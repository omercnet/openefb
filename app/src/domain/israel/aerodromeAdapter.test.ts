// Port of the IsraelAerodromeAdapter cases of IsraelNearestAndSearchTests.swift. The NRST list/search view-model cases
// (U4), the bundled-database case (tests/domain/israel/aerodromeAdapterDb.test.ts) and the two UI-wording cases
// (port-map: dropped) are not here.
import type {
  IsraelAerodrome,
  IsraelAerodromeReviewStatus,
  IsraelAerodromeRunway,
  IsraelAerodromeType,
  IsraelAerodromeUse,
  IsraelPPR,
} from '../../data/aviation/israelTypes';
import { isLandable } from '../core/landableAirportFilter';
import {
  NOT_LANDABLE_USES,
  airport,
  closingNotams,
  flags,
  frequency,
  frequencyType,
  isClosedByNotam,
  surface,
  type AerodromeNotamLike,
  type AerodromeNotamReport,
} from './aerodromeAdapter';

function runway(designator: string, length: number, width = 30, surfaceText = 'asphalt'): IsraelAerodromeRunway {
  return {
    id: 1,
    designator,
    lengthMetres: length,
    widthMetres: width,
    surface: surfaceText,
    headingA: 100,
    headingB: 280,
    headingIsTrue: true,
  };
}

function aerodrome(
  code: string,
  o: {
    type?: IsraelAerodromeType;
    use?: IsraelAerodromeUse;
    ppr?: IsraelPPR;
    runways?: IsraelAerodromeRunway[];
    review?: IsraelAerodromeReviewStatus;
  } = {},
): IsraelAerodrome {
  return {
    id: 1,
    code,
    nameHebrew: 'שדה',
    nameEnglish: `${code} field`,
    type: o.type ?? 'airport',
    use: o.use ?? 'civil',
    latitude: 32.18,
    longitude: 34.83,
    elevationFeet: 100,
    circuitAltitudeFeet: 800,
    circuitDirection: null,
    hours: null,
    ppr: o.ppr ?? 'no',
    pprText: null,
    remarks: null,
    sources: {
      identity: 'AIP 1/26 p1',
      runways: 'AIP 1/26 p2',
      frequencies: null,
      circuit: null,
      hours: null,
      remarks: null,
    },
    uncertainGroups: [],
    notes: null,
    reviewStatus: o.review ?? 'unreviewed',
    runways: o.runways ?? [runway('10/28', 1000)],
    frequencies: [],
  };
}

const HOUR = 3600_000;
const now = 1_800_000_000_000;

function notam(id: string, e: string, o: Partial<AerodromeNotamLike> = {}): AerodromeNotamLike {
  return { id, isSuperseded: false, closures: [], validFrom: null, validTo: null, e, ...o };
}

const report = (
  items: AerodromeNotamLike[],
  freshnessLevel: AerodromeNotamReport['freshnessLevel'] = 'fresh',
): AerodromeNotamReport => ({
  freshnessLevel,
  items,
});

describe('Closing NOTAMs', () => {
  // Real feed text (C2210/26, 2026-11-01): an area near Herzliya is closed for UAS activity, the field is not.
  test('anAreaClosureThatMentionsTheFieldDoesNotCloseIt', () => {
    const text =
      'UAS ACT WILL TAKE PLACE AT KFAR-SABA WI LLHZ TRG AREA NR 3, FM GND UP TO 400FT AGL. AN AREA BTN FLW PSN CLSD FM GND UP TO 900FT AMSL 321038N0345552E 321015N0345531E';
    const r = report([notam('C2210/26', text, { validFrom: now - HOUR, validTo: now + HOUR })]);
    expect(closingNotams('LLHZ', r, now)).toEqual([]);
  });

  test('onlyAClosureWhoseSubjectIsTheFieldMatches', () => {
    const match = (text: string): boolean => closingNotams('LLHZ', report([notam('N', text)]), now).length > 0;
    expect(match('LLHZ AD CLSD TO ALL FLT')).toBe(true);
    expect(match('LLHZ AIRSTRIP CLSD')).toBe(true);
    expect(match('AD LLHZ CLSD')).toBe(true);
    expect(match('LLHZ CLOSED DUE WORKS')).toBe(true);
    expect(match('llhz ad clsd')).toBe(true); // E) is upper-cased before matching
    expect(match('LLHZ IS CLSD')).toBe(true);
    expect(match('RWY 10/28 CLSD AT LLHZ')).toBe(false); // runway, not the field
    expect(match('TWY B CLSD AT LLHZ')).toBe(false); // taxiway
    expect(match('LLHZ TRG AREA ACT, AN AREA CLSD')).toBe(false); // area closure
    expect(match('PARACHUTING NR LLHZ, AIRSPACE CLSD')).toBe(false);
  });

  test('closureMatchingIgnoresSupersededExpiredFutureAndRouteNotams', () => {
    const items = [
      notam('OK', 'LLBO AIRSTRIP CLSD TO ALL FLT', { validFrom: now - HOUR, validTo: now + HOUR }),
      notam('CANCELLED', 'LLBO AIRSTRIP CLSD', { isSuperseded: true }),
      notam('ENDED', 'LLBO AIRSTRIP CLSD', { validFrom: now - 3 * HOUR, validTo: now - HOUR }),
      notam('FUTURE', 'LLBO AIRSTRIP CLSD', { validFrom: now + HOUR, validTo: now + 2 * HOUR }),
      notam('ROUTE', 'CVFR RTE CLSD LLBO-GALIM', { closures: [{ notamId: 'ROUTE' }] }),
      notam('OTHER', 'LLBOX AIRSTRIP CLSD'),
      notam('NOTCLOSED', 'LLBO PARACHUTING ACT'),
      notam('NOTEXT', 'x', { e: null }),
    ];
    expect(closingNotams('LLBO', report(items), now).map((n) => n.id)).toEqual(['OK']);
  });

  test('anOldFeedNeverFlagsAClosure', () => {
    const notams = [notam('C1/26', 'LLHZ AD CLSD')];
    expect(closingNotams('LLHZ', report(notams, 'expired'), now)).toEqual([]);
    expect(closingNotams('LLHZ', report(notams, 'unsafe'), now)).toEqual([]);
    expect(closingNotams('LLHZ', report(notams, 'unknown'), now)).toEqual([]);
    expect(closingNotams('LLHZ', report(notams, 'fresh'), now)).toHaveLength(1);
    expect(closingNotams('LLHZ', report(notams, 'old'), now)).toHaveLength(1);
  });

  test('a code with regex metacharacters matches literally', () => {
    expect(closingNotams('A.B', report([notam('N', 'AXB AD CLSD')]), now)).toEqual([]);
    expect(closingNotams('A.B', report([notam('N', 'A.B AD CLSD')]), now)).toHaveLength(1);
  });

  test('validity bounds are inclusive', () => {
    const items = [notam('N', 'LLHZ AD CLSD', { validFrom: now, validTo: now })];
    expect(closingNotams('LLHZ', report(items), now)).toHaveLength(1);
  });
});

describe('Flags', () => {
  test('nrstFlagsPPRFromTheAIPAndNothingElse', () => {
    const rishon = flags(aerodrome('LLRS', { ppr: 'yes' }), null, now);
    const herzliya = flags(aerodrome('LLHZ'), null, now);
    expect(rishon.requiresPPR).toBe(true);
    expect(herzliya.requiresPPR).toBe(false);
    expect(rishon.isReviewed).toBe(false);
    expect(isClosedByNotam(herzliya)).toBe(false); // no feed: no closure claim either way
  });

  test('a reviewed aerodrome and a closing NOTAM are flagged', () => {
    const f = flags(aerodrome('LLHZ', { review: 'reviewed' }), report([notam('C1/26', 'LLHZ AD CLSD')]), now);
    expect(f).toEqual({ requiresPPR: false, closureNotamIDs: ['C1/26'], isReviewed: true });
    expect(isClosedByNotam(f)).toBe(true);
  });
});

describe('Mapping to Airport', () => {
  test('runwayLengthsConvertFromMetresToFeet', () => {
    const a = airport(aerodrome('LLHZ', { runways: [runway('10/28', 903, 18)] }));
    const r = a.runways[0];
    expect(r.length).toBe(2963);
    expect(r.width).toBe(59); // feet
    expect(r.baseEndID).toBe('10');
    expect(r.reciprocalEndID).toBe('28');
    expect(r.surface).toBe('asphalt');
    expect(a.elevation).toBe(100); // feet MSL
  });

  test('designators without a slash or with empty halves keep Swift split behaviour', () => {
    const one = airport(aerodrome('X', { runways: [runway('?', 500)] })).runways[0];
    expect([one.baseEndID, one.reciprocalEndID]).toEqual(['?', '']);
    const lead = airport(aerodrome('X', { runways: [runway('/28', 500)] })).runways[0];
    expect([lead.baseEndID, lead.reciprocalEndID]).toEqual(['28', '']);
    const three = airport(aerodrome('X', { runways: [runway('10/28/30', 500)] })).runways[0];
    expect([three.baseEndID, three.reciprocalEndID]).toEqual(['10', '28/30']);
  });

  test('both runway ends sit on the reference point', () => {
    const r = airport(aerodrome('LLHZ')).runways[0];
    expect([r.baseEndLatitude, r.reciprocalEndLongitude]).toEqual([32.18, 34.83]);
  });

  test('missing elevation is zero', () => {
    expect(airport({ ...aerodrome('LLHZ'), elevationFeet: null }).elevation).toBe(0);
  });

  test('surfaces map by their first part', () => {
    expect(surface('concrete+asphalt')).toBe('concrete');
    expect(surface('asphalt/concrete')).toBe('asphalt');
    expect(surface('grass')).toBe('turf');
    expect(surface('gravel')).toBe('gravel');
    expect(surface('dirt')).toBe('dirt');
    expect(surface('unknown')).toBe('other');
    expect(surface('')).toBe('other');
    expect(surface('+asphalt')).toBe('asphalt');
  });

  test('frequencyRolesFollowTheAIPWording', () => {
    expect(frequencyType('TWR primary')).toBe('tower');
    expect(frequencyType('GND west of RWY 21')).toBe('ground');
    expect(frequencyType('ATIS arrival')).toBe('atis');
    expect(frequencyType('Airstrip operator channel (Teyman)')).toBe('ctaf');
    expect(frequencyType('Emergency')).toBe('other');
    expect(frequencyType('CLR delivery')).toBe('clearance');
    expect(frequencyType('Approach north')).toBe('approach');
    expect(frequencyType('TMA 1')).toBe('approach');
  });

  test('frequencies need a numeric MHz and carry the Hebrew callsign in the name', () => {
    const base = { id: 7, mhz: '122.200', service: 'TWR primary', callsignHebrew: null };
    expect(frequency(base)).toEqual({ id: 'israel-frequency-7', type: 'tower', frequency: 122.2, name: 'TWR primary' });
    expect(frequency({ ...base, callsignHebrew: 'מגדל' })?.name).toBe('TWR primary (מגדל)');
    expect(frequency({ ...base, mhz: 'n/a' })).toBeNull();
    expect(frequency({ ...base, mhz: '' })).toBeNull();
    expect(frequency({ ...base, mhz: ' 122.2' })).toBeNull();
  });

  test('militaryFieldsMapToMilitaryOwnershipAndHeliportsToHeliports', () => {
    expect(airport(aerodrome('LLEK', { use: 'military' })).ownership).toBe('military');
    expect(airport(aerodrome('LLHZ')).ownership).toBe('public');
    const pad = airport(aerodrome('ICHILOV', { type: 'heliport', use: 'hospital' }));
    expect(pad.type).toBe('heliport');
    expect(isLandable(pad)).toBe(false);
  });

  test('nrstExcludesUltralightOnlyStrips (the use set; the NRST list is U4)', () => {
    expect(NOT_LANDABLE_USES).toContain('ultralight');
    expect(NOT_LANDABLE_USES).toContain('uas');
    expect(NOT_LANDABLE_USES).toContain('foreign');
    expect(NOT_LANDABLE_USES).not.toContain('civil');
  });
});
