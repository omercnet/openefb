// POST /v1/counters: anonymous usage counters from the Kanaf app, written to Workers Analytics Engine.
//
// What this code does not do, and tests enforce: it reads no request header and no Cloudflare property (so no address,
// agent, cookie, location or token can reach storage), stores only fields the schema names, echoes nothing back, and sets no
// cookie. It is inert until the COUNTERS binding exists, so deploying the Worker without it stores nothing.
import { schema, type DataPoint } from "./schema.js";
import { isRecord } from "./typeGuards.js";

export type { DataPoint } from "./schema.js";

/** The slice of a Workers Analytics Engine dataset binding the handler uses. */
export interface AnalyticsEngineLike {
  writeDataPoint(point: DataPoint): void;
}

export interface Env {
  /** wrangler.toml `[[analytics_engine_datasets]]`. Absent until the owner deploys with it. */
  COUNTERS?: AnalyticsEngineLike;
}

/** A batch of at most 40 rows is about 7 KB; the cap only stops oversized bodies. */
export const MAX_BODY_BYTES = 16 * 1024;

function respond(status: number, body: string, contentType = "text/plain", extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "content-type": contentType, "cache-control": "no-store", ...extra } });
}

/** The body as text, or null once it passes `max` bytes (the rest is not read). */
async function readLimited(body: ReadableStream<Uint8Array> | null, max: number): Promise<string | null> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/** The batch's rows, or null when the body is not `{ v: 1, counters: [1 to maxRows rows] }` and nothing else. */
function rowsOf(text: string): unknown[] | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes("v") || !keys.includes("counters")) return null;
  const { v, counters } = body;
  if (v !== 1 || !Array.isArray(counters) || counters.length < 1 || counters.length > schema.maxRows) return null;
  return counters;
}

export async function handleFetch(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/health") return respond(200, "ok");
  if (pathname !== "/v1/counters") return respond(404, "not found");
  if (request.method !== "POST") return respond(405, "POST only", "text/plain", { allow: "POST" });
  const counters = env.COUNTERS;
  if (!counters) return respond(503, "counting is not configured");

  const text = await readLimited(request.body, MAX_BODY_BYTES);
  if (text === null) return respond(413, "body too large");
  const rows = rowsOf(text);
  if (!rows) return respond(400, "not a counter batch");

  let accepted = 0;
  let dropped = 0;
  for (const row of rows) {
    const point = schema.toDataPoint(row);
    if (!point) {
      dropped += 1;
      continue;
    }
    try {
      counters.writeDataPoint(point);
    } catch {
      // The dataset refused (quota, outage). The app keeps its counters and tries again with the next batch.
      return respond(503, "counting failed");
    }
    accepted += 1;
  }
  return respond(202, JSON.stringify({ accepted, dropped }), "application/json");
}
