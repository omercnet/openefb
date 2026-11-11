// Swift's number formatting and parsing as the profile and logbook forms use it (no Swift test covers it; the Swift behaviour
// is read from the source and checked against C printf through Python's % operator, which rounds the same way).
import { doubleText, fixed1, parseSwiftDouble, parseSwiftInt } from './numberFormat';

describe('fixed1 (String(format: "%.1f", x))', () => {
  // Expected values generated with Python: '%.1f' % x. Exact ties (x = k / 4, k odd) go to the even digit, unlike toFixed.
  const hours: [number, string][] = [
    [0, '0.0'],
    [1, '0.0'],
    [36, '0.0'],
    [180, '0.1'],
    [900, '0.2'], // 0.25 h: a tie, printf takes the even digit
    [1800, '0.5'],
    [2520, '0.7'],
    [2700, '0.8'], // 0.75 h: a tie, the even digit is 8
    [3600, '1.0'],
    [4500, '1.2'], // 1.25 h
    [5400, '1.5'],
    [8100, '2.2'], // 2.25 h
    [9000, '2.5'],
    [12600, '3.5'],
    [13500, '3.8'], // 3.75 h
    [36000, '10.0'],
    [36900, '10.2'], // 10.25 h
    [90061, '25.0'],
    [3599, '1.0'],
    [215, '0.1'],
    [1080, '0.3'],
    [3240, '0.9'],
    [-900, '-0.2'],
    [-2700, '-0.8'],
    [-5, '-0.0'],
  ];
  it.each(hours)('%s s as hours is %s', (seconds, text) => {
    expect(fixed1(seconds / 3600)).toBe(text);
  });

  const plain: [number, string][] = [
    [12.5, '12.5'],
    [0.25, '0.2'],
    [0.75, '0.8'],
    [1.25, '1.2'],
    [18.25, '18.2'],
    [8, '8.0'],
    [9.95, '9.9'], // not a tie: the double is just below 9.95
    [10.05, '10.1'],
    [2.675, '2.7'],
    [0.05, '0.1'],
    [0.15, '0.1'],
    [7.35, '7.3'],
    [123.45, '123.5'],
    [0.95, '0.9'],
    [1000, '1000.0'],
    [33.349999999999994, '33.3'],
  ];
  it.each(plain)('%s is %s', (x, text) => {
    expect(fixed1(x)).toBe(text);
  });

  it('a value that is not a number reads 0.0 (JS-only guard; printf prints inf or nan)', () => {
    expect(fixed1(Number.NaN)).toBe('0.0');
    expect(fixed1(Number.POSITIVE_INFINITY)).toBe('0.0');
  });
});

describe('doubleText (String(Double), as the edit forms show a stored number)', () => {
  it.each([
    [180, '180.0'], // Swift prints a whole Double with a ".0"
    [0, '0.0'],
    [-3, '-3.0'],
    [12.5, '12.5'],
    [0.1, '0.1'],
    [8.5, '8.5'],
    [1e21, '1e+21'],
  ])('%s -> %s', (x, text) => {
    expect(doubleText(x)).toBe(text);
  });
});

describe('parseSwiftDouble (Double(String): the whole text, no whitespace, "." as the decimal mark)', () => {
  const cases: [string, number | null][] = [
    ['12', 12],
    ['12.5', 12.5],
    ['-3', -3],
    ['+4', 4],
    ['.5', 0.5],
    ['5.', 5],
    ['0', 0],
    ['1e3', 1000],
    ['1E-2', 0.01],
    ['2.5e+1', 25],
    ['', null],
    [' 12', null],
    ['12 ', null],
    ['12,5', null], // a decimal comma reads as no value, like Swift's Double("12,5")
    ['abc', null],
    ['--1', null],
    ['1.2.3', null],
    ['.', null],
    ['e5', null],
    ['1e', null],
    ['1_000', null],
    ['0x10', null],
    ['inf', null], // Swift reads these; JS-only guard: a non-finite number is not a value
    ['nan', null],
    ['Infinity', null],
    ['1e999', null],
  ];
  it.each(cases)('%j -> %s', (text, value) => {
    expect(parseSwiftDouble(text)).toBe(value);
  });
});

describe('parseSwiftInt (Int(String): optional sign and digits only)', () => {
  const cases: [string, number | null][] = [
    ['12', 12],
    ['-3', -3],
    ['+7', 7],
    ['0', 0],
    ['007', 7],
    ['', null],
    ['1.0', null],
    [' 1', null],
    ['1 ', null],
    ['12a', null],
    ['--1', null],
    ['+', null],
    ['9007199254740993', null], // beyond exact JS integers (JS-only guard; Swift Int goes to 2^63)
  ];
  it.each(cases)('%j -> %s', (text, value) => {
    expect(parseSwiftInt(text)).toBe(value);
  });
});
