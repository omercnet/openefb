// ISO 8601 date-time parsing shared by the services (remote config, NOTAM feeds). Platform-free.
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

/** Epoch ms of a full ISO 8601 date-time with a zone ("2026-11-02T12:00:00Z", fractional seconds allowed), or null.
 * Date-only text, missing zones and impossible calendar values (month 13, 30 February) are not dates. */
export function parseIsoDateTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE_TIME.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const fraction = m[7] ? Math.floor(Number(`0${m[7]}`) * 1000) : 0;
  let offsetMs = 0;
  if (m[8] !== 'Z') {
    const sign = m[8].startsWith('-') ? -1 : 1;
    const digits = m[8].slice(1).replace(':', '');
    const offHour = Number(digits.slice(0, 2));
    const offMinute = Number(digits.slice(2));
    if (offHour > 23 || offMinute > 59) return null;
    offsetMs = sign * (offHour * 60 + offMinute) * 60_000;
  }
  return utc + fraction - offsetMs;
}
