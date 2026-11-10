// Port of efb-212/Services/CurrencyService.swift: pure FAR currency computation.
// FAR 61.23 (medical), 61.56 (flight review), 61.57 (night currency).
// Times are epoch ms. Swift used Calendar.current (device timezone); this port uses UTC calendar
// arithmetic, see app/docs/port-notes/L6.md.

export type CurrencyStatus = 'current' | 'warning' | 'expired';

export interface NightLanding {
  date: number;
  count: number;
}

const DAY_MS = 86_400_000;

/** Calendar.date(byAdding: .month): clamps the day to the end of the target month. */
function addMonths(epochMs: number, months: number): number {
  const d = new Date(epochMs);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

/** > 30 days remaining = current, 0..30 = warning, past or missing = expired. */
export function medicalStatus(expiryDate: number | null | undefined, now: number): CurrencyStatus {
  if (expiryDate == null) return 'expired';
  // dateComponents([.day]) yields whole days, truncated toward zero.
  const daysRemaining = Math.trunc((expiryDate - now) / DAY_MS);
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 30) return 'warning';
  return 'current';
}

/** Flight review expires 24 calendar months after the review date. */
export function flightReviewStatus(reviewDate: number | null | undefined, now: number): CurrencyStatus {
  if (reviewDate == null) return 'expired';
  return medicalStatus(addMonths(reviewDate, 24), now);
}

/** Needs 3 night landings in the preceding 90 days; no warning state. */
export function nightCurrencyStatus(nightLandings: readonly NightLanding[], now: number): CurrencyStatus {
  const cutoff = now - 90 * DAY_MS;
  const recent = nightLandings.filter((l) => l.date >= cutoff).reduce((sum, l) => sum + l.count, 0);
  return recent >= 3 ? 'current' : 'expired';
}

/** Most restrictive of the three: expired > warning > current. */
export function overallStatus(
  medical: CurrencyStatus,
  flightReview: CurrencyStatus,
  night: CurrencyStatus,
): CurrencyStatus {
  const all = [medical, flightReview, night];
  if (all.includes('expired')) return 'expired';
  if (all.includes('warning')) return 'warning';
  return 'current';
}
