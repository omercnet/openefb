// FAKE data for the Israel flight plan sheet until I1 feeds the database, the NOTAM service and the profiles in: the
// CVFR route Herzliya (LLHZ) to Rosh Pina (LLIB) and its aerodromes as efb-212/Resources/israel-aviation.sqlite has them
// (points, segment ids, names, lengths, bearings and published altitudes copied verbatim; each polyline reduced to its two
// end points, which are the points' positions; aerodrome text fields, runways and frequencies left empty), the LSA weekend
// rule from the same database, one aircraft and one pilot. The clock is the capture seed's 2026-11-12T06:26Z.
// `createFakeIsraelPlanDatabase` serves any such network; the tests build theirs with it.
import type { StoreApi } from 'zustand';
import { newAircraftProfile, newPilotProfile } from '../../../data/defaults';
import type { AircraftProfile, PilotProfile } from '../../../data/models';
import type {
  IsraelAerodrome,
  IsraelAerodromeSources,
  IsraelAerodromeUse,
  IsraelLSAWeekendRule,
  IsraelPPR,
  IsraelPointKind,
  IsraelReportingPoint,
  IsraelRouteActivity,
  IsraelRouteNetwork,
  IsraelRouteSegment,
} from '../../../data/aviation/israelTypes';
import type { PlanActivation } from './logic';
import { createIsraelPlanStore, type IsraelPlanDatabase, type IsraelPlanDeps, type IsraelPlanState } from './store';

/** 2026-11-12 06:26Z (08:26 in Israel), the capture seed's clock. */
export const FIXTURE_NOW = Date.UTC(2026, 10, 12, 6, 26);

// MARK: - Builders

export function planPoint(
  id: number,
  code: string,
  o: {
    kind?: IsraelPointKind;
    lat: number;
    lon: number;
    network?: IsraelRouteNetwork;
    en?: string | null;
    he?: string | null;
  },
): IsraelReportingPoint {
  return {
    id,
    code,
    nameEnglish: o.en === undefined ? code : o.en,
    nameHebrew: o.he ?? null,
    kind: o.kind ?? 'compulsory',
    latitude: o.lat,
    longitude: o.lon,
    network: o.network ?? 'cvfr',
  };
}

/** A two-way civil segment a -> b with a straight polyline; `reverse` null makes it one-way. */
export function planSegment(
  id: number,
  a: IsraelReportingPoint,
  b: IsraelReportingPoint,
  o: {
    nm: number;
    forward?: string;
    reverse?: string | null;
    bearing?: number;
    activity?: IsraelRouteActivity;
    en?: string | null;
    he?: string | null;
    lower?: number | null;
  },
): IsraelRouteSegment {
  const altitude = (published: string) => ({
    published,
    feet: /^[0-9]+$/.test(published) ? Number(published) : null,
  });
  const reverse = o.reverse === undefined ? '2000' : o.reverse;
  return {
    id,
    fromCode: a.code,
    toCode: b.code,
    fromPointID: a.id,
    toPointID: b.id,
    nameEnglish: o.en ?? null,
    nameHebrew: o.he ?? null,
    lengthNM: o.nm,
    isCivil: true,
    isMilitary: false,
    isByRequest: false,
    bearingTrue: o.bearing ?? 0,
    altitudeForward: altitude(o.forward ?? '1500'),
    altitudeReverse: reverse === null ? null : altitude(reverse),
    lowerAltitudeFeet: o.lower ?? null,
    mapSheet: null,
    polyline: [
      { lat: a.latitude, lon: a.longitude },
      { lat: b.latitude, lon: b.longitude },
    ],
    network: a.network,
    activity: o.activity ?? 'unspecified',
    activitySource: null,
    smallOnly: false,
  };
}

/** An aerodrome with the fields the planner reads; the rest empty (Swift IsraelNearestAndSearchTests.aerodrome). */
export function planAerodrome(
  code: string,
  o: {
    lat: number;
    lon: number;
    id?: number;
    nameHebrew?: string;
    nameEnglish?: string;
    use?: IsraelAerodromeUse;
    elevationFeet?: number | null;
    circuitAltitudeFeet?: number | null;
    ppr?: IsraelPPR;
    sources?: IsraelAerodromeSources;
  },
): IsraelAerodrome {
  return {
    id: o.id ?? code.length,
    code,
    nameHebrew: o.nameHebrew ?? '\u05E9\u05D3\u05D4',
    nameEnglish: o.nameEnglish ?? `${code} field`,
    type: 'airport',
    use: o.use ?? 'civil',
    latitude: o.lat,
    longitude: o.lon,
    elevationFeet: o.elevationFeet ?? null,
    circuitAltitudeFeet: o.circuitAltitudeFeet ?? null,
    circuitDirection: null,
    hours: null,
    ppr: o.ppr ?? 'no',
    pprText: null,
    remarks: null,
    sources: o.sources ?? {
      identity: 'test',
      runways: null,
      frequencies: null,
      circuit: null,
      hours: null,
      remarks: null,
    },
    uncertainGroups: [],
    notes: null,
    reviewStatus: 'reviewed',
    runways: [],
    frequencies: [],
  };
}

export interface FakeIsraelPlanNetwork {
  points: IsraelReportingPoint[];
  segments: IsraelRouteSegment[];
  aerodromes: IsraelAerodrome[];
  weekendRule?: IsraelLSAWeekendRule | null;
}

/** In-memory IsraelPlanDatabase (Swift MockIsraelAviationDatabase): every query filters by network, the bounds are ignored. */
export function createFakeIsraelPlanDatabase(network: FakeIsraelPlanNetwork): IsraelPlanDatabase & {
  aerodrome(code: string): Promise<IsraelAerodrome | null>;
} {
  return {
    metadata: async () => ({ lsaWeekendRule: network.weekendRule ?? null }),
    reportingPoint: async (code, net = 'cvfr') =>
      network.points.find((p) => p.network === net && p.code.toUpperCase() === code.toUpperCase()) ?? null,
    reportingPoints: async (_bounds, net = 'cvfr') => network.points.filter((p) => p.network === net),
    routeSegments: async (_bounds, net = 'cvfr') => network.segments.filter((s) => s.network === net),
    searchAerodromes: async (query, limit) => {
      const needle = query.toLowerCase();
      return network.aerodromes
        .filter(
          (a) =>
            a.code.toLowerCase().startsWith(needle) ||
            a.nameEnglish.toLowerCase().includes(needle) ||
            a.nameHebrew.includes(query),
        )
        .slice(0, limit);
    },
    aerodrome: async (code) => network.aerodromes.find((a) => a.code === code) ?? null,
  };
}

// MARK: - The LLHZ -> LLIB network (israel-aviation.sqlite, CVFR)

type PointRow = [number, string, string, string, IsraelPointKind, number, number];
// prettier-ignore
const POINT_ROWS: PointRow[] = [
  [91, "LLHZ", "Herzelia", "הרצליה", "arp", 32.179444, 34.834444],
  [20, "BAZRA", "Bazra", "בצרה", "compulsory", 32.218611, 34.8825],
  [35, "DEROR", "Bney Dror", "בני דרור", "compulsory", 32.257222, 34.891111],
  [153, "SHARO", "Tzomet Hasharon", "צומת השרון", "onRequest", 32.323056, 34.903889],
  [197, "ZYAAR", "Tzomet Yaar", "צומת יער", "compulsory", 32.409722, 34.903611],
  [56, "HADRA", "Hadera", "חדרה", "compulsory", 32.464722, 34.912222],
  [41, "EIRON", "Eiron", "עירון", "onRequest", 32.480833, 35.024444],
  [190, "ZMGID", "Tzomet Megido", "צומת מגידו", "compulsory", 32.572778, 35.191111],
  [3, "AFULA", "Afula", "עפולה", "compulsory", 32.603611, 35.281944],
  [166, "TAVOR", "Kfar Tavor", "כפר תבור", "onRequest", 32.690278, 35.42],
  [36, "DESHE", "Karey Deshe", "כרי דשא", "compulsory", 32.87, 35.5325],
  [9, "AMNON", "Amnon", "אמנון", "onRequest", 32.905556, 35.566667],
  [92, "LLIB", "Rosh Pina", "ראש פינה", "arp", 32.980556, 35.570833],
];

/** The reporting points of the route, departure first. */
export const FIXTURE_POINTS: IsraelReportingPoint[] = POINT_ROWS.map(([id, code, en, he, kind, lat, lon]) =>
  planPoint(id, code, { kind, lat, lon, en, he }),
);

type SegmentRow = [number, string, string, string, string, number, number, string, string, number];
// prettier-ignore
const SEGMENT_ROWS: SegmentRow[] = [
  [125, "LLHZ", "BAZRA", "Herzelia-Bazra", "הרצליה-בצרה", 3.387, 46.2, "800", "1200", 800],
  [27, "BAZRA", "DEROR", "Bazra-Bney Dror", "בצרה-בני דרור", 2.351, 10.7, "800/1600", "2000", 800],
  [48, "DEROR", "SHARO", "Bney Dror-Tzomet Hasharon", "בני דרור-צומת השרון", 3.992, 9.4, "1500", "2000", 1500],
  [215, "SHARO", "ZYAAR", "Tzomet Hasharon-Tzomet Yaar", "צומת השרון - צומת יער", 5.186, 359.8, "1500", "2000", 1500],
  [273, "ZYAAR", "HADRA", "Tzomet Yaar-Tzomet Hadera", "צומת יער-צומת חדרה", 3.32, 7.6, "1500", "2000", 1500],
  [78, "HADRA", "EIRON", "Tzomet Nachal Hadera-Eiron", "צומת נחל חדרה-עירון", 5.774, 80.4, "2500", "3000", 2500],
  [55, "EIRON", "ZMGID", "Eiron-Tzomet Megido", "עירון - צומת מגידו", 10.612, 56.9, "3000", "2500", 2500],
  [261, "ZMGID", "AFULA", "Tzomet Megido-Afula", "צומת מגידו-עפולה", 4.958, 68.1, "2500", "3000", 2500],
  [3, "AFULA", "TAVOR", "Afula-Kfar Tavor", "עפולה-כפר תבור", 9.155, 53.4, "2500", "3000", 2500],
  [230, "TAVOR", "DESHE", "Kfar Tavor-Karey Deshe", "כפר תבור-כרי דשא", 12.169, 27.8, "2500", "3000", 2500],
  [49, "DESHE", "AMNON", "Karey Deshe-Amnon", "כרי דשא-אמנון", 2.74, 39, "2500", "3000", 2500],
  [11, "AMNON", "LLIB", "Amnon-Rosh Pina", "אמנון-ראש פינה", 4.494, 2.7, "2500", "3000", 2500],
];

const pointByCode = new Map(FIXTURE_POINTS.map((p) => [p.code, p]));

export const FIXTURE_SEGMENTS: IsraelRouteSegment[] = SEGMENT_ROWS.map(
  ([id, from, to, en, he, nm, bearing, forward, reverse, lower]) =>
    planSegment(id, pointByCode.get(from)!, pointByCode.get(to)!, { nm, bearing, forward, reverse, en, he, lower }),
);

export const FIXTURE_AERODROMES: IsraelAerodrome[] = [
  planAerodrome('LLHZ', {
    id: 26,
    nameHebrew: 'שדה התעופה הרצליה ע"ש מודי אלון',
    nameEnglish: 'Herzliya (Modi Alon) Airport',
    lat: 32.179444,
    lon: 34.834444,
    elevationFeet: 121,
    circuitAltitudeFeet: 800,
    ppr: 'unknown',
    sources: {
      identity: 'AIP 1/26 ch.ד p209',
      runways: 'AIP 1/26 ch.ד p211',
      frequencies: 'AIP 1/26 ch.ד p212,221',
      circuit: 'AIP 1/26 ch.ד p219',
      hours: 'AIP 1/26 ch.ד p209',
      remarks: 'AIP 1/26 ch.ד p210,211,213,217,218',
    },
  }),
  planAerodrome('LLIB', {
    id: 27,
    nameHebrew: 'שדה התעופה ראש פינה',
    nameEnglish: 'Rosh Pina Airport',
    lat: 32.980833,
    lon: 35.571944,
    elevationFeet: 884,
    circuitAltitudeFeet: 1700,
    ppr: 'unknown',
    sources: {
      identity: 'AIP 1/26 ch.ד p268',
      runways: 'AIP 1/26 ch.ד p270',
      frequencies: 'AIP 1/26 ch.ד p271',
      circuit: 'AIP 1/26 ch.ד p274',
      hours: 'AIP 1/26 ch.ד p268',
      remarks: 'AIP 1/26 ch.ד p269,270,271,272,278,279',
    },
  }),
  planAerodrome('LLHA', {
    id: 23,
    nameHebrew: 'נמל התעופה חיפה',
    nameEnglish: 'Haifa Airport (U. Michaeli)',
    lat: 32.809722,
    lon: 35.043889,
    elevationFeet: 28,
    circuitAltitudeFeet: 1000,
    ppr: 'yes',
    sources: {
      identity: 'AIP 1/26 ch.ד p239',
      runways: 'AIP 1/26 ch.ד p242',
      frequencies: 'AIP 1/26 ch.ד p245',
      circuit: 'AIP 1/26 ch.ד p248',
      hours: 'AIP 1/26 ch.ד p239',
      remarks: 'AIP 1/26 ch.ד p239,240,243,244,245,248,250,254',
    },
  }),
];

export const FIXTURE_WEEKEND_RULE: IsraelLSAWeekendRule = {
  source: "Domestic AIP B-08, section 1 item ז ('ימי סוף שבוע'), PDF page 147; bubble start times in notes 2 and 3",
  textHebrew:
    'בכל מקום בנוהל זה ובנספח א\' "ימי סוף שבוע" פירושם ימי שישי החל משעה 06:00, ערבי חג החל משעה 14:00, וימי שבת וחג במשך כל היום, אלא אם צוין אחרת לאזור/בועה מסוימים. ימי חול המועד יחשבו כימי אמצע שבוע. בבועות שדרות דרום, באר שבע, מיתר, להבים ובכל מרחב הפיקוח של חצרים והנתיבים בפיקוח קדם סוף השבוע מתחיל ביום שישי בשעה 14:00; בבועות שדרות צפון, ניצנים, ים המלח, זוהר, שלם ואורן ביום שישי בשעה 12:00.',
  textEnglish:
    'Weekend days mean Fridays from 06:00, holiday eves from 14:00, and Saturdays and holidays all day, unless stated otherwise for a bubble. Intermediate festival days count as weekdays. In the Sderot South, Beer Sheva, Mitar and Lehavim bubbles, the whole Hatzerim control area and the routes under Kedem control, the weekend starts Friday 14:00; in the Sderot North, Nitzanim, Dead Sea, Zohar, Shalem and Oren bubbles, Friday 12:00. Translation by the importer author; the Hebrew text is the source.',
  fridayStartDefault: '06:00',
  fridayStartLatestPublished: '14:00',
  holidayEveStart: '14:00',
  layerDoesNotSay: 'which Friday start applies to which route; holidays are not in the data',
};

/** Active aircraft with what the message needs (registration, type, endurance, persons on board). */
export const FIXTURE_AIRCRAFT: AircraftProfile = newAircraftProfile('4X-CXA', {
  newId: () => 'fixture-aircraft',
  now: () => FIXTURE_NOW,
  aircraftType: 'Cessna 172S',
  icaoTypeDesignator: 'C172',
  cruiseSpeedKts: 105,
  fuelCapacityGallons: 53,
  fuelBurnGPH: 9,
  personsOnBoard: 2,
  isActive: true,
});

/** Active pilot. The e-mail is here so the sheet shows it is not where the FPL draft goes. */
export const FIXTURE_PILOT: PilotProfile = newPilotProfile({
  newId: () => 'fixture-pilot',
  now: () => FIXTURE_NOW,
  name: 'Israel Israeli',
  certificateNumber: '12345',
  phone: '050-1234567',
  email: 'pilot@example.com',
  isActive: true,
});

/** Dependencies over the fixture network: no NOTAM feed, navigation and map are no-ops unless overridden. */
export function fixturePlanDeps(overrides: Partial<IsraelPlanDeps> = {}): IsraelPlanDeps {
  const database = createFakeIsraelPlanDatabase({
    points: FIXTURE_POINTS,
    segments: FIXTURE_SEGMENTS,
    aerodromes: FIXTURE_AERODROMES,
    weekendRule: FIXTURE_WEEKEND_RULE,
  });
  let active = false;
  return {
    database: async () => database,
    fetchNotams: null,
    now: () => FIXTURE_NOW,
    profiles: () => ({ aircraft: [FIXTURE_AIRCRAFT], pilots: [FIXTURE_PILOT] }),
    networkPreferences: null,
    navigation: {
      activate: (_activation: PlanActivation) => {
        active = true;
      },
      hasActiveRoute: () => active,
      clear: () => {
        active = false;
      },
    },
    ...overrides,
  };
}

/** The route's state: LLHZ to LLIB picked and routed on CVFR. */
export async function seedFixturePlan(store: StoreApi<IsraelPlanState>): Promise<void> {
  const [departure, destination] = FIXTURE_AERODROMES;
  store.setState({ departure, departureQuery: departure.code, destination, destinationQuery: destination.code });
  await store.getState().computeRoute();
}

export function createFixturePlanStore(overrides: Partial<IsraelPlanDeps> = {}): StoreApi<IsraelPlanState> {
  return createIsraelPlanStore(fixturePlanDeps(overrides));
}
