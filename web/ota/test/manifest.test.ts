import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildManifest, readExport, republish, signatureHeader, verifyPart } from "../cli/manifest.mjs";
import { newKeyPair } from "./keys.js";

const dist = "test/fixtures/dist";
const a = newKeyPair();
const b = newKeyPair();
const build = () => buildManifest({ files: readExport(dist, "ios"), runtimeVersion: "rv1", baseUrl: "http://localhost:8787", expoClient: { name: "Kanaf" } });

describe("buildManifest", () => {
  it("describes the launch bundle and assets with sha256 hash, md5 key and content-addressed urls", () => {
    const m = JSON.parse(build());
    const bundle = readFileSync(`${dist}/_expo/static/js/ios/entry-abc.hbc`);
    const hex = createHash("sha256").update(bundle).digest("hex");
    expect(m.launchAsset).toEqual({
      hash: createHash("sha256").update(bundle).digest("base64url"),
      key: createHash("md5").update(bundle).digest("hex"),
      contentType: "application/javascript",
      fileExtension: ".hbc",
      url: `http://localhost:8787/assets/${hex}`,
    });
    expect(m.assets).toHaveLength(1);
    expect(m.assets[0].contentType).toBe("image/png");
    expect(m.assets[0].fileExtension).toBe(".png");
    expect(m.runtimeVersion).toBe("rv1");
    expect(m.extra.expoClient).toEqual({ name: "Kanaf" });
  });
});

describe("signing", () => {
  it("verifies, and fails on a flipped byte or another key", () => {
    const body = build();
    const header = signatureHeader(body, a.privateKey);
    expect(verifyPart(body, header, a.publicKey)).toBe(true);
    expect(verifyPart(body.replace("rv1", "rv2"), header, a.publicKey)).toBe(false);
    expect(verifyPart(body, signatureHeader(body, b.privateKey), a.publicKey)).toBe(false);
    expect(verifyPart(body, header.replace('keyid="main"', 'keyid="other"'), a.publicKey)).toBe(false);
  });
});

describe("republish (rollback --to)", () => {
  const body = build();
  const old = { kind: "manifest", body, signature: signatureHeader(body, a.privateKey), createdAt: "2026-01-01T00:00:00.000Z" };

  it("keeps the assets under a new id and a later createdAt, and verifies", () => {
    const r = republish(old, a.publicKey, a.privateKey);
    const before = JSON.parse(body);
    const after = JSON.parse(r.body);
    expect(after.launchAsset).toEqual(before.launchAsset);
    expect(after.assets).toEqual(before.assets);
    expect(after.id).not.toBe(before.id);
    expect(after.id).toBe(r.updateId);
    expect(after.createdAt > before.createdAt).toBe(true);
    expect(verifyPart(r.body, r.signature, a.publicKey)).toBe(true);
  });

  it("refuses an archived update that was not signed by the certificate's key", () => {
    expect(() => republish(old, b.publicKey, b.privateKey)).toThrow();
  });
});
