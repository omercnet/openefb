// Port of Services/IsraelLSATimeRules.swift: when the sport-aviation (LSA) weekend routes are in use.
// The data publishes AllWeek / Weekend / special per route; it does not say which Friday start belongs to which
// route and has no holiday calendar, so this proves only what the text proves:
//  - Saturday, and Friday from the latest published start (14:00): in use.
//  - Friday 06:00 to 14:00: the default says weekend, a bubble may say later: unconfirmed.
//  - Anything else: not in use.
// The pilot supplies holidays with an IsraelDayOverride.

/** A day the pilot declares a holiday or a holiday eve; the data has no calendar of Israeli holidays. */
export const DAY_OVERRIDES = ['none', 'holidayEve', 'holiday'] as const;
export type IsraelDayOverride = (typeof DAY_OVERRIDES)[number];

export type IsraelWeekendState = 'inUse' | 'startUnconfirmed' | 'notInUse';

/** Hour of the day (local Israel time) the AIP default Friday weekend starts: 06:00. */
export const FRIDAY_DEFAULT_START_HOUR = 6;
/** The latest Friday start any bubble publishes, 14:00; also when a holiday eve begins. */
export const FRIDAY_LATEST_START_HOUR = 14;

export const ISRAEL_TIME_ZONE = 'Asia/Jerusalem';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Wall-clock fields of an instant in Israel local time. `weekday`: 0 = Sunday ... 6 = Saturday. */
export interface IsraelClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export function israelClock(epochMs: number): IsraelClock {
  const options = {
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  } as const;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { ...options, timeZone: ISRAEL_TIME_ZONE }).formatToParts(
      new Date(epochMs),
    );
  } catch {
    // JS-only guard: a runtime without the zone database falls back to UTC, like Swift's `?? .gmt`.
    parts = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).formatToParts(new Date(epochMs));
  }
  const num = (type: Intl.DateTimeFormatPartTypes): number => {
    const n = Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const weekdayText = parts.find((p) => p.type === 'weekday')?.value ?? '';
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour') % 24,
    minute: num('minute'),
    weekday: WEEKDAYS.indexOf(weekdayText as (typeof WEEKDAYS)[number]),
  };
}

/** Weekend state at `epochMs`, local Israel time. */
export function weekendState(epochMs: number, override: IsraelDayOverride = 'none'): IsraelWeekendState {
  if (override === 'holiday') return 'inUse';
  const { weekday, hour } = israelClock(epochMs);
  if (override === 'holidayEve' && hour >= FRIDAY_LATEST_START_HOUR) return 'inUse';
  switch (weekday) {
    case 6: // Saturday
      return 'inUse';
    case 5: // Friday
      if (hour >= FRIDAY_LATEST_START_HOUR) return 'inUse';
      if (hour >= FRIDAY_DEFAULT_START_HOUR) return 'startUnconfirmed';
      return 'notInUse';
    default:
      return 'notInUse';
  }
}
