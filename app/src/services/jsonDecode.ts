// Strict decoding helpers that mirror Swift Decodable for optional fields: absent or null reads as null, a value of
// the wrong type throws (the whole payload is then rejected, as JSONDecoder does). Platform-free.
export type JsonObject = Record<string, unknown>;

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeError';
  }
}

export const isJsonObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

export function asObject(value: unknown, path: string): JsonObject {
  if (!isJsonObject(value)) throw new DecodeError(`${path}: expected an object`);
  return value;
}

export function optObject(o: JsonObject, key: string): JsonObject | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  return asObject(v, key);
}

export function optString(o: JsonObject, key: string): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new DecodeError(`${key}: expected a string`);
  return v;
}

export function reqString(o: JsonObject, key: string): string {
  const v = optString(o, key);
  if (v === null) throw new DecodeError(`${key}: missing`);
  return v;
}

/** Swift Int: a whole JSON number. */
export function optInt(o: JsonObject, key: string): number | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new DecodeError(`${key}: expected an integer`);
  return v;
}

export function reqInt(o: JsonObject, key: string): number {
  const v = optInt(o, key);
  if (v === null) throw new DecodeError(`${key}: missing`);
  return v;
}

export function optDouble(o: JsonObject, key: string): number | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DecodeError(`${key}: expected a number`);
  return v;
}

export function reqDouble(o: JsonObject, key: string): number {
  const v = optDouble(o, key);
  if (v === null) throw new DecodeError(`${key}: missing`);
  return v;
}

export function optBool(o: JsonObject, key: string): boolean | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'boolean') throw new DecodeError(`${key}: expected a boolean`);
  return v;
}

export function reqBool(o: JsonObject, key: string): boolean {
  const v = optBool(o, key);
  if (v === null) throw new DecodeError(`${key}: missing`);
  return v;
}

export function optArray(o: JsonObject, key: string): unknown[] | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) throw new DecodeError(`${key}: expected an array`);
  return v;
}

export function reqArray(o: JsonObject, key: string): unknown[] {
  const v = optArray(o, key);
  if (v === null) throw new DecodeError(`${key}: missing`);
  return v;
}

export function stringArray(values: unknown[], path: string): string[] {
  return values.map((v) => {
    if (typeof v !== 'string') throw new DecodeError(`${path}: expected strings`);
    return v;
  });
}

/** Runs a decoder, turning any failure into null (Swift `try?`). */
export function lenient<T>(decode: () => T): T | null {
  try {
    return decode();
  } catch {
    return null;
  }
}
