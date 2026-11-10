// Core Data / SwiftData value decoding (see docs/swift-store-layout.md).

/** Seconds between the Unix epoch and the Core Data reference date, 2001-01-01T00:00:00Z. */
export const CORE_DATA_EPOCH_OFFSET_SECONDS = 978_307_200;

/** Core Data timestamps are REAL seconds since 2001-01-01; ours are epoch ms integers. NULL stays null. */
export function coreDataToEpochMs(seconds: unknown): number | null {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? Math.round((seconds + CORE_DATA_EPOCH_OFFSET_SECONDS) * 1000)
    : null;
}

/** A SwiftData UUID attribute is the 16 raw bytes (big endian). Returns lower-case text, or null for any other shape. */
export function uuidFromBlob(blob: unknown): string | null {
  if (!(blob instanceof Uint8Array) || blob.length !== 16) return null;
  const hex = Array.from(blob, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** UUID strings stored as text (settings, profile links) are compared case-insensitively; we store them lower case. */
export const normalizeUuidText = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v.toLowerCase() : null;

/** Swift Data columns that hold JSON (Codable) arrive as bytes; read them as UTF-8 text. Plain text passes through. */
export function blobToText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(v);
    } catch {
      return null;
    }
  }
  return null;
}
