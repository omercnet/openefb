import { PLATFORMS, SEGMENT, assetKey, pointerKey } from "./keys.js";
import { BOUNDARY, buildPart } from "./multipart.js";

export interface R2ObjectLike {
  body: ReadableStream;
  text(): Promise<string>;
  httpMetadata?: { contentType?: string };
}
export interface R2Like {
  get(key: string): Promise<R2ObjectLike | null>;
}
export interface Env {
  OTA_BUCKET: R2Like;
}

const PROTOCOL = { "expo-protocol-version": "1", "expo-sfv-version": "0", "cache-control": "private, max-age=0" };
const text = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "text/plain" } });

async function manifest(request: Request, env: Env): Promise<Response> {
  const h = request.headers;
  if (h.get("expo-protocol-version") !== "1") return text(400, "expo-protocol-version must be 1");
  const platform = h.get("expo-platform") ?? "";
  if (!PLATFORMS.includes(platform)) return text(400, "bad expo-platform");
  const rv = h.get("expo-runtime-version") ?? "";
  if (!SEGMENT.test(rv)) return text(400, "bad expo-runtime-version");
  const channel = h.get("expo-channel-name") ?? "production";
  if (!SEGMENT.test(channel)) return text(400, "bad expo-channel-name");

  const obj = await env.OTA_BUCKET.get(pointerKey(channel, rv, platform));
  if (!obj) return new Response(null, { status: 204, headers: PROTOCOL });

  let pointer: { kind?: string; body?: unknown; signature?: unknown };
  try {
    pointer = JSON.parse(await obj.text());
  } catch {
    return text(500, "unparsable pointer");
  }
  if ((pointer.kind !== "manifest" && pointer.kind !== "directive") || typeof pointer.body !== "string" || typeof pointer.signature !== "string") {
    return text(500, "invalid pointer");
  }
  let body: string;
  try {
    body = buildPart(pointer.kind, pointer.body, pointer.signature);
  } catch {
    return text(500, "pointer body contains the multipart boundary");
  }
  return new Response(body, { headers: { ...PROTOCOL, "content-type": `multipart/mixed; boundary=${BOUNDARY}` } });
}

async function asset(hex: string, env: Env): Promise<Response> {
  if (!/^[0-9a-f]{64}$/.test(hex)) return text(400, "bad asset id");
  const obj = await env.OTA_BUCKET.get(assetKey(hex));
  if (!obj) return text(404, "not found");
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}

export async function handleFetch(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return text(405, "method not allowed");
  const { pathname } = new URL(request.url);
  if (pathname === "/health") return Response.json({ ok: true });
  if (pathname === "/manifest") return manifest(request, env);
  if (pathname.startsWith("/assets/")) return asset(pathname.slice("/assets/".length), env);
  return text(404, "not found");
}
