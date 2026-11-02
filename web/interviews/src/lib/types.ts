export const CONSENT_VERSION = "2026-10-31";

export interface TranscriptEntry {
  role: "interviewer" | "pilot";
  text: string;
  /** ms since the interview started (client clock) */
  t: number;
}

export interface Profile {
  certificate?: string;
  hours_per_year?: string;
  aircraft?: string;
  owner_or_rental?: string;
  efb_used?: string;
}

export interface Outcome {
  commitment: "yes" | "no" | "unsure";
  email?: string;
  profile?: Profile;
  note?: string;
}

export type InterviewStatus = "active" | "completed" | "dropped" | "capped";

export interface Interview {
  id: string;
  status: InterviewStatus;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  consentAt: string;
  consentVersion: string;
  callId?: string;
  ipHash: string;
  model: string;
  /** interview language; missing on older records means "en" */
  lang?: "en" | "he";
  /** noise handling used for this call, for diagnosing bad transcripts */
  noise?: {
    device: "near" | "far" | null;
    reduction: "near_field" | "far_field" | "off";
    turnDetection: string;
    /** what the browser actually applied (track.getSettings()), as reported by the client */
    mic?: { noiseSuppression?: boolean; echoCancellation?: boolean; autoGainControl?: boolean; channelCount?: number; sampleRate?: number };
    /** ambient level from the optional pre-start noise check, dBFS */
    ambientDb?: number;
  };
  transcript: TranscriptEntry[];
  outcome?: Outcome;
  /** notes-template fields produced by the optional summary model */
  summary?: Record<string, string>;
  audio?: { mime: string; parts: number };
}

export const ID_RE = /^\d{8}-[a-f0-9]{32}$/;
