// The app's one type guard for JSON objects. Data read at a boundary (native module output, a stored value, a server reply)
// is `unknown`; this narrows it to an object whose fields are still `unknown`, so each field a caller uses is then checked
// with typeof or Array.isArray. Import it; do not define another.

/** True for a non-null, non-array object. The fields of the result are `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
