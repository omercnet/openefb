import { runScrapeJob, readMeta, FEED_FILE } from "./job.js";
import { kvStore, type KVLike } from "./storage.js";

export interface Env {
  NOTAM_KV: KVLike;
  /** Optional. Enables POST /run (manual scrape, e.g. the first run after deploy). Set with `wrangler secret put RUN_SECRET`. */
  RUN_SECRET?: string;
}

/** Unhealthy when the last successful scrape is older than three cron periods (45 min) or never happened. */
export const MAX_AGE_SECONDS = 45 * 60;

const CORS = { "Access-Control-Allow-Origin": "*" };

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Constant-time compare of digests, so token length and content don't leak through timing. */
async function authorized(header: string | null, secret: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(header ?? ""), sha256(`Bearer ${secret}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function handleFetch(request: Request, env: Env, now: Date = new Date()): Promise<Response> {
  const store = kvStore(env.NOTAM_KV);
  const { pathname } = new URL(request.url);

  if (pathname === "/notams.json" && (request.method === "GET" || request.method === "HEAD")) {
    const body = await store.get(FEED_FILE);
    if (body === null) return new Response("no feed yet", { status: 503, headers: { "Cache-Control": "no-store", ...CORS } });
    // Tell the client (and the edge) how old the data is, so a stale feed is never mistaken for a current one.
    const meta = await readMeta(store);
    const ageSeconds = meta.lastSuccessAt ? Math.max(0, Math.round((now.getTime() - Date.parse(meta.lastSuccessAt)) / 1000)) : null;
    const stale = ageSeconds === null || ageSeconds > MAX_AGE_SECONDS;
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      // The scrape runs every 15 min; the app caches 5 min, the edge may too. A stale feed is not cached at the edge for long.
      "Cache-Control": stale ? "public, max-age=60" : "public, max-age=300, stale-while-revalidate=900",
      "X-Feed-Age-Seconds": ageSeconds === null ? "unknown" : String(ageSeconds),
      "X-Content-Type-Options": "nosniff",
      ...CORS,
    };
    if (meta.lastSuccessAt) headers["X-Feed-Last-Success"] = meta.lastSuccessAt;
    if (stale) headers["Warning"] = '110 - "Response is stale"';
    return new Response(request.method === "HEAD" ? null : body, { headers });
  }

  if (pathname === "/health" && request.method === "GET") {
    const meta = await readMeta(store);
    const ageSeconds = meta.lastSuccessAt ? Math.max(0, Math.round((now.getTime() - Date.parse(meta.lastSuccessAt)) / 1000)) : null;
    const ok = ageSeconds !== null && ageSeconds <= MAX_AGE_SECONDS;
    return Response.json(
      { ok, lastSuccessAt: meta.lastSuccessAt, ageSeconds, lastAttemptAt: meta.lastAttemptAt, lastError: meta.lastError, lastStats: meta.lastStats, consecutiveFailures: meta.consecutiveFailures ?? 0, nextAttemptAt: meta.nextAttemptAt ?? null },
      { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...CORS } },
    );
  }

  if (pathname === "/run" && request.method === "POST") {
    if (!env.RUN_SECRET) return new Response("RUN_SECRET not set", { status: 503, headers: { "Cache-Control": "no-store" } });
    if (!(await authorized(request.headers.get("authorization"), env.RUN_SECRET)))
      return new Response("unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
    const outcome = await runScrapeJob(store, { now });
    return Response.json(outcome, { status: outcome.status === "error" ? 502 : 200 });
  }

  return new Response("not found", { status: 404 });
}
