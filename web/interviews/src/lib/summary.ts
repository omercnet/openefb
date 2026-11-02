import { config } from "./config";
import { jsonResponse } from "./openai";
import { loadInterview, saveInterview } from "./interviews";

export const SUMMARY_FIELDS: { key: string; label: string }[] = [
  { key: "profile", label: "Pilot profile" },
  { key: "timeline", label: "Last-flight timeline" },
  { key: "doubt", label: "Moments of doubt / wrong data" },
  { key: "offline", label: "Offline / GPS / battery stories" },
  { key: "divert", label: "Divert story" },
  { key: "alternatives", label: "Alternatives trusted most" },
  { key: "spend", label: "Spend" },
  { key: "quotes", label: "Verbatim quotes" },
  { key: "hypotheses", label: "Does this confirm or contradict CUSTOMER.md?" },
];

const INSTRUCTIONS = `You turn a customer-discovery interview transcript into notes (the transcript may be in Hebrew: write the notes in English, but keep "quotes" verbatim in the original language). Return ONLY a JSON object with string values for exactly these keys: ${SUMMARY_FIELDS.map((f) => f.key).join(", ")}.
Rules: use only what the pilot actually said about real past events; no speculation. Keep each value short (bullet-ish sentences separated by "; "). "quotes" = 2-4 verbatim pilot quotes in quotation marks. "hypotheses" = for each of J1 in-flight awareness is the anchor job / trust is the worst-served dimension / Little Hire (failure on any single flight) / panel GPS is a key alternative, say confirms, contradicts or no evidence, with one phrase of evidence. Write "-" when the transcript has nothing for a field.`;

export async function summarize(id: string): Promise<void> {
  const model = config.summaryModel;
  if (!model) return;
  try {
    const iv = await loadInterview(id);
    if (!iv || iv.transcript.length < 4) return;
    const text = iv.transcript.map((e) => `${e.role === "pilot" ? "Pilot" : "Interviewer"}: ${e.text}`).join("\n");
    const raw = await jsonResponse(model, INSTRUCTIONS, `Transcript (respond in JSON):\n\n${text}`);
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const summary: Record<string, string> = {};
    for (const f of SUMMARY_FIELDS) summary[f.key] = typeof obj[f.key] === "string" ? (obj[f.key] as string) : "-";
    const fresh = (await loadInterview(id)) ?? iv;
    fresh.summary = summary;
    await saveInterview(fresh);
  } catch (e) {
    console.error("summary failed", id, e);
  }
}
