import { isAdmin, unauthorized } from "@/lib/auth";
import { audioPath, loadInterview } from "@/lib/interviews";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Streams the stored parts back-to-back (MediaRecorder chunks concatenate into one valid file). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req.headers.get("authorization"))) return unauthorized();
  const { id } = await ctx.params;
  const iv = await loadInterview(id);
  if (!iv?.audio) return new Response("no audio", { status: 404 });
  const { mime, parts } = iv.audio;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < parts; i++) {
          const part = await getObject(audioPath(id, i));
          if (!part) continue; // a dropped part: keep going with what exists
          const reader = part.stream.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": mime, "Cache-Control": "private, no-store" } });
}
