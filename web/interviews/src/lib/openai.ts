const API = "https://api.openai.com/v1";

function key(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("OPENAI_API_KEY is not set");
  return k;
}

/** Unified-interface WebRTC call: send the browser's SDP offer + session config, get the SDP answer + call id. */
export async function createCall(
  sdp: string,
  session: unknown,
  safetyId: string,
): Promise<{ answer: string; callId: string | null } | { error: string; status: number }> {
  const fd = new FormData();
  fd.set("sdp", sdp);
  fd.set("session", JSON.stringify(session));
  try {
    const r = await fetch(`${API}/realtime/calls`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "OpenAI-Safety-Identifier": safetyId },
      body: fd,
      signal: AbortSignal.timeout(20_000),
    });
    const body = await r.text();
    if (!r.ok) return { error: body.slice(0, 500), status: r.status };
    const loc = r.headers.get("location");
    return { answer: body, callId: loc ? (loc.split("/").filter(Boolean).pop() ?? null) : null };
  } catch (e) {
    return { error: `request failed: ${e instanceof Error ? e.message : String(e)}`, status: 504 };
  }
}

export async function hangup(callId: string): Promise<void> {
  try {
    await fetch(`${API}/realtime/calls/${encodeURIComponent(callId)}/hangup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    /* already gone */
  }
}

export async function jsonResponse(model: string, instructions: string, input: string): Promise<string> {
  const r = await fetch(`${API}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      instructions,
      input,
      text: { format: { type: "json_object" } },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`responses ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = (await r.json()) as {
    output?: { type: string; content?: { type: string; text?: string }[] }[];
  };
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) if (c.type === "output_text" && c.text) return c.text;
  }
  throw new Error("no text in responses output");
}
