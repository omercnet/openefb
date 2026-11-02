#!/usr/bin/env node
// Upload a chart pack edition to the R2 bucket and update the manifests. See README.md for the interface.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { assertApprovable, assertImmutable, assertSegment, buildEditionManifest, mergeProductManifest, objectKey, productManifestKey } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const USAGE = `usage: publish.sh --product <id> --edition <id> --pack <file> [--pack <file>...] [--manifest <manifest.json>]
                  [--approve] [--manifest-only] [--local | --remote] [--dry-run] [--bucket <name>] [--base-url <https://...>]
  --pack           pack file(s) to upload to <product>/<edition>/ (repeatable; wrangler's upload limit is 300 MiB per file)
  --manifest       the pipeline's edition manifest.json (default: manifest.json next to the first --pack)
  --approve        set published=true (the owner's go-ahead). Without it the edition is uploaded as published=false
                   and the app ignores it, unless it was already published (never silently unpublishes).
  --manifest-only  skip pack uploads (packs already in the bucket); recompute hashes from the local files and update manifests
  --local          use wrangler's local R2 simulator (default; nothing leaves this machine)
  --remote         the real bucket (needs 'wrangler login')
  --dry-run        print the plan and the manifests; upload nothing
  --bucket         default openefb-charts   --base-url  adds absolute "url" fields (or env CHARTS_PUBLIC_URL)`;

const { values: o } = parseArgs({
  options: {
    product: { type: "string" }, edition: { type: "string" }, pack: { type: "string", multiple: true }, manifest: { type: "string" },
    approve: { type: "boolean" }, "manifest-only": { type: "boolean" }, local: { type: "boolean" }, remote: { type: "boolean" },
    "dry-run": { type: "boolean" }, bucket: { type: "string", default: "openefb-charts" }, "base-url": { type: "string" }, help: { type: "boolean" },
  },
});
const fail = (msg) => { console.error(`publish: ${msg}\n${USAGE}`); process.exit(2); };
if (o.help) { console.log(USAGE); process.exit(0); }
if (o.local && o.remote) fail("--local and --remote are exclusive");
if (!o.product || !o.edition || !o.pack?.length) fail("--product, --edition and at least one --pack are required");
assertSegment("product", o.product);
assertSegment("edition", o.edition);
const mode = o.remote ? "--remote" : "--local";
const baseUrl = o["base-url"] ?? process.env.CHARTS_PUBLIC_URL;

async function sha256(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}

function wrangler(args) {
  const r = spawnSync("npx", ["--no-install", "wrangler", ...args], { cwd: here, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

async function put(key, file, contentType, cacheControl) {
  const r = wrangler(["r2", "object", "put", `${o.bucket}/${key}`, "--file", file, "--content-type", contentType, "--cache-control", cacheControl, mode, "-y"]);
  if (!r.ok) throw new Error(`upload of ${key} failed:\n${r.out}`);
}

/** Existing JSON object, or null when the key doesn't exist yet. Any other failure is an error. */
async function getJson(key, tmp) {
  const file = path.join(tmp, `get-${Math.random().toString(36).slice(2)}.json`);
  const r = wrangler(["r2", "object", "get", `${o.bucket}/${key}`, "--file", file, mode]);
  if (!r.ok) {
    if (/does not exist|not found|NoSuchKey/i.test(r.out)) return null;
    throw new Error(`could not read ${key}:\n${r.out}`);
  }
  return JSON.parse(await readFile(file, "utf8"));
}

const tmp = await mkdtemp(path.join(tmpdir(), "efb-publish-"));
try {
  const files = [];
  for (const p of o.pack) {
    const st = await stat(p);
    if (!st.isFile()) fail(`${p} is not a file`);
    files.push({ path: p, name: assertSegment("file", path.basename(p)), bytes: st.size, sha256: await sha256(p) });
  }
  const manifestPath = o.manifest ?? path.join(path.dirname(o.pack[0]), "manifest.json");
  const source = JSON.parse(await readFile(manifestPath, "utf8"));
  const now = new Date().toISOString();

  const existingEdition = o["dry-run"] ? null : await getJson(objectKey(o.product, o.edition, "manifest.json"), tmp);
  assertImmutable(existingEdition, files);
  assertApprovable(source, Boolean(o.approve));
  const edition = buildEditionManifest({ product: o.product, edition: o.edition, source, files, existing: existingEdition, approve: Boolean(o.approve), now, baseUrl });
  const existingProduct = o["dry-run"] ? null : await getJson(productManifestKey(o.product), tmp);
  const product = mergeProductManifest(existingProduct, edition, now);

  console.log(`target: ${o.bucket} (${mode.slice(2)}), ${o["dry-run"] ? "DRY RUN" : "uploading"}`);
  for (const f of files) console.log(`  ${o["manifest-only"] ? "skip " : "pack "} ${objectKey(o.product, o.edition, f.name)}  ${f.bytes} B  sha256 ${f.sha256.slice(0, 16)}...`);
  console.log(`  edition manifest ${objectKey(o.product, o.edition, "manifest.json")}  published=${edition.published}`);
  console.log(`  product manifest ${productManifestKey(o.product)}  latest=${product.latest}`);
  if (o["dry-run"]) { console.log(JSON.stringify({ edition, product }, null, 2)); process.exit(0); }

  // Order matters: packs first, then the edition manifest, then the product index the app polls.
  if (!o["manifest-only"]) {
    for (const f of files) await put(objectKey(o.product, o.edition, f.name), f.path, "application/octet-stream", "public, max-age=31536000, immutable");
  }
  const editionFile = path.join(tmp, "edition.json");
  await writeFile(editionFile, JSON.stringify(edition, null, 2));
  await put(objectKey(o.product, o.edition, "manifest.json"), editionFile, "application/json", "public, max-age=300");
  const productFile = path.join(tmp, "product.json");
  await writeFile(productFile, JSON.stringify(product, null, 2));
  await put(productManifestKey(o.product), productFile, "application/json", "public, max-age=300");
  console.log(`done: ${o.product}/${o.edition} published=${edition.published}`);
} catch (err) {
  console.error(`publish: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
} finally {
  await rm(tmp, { recursive: true, force: true });
}
