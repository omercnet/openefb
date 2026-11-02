function num(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

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
  get contactEmail() {
    return process.env.CONTACT_EMAIL || "";
  },
  /** Hebrew interviews may use a different voice; defaults to REALTIME_VOICE. */
  get voiceHe() {
    return process.env.REALTIME_VOICE_HE || this.voice;
  },
  /** Optional transcription model override for Hebrew; defaults to TRANSCRIBE_MODEL. */
  get transcribeModelHe() {
    return process.env.TRANSCRIBE_MODEL_HE || this.transcribeModel;
  },
  /** Realtime input noise reduction: auto (by the pilot's device choice), near_field, far_field, or off. */
  get noiseReduction(): "auto" | "near_field" | "far_field" | "off" {
    const v = (process.env.NOISE_REDUCTION || "auto").toLowerCase();
    return v === "near_field" || v === "far_field" || v === "off" ? v : "auto";
  },
  /** 0..1, how hard the server filters input noise (API default 1). */
  get noiseStrength() {
    return num("NOISE_REDUCTION_STRENGTH", 1, 0, 1);
  },
  get turnDetection(): "semantic_vad" | "server_vad" {
    return process.env.TURN_DETECTION === "server_vad" ? "server_vad" : "semantic_vad";
  },
  /** semantic_vad only: low waits longest for the pilot to finish. */
  get vadEagerness(): "low" | "medium" | "high" | "auto" {
    const v = process.env.VAD_EAGERNESS;
    return v === "medium" || v === "high" || v === "auto" ? v : "low";
  },
  /** server_vad only: 0..1 activation threshold; higher needs louder speech (better in noise). */
  get vadThreshold() {
    return num("VAD_THRESHOLD", 0.7, 0, 1);
  },
  /** server_vad only: silence before the turn ends, ms. */
  get vadSilenceMs() {
    return int("VAD_SILENCE_MS", 1000);
  },
  /** server_vad only: audio kept before detected speech, ms. */
  get vadPrefixMs() {
    return int("VAD_PREFIX_MS", 300);
  },
  /** Whether detected speech cancels the interviewer mid-sentence (default true, the API default). */
  get vadInterrupt() {
    return process.env.VAD_INTERRUPT_RESPONSE !== "false";
  },
};

export function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10).replaceAll("-", "");
}
