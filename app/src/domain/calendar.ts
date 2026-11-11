// The calendar behind the date rows (the SwiftUI DatePicker with displayedComponents: .date). Local time, like SwiftUI; the
// grid is Sunday-first (US and Israel). English names until the string-table pass (U6).

export interface CalendarDay {
  year: number;
  /** 0 = January. */
  month: number;
  day: number;
  /** False for the leading and trailing days of the neighbouring months. */
  inMonth: boolean;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export const monthTitle = (year: number, month: number): string => `${MONTH_NAMES[month]} ${year}`;

/** A local date; `setFullYear` so a year below 100 is not read as 19xx. */
function localDate(year: number, month: number, day: number): Date {
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month, day);
  return date;
}

/** The six Sunday-first weeks that show `month` (0 = January), with the days around it. */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const lead = localDate(year, month, 1).getDay();
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = localDate(year, month, 1 - lead + week * 7 + weekday);
      return {
        year: date.getFullYear(),
        month: date.getMonth(),
        day: date.getDate(),
        inMonth: date.getMonth() === month,
      };
    }),
  );
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  const shiftedYear = Math.floor(total / 12);
  return { year: shiftedYear, month: total - shiftedYear * 12 };
}

export function localDateParts(epochMs: number): { year: number; month: number; day: number } {
  const date = new Date(epochMs);
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

/** The same instant moved to another local day, keeping the local time of day (the SwiftUI DatePicker does the same). */
export function withLocalDate(epochMs: number, year: number, month: number, day: number): number {
  const date = new Date(epochMs);
  date.setFullYear(year, month, day);
  return date.getTime();
}

/** The day as the device locale writes it ("Nov 5, 2026"); empty for a value that is not a time. */
export function formatDay(epochMs: number, locale?: string, timeZone?: string): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(date);
}
