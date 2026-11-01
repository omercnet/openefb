import { isAdmin, unauthorized } from "@/lib/auth";
import { loadInterview } from "@/lib/interviews";
import { toMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req.headers.get("authorization"))) return unauthorized();
  const { id } = await ctx.params;
  const iv = await loadInterview(id);
  if (!iv) return new Response("not found", { status: 404 });
  return new Response(toMarkdown(iv), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `inline; filename="interview-${id}.md"`,
    },
  });
}
