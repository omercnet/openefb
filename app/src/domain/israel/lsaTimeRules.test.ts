// Port of IsraelLSATimeRulesTests (IsraelLSAPlannerTests.swift) plus the ScenarioFlightTests weekday check.
import { israelClock, weekendState, type IsraelDayOverride } from './lsaTimeRules';

/** Local Israel time as an absolute instant. The dates used are all November (IST, UTC+2). */
const israelNovember = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 10, day, hour - 2, minute);

const state = (epochMs: number, override?: IsraelDayOverride) => weekendState(epochMs, override);

describe('Israel LSA weekend rule', () => {
  test('saturdayIsAWeekendAllDay', () => {
    expect(state(israelNovember(7, 0, 0))).toBe('inUse');
    expect(state(israelNovember(7, 23, 59))).toBe('inUse');
  });

  test('sundayThroughThursdayAreNotAWeekend', () => {
    for (const day of [1, 2, 3, 4, 5]) expect(state(israelNovember(day, 12))).toBe('notInUse'); // Sun 1 Nov ... Thu 5 Nov
    expect(state(israelNovember(8, 0, 0))).toBe('notInUse'); // Saturday ends at midnight
  });

  test('fridayStartsUnconfirmedAtSixAndConfirmedAtFourteen', () => {
    expect(state(israelNovember(6, 5, 59))).toBe('notInUse');
    expect(state(israelNovember(6, 6, 0))).toBe('startUnconfirmed');
    expect(state(israelNovember(6, 13, 59))).toBe('startUnconfirmed');
    expect(state(israelNovember(6, 14, 0))).toBe('inUse');
  });

  test('aDeclaredHolidayCountsAsASaturdayAndAHolidayEveAsAFridayFromFourteen', () => {
    expect(state(israelNovember(4, 10), 'holiday')).toBe('inUse');
    expect(state(israelNovember(4, 13, 59), 'holidayEve')).toBe('notInUse');
    expect(state(israelNovember(4, 14, 0), 'holidayEve')).toBe('inUse');
  });

  test('uses Israel time across daylight saving (summer is UTC+3)', () => {
    // Friday 2026-07-03 03:30 UTC is 06:30 in Israel (IDT): unconfirmed. With UTC+2 it would be 05:30.
    expect(state(Date.UTC(2026, 6, 3, 3, 30))).toBe('startUnconfirmed');
    expect(state(Date.UTC(2026, 6, 3, 2, 59))).toBe('notInUse');
  });

  test('israelClock reports the local wall clock', () => {
    expect(israelClock(Date.UTC(2022, 8, 29, 11, 0))).toEqual({
      year: 2022,
      month: 9,
      day: 29,
      hour: 14,
      minute: 0,
      weekday: 4,
    });
    // Midnight local must be hour 0, not 24.
    expect(israelClock(Date.UTC(2026, 10, 6, 22, 0)).hour).toBe(0);
  });
});
