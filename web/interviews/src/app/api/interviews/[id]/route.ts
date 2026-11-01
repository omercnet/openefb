import { after } from "next/server";
import { config } from "@/lib/config";
import { finish, loadInterview, saveInterview } from "@/lib/interviews";
import { summarize } from "@/lib/summary";
import type { Interview, Outcome, TranscriptEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

function cleanTranscript(v: unknown): TranscriptEntry[] | null {
  if (!Array.isArray(v) || v.length > 2000) return null;
  const out: TranscriptEntry[] = [];
  for (const e of v) {
    if (!e || (e.role !== "pilot" && e.role !== "interviewer") || typeof e.text !== "string") return null;
    out.push({ role: e.role, text: e.text.slice(0, 5000), t: Number.isFinite(e.t) ? Math.max(0, Number(e.t)) : 0 });
  }
  return out;
}

function cleanOutcome(v: unknown): Outcome | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (o.commitment !== "yes" && o.commitment !== "no" && o.commitment !== "unsure") return undefined;
  const p = (o.profile && typeof o.profile === "object" ? o.profile : {}) as Record<string, unknown>;
  return {
    commitment: o.commitment,
    email: str(o.email, 200),
    note: str(o.note, 500),
    profile: {
      certificate: str(p.certificate, 200),
      hours_per_year: str(p.hours_per_year, 200),
      aircraft: str(p.aircraft, 200),
      owner_or_rental: str(p.owner_or_rental, 200),
      efb_used: str(p.efb_used, 200),
    },
  };
}

/**
 * Save transcript/outcome for an interview (partial saves while live, final on end).
 * The 128-bit random id from /api/session is the capability; ended interviews can only grow their transcript.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raw = await req.text();
  if (raw.length > 1_500_000) return new Response("too large", { status: 413 });
  let body: { transcript?: unknown; outcome?: unknown; end?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const iv: Interview | null = await loadInterview(id);
  if (!iv) return new Response("not found", { status: 404 });

  const transcript = body.transcript === undefined ? null : cleanTranscript(body.transcript);
  if (body.transcript !== undefined && !transcript) return new Response("bad transcript", { status: 400 });
  if (transcript && (iv.status === "active" || transcript.length >= iv.transcript.length)) {
    iv.transcript = transcript;
  }
  const outcome = cleanOutcome(body.outcome);
  if (outcome) iv.outcome = outcome;
  const end = body.end;
  if (end === "completed" || end === "dropped" || end === "capped") {
    const wasActive = iv.status === "active";
    await saveInterview(iv);
    // a client can't claim "completed" past the hard cap
    const status = end === "completed" && Date.now() - Date.parse(iv.startedAt) > (config.maxSessionSeconds + 120) * 1000 ? "capped" : end;
    await finish(iv, status);
    if (wasActive) after(() => summarize(id));
  } else {
    await saveInterview(iv);
  }
  return Response.json({ ok: true });
}
