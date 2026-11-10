// Port of efb-212Tests/DataTests/IsraelAerodromeDatabaseTests.swift: the curated aerodromes in the bundled
// israel-aviation.sqlite (IL-4).
import { WHOLE_COUNTRY, boundsAround, runwayLengthFeet, type IsraelAviationDatabase } from '../../../src/data/aviation';
import { distanceNm } from '../../../src/domain/geo';
import { openBundledIsrael } from './israelBundled';

const herzliya = { lat: 32.1794, lon: 34.8344 }; // LLHZ ARP

describe('Israel Aerodrome Database Tests', () => {
  let db: IsraelAviationDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await openBundledIsrael());
  });
  afterAll(async () => close());

  describe('coverage', () => {
    test('everyCAAIReferencePointAndRunwayResolvesToAnAerodrome', async () => {
      const points = (await db.reportingPoints(WHOLE_COUNTRY)).filter((p) => p.kind === 'arp');
      expect(points).toHaveLength(25);
      for (const point of points) {
        expect(await db.aerodrome(point.code)).not.toBeNull();
      }
      for (const runway of await db.runwaysIn(WHOLE_COUNTRY)) {
        if (runway.aerodrome === null) continue;
        expect(await db.aerodrome(runway.aerodrome)).not.toBeNull();
      }
    });

    test('theTableHoldsAirportsAirstripsAndHeliports', async () => {
      const all = await db.aerodromesIn(WHOLE_COUNTRY);
      expect(all).toHaveLength(49);
      expect(new Set(all.map((a) => a.type))).toEqual(new Set(['airport', 'airstrip', 'heliport']));
      expect(new Set(all.map((a) => a.code)).size).toBe(all.length);
    });
  });

  describe('nearest', () => {
    test('nearestFromHerzliyaIsHerzliyaThenTheCoastalFields', async () => {
      // Every kind is returned: Herzliya, the Tel Aviv hospital pads and Rishon come before Ben Gurion.
      const nearest = await db.nearestAerodromes(herzliya, 10);
      expect(nearest).toHaveLength(10);
      expect(nearest[0]?.code).toBe('LLHZ');
      expect(nearest.map((a) => a.code)).toContain('LLBG');
      expect(nearest.map((a) => a.code)).not.toContain('LLHA');
      const distances = nearest.map((a) => distanceNm(herzliya, { lat: a.latitude, lon: a.longitude }));
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
    });

    test('nearestFromEilatFindsEilatAndHonoursTheCount', async () => {
      const eilat = { lat: 29.56, lon: 34.95 };
      const nearest = await db.nearestAerodromes(eilat, 6);
      expect(nearest).toHaveLength(6);
      expect(nearest.map((a) => a.code)).toContain('LLER');
      expect(await db.nearestAerodromes(eilat, 0)).toEqual([]);
    });
  });

  describe('search', () => {
    test('searchFindsByHebrewName', async () => {
      expect((await db.searchAerodromes('הרצליה', 5))[0]?.code).toBe('LLHZ');
      expect((await db.searchAerodromes('הבונים', 5)).map((a) => a.code)).toEqual(['LLBO']);
      expect((await db.searchAerodromes('עין', 10)).map((a) => a.code)).toContain('LLEY');
    });

    test('searchFindsByEnglishNameAndIgnoresCase', async () => {
      expect((await db.searchAerodromes('herzliya', 5))[0]?.code).toBe('LLHZ');
      expect((await db.searchAerodromes('KIRYAT', 5))[0]?.code).toBe('LLKS');
    });

    test('searchByCodeRanksExactThenPrefix', async () => {
      expect((await db.searchAerodromes('llhz', 5))[0]?.code).toBe('LLHZ');
      const prefix = await db.searchAerodromes('LLH', 10);
      expect(prefix.map((a) => a.code)).toContain('LLHA');
      expect(prefix.map((a) => a.code)).toContain('LLHZ');
      expect(
        prefix.every(
          (a) =>
            a.code.startsWith('LLH') || a.nameEnglish.toLowerCase().includes('llh') || a.nameHebrew.includes('LLH'),
        ),
      ).toBe(true);
    });

    test('searchTreatsWildcardsAsPlainText', async () => {
      expect(await db.searchAerodromes('%', 50)).toEqual([]);
      expect(await db.searchAerodromes('_', 50)).toEqual([]);
      expect(await db.searchAerodromes('   ', 50)).toEqual([]);
      expect(await db.searchAerodromes('zzzz-no-such-field', 50)).toEqual([]);
    });

    test('searchHonoursTheLimit', async () => {
      expect(await db.searchAerodromes('LL', 3)).toHaveLength(3);
    });
  });

  describe('values with their units', () => {
    test('herzliyaCarriesRunwayFrequenciesCircuitAndSources', async () => {
      const lhz = await db.aerodrome('llhz');
      expect(lhz).not.toBeNull();
      if (lhz === null) return;
      expect(lhz.type).toBe('airport');
      expect(lhz.use).toBe('civil');
      expect(lhz.elevationFeet).toBe(121); // feet MSL
      expect(Math.abs(lhz.latitude - 32.179444)).toBeLessThan(1e-5); // degrees
      expect(Math.abs(lhz.longitude - 34.834444)).toBeLessThan(1e-5);
      const runway = lhz.runways[0];
      expect(lhz.runways).toHaveLength(1);
      expect(runway?.designator).toBe('10/28');
      expect(runway?.lengthMetres).toBe(903); // metres
      expect(runway?.widthMetres).toBe(18);
      expect(runway?.surface).toBe('asphalt');
      expect(runway?.headingIsTrue).toBe(true);
      expect(runway?.headingA).toBe(104.12);
      expect(runway === undefined ? null : runwayLengthFeet(runway)).toBe(2963); // feet
      const tower = lhz.frequencies.find((f) => f.mhz === '122.200');
      expect(tower?.service.startsWith('TWR')).toBe(true);
      expect(tower?.callsignHebrew).toBe('מגדל הרצליה');
      expect(lhz.circuitAltitudeFeet).toBe(800); // feet MSL (QNH)
      expect(lhz.sources.identity).toContain('p209');
      expect(lhz.sources.runways).toContain('p211');
    });

    test('belowSeaLevelFieldsKeepNegativeElevationAndMagneticHeadings', async () => {
      const masada = await db.aerodrome('LLMZ');
      expect(masada?.elevationFeet).toBe(-1233); // feet MSL
      expect(masada?.circuitAltitudeFeet).toBe(-400); // feet MSL
      expect(masada?.runways[0]?.headingIsTrue).toBe(false);
      expect(masada?.ppr).toBe('yes');
      expect((await db.aerodrome('LLEY'))?.elevationFeet).toBe(-177);
    });

    test('militaryFieldsAreMarkedAndCarryOnlyTheirPublishedUnitFrequencies', async () => {
      const tel = await db.aerodrome('LLEK');
      expect(tel?.use).toBe('military');
      // A-07 §12 publishes the unit frequencies; they are labelled military control, not civil services.
      expect(tel?.frequencies.map((f) => f.mhz)).toEqual(['128.150', '129.050']);
      expect(tel?.frequencies.every((f) => f.service.includes('military control'))).toBe(true);
      expect(tel?.ppr).toBe('yes');
      expect(tel?.pprText).toContain('CAAI authorization');
      expect(tel?.uncertainGroups).toContain('runways');
      expect(tel?.runways.every((r) => r.designator === '?')).toBe(true);
    });

    test('agriculturalStripsHaveAPositionAndNoInventedRunway', async () => {
      const gvulot = await db.aerodrome('GVULT');
      expect(gvulot?.use).toBe('agricultural');
      expect(gvulot?.type).toBe('airstrip');
      expect(gvulot?.runways).toEqual([]);
      expect(gvulot?.elevationFeet).toBeNull();
      expect(gvulot?.ppr).toBe('yes');
    });
  });

  describe('review status', () => {
    test('onlyFullyAdjudicatedAerodromesAreReviewed', async () => {
      const all = await db.aerodromesIn(WHOLE_COUNTRY);
      const unreviewed = all.filter((a) => a.reviewStatus !== 'reviewed').map((a) => a.code);
      expect(unreviewed).toEqual([]); // all 49 reviewed; owner resolved the fable vs astra conflicts (Q7 = B)
      expect(all.filter((a) => a.reviewStatus === 'reviewed')).toHaveLength(49);
    });

    test('everyValueGroupNamesItsSource', async () => {
      const missing: string[] = [];
      for (const a of await db.aerodromesIn(WHOLE_COUNTRY)) {
        if (a.sources.identity.length === 0) missing.push(`${a.code} identity`);
        if (a.runways.length > 0 && a.sources.runways === null) missing.push(`${a.code} runways`);
        if (a.frequencies.length > 0 && a.sources.frequencies === null) missing.push(`${a.code} frequencies`);
        if (a.hours !== null && a.sources.hours === null) missing.push(`${a.code} hours`);
        if (a.circuitAltitudeFeet !== null && a.sources.circuit === null) missing.push(`${a.code} circuit`);
      }
      expect(missing).toEqual([]);
    });

    test('rtreeBoundsFindTheFieldsInsideTheBox', async () => {
      const box = boundsAround(herzliya, 3);
      expect((await db.aerodromesIn(box)).map((a) => a.code)).toContain('LLHZ');
      const empty = { minLatitude: 0, maxLatitude: 1, minLongitude: 0, maxLongitude: 1 };
      expect(await db.aerodromesIn(empty)).toEqual([]);
    });
  });
});
