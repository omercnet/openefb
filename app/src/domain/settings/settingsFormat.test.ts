// Characterisation of the small formatting and derivation rules inside SettingsView.swift (no Swift tests exist for them).
import type { PilotProfile } from '../../data/models';
import { newPilotProfile } from '../../data/defaults';
import { aviationDataRow, currencyToRenewCount, formatCycleDate, formatFileSize } from './settingsFormat';

const DAY = 86_400_000;
const utc = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d);

describe('formatCycleDate (OfflineMapsView.dateString: "d MMM yyyy", UTC, en_US_POSIX)', () => {
  it.each([
    [utc(2026, 11, 5), '5 Nov 2026'],
    [utc(2026, 1, 1), '1 Jan 2026'],
    [utc(2026, 9, 30), '30 Sep 2026'], // "Sep", not "Sept"
    [utc(2025, 12, 31) + 23 * 3_600_000 + 59 * 60_000, '31 Dec 2025'], // still the 31st in UTC
    [utc(2026, 2, 28) + DAY, '1 Mar 2026'],
    [utc(2028, 2, 29), '29 Feb 2028'],
    [utc(999, 6, 1), '1 Jun 0999'], // yyyy pads to four digits
  ])('%s -> %s', (ms, text) => {
    expect(formatCycleDate(ms)).toBe(text);
  });

  it('a date that is not a time reads as unknown instead of "NaN NaN NaN"', () => {
    expect(formatCycleDate(Number.NaN)).toBe('unknown');
  });
});

describe('aviationDataRow (SettingsView.aviationDataRow)', () => {
  const cycle = { source: 'FAA NASR', effectiveMs: utc(2026, 10, 8), expiresMs: utc(2026, 11, 5) };

  it('no cycle reads "Cycle unknown", neutral', () => {
    expect(aviationDataRow(null, utc(2026, 11, 1))).toEqual({ text: 'Cycle unknown', expired: false });
  });

  it('a valid cycle shows effective and valid-to dates', () => {
    expect(aviationDataRow(cycle, utc(2026, 10, 20))).toEqual({
      text: 'NASR 8 Oct 2026, valid to 5 Nov 2026',
      expired: false,
    });
  });

  it('the cycle expires at its expiry instant (date >= expires)', () => {
    expect(aviationDataRow(cycle, cycle.expiresMs - 1).expired).toBe(false);
    expect(aviationDataRow(cycle, cycle.expiresMs)).toEqual({
      text: 'NASR 8 Oct 2026, EXPIRED 5 Nov 2026',
      expired: true,
    });
    expect(aviationDataRow(cycle, cycle.expiresMs + 40 * DAY).expired).toBe(true);
  });

  it('a cycle with a non-time date is shown as unknown (JS-only guard)', () => {
    expect(aviationDataRow({ ...cycle, expiresMs: Number.NaN }, utc(2026, 10, 20))).toEqual({
      text: 'Cycle unknown',
      expired: false,
    });
  });
});

describe('currencyToRenewCount (SettingsView.currencyCount: statuses that are not current)', () => {
  const now = utc(2026, 11, 11);
  const pilot = (over: Partial<PilotProfile>): PilotProfile => newPilotProfile({ isActive: true, ...over });
  const night = (daysAgo: number, count: number) => ({ date: now - daysAgo * DAY, count });

  it('no active pilot counts nothing', () => {
    expect(currencyToRenewCount(null, now)).toBe(0);
  });

  it('a pilot with nothing recorded has all three to renew', () => {
    expect(currencyToRenewCount(pilot({}), now)).toBe(3);
  });

  it('fully current counts none', () => {
    const p = pilot({
      medicalExpiry: now + 200 * DAY,
      flightReviewDate: now - 30 * DAY,
      nightLandingEntries: [night(10, 3)],
    });
    expect(currencyToRenewCount(p, now)).toBe(0);
  });

  it('a warning status counts (anything not current): medical expiring in 10 days', () => {
    const p = pilot({
      medicalExpiry: now + 10 * DAY,
      flightReviewDate: now - 30 * DAY,
      nightLandingEntries: [night(10, 3)],
    });
    expect(currencyToRenewCount(p, now)).toBe(1);
  });

  it('counts each lapsed item once: review lapsed and night landings too old', () => {
    const p = pilot({
      medicalExpiry: now + 200 * DAY,
      flightReviewDate: now - 800 * DAY,
      nightLandingEntries: [night(120, 3)],
    });
    expect(currencyToRenewCount(p, now)).toBe(2);
  });

  it('night landings dated after now do not count (L6 owner decision)', () => {
    const p = pilot({
      medicalExpiry: now + 200 * DAY,
      flightReviewDate: now - 30 * DAY,
      nightLandingEntries: [{ date: now + 5 * DAY, count: 3 }],
    });
    expect(currencyToRenewCount(p, now)).toBe(1);
  });
});

describe('formatFileSize (stand-in for ByteCountFormatter .file until M3 ports OfflineSizeFormatter)', () => {
  it.each([
    [0, 'Zero KB'],
    [1, '1 byte'],
    [999, '999 bytes'],
    [1000, '1 KB'],
    [12_345, '12 KB'],
    [999_499, '999 KB'],
    [999_500, '1 MB'], // rounds up into the next unit, never "1000 KB"
    [1_234_567, '1.2 MB'],
    [12_000_000, '12 MB'],
    [12_345_678, '12.3 MB'],
    [1_500_000_000, '1.5 GB'],
    [1_534_000_000, '1.53 GB'],
    [2_000_000_000_000, '2 TB'],
  ])('%s -> %s', (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text);
  });

  it('a negative or non-finite size reads as zero (JS-only guard)', () => {
    expect(formatFileSize(-5)).toBe('Zero KB');
    expect(formatFileSize(Number.NaN)).toBe('Zero KB');
  });
});
