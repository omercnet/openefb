import { dayAccessibilityLabel, stepValue, WEEKDAY_LETTERS } from './logic';

describe('stepValue (Stepper(value:in:))', () => {
  it.each([
    [3, 1, 0, 10, 4],
    [3, -1, 0, 10, 2],
    [10, 1, 0, 10, 10], // stops at the top
    [0, -1, 0, 10, 0], // and at the bottom
    [99, 1, 0, 99, 99],
    [1, -1, 1, 10, 1],
    [5, 1, 5, 5, 5],
  ])('%s stepped by %s within %s to %s is %s', (value, delta, min, max, expected) => {
    expect(stepValue(value, delta, min, max)).toBe(expected);
  });

  it('a value outside the range is brought into it by the next step', () => {
    expect(stepValue(15, -1, 0, 10)).toBe(10);
    expect(stepValue(-4, 1, 0, 10)).toBe(0);
  });

  it('a value that is not a number reads as the minimum, then steps (JS-only guard)', () => {
    expect(stepValue(Number.NaN, 1, 1, 10)).toBe(2);
    expect(stepValue(Number.NaN, -1, 1, 10)).toBe(1); // stepping down from the minimum stays at it
    expect(stepValue(Number.NaN, 0, 0, 99)).toBe(0);
  });
});

describe('calendar labels', () => {
  it('a day is announced with its full date', () => {
    expect(dayAccessibilityLabel(2026, 10, 5)).toBe('5 November 2026');
    expect(dayAccessibilityLabel(2028, 1, 29)).toBe('29 February 2028');
    expect(dayAccessibilityLabel(2027, 0, 1)).toBe('1 January 2027');
  });

  it('the weekday header is Sunday first', () => {
    expect(WEEKDAY_LETTERS).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
  });
});
