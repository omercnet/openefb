// Port of efb-212Tests/ServiceTests/CurrencyServiceTests.swift (21 cases).
// The Swift tests call Date() twice and tolerate drift; here `now` is fixed so results are deterministic.
import { flightReviewStatus, medicalStatus, nightCurrencyStatus, overallStatus, type CurrencyStatus } from './currency';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const addDays = (d: number): number => NOW + d * DAY;
const addMonths = (m: number): number => {
  const d = new Date(NOW);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.getTime();
};

describe('CurrencyService Tests', () => {
  // Medical Status (FAR 61.23)
  test('medicalCurrentWhenMoreThan30Days', () => {
    expect(medicalStatus(addDays(60), NOW)).toBe('current');
  });
  test('medicalWarningWhenWithin30Days', () => {
    expect(medicalStatus(addDays(15), NOW)).toBe('warning');
  });
  test('medicalExpiredWhenPastDate', () => {
    expect(medicalStatus(addDays(-1), NOW)).toBe('expired');
  });
  test('medicalExpiredWhenNil', () => {
    expect(medicalStatus(null, NOW)).toBe('expired');
  });
  test('medicalWarningAtExactly30Days', () => {
    expect(medicalStatus(addDays(30), NOW)).toBe('warning');
  });

  // Owner decision 2026-11-10: expired as soon as the expiry time has passed (not in Swift).
  test('medicalWarningJustBeforeExpiry', () => {
    expect(medicalStatus(NOW + 1, NOW)).toBe('warning');
  });
  test('medicalWarningExactlyAtExpiry', () => {
    expect(medicalStatus(NOW, NOW)).toBe('warning');
  });
  test('medicalExpiredOneMillisecondAfterExpiry', () => {
    expect(medicalStatus(NOW - 1, NOW)).toBe('expired');
  });
  test('medicalExpiredOneHourAfterExpiry', () => {
    expect(medicalStatus(NOW - 3_600_000, NOW)).toBe('expired');
  });

  // Flight Review Status (FAR 61.56)
  test('flightReviewCurrentWhenRecent', () => {
    expect(flightReviewStatus(addMonths(-12), NOW)).toBe('current');
  });
  test('flightReviewWarningWhenApproaching', () => {
    expect(flightReviewStatus(addMonths(-23), NOW)).toBe('warning');
  });
  test('flightReviewExpiredWhenPast24Months', () => {
    expect(flightReviewStatus(addMonths(-25), NOW)).toBe('expired');
  });
  test('flightReviewExpiredWhenNil', () => {
    expect(flightReviewStatus(null, NOW)).toBe('expired');
  });

  // Night Currency Status (FAR 61.57)
  test('nightCurrentWith3Landings', () => {
    expect(nightCurrencyStatus([{ date: addDays(-30), count: 3 }], NOW)).toBe('current');
  });
  test('nightExpiredWith2Landings', () => {
    expect(nightCurrencyStatus([{ date: addDays(-30), count: 2 }], NOW)).toBe('expired');
  });
  test('nightExpiredWhenOutside90Days', () => {
    expect(nightCurrencyStatus([{ date: addDays(-100), count: 5 }], NOW)).toBe('expired');
  });
  test('nightExpiredWhenEmpty', () => {
    expect(nightCurrencyStatus([], NOW)).toBe('expired');
  });
  test('nightCurrentWithMultipleEntries', () => {
    const landings = [
      { date: addDays(-45), count: 1 },
      { date: addDays(-30), count: 1 },
      { date: addDays(-10), count: 1 },
    ];
    expect(nightCurrencyStatus(landings, NOW)).toBe('current');
  });

  // Overall Status
  test('overallCurrentWhenAllCurrent', () => {
    expect(overallStatus('current', 'current', 'current')).toBe('current');
  });
  test('overallWarningWhenOneWarning', () => {
    expect(overallStatus('warning', 'current', 'current')).toBe('warning');
  });
  test('overallExpiredWhenOneExpired', () => {
    const s: CurrencyStatus = overallStatus('current', 'current', 'expired');
    expect(s).toBe('expired');
  });

  // Logbook-Derived Night Currency (LOG-03 bridge)
  test('nightCurrencyFromLogbookSingleConfirmedEntry', () => {
    expect(nightCurrencyStatus([{ date: addDays(-10), count: 3 }], NOW)).toBe('current');
  });
  test('nightCurrencyFromLogbookMultipleConfirmedEntries', () => {
    const landings = [
      { date: addDays(-80), count: 1 },
      { date: addDays(-50), count: 1 },
      { date: addDays(-20), count: 1 },
    ];
    expect(nightCurrencyStatus(landings, NOW)).toBe('current');
  });
  test('nightCurrencyFromLogbookMixedOldAndNew', () => {
    const landings = [
      { date: addDays(-100), count: 5 },
      { date: addDays(-30), count: 1 },
    ];
    expect(nightCurrencyStatus(landings, NOW)).toBe('expired');
  });
  test('nightCurrencyFromLogbookExactlyAt90Days', () => {
    expect(nightCurrencyStatus([{ date: addDays(-90), count: 3 }], NOW)).toBe('current');
  });
});
