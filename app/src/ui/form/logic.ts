// Pure decisions behind the form controls, kept apart from the views so they are testable without a renderer.
import { monthTitle } from '../../domain/calendar';

/** One step of a Stepper, held to its range. A value outside the range is brought into it; NaN steps from the minimum. */
export function stepValue(value: number, delta: number, min: number, max: number): number {
  const from = Number.isFinite(value) ? value : min;
  return Math.min(max, Math.max(min, from + delta));
}

/** "5 November 2026": what a screen reader says for a calendar day (month is 0-based). */
export const dayAccessibilityLabel = (year: number, month: number, day: number): string =>
  `${day} ${monthTitle(year, month)}`;

/** The calendar's weekday header, Sunday first. */
export const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
