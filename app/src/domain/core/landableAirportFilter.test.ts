import {
  DEFAULT_MINIMUM_RUNWAY_LENGTH_FEET,
  isLandable,
  isMilitary,
  isPrivateUse,
  landableAirports,
  longestRunway,
  surfaceAbbreviation,
} from './landableAirportFilter';
import { makeAirport, type Airport, type Runway } from './models';
import type { AirportType, OwnershipType, SurfaceType } from './types';

const runway = (id: string, length: number, surface: SurfaceType): Runway => ({
  id,
  length,
  width: 60,
  surface,
  lighting: 'none',
  baseEndID: id.slice(0, 2),
  reciprocalEndID: id.slice(-2),
  baseEndLatitude: 0,
  baseEndLongitude: 0,
  reciprocalEndLatitude: 0,
  reciprocalEndLongitude: 0,
});
const airport = (
  icao: string,
  runways: Runway[],
  type: AirportType = 'airport',
  ownership: OwnershipType = 'public',
): Airport => makeAirport({ icao, name: icao, latitude: 37, longitude: -122, elevation: 0, type, ownership, runways });

const kpao = airport('KPAO', [runway('13/31', 2441, 'asphalt')]);
const hospitalHeliport = airport('15CA', [runway('H1', 100, 'asphalt')], 'heliport');
const heliportNoRunway = airport('US-2776', [], 'heliport');
const seaplaneBase = airport('S00', [runway('01W/19W', 5000, 'water')], 'seaplane');
const shortStrip = airport('1CA1', [runway('09/27', 1200, 'turf')]);
const gravelOnly = airport('2CA2', [runway('09/27', 3000, 'gravel')]);
const turfStrip = airport('3CA3', [runway('18/36', 2200, 'turf')]);
const privateField = airport('4CA4', [runway('18/36', 2600, 'asphalt')], 'airport', 'private');
const mixedSurfaces = airport('5CA5', [runway('09/27', 4000, 'dirt'), runway('18/36', 1800, 'concrete')]);
const exactMinimum = airport('6CA6', [runway('18/36', 1500, 'asphalt')]);

describe('Landable Airport Filter', () => {
  it('heliportIsNotLandableEvenWithHardPad', () => {
    expect(isLandable(hospitalHeliport)).toBe(false);
    expect(isLandable(heliportNoRunway)).toBe(false);
  });
  it('seaplaneBaseIsNotLandable', () => expect(isLandable(seaplaneBase)).toBe(false));
  it('shortRunwayIsNotLandable', () => expect(isLandable(shortStrip)).toBe(false));
  it('gravelOnlyIsNotLandable', () => expect(isLandable(gravelOnly)).toBe(false));
  it('airportWithoutRunwayDataIsNotLandable', () => expect(isLandable(airport('7CA7', []))).toBe(false));
  it('pavedAirportIsLandable', () => expect(isLandable(kpao)).toBe(true));
  it('turfStripAboveMinimumIsLandable', () => expect(isLandable(turfStrip)).toBe(true));
  it('runwayExactlyAtMinimumIsLandable', () => {
    expect(isLandable(exactMinimum)).toBe(true);
    expect(DEFAULT_MINIMUM_RUNWAY_LENGTH_FEET).toBe(1500);
  });
  it('onlyLandableSurfaceRunwaysCountTowardMinimum', () => {
    expect(isLandable(mixedSurfaces)).toBe(true);
    expect(isLandable(mixedSurfaces, 2000)).toBe(false);
  });
  it('minimumRunwayLengthIsConfigurable', () => {
    expect(isLandable(kpao, 2500)).toBe(false);
    expect(isLandable(kpao, 2400)).toBe(true);
  });
  it('filterKeepsOrderAndDropsHeliportsSeaplanesAndShortStrips', () => {
    const input = [
      hospitalHeliport,
      kpao,
      heliportNoRunway,
      seaplaneBase,
      shortStrip,
      turfStrip,
      gravelOnly,
      privateField,
    ];
    expect(landableAirports(input).map((a) => a.icao)).toEqual(['KPAO', '3CA3', '4CA4']);
  });
  it('privateUseIsFlaggedButStillLandable', () => {
    expect(isPrivateUse(privateField)).toBe(true);
    expect(isPrivateUse(kpao)).toBe(false);
    expect(isLandable(privateField)).toBe(true);
  });
  it('militaryIsFlaggedMilNotPvtAndStillListed', () => {
    const moffett = airport('KNUQ', [runway('14R/32L', 9200, 'asphalt')], 'airport', 'military');
    expect(isMilitary(moffett)).toBe(true);
    expect(isPrivateUse(moffett)).toBe(false);
    expect(isMilitary(kpao)).toBe(false);
    expect(isMilitary(privateField)).toBe(false);
    expect(landableAirports([kpao, moffett]).map((a) => a.icao)).toEqual(['KPAO', 'KNUQ']);
  });
  it('longestRunwayPrefersLandableSurface', () => {
    const longest = longestRunway(mixedSurfaces);
    expect(longest?.id).toBe('18/36');
    expect(longest?.surface).toBe('concrete');
  });
  it('longestRunwayFallsBackToAnySurfaceAndNullWhenNone', () => {
    expect(longestRunway(gravelOnly)?.surface).toBe('gravel');
    expect(longestRunway(heliportNoRunway)).toBeNull();
  });
  it('surfaceAbbreviationsAreStandard', () => {
    expect(['asphalt', 'concrete', 'turf', 'gravel'].map((s) => surfaceAbbreviation(s as SurfaceType))).toEqual([
      'ASPH',
      'CONC',
      'TURF',
      'GRVL',
    ]);
  });
});
