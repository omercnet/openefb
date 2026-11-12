// The calendar behind the date rows (SwiftUI DatePicker with displayedComponents: .date). Tests build dates with local
// constructors and read them through local getters, so they hold in any time zone.
import {
  formatDay,
  localDateParts,
  monthGrid,
  monthTitle,
  shiftMonth,
  withLocalDate,
  type CalendarDay,
} from './calendar';

const flat = (grid: CalendarDay[][]) => grid.flat();

describe('monthGrid (six Sunday-first weeks)', () => {
  it('always has 6 weeks of 7 days', () => {
    for (const [y, m] of [
      [2026, 10],
      [2026, 1],
      [2028, 1],
      [2026, 7],
    ]) {
      const grid = monthGrid(y, m);
      expect(grid).toHaveLength(6);
      expect(grid.every((week) => week.length === 7)).toBe(true);
    }
  });

  it('November 2026 starts on a Sunday: the first cell is Nov 1 and the grid ends in December', () => {
    const cells = flat(monthGrid(2026, 10));
    expect(cells[0]).toEqual({ year: 2026, month: 10, day: 1, inMonth: true });
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30);
    expect(cells[41]).toEqual({ year: 2026, month: 11, day: 12, inMonth: false });
  });

  it('August 2026 starts on a Saturday: the first row is the end of July', () => {
    const [first] = monthGrid(2026, 7);
    expect(first.map((c) => [c.month, c.day, c.inMonth])).toEqual([
      [6, 26, false],
      [6, 27, false],
      [6, 28, false],
      [6, 29, false],
      [6, 30, false],
      [6, 31, false],
      [7, 1, true],
    ]);
  });

  it('February 2028 (leap) has 29 days in the month, February 2027 has 28', () => {
    expect(
      flat(monthGrid(2028, 1))
        .filter((c) => c.inMonth)
        .map((c) => c.day)
        .at(-1),
    ).toBe(29);
    expect(
      flat(monthGrid(2027, 1))
        .filter((c) => c.inMonth)
        .map((c) => c.day)
        .at(-1),
    ).toBe(28);
  });

  it('a month that starts on Monday leaves one leading day from the previous month, across a year boundary', () => {
    const [first] = monthGrid(2025, 11); // December 2025 starts on a Monday
    expect(first[0]).toEqual({ year: 2025, month: 10, day: 30, inMonth: false });
    expect(first[1]).toEqual({ year: 2025, month: 11, day: 1, inMonth: true });
    const jan = flat(monthGrid(2026, 0)); // January 2026 starts on a Thursday, trailing days are February
    expect(jan[0]).toEqual({ year: 2025, month: 11, day: 28, inMonth: false });
    expect(jan.at(-1)?.month).toBe(1);
  });
});

describe('shiftMonth', () => {
  it.each([
    [2026, 10, 1, 2026, 11],
    [2026, 11, 1, 2027, 0],
    [2026, 0, -1, 2025, 11],
    [2026, 5, 25, 2028, 6],
    [2026, 5, -13, 2025, 4],
    [2026, 5, 0, 2026, 5],
  ])('(%s, %s) shifted by %s is (%s, %s)', (year, month, delta, y, m) => {
    expect(shiftMonth(year, month, delta)).toEqual({ year: y, month: m });
  });
});

describe('local dates', () => {
  it('reads the local year, month and day', () => {
    expect(localDateParts(new Date(2026, 10, 5, 23, 59).getTime())).toEqual({ year: 2026, month: 10, day: 5 });
  });

  it('choosing a day keeps the time of day, as the SwiftUI DatePicker does', () => {
    const before = new Date(2026, 10, 5, 15, 42, 7, 123);
    const after = new Date(withLocalDate(before.getTime(), 2027, 1, 28));
    expect([after.getFullYear(), after.getMonth(), after.getDate()]).toEqual([2027, 1, 28]);
    expect([after.getHours(), after.getMinutes(), after.getSeconds(), after.getMilliseconds()]).toEqual([
      15, 42, 7, 123,
    ]);
  });

  it('works across a month with fewer days and for leap day', () => {
    const base = new Date(2026, 0, 31, 9, 30).getTime();
    expect(localDateParts(withLocalDate(base, 2028, 1, 29))).toEqual({ year: 2028, month: 1, day: 29 });
    expect(localDateParts(withLocalDate(base, 2026, 3, 30))).toEqual({ year: 2026, month: 3, day: 30 });
  });
});

describe('titles and day text', () => {
  it('monthTitle', () => {
    expect(monthTitle(2026, 10)).toBe('November 2026');
    expect(monthTitle(2027, 0)).toBe('January 2027');
  });

  it('formatDay is the medium date of the locale (Text(date, format: .dateTime.month().day().year()))', () => {
    expect(formatDay(Date.UTC(2026, 10, 5, 12), 'en-US', 'UTC')).toBe('Nov 5, 2026');
    expect(formatDay(Date.UTC(2026, 0, 31, 23, 30), 'en-US', 'UTC')).toBe('Jan 31, 2026');
  });

  it('a value that is not a time reads as an empty string', () => {
    expect(formatDay(Number.NaN, 'en-US', 'UTC')).toBe('');
  });
});
