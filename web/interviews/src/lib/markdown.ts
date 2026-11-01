import { SUMMARY_FIELDS } from "./summary";
import type { Interview } from "./types";

const cell = (s: string | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

export function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function profileLine(iv: Interview): string {
  const p = iv.outcome?.profile;
  if (!p) return "";
  return [
    p.certificate && `cert: ${p.certificate}`,
    p.hours_per_year && `hours/yr: ${p.hours_per_year}`,
    p.aircraft && `aircraft: ${p.aircraft}`,
    p.owner_or_rental && `owner/rental: ${p.owner_or_rental}`,
    p.efb_used && `EFB: ${p.efb_used}`,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Per-interview notes in the kit's template, plus the full transcript. */
export function toMarkdown(iv: Interview): string {
  const s = iv.summary ?? {};
  const commit = iv.outcome ? iv.outcome.commitment : "no answer recorded";
  const rows = SUMMARY_FIELDS.map((f) => {
    let v = s[f.key] ?? "";
    if (f.key === "profile" && (!v || v === "-")) v = profileLine(iv) || v;
    return `| ${f.label} | ${cell(v)} |`;
  });
  const commitRow = `| Commitment (TestFlight flight?) | ${cell(commit)}${iv.outcome?.email ? ` (${cell(iv.outcome.email)})` : ""} |`;
  // template order: commitment sits before the hypotheses row
  rows.splice(rows.length - 1, 0, commitRow);

  const transcript = iv.transcript
    .filter((e) => e.text.trim())
    .map((e) => `**[${mmss(e.t)}] ${e.role === "pilot" ? "Pilot" : "Interviewer"}:** ${e.text.trim()}`)
    .join("\n\n");

  const dur = iv.durationSec != null ? `${Math.round(iv.durationSec / 60)} min` : "in progress";
  return [
    `## Interview ${iv.id}`,
    "",
    `- Date: ${iv.startedAt}`,
    `- Duration: ${dur}`,
    `- Status: ${iv.status}`,
    iv.outcome?.note ? `- Closing note: ${iv.outcome.note}` : "",
    iv.summary ? "" : "- (No automatic summary; set SUMMARY_MODEL to generate the notes fields.)",
    "",
    "| Field | Notes |",
    "|---|---|",
    ...rows,
    "",
    "### Transcript",
    "",
    transcript || "_(empty)_",
    "",
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n");
}
