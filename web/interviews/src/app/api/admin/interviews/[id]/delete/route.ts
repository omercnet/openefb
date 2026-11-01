import { isAdmin, unauthorized } from "@/lib/auth";
import { deleteInterview, loadInterview } from "@/lib/interviews";
import { hangup } from "@/lib/openai";

export const dynamic = "force-dynamic";

/** Honours a pilot's deletion request: transcript, audio and markers. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req.headers.get("authorization"))) return unauthorized();
  const { id } = await ctx.params;
  const iv = await loadInterview(id);
  if (!iv) return new Response("not found", { status: 404 });
  if (iv.status === "active" && iv.callId) await hangup(iv.callId);
  await deleteInterview(id);
  return Response.redirect(new URL("/admin", req.url), 303);
}
