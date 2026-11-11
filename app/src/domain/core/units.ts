// Port of Core/Extensions/Date+Aviation.swift. Times are epoch ms; all formatting is UTC.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number): string => String(n).padStart(2, '0');

/** "1430Z" */
export function zuluString(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}Z`;
}

/** "05 Mar 2026 1430Z" */
export function fullZuluString(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${zuluString(ms)}`;
}

/** "051430Z" (METAR observation time group) */
export function metarTimeString(ms: number): string {
  const d = new Date(ms);
  return `${p2(d.getUTCDate())}${zuluString(ms)}`;
}

/** Parse "ddHHmm" or "ddHHmmZ" into epoch ms in the year/month of `referenceMs`; null if malformed. */
export function fromMetarTime(text: string, referenceMs: number): number | null {
  const cleaned = text.replaceAll('Z', '');
  if (cleaned.length !== 6 || !/^\d{6}$/.test(cleaned)) return null;
  const ref = new Date(referenceMs);
  return Date.UTC(
    ref.getUTCFullYear(),
    ref.getUTCMonth(),
    Number(cleaned.slice(0, 2)),
    Number(cleaned.slice(2, 4)),
    Number(cleaned.slice(4, 6)),
    0,
  );
}

/** "<1 min", "12 min", "2h 5m", "3h", "2d" (port of Date.timeAgoShort; `nowMs` replaces Date()). */
export function timeAgoShort(ms: number, nowMs: number): string {
  const totalMinutes = Math.trunc((nowMs - ms) / 1000 / 60);
  if (totalMinutes < 1) return '<1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const rem = totalMinutes % 60;
  if (hours < 24) return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
  return `${Math.floor(hours / 24)}d`;
}

export type AltimeterUnit = 'inHg' | 'hPa';

export const HPA_PER_INHG = 33.8639;

/** Region-aware altimeter text: "1017 hPa" or "30.03 inHg". */
export function formatAltimeter(hPa: number, unit: AltimeterUnit): string {
  return unit === 'hPa' ? `${hPa.toFixed(0)} hPa` : `${(hPa / HPA_PER_INHG).toFixed(2)} inHg`;
}
