// Swift number formatting and parsing as the profile and logbook forms use it.

/**
 * `String(format: "%.1f", x)`. printf rounds an exact tie to the even digit, where `Number#toFixed` rounds it up: 900 s is
 * 0.25 h, which Swift shows as "0.2". A tie needs x = k / 4 with k odd (then x * 10 is exactly n + 0.5). A value that is not a
 * number reads "0.0" (JS-only guard; printf prints inf or nan).
 */
export function fixed1(x: number): string {
  if (!Number.isFinite(x)) return '0.0';
  const quarters = Math.abs(x) * 4;
  if (Number.isInteger(quarters) && quarters % 2 === 1) {
    const lower = Math.floor(Math.abs(x) * 10);
    const even = lower % 2 === 0 ? lower : lower + 1;
    return `${x < 0 ? '-' : ''}${(even / 10).toFixed(1)}`;
  }
  return x.toFixed(1);
}

/** `String(Double)`: a whole number keeps its ".0" (an aircraft's 180 gallons edits as "180.0"). */
export function doubleText(x: number): string {
  return Number.isInteger(x) && Math.abs(x) < 1e16 ? x.toFixed(1) : String(x);
}

/**
 * `Double(String)`: the whole text must be a decimal number, with no whitespace and "." as the decimal mark ("12,5" reads as
 * no value, as in Swift). JS-only guard: Swift also reads "inf", "nan" and hex floats; those, and anything that overflows,
 * read as no value here so a non-finite number is never stored.
 */
export function parseSwiftDouble(text: string): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** `Int(String)`: an optional sign and digits only. JS-only guard: beyond exact JS integers reads as no value. */
export function parseSwiftInt(text: string): number | null {
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}
