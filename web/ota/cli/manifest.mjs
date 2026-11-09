// Pure publisher functions: read an `expo export` dir, build and sign manifests, verify signed parts.
import { createHash, createPublicKey, createVerify, constants, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { assetKey } from "../src/keys.ts";

const TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ttf: "font/ttf", otf: "font/otf", json: "application/json", mp3: "audio/mpeg", mp4: "video/mp4", hbc: "application/javascript", js: "application/javascript" };

/** Files of one platform from dist/metadata.json: the launch bundle first, then the assets. */
export function readExport(distDir, platform) {
  const meta = JSON.parse(readFileSync(path.join(distDir, "metadata.json"), "utf8")).fileMetadata?.[platform];
  if (!meta) throw new Error(`no ${platform} export in ${distDir}/metadata.json`);
  const file = (rel, ext) => {
    const bytes = readFileSync(path.join(distDir, rel));
    ext = ext ?? path.extname(rel).slice(1);
    return {
      bytes,
      ext: `.${ext}`,
      contentType: TYPES[ext] ?? "application/octet-stream",
      sha256hex: createHash("sha256").update(bytes).digest("hex"),
      sha256b64url: createHash("sha256").update(bytes).digest("base64url"),
      md5: createHash("md5").update(bytes).digest("hex"),
    };
  };
  return { launch: file(meta.bundle), assets: meta.assets.map((a) => file(a.path, a.ext)) };
}

const asset = (f, baseUrl) => ({ hash: f.sha256b64url, key: f.md5, contentType: f.contentType, fileExtension: f.ext, url: `${baseUrl}/${assetKey(f.sha256hex)}` });

/** The manifest JSON text that gets signed. `key` is md5 so embedded assets match and are not re-downloaded. */
export function buildManifest({ files, runtimeVersion, baseUrl, expoClient, id = randomUUID(), createdAt = new Date().toISOString() }) {
  return JSON.stringify({
    id,
    createdAt,
    runtimeVersion,
    launchAsset: asset(files.launch, baseUrl),
    assets: files.assets.map((f) => asset(f, baseUrl)),
    metadata: {},
    extra: { expoClient },
  });
}

export function buildDirective(commitTime = new Date().toISOString()) {
  return JSON.stringify({ type: "rollBackToEmbedded", parameters: { commitTime }, extra: {} });
}

/** RSASSA-PKCS1-v1_5 SHA-256 over the exact UTF-8 bytes, PKCS#8 PEM key. */
export function signatureHeader(body, privateKeyPem) {
  const sig = sign("sha256", Buffer.from(body, "utf8"), { key: privateKeyPem, padding: constants.RSA_PKCS1_PADDING });
  return `sig="${sig.toString("base64")}", keyid="main"`;
}

/** certPem may be a certificate or a public key PEM. */
export function verifyPart(body, header, certPem) {
  const m = /sig="([^"]+)"/.exec(header ?? "");
  if (!m || !/keyid="main"/.test(header)) return false;
  return createVerify("sha256").update(Buffer.from(body, "utf8")).verify({ key: createPublicKey(certPem), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(m[1], "base64"));
}

/**
 * rollback --to: same launchAsset/assets/extra under a new id and createdAt. Re-pointing to the old bytes is not enough:
 * clients launch the newest createdAt among the updates they hold. Throws when the archived part does not verify.
 */
export function republish(archived, certPem, privateKeyPem, { id = randomUUID(), createdAt = new Date().toISOString() } = {}) {
  if (archived.kind !== "manifest" || !verifyPart(archived.body, archived.signature, certPem)) throw new Error("archived update is not a manifest signed by this certificate");
  const body = JSON.stringify({ ...JSON.parse(archived.body), id, createdAt });
  return { kind: "manifest", body, signature: signatureHeader(body, privateKeyPem), updateId: id, createdAt };
}
