import { audioPath, loadInterview, saveInterview } from "@/lib/interviews";
import { putObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

const MAX_PART = 3_500_000; // Vercel request bodies are capped at 4.5 MB
const MAX_PARTS = 1000;

/** Best-effort audio: the browser uploads consecutive MediaRecorder chunks as numbered parts. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const seq = Number.parseInt(new URL(req.url).searchParams.get("seq") ?? "", 10);
  if (!Number.isInteger(seq) || seq < 0 || seq >= MAX_PARTS) return new Response("bad seq", { status: 400 });
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!/^audio\/(webm|mp4|ogg|aac|mpeg)$/.test(mime)) return new Response("bad type", { status: 415 });

  const iv = await loadInterview(id);
  if (!iv) return new Response("not found", { status: 404 });
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
