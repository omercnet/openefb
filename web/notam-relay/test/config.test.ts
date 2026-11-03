import { describe, expect, it } from "vitest";
import { handleFetch, type Env } from "../src/handler.js";
import type { KVLike } from "../src/storage.js";

class MemoryKV implements KVLike {
  data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
}

const env = (): Env => ({ NOTAM_KV: new MemoryKV() });
const req = (path: string, init?: RequestInit) => new Request(`https://relay.test${path}`, init);

describe("GET /config.json (remote app config)", () => {
  it("serves the checked-in file as JSON with a 5 minute cache", async () => {
    const res = await handleFetch(req("/config.json"), env());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schemaVersion).toBe(1);
  });

  it("carries what the app needs to accept it: an integer serial and an expiry after the issue date", async () => {
    const body = (await (await handleFetch(req("/config.json"), env())).json()) as {
      serial: unknown;
      issuedAt: string;
      expiresAt: string;
    };
    expect(Number.isInteger(body.serial)).toBe(true);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.parse(body.issuedAt));
  });

  it("answers HEAD without a body and rejects other methods", async () => {
    const head = await handleFetch(req("/config.json", { method: "HEAD" }), env());
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const post = await handleFetch(req("/config.json", { method: "POST" }), env());
    expect(post.status).toBe(404);
  });
});
