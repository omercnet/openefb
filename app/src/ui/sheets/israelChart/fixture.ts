// FAKE Israel CVFR chart selections for the tap sheet's tests and previews. The points, segments, airspaces and closures
// are made up (codes and names only look like the CAAI layers'); they are built through the domain's pointDetail and
// airspaceDetails, so the sheet shows exactly the text the map tap would produce.
import type { IsraelAirspace, IsraelAirspaceLimit, IsraelRouteSegment } from '../../../data/aviation/israelTypes';
import {
  airspaceDetails,
  pointDetail,
  type IsraelChartClosureMark,
  type IsraelChartSelection,
} from '../../../domain/map/israel';

function segment(
  id: number,
  from: string,
  to: string,
  o: { forward?: string | null; reverse?: string | null; byRequest?: boolean; military?: boolean } = {},
): IsraelRouteSegment {
  const altitude = (published: string | null | undefined) =>
    published == null ? null : { published, feet: published.includes('/') ? null : Number(published) };
  const military = o.military ?? false;
  return {
    id,
    fromCode: from,
    toCode: to,
    fromPointID: id * 10,
    toPointID: id * 10 + 1,
    nameEnglish: null,
    nameHebrew: null,
    lengthNM: 6,
    isCivil: !military,
    isMilitary: military,
    isByRequest: o.byRequest ?? false,
    bearingTrue: 30,
    altitudeForward: altitude(o.forward),
    altitudeReverse: altitude(o.reverse),
    lowerAltitudeFeet: null,
    mapSheet: null,
    polyline: [
      { lat: 32.3, lon: 34.9 },
      { lat: 32.4, lon: 34.95 },
    ],
    network: 'cvfr',
    activity: 'unspecified',
    activitySource: null,
    smallOnly: false,
  };
}

const SEGMENTS: IsraelRouteSegment[] = [
  segment(101, 'DEROR', 'SHARO', { forward: '1500', reverse: '2000' }),
  segment(102, 'SHARO', 'HADRA', { forward: '1500/2500', reverse: null, byRequest: true }),
  segment(103, 'SHARO', 'OLGAA', { forward: '1000', reverse: '1000', military: true }),
  segment(104, 'GALIM', 'DAROM', { forward: '2500', reverse: '2500' }),
];

/** SHARO -> HADRA is closed outright; DEROR - SHARO only at some altitudes, with the exception as written. */
const CLOSURES = new Map<number, IsraelChartClosureMark>([
  [102, { notamID: 'C0412/26', text: 'CLSD to 13:30Z', schedule: null, severity: 'full', notes: [] }],
  [
    101,
    {
      notamID: 'C0415/26',
      text: 'CLSD 1500-2000 ft to 16:00Z',
      schedule: null,
      severity: 'partial',
      notes: ['EXC ACFT WITH PRIOR COORDINATION'],
    },
  ],
]);

/** A compulsory point on three segments: six rows, two with closures, one military, one by request. */
export const POINT_SELECTION: IsraelChartSelection = {
  kind: 'point',
  detail: pointDetail(
    {
      id: 7,
      code: 'SHARO',
      nameEnglish: 'Sharon Junction',
      nameHebrew: 'צומת השרון',
      kind: 'compulsory',
      latitude: 32.323,
      longitude: 34.904,
      network: 'cvfr',
    },
    SEGMENTS,
    CLOSURES,
  ),
};

/** A sport-aviation route end with no CVFR segment: the "No CVFR route segment ends here." case, no names. */
export const LONELY_POINT_SELECTION: IsraelChartSelection = {
  kind: 'point',
  detail: pointDetail(
    {
      id: 8,
      code: 'ZZLSA',
      nameEnglish: null,
      nameHebrew: null,
      kind: 'unlisted',
      latitude: 31.9,
      longitude: 34.8,
      network: 'lsa',
    },
    SEGMENTS,
    CLOSURES,
  ),
};

const limit = (
  feet: number | null,
  reference: IsraelAirspaceLimit['reference'],
  publishedText: string | null = null,
) => ({
  feet,
  reference,
  publishedText,
});

const airspace = (a: Omit<IsraelAirspace, 'polygons'>): IsraelAirspace => ({ ...a, polygons: [] });

/**
 * Three overlapping airspaces as a tap under the finger gives them: the restricted area sorts first. The TMA has a chart
 * label and an inferred MSL ceiling (the reference note); the restricted area has an authority and a two-number limit;
 * the CTR repeats nothing optional (no authority, no label, English name equal to the title is hidden).
 */
export const AIRSPACES_SELECTION: IsraelChartSelection = {
  kind: 'airspaces',
  details: airspaceDetails([
    airspace({
      id: 31,
      kind: 'TMA',
      code: 'LLBG',
      nameEnglish: 'Ben Gurion TMA 2',
      nameHebrew: 'אזור פיקוח מסוף בן גוריון 2',
      label: 'LLBG TMA 2 500 - 8 000',
      authority: 'civil',
      floor: limit(2500, 'MSL'),
      ceiling: limit(8000, 'MSL'),
    }),
    airspace({
      id: 12,
      kind: 'R',
      code: 'LLR104',
      nameEnglish: 'Palmachim',
      nameHebrew: 'פלמחים',
      label: null,
      authority: 'military',
      floor: limit(0, 'SFC'),
      ceiling: limit(3500, 'MSL', '3000/3500'),
    }),
    airspace({
      id: 40,
      kind: 'D',
      code: null,
      nameEnglish: 'Hof Dor',
      nameHebrew: null,
      label: null,
      authority: null,
      floor: limit(null, null),
      ceiling: limit(9500, 'FL'),
    }),
  ]),
};

/** An aerodrome tap: opens the airport sheet, never this one (the sheet body stays empty, as Swift's EmptyView). */
export const AERODROME_SELECTION: IsraelChartSelection = { kind: 'aerodrome', code: 'LLHZ' };
