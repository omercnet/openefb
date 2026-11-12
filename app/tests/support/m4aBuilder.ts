// Builds MPEG-4 audio files byte by byte for the duration parser and the file adapter tests.

export const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));
export const u32 = (n: number): Uint8Array => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A box: 32 bit size, 4 character type, payload. */
export const box = (type: string, ...payload: Uint8Array[]): Uint8Array => {
  const body = concat(...payload);
  return concat(u32(8 + body.length), ascii(type), body);
};

/** The 80 bytes after the duration (rate, volume, matrix, next track id) are irrelevant to the parser. */
const mvhdTail = new Uint8Array(80);

/** Movie header, version 0: 32 bit creation, modification and duration. */
export const mvhdV0 = (timescale: number, duration: number): Uint8Array =>
  box('mvhd', u32(0), u32(0), u32(0), u32(timescale), u32(duration), mvhdTail);

/** Movie header, version 1: 64 bit duration given as two 32 bit halves. */
export const mvhdV1 = (timescale: number, high: number, low: number): Uint8Array =>
  box('mvhd', u32(0x01000000), new Uint8Array(16), u32(timescale), u32(high), u32(low), mvhdTail);

export const ftyp = box('ftyp', ascii('M4A '), u32(0), ascii('M4A mp42isom'));
export const mdat = box('mdat', new Uint8Array(1000));

/** A finished recording of the given length: media data first, then the movie box, as recorders write it. */
export const m4aOf = (seconds: number): Uint8Array =>
  concat(ftyp, mdat, box('moov', mvhdV0(1000, Math.round(seconds * 1000))));
