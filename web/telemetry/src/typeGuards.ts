// This package's one type guard for JSON objects. Request bodies are `unknown` until checked; this narrows to an object
// whose fields are still `unknown`, and each field the Worker uses is then checked with typeof or Array.isArray. Import it;
// do not define another.

/** True for a non-null, non-array object. The fields of the result are `unknown`. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
