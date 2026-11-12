// Offline labels (M3): the style's `glyphs` must be a local file URL and every font stack a layer asks for must be bundled.
import baseStyle from '../../../assets/base-style.json';
import { packStyle } from '../offline/packModel';
import { layerSpecsFor } from './registry';
import {
  BUNDLED_GLYPH_RANGES,
  BUNDLED_GLYPH_STACKS,
  emptyGlyphRangePbf,
  fontStacksUsedBy,
  glyphRangeName,
  glyphRangesToGenerate,
  isLocalGlyphsUrl,
  localGlyphsUrl,
  withLocalGlyphs,
} from './glyphs';

describe('local glyphs', () => {
  const dir = 'file:///data/user/0/app/files/glyphs';

  it('the style glyphs URL is a local file URL with both placeholders, and never remote', () => {
    const url = localGlyphsUrl(dir);
    expect(url).toBe('file:///data/user/0/app/files/glyphs/{fontstack}/{range}.pbf');
    expect(isLocalGlyphsUrl(url)).toBe(true);
    expect(isLocalGlyphsUrl('https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf')).toBe(false);
    expect(isLocalGlyphsUrl('file:///x/{range}.pbf')).toBe(false); // no {fontstack}
    expect(localGlyphsUrl(`${dir}/`)).toBe(url); // a trailing slash does not double up
  });

  it('withLocalGlyphs replaces only `glyphs` and does not mutate the base style', () => {
    const before = JSON.stringify(baseStyle);
    const style = withLocalGlyphs(baseStyle as unknown as { glyphs?: string; layers: unknown[] }, localGlyphsUrl(dir));
    expect(isLocalGlyphsUrl(style.glyphs)).toBe(true);
    expect(style.layers).toBe((baseStyle as unknown as { layers: unknown[] }).layers);
    expect(JSON.stringify(baseStyle)).toBe(before);
    expect((baseStyle as { glyphs: string }).glyphs).toMatch(/^https:/); // the asset itself stays as authored
  });

  it('the offline street pack style keeps the local glyphs, so a pack never downloads glyph ranges', () => {
    const local = localGlyphsUrl(dir);
    const style = packStyle('street', withLocalGlyphs(baseStyle as unknown as { glyphs?: string }, local)) as {
      glyphs?: string;
    };
    expect(isLocalGlyphsUrl(style.glyphs)).toBe(true);
    expect((packStyle('sectional', baseStyle) as { glyphs?: string }).glyphs).toBeUndefined();
  });

  it('every text-font used by the base style and by every region registry is a bundled stack', () => {
    const baseFonts = (baseStyle.layers as { layout?: { 'text-font'?: string[] } }[]).flatMap(
      (l) => l.layout?.['text-font'] ?? [],
    );
    expect(baseFonts.length).toBeGreaterThan(0);
    const used = new Set<string>([...baseFonts]);
    for (const region of ['us', 'israel'] as const)
      for (const f of fontStacksUsedBy(layerSpecsFor(region))) used.add(f);
    expect(used.size).toBeGreaterThan(0);
    for (const font of used) expect(Object.keys(BUNDLED_GLYPH_STACKS)).toContain(font);
  });

  it('the bundled ranges cover Basic Latin, the degree sign, Hebrew and general punctuation', () => {
    const ranges = BUNDLED_GLYPH_RANGES['Noto Sans Regular']!;
    for (const cp of ['A'.codePointAt(0)!, 0xb0, 0x5d0 /* alef */, 0x2013 /* en dash */]) {
      expect(ranges).toContain(glyphRangeName(cp));
    }
  });

  it('glyphRangeName buckets by 256 code points', () => {
    expect(glyphRangeName(0)).toBe('0-255');
    expect(glyphRangeName(255)).toBe('0-255');
    expect(glyphRangeName(256)).toBe('256-511');
    expect(glyphRangeName(0x5d0)).toBe('1280-1535');
    expect(glyphRangeName(0xffff)).toBe('65280-65535');
  });

  it('ranges that are not bundled are generated as empty glyph files so a request never fails', () => {
    const gen = glyphRangesToGenerate('Noto Sans Regular');
    expect(gen).toHaveLength(256 - BUNDLED_GLYPH_RANGES['Noto Sans Regular']!.length);
    expect(gen).not.toContain('0-255');
    expect(gen).toContain('256-511');
    expect(new Set(gen).size).toBe(gen.length);
  });

  it('an empty glyph range is a valid PBF: one fontstack with the name and the range, no glyphs', () => {
    const bytes = emptyGlyphRangePbf('Noto Sans Regular', '256-511');
    // outer field 1 (stacks), length-delimited
    expect(bytes[0]).toBe(0x0a);
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).toContain('Noto Sans Regular');
    expect(text).toContain('256-511');
    expect(bytes[1]).toBe(bytes.length - 2); // short enough for a one-byte length
  });

  it('fontStacksUsedBy ignores non-symbol layers and layers without a text-font', () => {
    const used = fontStacksUsedBy([
      { id: 'a', type: 'circle', source: 's', layer: null },
      { id: 'b', type: 'symbol', source: 's', layer: null, layout: { 'icon-image': 'x' } },
      { id: 'c', type: 'symbol', source: 's', layer: null, layout: { 'text-font': ['Foo', 'Bar'] } },
    ]);
    expect([...used].sort()).toEqual(['Bar', 'Foo']);
  });

  it('the bundled glyph files exist and stay small (under 250 KB in total)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    let total = 0;
    for (const [stack, ranges] of Object.entries(BUNDLED_GLYPH_RANGES)) {
      for (const r of ranges) {
        const file = path.join(__dirname, '../../../assets/glyphs', stack, `${r}.pbf`);
        expect(fs.existsSync(file)).toBe(true);
        total += fs.statSync(file).size;
      }
    }
    expect(total).toBeLessThan(250_000);
  });
});
