// Port of DataRefreshScheduler (Core/DataRefreshScheduler.swift): when to re-fetch the in-flight data layers.
// - Each product refreshes once its data is as old as the service's own cache (METAR 15 min, TFR and AIRMET/SIGMET 10 min).
// - Low Power Mode doubles every interval.
// - No refresh without a network path, and only for layers the pilot has switched on.
// - A failed attempt backs off: the next try waits 2x, then 4x (capped) the interval; a success resets it.
export const REFRESH_PRODUCTS = ['weather', 'tfr', 'advisories'] as const;
export type RefreshProduct = (typeof REFRESH_PRODUCTS)[number];

/** Seconds between refreshes (data age at which the next fetch is due). */
export const BASE_INTERVAL_SECONDS: Record<RefreshProduct, number> = {
  weather: 15 * 60, // WeatherService cache life
  tfr: 10 * 60, // TFRService.refreshInterval
  advisories: 10 * 60, // AirSigmetService.refreshInterval
};

/** Longest backoff multiplier after repeated failures. */
export const MAX_BACKOFF = 4;

export class DataRefreshScheduler {
  private readonly lastAttempt = new Map<RefreshProduct, number>();
  private readonly failures = new Map<RefreshProduct, number>();

  /** Seconds until the next refresh is due, after the last data or attempt. */
  interval(product: RefreshProduct, lowPower: boolean): number {
    const backoff = Math.min(2 ** Math.min(this.failures.get(product) ?? 0, 2), MAX_BACKOFF);
    return BASE_INTERVAL_SECONDS[product] * (lowPower ? 2 : 1) * backoff;
  }

  /** @param lastDataMs when the displayed data was fetched; null/undefined if never. */
  isDue(product: RefreshProduct, lastDataMs: number | null | undefined, nowMs: number, lowPower: boolean): boolean {
    const reference = Math.max(lastDataMs ?? -Infinity, this.lastAttempt.get(product) ?? -Infinity);
    return (nowMs - reference) / 1000 >= this.interval(product, lowPower);
  }

  /** The products to refresh now: wanted (layer on), network available, and due. */
  due(input: {
    wanted: ReadonlySet<RefreshProduct>;
    lastData: Partial<Record<RefreshProduct, number>>;
    nowMs: number;
    lowPower: boolean;
    networkAvailable: boolean;
  }): RefreshProduct[] {
    if (!input.networkAvailable) return [];
    return REFRESH_PRODUCTS.filter(
      (p) => input.wanted.has(p) && this.isDue(p, input.lastData[p], input.nowMs, input.lowPower),
    );
  }

  recordAttempt(product: RefreshProduct, atMs: number, success: boolean): void {
    this.lastAttempt.set(product, atMs);
    this.failures.set(product, success ? 0 : (this.failures.get(product) ?? 0) + 1);
  }
}
