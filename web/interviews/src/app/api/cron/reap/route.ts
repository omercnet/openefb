import { config } from "@/lib/config";
import { activePath, finish, loadInterview } from "@/lib/interviews";
import { deleteObjects, getJson, listPaths } from "@/lib/storage";
import { safeEqual } from "@/lib/limits";

export const dynamic = "force-dynamic";

/**
 * Backstop for the session cap: hangs up calls whose browser never ended them (closed tab, tampered client).
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET not set", { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("unauthorized", { status: 401 });

  const cutoff = Date.now() - (config.maxSessionSeconds + 60) * 1000;
  let reaped = 0;
  for (const p of await listPaths("active/", 500)) {
    const marker = await getJson<{ id: string; startedAt: string }>(p);
    if (!marker) continue;
    if (Date.parse(marker.startedAt) > cutoff) continue;
    const iv = await loadInterview(marker.id);
    if (iv) await finish(iv, "capped");
    else await deleteObjects([activePath(marker.id)]);
    reaped++;
  }
  return Response.json({ reaped });
}
