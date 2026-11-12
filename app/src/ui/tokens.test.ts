// Parity of tokens.ts with efb-212/Core/DesignTokens.swift (read in place, Swift stays until cutover). Not a port of a
// Swift test: nothing in efb-212Tests covers the tokens directly, so the Swift source is the oracle.
import { readFileSync } from 'node:fs';
import { Platform } from 'react-native';
import { join } from 'node:path';

import { AccentDayHighContrast, Day, MapControlMetrics, Night, Radius, Space, StripMetrics, lineHeight } from './tokens';

const swift = readFileSync(join(__dirname, '../../../efb-212/Core/DesignTokens.swift'), 'utf8');

/** Body of `enum <name> { ... }` up to the first closing brace at column 0. */
function enumBody(name: string): string {
  const m = new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`).exec(swift);
  if (!m) throw new Error(`enum ${name} not found in DesignTokens.swift`);
  return m[1];
}

function numbers(name: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of enumBody(name).matchAll(/static let (\w+): CGFloat = ([\d.]+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

const hex = (n: number): string => `#${n.toString(16).toUpperCase().padStart(6, '0')}`;

describe('DesignTokens parity', () => {
  it('Space matches', () => {
    expect(Space).toEqual(numbers('Space'));
  });

  it('Radius matches', () => {
    expect(Radius).toEqual(numbers('Radius'));
  });

  it('StripMetrics matches', () => {
    const s = numbers('StripMetrics');
    expect(StripMetrics.width).toBe(s.width);
    expect(StripMetrics.railWidth).toBe(s.railWidth);
    expect(StripMetrics.cell).toBe(s.cell);
    expect(StripMetrics.labelTracking).toBe(s.labelTracking);
  });

  it('MapControlMetrics matches', () => {
    expect(MapControlMetrics.size).toBe(numbers('MapControlMetrics').size);
    expect(MapControlMetrics.cornerRadius).toBe(Radius.l);
  });

  it('strip palette (dynamic(day:night:)) matches Day and Night', () => {
    const pairs = [...swift.matchAll(/static let (\w+) = dynamic\(day: 0x([0-9A-Fa-f]{6}), night: 0x([0-9A-Fa-f]{6})\)/g)];
    expect(pairs.map((m) => m[1])).toEqual([
      'paper',
      'paperSecondary',
      'activeCell',
      'rule',
      'ink',
      'inkSecondary',
      'route',
      'airspace',
    ]);
    for (const [, name, day, night] of pairs) {
      expect((Day as Record<string, unknown>)[name]).toBe(hex(parseInt(day, 16)));
      expect((Night as Record<string, unknown>)[name]).toBe(hex(parseInt(night, 16)));
    }
  });

  it('literal UIColor(red:green:blue:) palette entries match', () => {
    const rgb = (r: number, g: number, b: number): string =>
      hex((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255));
    expect(Day.caution).toBe(rgb(0.647, 0.322, 0));
    expect(Day.warning).toBe(rgb(0.784, 0, 0.078));
    expect(Day.ok).toBe(rgb(0.078, 0.471, 0.196));
    expect(Day.northMarker).toBe(rgb(1, 0.624, 0.58));
    expect(Night.northMarker).toBe(rgb(1, 0.561, 0.525));
    expect(Day.routeLine).toBe(rgb(0.82, 0, 0.82));
    expect(Night.routeLine).toBe(rgb(0.95, 0.42, 0.95));
    expect(Night.layerSectional).toBe(rgb(0.275, 0.471, 0.745));
    expect(Day.layerAirports).toBe(rgb(0, 0.431, 0.549));
    expect(Day.layerAirspace).toBe(rgb(0.706, 0.345, 0));
    expect(Day.layerAdvisory).toBe(rgb(0.588, 0.235, 0.784));
    expect(Day.layerWeather).toBe(rgb(0.078, 0.471, 0.196));
    expect(Day.layerDiagrams).toBe(rgb(0, 0.471, 0.51));
    expect(Night.categoryMVFR).toBe(rgb(0.56, 0.71, 0.88));
    expect(Day.categoryLIFR).toBe(rgb(0.8, 0, 0.8));
    expect(Night.categoryLIFR).toBe(rgb(0.9, 0.45, 0.9));
    expect(Night.accent).toBe(rgb(0.18, 0.29, 0.43));
    expect(Night.onAccent).toBe(rgb(0.85, 0.85, 0.85));
  });

  it('derived tokens match their Swift definitions', () => {
    expect(Day.onWarning).toBe('#FFFFFF'); // .white by day
    expect(Night.onWarning).toBe('#000000'); // .black in dark
    expect(Day.cautionFill).toBe('#FF9500'); // Color.orange (systemOrange light)
    expect(Night.cautionFill).toBe('#FF9F0A');
    expect(Day.fill).toBe('rgba(60,60,67,0.072)'); // secondary 0.6 x 0.12
    expect(Night.fill).toBe('rgba(235,235,245,0.072)');
    expect(Day.infoFill).toBe('rgba(21,86,184,0.15)'); // accentDay at 0.15
    expect(Night.infoFill).toBe('rgba(46,74,110,0.35)'); // accentNight at 0.35
    expect(AccentDayHighContrast).toBe('#0C4091');
    expect(Day.accent).toBe('#1556B8');
  });

  it('accentText is the AccentColor asset, light and dark', () => {
    type Entry = { appearances?: { appearance: string; value: string }[]; color: { components: Record<string, string> } };
    const asset = JSON.parse(
      readFileSync(join(__dirname, '../../../efb-212/Assets.xcassets/AccentColor.colorset/Contents.json'), 'utf8'),
    ) as { colors: Entry[] };
    const colour = (entry: Entry | undefined) => {
      const c = entry?.color.components;
      return c ? hex([c.red, c.green, c.blue].reduce((n, v) => n * 256 + Math.round(Number(v) * 255), 0)) : undefined;
    };
    const light = asset.colors.find((e) => !e.appearances);
    const dark = asset.colors.find((e) => e.appearances?.length === 1 && e.appearances[0].value === 'dark');
    expect(Day.accentText).toBe(colour(light));
    expect(Night.accentText).toBe(colour(dark));
  });
});

// Not a port of a Swift test: the rule was measured on the CI simulator and emulator against the Swift references, and
// swapping the platforms' rules costs 0.04 to 0.12 SSIM (see the comment on `lineHeight`).
describe('lineHeight per platform', () => {
  afterEach(() => jest.restoreAllMocks());
  const sizes = [
    // [label, font size, em, natural height]
    ['11 pt Archivo label', 11, 1.088, 11.968],
    ['13 pt Archivo caption', 13, 1.088, 14.144],
    ['15 pt Plex Mono data', 15, 1.3, 19.5],
    ['34 pt Archivo title', 34, 1.088, 36.992],
  ] as const;
  const cases: [string, 'ios' | 'android' | 'web', number[]][] = [
    ['iOS: just below the natural height, which RN ceils to the same grid line as SwiftUI', 'ios', [11.958, 14.134, 19.49, 36.982]],
    ['Android: the natural height to the nearest 0.5 pt (the rule that matched the reference within 1 dp)', 'android', [12, 14, 19.5, 37]],
    ['web: rounded up to the 0.5 pt grid like SwiftUI', 'web', [12, 14.5, 19.5, 37]],
  ];
  it.each(cases)('%s', (_name, os, expected) => {
    jest.replaceProperty(Platform, 'OS', os);
    expect(sizes.map(([, size, em]) => lineHeight(size, em))).toEqual(expected);
  });

  it('stays within 0.5 pt of the natural height on every platform', () => {
    for (const os of ['ios', 'android', 'web'] as const) {
      jest.replaceProperty(Platform, 'OS', os);
      for (const [, size, em, natural] of sizes) expect(Math.abs(lineHeight(size, em) - natural)).toBeLessThanOrEqual(0.5);
    }
  });
});
