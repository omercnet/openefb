// Ported from efb-212Tests/ServiceTests/DisplayModeResolverTests.swift (8 cases, same names and inputs).
import { type Coordinate } from './geo';
import { DISPLAY_MODES, colorSchemeFor, DisplayModeResolver, SolarPosition, displayModeTitle } from './displayMode';

const KPAO: Coordinate = { lat: 37.4611, lon: -122.115 };

/** UTC instant (epoch ms) from components. */
const utc = (y: number, mo: number, d: number, h: number, mi = 0): number => Date.UTC(y, mo - 1, d, h, mi);

const isNight = DisplayModeResolver.isNight;

describe('DisplayModeResolverTests', () => {
  it('explicitModesIgnoreSunAndSystem', () => {
    const noon = utc(2026, 6, 21, 20); // 13:00 PDT at KPAO
    expect(isNight({ mode: 'night', systemIsDark: false, coordinate: KPAO, date: noon })).toBe(true);
    expect(isNight({ mode: 'day', systemIsDark: true, coordinate: KPAO, date: noon })).toBe(false);
  });

  it('autoWithoutFixFollowsSystem', () => {
    const now = utc(2026, 6, 21, 20);
    expect(isNight({ mode: 'auto', systemIsDark: true, coordinate: null, date: now })).toBe(true);
    expect(isNight({ mode: 'auto', systemIsDark: false, coordinate: null, date: now })).toBe(false);
  });

  it('autoIsDayAtLocalNoon', () => {
    // System dark must not matter once a position is known
    const noon = utc(2026, 6, 21, 20);
    expect(isNight({ mode: 'auto', systemIsDark: true, coordinate: KPAO, date: noon })).toBe(false);
  });

  it('autoIsNightAtLocalMidnight', () => {
    const midnight = utc(2026, 6, 21, 9); // 02:00 PDT
    expect(isNight({ mode: 'auto', systemIsDark: false, coordinate: KPAO, date: midnight })).toBe(true);
  });

  it('solarElevationMatchesKnownValues', () => {
    // Summer solstice solar noon at KPAO: 90 - 37.46 + 23.44 = 75.98 deg (solar noon ~20:10 UTC)
    const noon = SolarPosition.elevationDegrees(KPAO, utc(2026, 6, 21, 20, 10));
    expect(Math.abs(noon - 76.0)).toBeLessThan(1.0);
    // Winter solstice solar noon: 90 - 37.46 - 23.44 = 29.1 deg
    const winter = SolarPosition.elevationDegrees(KPAO, utc(2026, 12, 21, 20, 10));
    expect(Math.abs(winter - 29.1)).toBeLessThan(1.0);
  });

  it('civilTwilightBoundaryIsSix', () => {
    // Sunset ~03:25 UTC (20:25 PDT); civil twilight ends ~04:00 UTC.
    expect(isNight({ mode: 'auto', systemIsDark: false, coordinate: KPAO, date: utc(2026, 6, 22, 3, 40) })).toBe(false);
    expect(isNight({ mode: 'auto', systemIsDark: false, coordinate: KPAO, date: utc(2026, 6, 22, 4, 30) })).toBe(true);
  });

  it('polarWinterIsNightAtNoonAndPolarSummerIsDayAtMidnight', () => {
    const arctic: Coordinate = { lat: 80, lon: 0 };
    expect(isNight({ mode: 'auto', systemIsDark: false, coordinate: arctic, date: utc(2026, 12, 21, 12) })).toBe(true);
    expect(isNight({ mode: 'auto', systemIsDark: true, coordinate: arctic, date: utc(2026, 6, 21, 0) })).toBe(false);
  });

  it('invalidCoordinateFallsBackToSystem', () => {
    const bad: Coordinate = { lat: 999, lon: 999 };
    expect(isNight({ mode: 'auto', systemIsDark: true, coordinate: bad, date: utc(2026, 6, 21, 20) })).toBe(true);
  });
});

describe('DisplayMode (enum surface)', () => {
  it('lists day, night, auto with their titles', () => {
    expect(DISPLAY_MODES).toEqual(['day', 'night', 'auto']);
    expect(DISPLAY_MODES.map(displayModeTitle)).toEqual(['Day', 'Night', 'Auto']);
  });
});

describe('colorSchemeFor (DisplayModeModifier.scheme)', () => {
  const noon = utc(2026, 6, 21, 20);
  const midnight = utc(2026, 6, 21, 9);
  it('day and night force a scheme', () => {
    expect(colorSchemeFor('day', KPAO, midnight)).toBe('light');
    expect(colorSchemeFor('night', KPAO, noon)).toBe('dark');
  });
  it('auto is system (null) without a fix and follows the sun with one', () => {
    expect(colorSchemeFor('auto', null, noon)).toBeNull();
    expect(colorSchemeFor('auto', KPAO, noon)).toBe('light');
    expect(colorSchemeFor('auto', KPAO, midnight)).toBe('dark');
  });
});
