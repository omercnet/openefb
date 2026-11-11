// Port of DataTests/DataRefreshSchedulerTests.swift (6 tests).
import { DataRefreshScheduler, REFRESH_PRODUCTS, type RefreshProduct } from './dataRefreshScheduler';

const now = 1_800_000_000_000;
const all = new Set<RefreshProduct>(REFRESH_PRODUCTS);

function due(
  scheduler: DataRefreshScheduler,
  ageMinutes: number,
  opts: { wanted?: Set<RefreshProduct>; lowPower?: boolean; network?: boolean } = {},
): Set<RefreshProduct> {
  const lastData = Object.fromEntries(REFRESH_PRODUCTS.map((p) => [p, now - ageMinutes * 60_000]));
  return new Set(
    scheduler.due({
      wanted: opts.wanted ?? all,
      lastData,
      nowMs: now,
      lowPower: opts.lowPower ?? false,
      networkAvailable: opts.network ?? true,
    }),
  );
}

test('eachProductRefreshesWhenItsDataIsAsOldAsItsCache', () => {
  const scheduler = new DataRefreshScheduler();
  expect(due(scheduler, 9).size).toBe(0);
  expect(due(scheduler, 10)).toEqual(new Set(['tfr', 'advisories']));
  expect(due(scheduler, 15)).toEqual(new Set(['weather', 'tfr', 'advisories']));
});

test('neverLoadedDataIsDueImmediately', () => {
  const scheduler = new DataRefreshScheduler();
  expect(
    scheduler.due({ wanted: new Set(['tfr']), lastData: {}, nowMs: now, lowPower: false, networkAvailable: true }),
  ).toEqual(['tfr']);
});

test('lowPowerModeDoublesTheIntervals', () => {
  const scheduler = new DataRefreshScheduler();
  expect(due(scheduler, 19, { lowPower: true }).size).toBe(0);
  expect(due(scheduler, 20, { lowPower: true })).toEqual(new Set(['tfr', 'advisories']));
});

test('nothingRefreshesOffline', () => {
  expect(due(new DataRefreshScheduler(), 600, { network: false }).size).toBe(0);
});

test('onlyLayersThatAreOnRefresh', () => {
  expect(due(new DataRefreshScheduler(), 600, { wanted: new Set(['tfr']) })).toEqual(new Set(['tfr']));
  expect(due(new DataRefreshScheduler(), 600, { wanted: new Set() }).size).toBe(0);
});

test('aFailedAttemptBacksOffAndASuccessResets', () => {
  const scheduler = new DataRefreshScheduler();
  const lastData = { tfr: now - 3_600_000 };
  const dueAt = (offsetMin: number) =>
    scheduler.due({
      wanted: new Set(['tfr']),
      lastData,
      nowMs: now + offsetMin * 60_000,
      lowPower: false,
      networkAvailable: true,
    });
  scheduler.recordAttempt('tfr', now, false);
  expect(scheduler.interval('tfr', false)).toBe(20 * 60); // 2x
  expect(dueAt(19)).toEqual([]);
  expect(dueAt(20)).toEqual(['tfr']);

  scheduler.recordAttempt('tfr', now, false);
  scheduler.recordAttempt('tfr', now, false);
  scheduler.recordAttempt('tfr', now, false);
  expect(scheduler.interval('tfr', false)).toBe(40 * 60); // capped at 4x

  scheduler.recordAttempt('tfr', now, true);
  expect(scheduler.interval('tfr', false)).toBe(10 * 60);
});

// JS-only guards
test('a failure of one product does not back off another', () => {
  const scheduler = new DataRefreshScheduler();
  scheduler.recordAttempt('tfr', now, false);
  expect(scheduler.interval('advisories', false)).toBe(10 * 60);
  expect(scheduler.interval('weather', false)).toBe(15 * 60);
});

test('a recent attempt delays the next try even when the data is old', () => {
  const scheduler = new DataRefreshScheduler();
  scheduler.recordAttempt('weather', now - 60_000, true);
  expect(scheduler.isDue('weather', now - 3_600_000, now, false)).toBe(false);
  expect(scheduler.isDue('weather', now - 3_600_000, now + 15 * 60_000, false)).toBe(true);
});
