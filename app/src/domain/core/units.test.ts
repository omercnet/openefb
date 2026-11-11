import { formatAltimeter, fromMetarTime, fullZuluString, metarTimeString, timeAgoShort, zuluString } from './units';

const t = Date.UTC(2026, 2, 5, 14, 30, 0);

describe('date formatting', () => {
  it('formats zulu strings', () => {
    expect(zuluString(t)).toBe('1430Z');
    expect(fullZuluString(t)).toBe('05 Mar 2026 1430Z');
    expect(metarTimeString(t)).toBe('051430Z');
  });
  it('parses METAR time groups in the reference month', () => {
    expect(fromMetarTime('051430Z', t)).toBe(t);
    expect(fromMetarTime('051430', t)).toBe(t);
    expect(fromMetarTime('1430Z', t)).toBeNull();
    expect(fromMetarTime('05143x', t)).toBeNull();
  });
  it.each([
    [30, '<1 min'],
    [60, '1 min'],
    [59 * 60, '59 min'],
    [3600, '1h'],
    [3600 + 300, '1h 5m'],
    [23 * 3600, '23h'],
    [49 * 3600, '2d'],
  ])('timeAgoShort %i s', (sec, out) => {
    expect(timeAgoShort(t, t + sec * 1000)).toBe(out);
  });
});

describe('altimeter', () => {
  it('formats by unit', () => {
    expect(formatAltimeter(1017, 'hPa')).toBe('1017 hPa');
    expect(formatAltimeter(1016.9, 'inHg')).toBe('30.03 inHg');
  });
});
