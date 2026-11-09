#!/usr/bin/env node
// Publish, roll back and verify Expo updates in the openefb-ota R2 bucket. Signing happens here, never on the Worker.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PLATFORMS, SEGMENT, archiveKey, assetKey, pointerKey } from "../src/keys.ts";
import { buildDirective, buildManifest, readExport, republish, signatureHeader, verifyPart } from "./manifest.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const repoRoot = path.resolve(root, "../..");
const USAGE = `usage: ota.mjs publish  --dist <dir> --platform <ios|android> --channel <c> --runtime-version <rv> --key <pem> --base-url <url> [--published-by <text>] [--dry-run]
       ota.mjs rollback (--embedded | --to <updateId>) --platform <p> --channel <c> --runtime-version <rv> --key <pem> [--certificate <pem>]
       ota.mjs status   --platform <p> --channel <c> --runtime-version <rv>
       ota.mjs verify   --platform <p> --channel <c> --runtime-version <rv> --certificate <pem>
  common: [--local | --remote] (default --local, nothing leaves this machine) [--bucket openefb-ota]
  --key defaults to env OTA_PRIVATE_KEY_FILE; a key inside this checkout is refused without --allow-repo-key.
  --certificate (rollback --to, verify): certificate or public key PEM`;

const { positionals, values: o } = parseArgs({
  allowPositionals: true,
  options: {
    dist: { type: "string" }, platform: { type: "string" }, channel: { type: "string" }, "runtime-version": { type: "string" },
    key: { type: "string" }, certificate: { type: "string" }, "base-url": { type: "string" }, "published-by": { type: "string" },
    embedded: { type: "boolean" }, to: { type: "string" }, local: { type: "boolean" }, remote: { type: "boolean" },
    bucket: { type: "string", default: "openefb-ota" }, "dry-run": { type: "boolean" }, "allow-repo-key": { type: "boolean" }, help: { type: "boolean" },
  },
});
const fail = (msg) => { console.error(`ota: ${msg}\n${USAGE}`); process.exit(2); };
const cmd = positionals[0];
if (o.help || !cmd) { console.log(USAGE); process.exit(o.help ? 0 : 2); }
if (o.local && o.remote) fail("--local and --remote are exclusive");
const mode = o.remote ? "--remote" : "--local";
const { platform, channel, "runtime-version": rv } = o;
if (!PLATFORMS.includes(platform)) fail("--platform must be ios or android");
if (!SEGMENT.test(channel ?? "")) fail("--channel is required (letters, digits, . _ -)");
if (!SEGMENT.test(rv ?? "")) fail("--runtime-version is required (letters, digits, . _ -)");

function wrangler(args) {
  const r = spawnSync("npx", ["--no-install", "wrangler", ...args], { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}
async function put(key, file, contentType, cacheControl) {
  const r = wrangler(["r2", "object", "put", `${o.bucket}/${key}`, "--file", file, "--content-type", contentType, "--cache-control", cacheControl, mode, "-y"]);
  if (!r.ok) throw new Error(`upload of ${key} failed:\n${r.out}`);
}
/** Object text, or null when the key does not exist. */
async function get(key, tmp) {
  const file = path.join(tmp, "get");
  const r = wrangler(["r2", "object", "get", `${o.bucket}/${key}`, "--file", file, mode]);
  if (!r.ok) {
    if (/does not exist|not found|NoSuchKey/i.test(r.out)) return null;
    throw new Error(`could not read ${key}:\n${r.out}`);
  }
  const text = await readFile(file, "utf8");
  await rm(file);
  return text;
}
async function putJson(key, obj, tmp) {
  const file = path.join(tmp, "put.json");
  await writeFile(file, JSON.stringify(obj));
  await put(key, file, "application/json", "no-store");
}
const readPem = (p) => { if (!existsSync(p)) fail(`${p} does not exist`); return readFileSync(p, "utf8"); };
function privateKey() {
  const p = o.key ?? process.env.OTA_PRIVATE_KEY_FILE;
  if (!p) fail("--key or OTA_PRIVATE_KEY_FILE is required");
  const abs = path.resolve(p);
  if (!o["allow-repo-key"] && (abs === repoRoot || abs.startsWith(repoRoot + path.sep))) fail(`refusing a private key inside the checkout: ${abs}`);
  return readPem(abs);
}

const ptr = pointerKey(channel, rv, platform);
const tmp = await mkdtemp(path.join(tmpdir(), "ota-"));
try {
  if (cmd === "publish") {
    if (!o.dist || !o["base-url"]) fail("--dist and --base-url are required");
    const key = privateKey();
    const files = readExport(o.dist, platform);
    const expoConfig = path.join(o.dist, "expoConfig.json");
    const expoClient = existsSync(expoConfig) ? JSON.parse(readFileSync(expoConfig, "utf8")) : {};
    const body = buildManifest({ files, runtimeVersion: rv, baseUrl: o["base-url"].replace(/\/$/, ""), expoClient });
    const { id, createdAt } = JSON.parse(body);
    const obj = { kind: "manifest", body, signature: signatureHeader(body, key), updateId: id, createdAt, publishedBy: o["published-by"] };
    const all = new Map([files.launch, ...files.assets].map((f) => [f.sha256hex, f]));
    let uploaded = 0;
    if (!o["dry-run"]) {
      for (const f of all.values()) { // assets first, then the archive, then the pointer: a crash leaves the channel unchanged
        if (await get(assetKey(f.sha256hex), tmp) !== null) continue;
        const file = path.join(tmp, "asset");
        await writeFile(file, f.bytes);
        await put(assetKey(f.sha256hex), file, f.contentType, "public, max-age=31536000, immutable");
        uploaded++;
      }
      await putJson(archiveKey(channel, rv, platform, id), obj, tmp);
      await putJson(ptr, obj, tmp);
    }
    console.log(`published ${id} channel=${channel} runtime=${rv} platform=${platform} assets=${all.size} uploaded=${uploaded}`);
  } else if (cmd === "rollback") {
    if (!o.embedded === !o.to) fail("rollback needs exactly one of --embedded or --to <updateId>");
    const key = privateKey();
    let obj, label;
    if (o.embedded) {
      const body = buildDirective();
      const createdAt = JSON.parse(body).parameters.commitTime;
      obj = { kind: "directive", body, signature: signatureHeader(body, key), createdAt };
      await putJson(archiveKey(channel, rv, platform, `rollback-${createdAt.replace(/[:.]/g, "-")}`), obj, tmp);
      label = "embedded";
    } else {
      if (!SEGMENT.test(o.to)) fail("--to must be an update id");
      if (!o.certificate) fail("--certificate is required for --to");
      const old = await get(archiveKey(channel, rv, platform, o.to), tmp);
      if (old === null) throw new Error(`no archived update ${o.to}`);
      obj = republish(JSON.parse(old), readPem(o.certificate), key);
      await putJson(archiveKey(channel, rv, platform, obj.updateId), obj, tmp);
      label = `${o.to} as ${obj.updateId}`;
    }
    await putJson(ptr, obj, tmp);
    console.log(`rolled-back ${label} channel=${channel} runtime=${rv} platform=${platform}`);
  } else if (cmd === "status" || cmd === "verify") {
    const text = await get(ptr, tmp);
    if (cmd === "status") {
      console.log(text ?? "none");
    } else {
      if (!o.certificate) fail("--certificate is required");
      if (text === null) { console.error(`verify: no pointer at ${ptr}`); process.exit(1); }
      const p = JSON.parse(text);
      if (!verifyPart(p.body, p.signature, readPem(o.certificate))) { console.error(`verify: signature does not verify for ${ptr}`); process.exit(1); }
      console.log(`ok ${p.kind} ${p.updateId ?? ""} ${ptr}`.replace(/ +/g, " "));
    }
  } else {
    fail(`unknown command ${cmd}`);
  }
} catch (e) {
  console.error(`ota: ${e.message}`);
  process.exit(1);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
