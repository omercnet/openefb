// Port of Core/TAFValidity.swift. Times are epoch ms (UTC).

const VALID_PERIOD = /\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/;

/**
 * End of the TAF's DDHH/DDHH valid period. The day is resolved against the previous, current and next month
 * of `now`, picking the candidate closest to `now`. Hour 24 is midnight at the end of that day.
 */
export function tafValidUntil(rawTaf: string, now: number): number | null {
  const m = VALID_PERIOD.exec(rawTaf);
  if (!m) return null;
  const endDay = Number(m[3]);
  const endHour = Number(m[4]);
  if (endDay < 1 || endDay > 31 || endHour > 24) return null;
  const ref = new Date(now);
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth();
  let best: number | null = null;
  for (let offset = -1; offset <= 1; offset++) {
    const monthStart = Date.UTC(year, month + offset, 1);
    const start = new Date(monthStart);
    const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    if (endDay > daysInMonth) continue;
    const candidate = monthStart + (endDay - 1) * 86_400_000 + endHour * 3_600_000;
    if (best === null || Math.abs(candidate - now) < Math.abs(best - now)) best = candidate;
  }
  return best;
}
