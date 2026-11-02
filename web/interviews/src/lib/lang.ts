export type Lang = "en" | "he";

export const LANGS: Lang[] = ["en", "he"];

/** Accepts only the supported codes; anything else (including arrays) falls back to English. */
export function parseLang(v: unknown): Lang {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "he" ? "he" : "en";
}

export const dirOf = (lang: Lang): "rtl" | "ltr" => (lang === "he" ? "rtl" : "ltr");

/** Where the pilot is relative to the microphone; picks the Realtime noise-reduction profile. */
export type Device = "near" | "far";

export function parseDevice(v: unknown): Device | null {
  return v === "near" || v === "far" ? v : null;
}
