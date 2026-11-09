import { describe, expect, it, vi } from "vitest";
import { handleFetch, type R2Like } from "../src/handler.js";
import { pointerKey } from "../src/keys.js";
import { buildDirective, buildManifest, readExport, signatureHeader, verifyPart } from "../cli/manifest.mjs";
import { newKeyPair } from "./keys.js";

const { privateKey, publicKey } = newKeyPair();
const text = (s: string) => ({ text: async () => s, body: new Response(s).body! });

function bucket(objects: Record<string, { text: string; contentType?: string }>) {
  const get = vi.fn(async (key: string) => {
    const o = objects[key];
    return o ? { ...text(o.text), httpMetadata: { contentType: o.contentType } } : null;
  });
  return { env: { OTA_BUCKET: { get } as R2Like }, get };
}

const headers = (over: Record<string, string> = {}) => ({
  "expo-protocol-version": "1", "expo-platform": "ios", "expo-runtime-version": "rv1", "expo-channel-name": "production", ...over,
});
const call = (env: { OTA_BUCKET: R2Like }, path: string, h: Record<string, string> = headers()) => handleFetch(new Request(`http://x${path}`, { headers: h }), env);

function pointer(kind: "manifest" | "directive", body: string) {
  return JSON.stringify({ kind, body, signature: signatureHeader(body, privateKey), createdAt: "2026-11-09T00:00:00.000Z" });
}
const files = readExport("test/fixtures/dist", "ios");
// Body with characters that a re-serialiser would change: unicode, escaped slash, trailing spaces inside strings.
const manifestBody = buildManifest({ files, runtimeVersion: "rv1", baseUrl: "http://x", expoClient: { name: "K\u00e4naf  ", path: "a\\/b" } });

/** Splits the single multipart part: returns its headers and the exact body text. */
function parsePart(raw: string) {
  const m = /^--(\S+)\r\n([\s\S]*?)\r\n\r\n([\s\S]*)\r\n--\1--\r\n$/.exec(raw)!;
  const hdr = Object.fromEntries(m[2].split("\r\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  return { hdr, body: m[3] };
}

describe("GET /manifest", () => {
  it("serves a manifest whose signature verifies over the exact served bytes", async () => {
    const { env } = bucket({ [pointerKey("production", "rv1", "ios")]: { text: pointer("manifest", manifestBody) } });
    const res = await call(env, "/manifest");
    expect(res.status).toBe(200);
    expect(res.headers.get("expo-protocol-version")).toBe("1");
    expect(res.headers.get("expo-sfv-version")).toBe("0");
    expect(res.headers.get("content-type")).toMatch(/^multipart\/mixed; boundary=/);
    const part = parsePart(await res.text());
    expect(part.hdr["content-disposition"]).toBe('form-data; name="manifest"');
    expect(part.body).toBe(manifestBody);
    expect(verifyPart(part.body, part.hdr["expo-signature"], publicKey)).toBe(true);
  });

  it("serves a directive under its own part name with a verifying signature", async () => {
    const body = buildDirective("2026-11-09T00:00:00.000Z");
    const { env } = bucket({ [pointerKey("production", "rv1", "ios")]: { text: pointer("directive", body) } });
    const part = parsePart(await (await call(env, "/manifest")).text());
    expect(part.hdr["content-disposition"]).toBe('form-data; name="directive"');
    expect(verifyPart(part.body, part.hdr["expo-signature"], publicKey)).toBe(true);
  });

  it("returns 204 without a pointer, and isolates runtime, platform and channel", async () => {
    const { env } = bucket({ [pointerKey("production", "rv1", "ios")]: { text: pointer("manifest", manifestBody) } });
    expect((await call(env, "/manifest")).status).toBe(200);
    for (const over of [{ "expo-runtime-version": "rv2" }, { "expo-platform": "android" }, { "expo-channel-name": "beta" }] as Record<string, string>[]) {
      const res = await call(env, "/manifest", headers(over));
      expect(res.status).toBe(204);
      expect(res.headers.get("expo-protocol-version")).toBe("1");
      expect(await res.text()).toBe("");
    }
    expect((await call(bucket({}).env, "/manifest")).status).toBe(204);
  });

  it("defaults the channel to production when the header is absent", async () => {
    const { env } = bucket({ [pointerKey("production", "rv1", "ios")]: { text: pointer("manifest", manifestBody) } });
    const h: Record<string, string> = headers();
    delete h["expo-channel-name"];
    expect((await call(env, "/manifest", h)).status).toBe(200);
  });

  it("rejects bad headers with 400 and never touches R2 for a bad segment", async () => {
    const { env, get } = bucket({});
    const missing: Record<string, string> = headers();
    delete missing["expo-protocol-version"];
    expect((await call(env, "/manifest", missing)).status).toBe(400);
    expect((await call(env, "/manifest", headers({ "expo-protocol-version": "0" }))).status).toBe(400);
    expect((await call(env, "/manifest", headers({ "expo-platform": "web" }))).status).toBe(400);
    expect((await call(env, "/manifest", headers({ "expo-channel-name": "../x" }))).status).toBe(400);
    expect((await call(env, "/manifest", headers({ "expo-runtime-version": "a/b" }))).status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });

  it("returns 500, not 204, for a corrupt pointer", async () => {
    for (const t of ["{not json", JSON.stringify({ kind: "weird", body: "x", signature: "y" })]) {
      const { env } = bucket({ [pointerKey("production", "rv1", "ios")]: { text: t } });
      expect((await call(env, "/manifest")).status).toBe(500);
    }
  });
});

describe("GET /assets", () => {
  const hex = "a".repeat(64);
  it("streams the stored content type with immutable caching", async () => {
    const { env } = bucket({ [`assets/${hex}`]: { text: "data", contentType: "image/png" } });
    const res = await call(env, `/assets/${hex}`, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe("data");
  });

  it("404s an unknown asset and 400s a non-hash id without an R2 call", async () => {
    const { env, get } = bucket({});
    expect((await call(env, `/assets/${hex}`, {})).status).toBe(404);
    get.mockClear();
    expect((await call(env, "/assets/..%2Fchannels%2Fx", {})).status).toBe(400);
    expect((await call(env, "/assets/ABC", {})).status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });
});
