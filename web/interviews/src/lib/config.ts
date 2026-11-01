function int(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  get maxSessionSeconds() {
    return int("MAX_SESSION_MINUTES", 25) * 60;
  },
  get dailyCap() {
    return int("DAILY_INTERVIEW_CAP", 20);
  },
  get ipDailyCap() {
    return int("IP_DAILY_CAP", 3);
  },
  get model() {
    return process.env.REALTIME_MODEL || "gpt-realtime-2.1";
  },
  get voice() {
    return process.env.REALTIME_VOICE || "marin";
  },
  get transcribeModel() {
    return process.env.TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  },
  get summaryModel() {
    return process.env.SUMMARY_MODEL || "";
  },
  get inviteCode() {
    return process.env.INVITE_CODE || "";
  },
  get interviewerName() {
    return process.env.INTERVIEWER_NAME || "the researcher";
  },
  get contactEmail() {
    return process.env.CONTACT_EMAIL || "";
  },
};

export function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}
