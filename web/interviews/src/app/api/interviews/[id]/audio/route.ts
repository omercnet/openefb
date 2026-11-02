import { audioPath, loadInterview, saveInterview } from "@/lib/interviews";
import { putObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_PART = 500_000; // the client sends ~150 KB parts (PART_BYTES); a 25 min call is ~30 parts
const MAX_PARTS = 200; // 200 x 500 KB = 100 MB hard ceiling per interview, however long the id is held
/** The browser flushes the last parts before it posts the end; allow a short grace for late parts, then close the door. */
const GRACE_MS = 2 * 60_000;

/** Best-effort audio: the browser uploads consecutive MediaRecorder chunks as numbered parts. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const seq = Number.parseInt(new URL(req.url).searchParams.get("seq") ?? "", 10);
  if (!Number.isInteger(seq) || seq < 0 || seq >= MAX_PARTS) return new Response("bad seq", { status: 400 });
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^audio\/(webm|mp4|ogg|aac|mpeg)$/.test(mime)) return new Response("bad type", { status: 415 });

  const iv = await loadInterview(id);
  if (!iv) return new Response("not found", { status: 404 });
  // Audio is only accepted while the interview is live (or just ended): the id alone must not be a standing upload slot.
  if (iv.status !== "active" && Date.now() - Date.parse(iv.endedAt ?? iv.startedAt) > GRACE_MS) return new Response("interview closed", { status: 409 });
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_PART) return new Response("bad size", { status: 413 });
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_PART) return new Response("bad size", { status: 413 });

  await putObject(audioPath(id, seq), buf, mime);
  // parts arrive sequentially from one client; record the high-water mark
  if (!iv.audio || iv.audio.parts < seq + 1) {
    const fresh = (await loadInterview(id)) ?? iv;
    fresh.audio = { mime, parts: Math.max(fresh.audio?.parts ?? 0, seq + 1) };
    await saveInterview(fresh);
  }
  return Response.json({ ok: true });
}
