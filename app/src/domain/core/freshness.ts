// Port of Core/DataFreshness.swift and Core/OverlayStaleness.swift. Times are epoch ms; durations are seconds.

export const DATA_PRODUCTS = [
  'metar',
  'taf',
  'pirep',
  'windsAloft',
  'tfr',
  'airmetSigmet',
  'notam',
  'chartCycle',
] as const;
export type DataProduct = (typeof DATA_PRODUCTS)[number];

/** Age (s) from which a product reads OLD; null when age is not how the product is judged. */
const OLD_AFTER: Record<DataProduct, number | null> = {
  metar: 75 * 60,
  taf: 7 * 3600,
  pirep: 60 * 60,
  windsAloft: null,
  tfr: 30 * 60,
  airmetSigmet: 30 * 60,
  notam: 60 * 60,
  chartCycle: null,
};

/** Age (s) from which a product reads EXPIRED. */
const EXPIRED_AFTER: Record<DataProduct, number | null> = {
  metar: 3 * 3600,
  taf: 30 * 3600, // longest TAF valid period: backstop when the TAF carries no parsable validity
  pirep: 2 * 3600,
  windsAloft: null,
  tfr: 2 * 3600,
  airmetSigmet: 2 * 3600,
  notam: 6 * 3600,
  chartCycle: null,
};

const DISPLAY_NAMES: Record<DataProduct, string> = {
  metar: 'METAR',
  taf: 'TAF',
  pirep: 'PIREP',
  windsAloft: 'Winds aloft',
  tfr: 'TFR data',
  airmetSigmet: 'AIRMET/SIGMET data',
  notam: 'NOTAM data',
  chartCycle: 'Chart cycle',
};

export const productOldAfter = (p: DataProduct): number | null => OLD_AFTER[p];
export const productExpiredAfter = (p: DataProduct): number | null => EXPIRED_AFTER[p];
/** Only TFR data reads red (unsafe) when expired. */
export const productExpiryIsUnsafe = (p: DataProduct): boolean => p === 'tfr';
export const productDisplayName = (p: DataProduct): string => DISPLAY_NAMES[p];

/** Ordered: unknown < fresh < old < expired < unsafe. */
export const FRESHNESS_LEVELS = ['unknown', 'fresh', 'old', 'expired', 'unsafe'] as const;
export type FreshnessLevel = (typeof FRESHNESS_LEVELS)[number];
export const freshnessRank = (l: FreshnessLevel): number => FRESHNESS_LEVELS.indexOf(l);

export interface DataFreshness {
  product: DataProduct;
  level: FreshnessLevel;
  text: string;
}

export interface FreshnessInput {
  observed?: number | null;
  validFrom?: number | null;
  validUntil?: number | null;
  /** Epoch ms; required because the domain never reads the clock. */
  now: number;
}

export function ageText(ageSeconds: number): string {
  const minutes = Math.trunc(ageSeconds / 60);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function evaluateFreshness(product: DataProduct, input: FreshnessInput): DataFreshness {
  const { now } = input;
  const observed = input.observed ?? null;
  const validFrom = input.validFrom ?? null;
  const validUntil = input.validUntil ?? null;
  const expiredLevel: FreshnessLevel = productExpiryIsUnsafe(product) ? 'unsafe' : 'expired';
  const result = (level: FreshnessLevel, text: string): DataFreshness => ({ product, level, text });

  if (validUntil !== null && now > validUntil) return result(expiredLevel, 'EXPIRED');
  if (validFrom !== null && now < validFrom) return result('fresh', 'NOT YET VALID');
  if (observed !== null) {
    const age = Math.max(0, (now - observed) / 1000);
    const expiredAfter = EXPIRED_AFTER[product];
    if (expiredAfter !== null && age >= expiredAfter) return result(expiredLevel, 'EXPIRED');
    const oldAfter = OLD_AFTER[product];
    if (oldAfter !== null && age >= oldAfter) return result('old', `OLD ${ageText(age)}`);
    if (oldAfter !== null) return result('fresh', ageText(age));
  }
  if (validUntil !== null) {
    if (product === 'chartCycle' && (validUntil - now) / 1000 <= 7 * 86_400) {
      return result('old', `EXPIRES ${Math.ceil((validUntil - now) / 1000 / 86_400)}d`);
    }
    return result('fresh', 'VALID');
  }
  return result('unknown', 'N/A');
}

export type OverlayStaleness = 'current' | 'stale' | 'hidden';

/** How an overlay built from a snapshot fetched at `fetchedAt` should be drawn. Never fetched reads current. */
export function evaluateOverlayStaleness(
  product: DataProduct,
  fetchedAt: number | null | undefined,
  now: number,
): OverlayStaleness {
  if (fetchedAt === null || fetchedAt === undefined) return 'current';
  switch (evaluateFreshness(product, { observed: fetchedAt, now }).level) {
    case 'unknown':
    case 'fresh':
      return 'current';
    case 'old':
      return 'stale';
    default:
      return 'hidden';
  }
}
