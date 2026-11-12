// Offline map labels (M3). MapLibre fetches text glyphs as 256-code-point PBF ranges from the style's `glyphs` URL; the
// SwiftUI app drew Israel labels to local sprites, and the base style pointed at a remote endpoint, so labels vanished
// offline. The app now bundles the Noto Sans Regular ranges it needs (Latin, Hebrew, general punctuation; OFL 1.1, from
// the OpenFreeMap font set), installs them to a local directory at first launch, and points `glyphs` at that directory.
// Every other range is generated as an empty (valid) glyph file, so a label containing an unbundled character drops that
// character instead of failing the whole request. Platform-free: the file copying is adapters/glyphInstall.ts.
import type { LayerSpec } from './layerSpec';

/** Ranges bundled per font stack, as `start-end` names. Sizes: 0-255 77 KB, 1280-1535 78 KB, 8192-8447 34 KB. */
export const BUNDLED_GLYPH_RANGES: Readonly<Record<string, readonly string[]>> = {
  // 0-255 Basic Latin and Latin-1 (digits, the degree sign), 1280-1535 Hebrew (U+0500-05FF), 8192-8447 punctuation.
  'Noto Sans Regular': ['0-255', '1280-1535', '8192-8447'],
};
export const BUNDLED_GLYPH_STACKS = BUNDLED_GLYPH_RANGES;

const RANGE_SIZE = 256;
const RANGE_COUNT = 256; // code points 0..65535

export function glyphRangeName(codePoint: number): string {
  const start = Math.floor(codePoint / RANGE_SIZE) * RANGE_SIZE;
  return `${start}-${start + RANGE_SIZE - 1}`;
}

/** Ranges of a stack that are not bundled and must be written as empty files. */
export function glyphRangesToGenerate(stack: string): string[] {
  const bundled = new Set(BUNDLED_GLYPH_RANGES[stack] ?? []);
  const out: string[] = [];
  for (let i = 0; i < RANGE_COUNT; i++) {
    const name = `${i * RANGE_SIZE}-${i * RANGE_SIZE + RANGE_SIZE - 1}`;
    if (!bundled.has(name)) out.push(name);
  }
  return out;
}

const utf8 = (s: string): number[] => [...new TextEncoder().encode(s)];

/**
 * A glyph PBF with one font stack (name and range) and no glyphs:
 * `glyphs { stacks (1) { name (1), range (2) } }`.
 */
export function emptyGlyphRangePbf(stack: string, range: string): Uint8Array {
  const name = utf8(stack);
  const rng = utf8(range);
  const inner = [0x0a, name.length, ...name, 0x12, rng.length, ...rng];
  if (inner.length > 127) throw new Error('glyph stack name too long for the one-byte length');
  return Uint8Array.from([0x0a, inner.length, ...inner]);
}

/** `{dir}/{fontstack}/{range}.pbf`, the form MapLibre substitutes into. `dir` is a file:// directory uri. */
export const localGlyphsUrl = (dirUri: string): string => `${dirUri.replace(/\/+$/, '')}/{fontstack}/{range}.pbf`;

export const isLocalGlyphsUrl = (url: string | undefined): boolean =>
  typeof url === 'string' && url.startsWith('file://') && url.includes('{fontstack}') && url.includes('{range}');

/** A copy of the style with `glyphs` replaced; layers and sources are shared, not cloned. */
export function withLocalGlyphs<T extends { glyphs?: string }>(style: T, glyphsUrl: string): T {
  return { ...style, glyphs: glyphsUrl };
}

/** Every font name that a symbol layer asks for in `text-font`. */
export function fontStacksUsedBy(specs: readonly LayerSpec[]): Set<string> {
  const out = new Set<string>();
  for (const s of specs) {
    if (s.type !== 'symbol') continue;
    const fonts = s.layout?.['text-font'];
    if (Array.isArray(fonts)) for (const f of fonts) if (typeof f === 'string') out.add(f);
  }
  return out;
}
