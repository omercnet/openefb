// Value types read from the bundled israel-aviation.sqlite (built by tools/caai-importer from the CAAI GIS layers).
// Port of Data/IsraelAviationModels.swift. Units: degrees WGS-84, feet MSL, nautical miles, metres where named.
import type { Coordinate } from '../../domain/geo';

/** A latitude/longitude box for spatial queries (degrees, WGS-84). */
export interface IsraelGeoBounds {
  minLatitude: number;
  maxLatitude: number;
  minLongitude: number;
  maxLongitude: number;
}

/** Everything the database covers: Israel and its FIR with a margin. */
export const WHOLE_COUNTRY: IsraelGeoBounds = {
  minLatitude: 28.0,
  maxLatitude: 34.5,
  minLongitude: 33.5,
  maxLongitude: 36.5,
};

/** The box around `center` that contains a circle of `radiusNM` (1 degree of latitude = 60 NM). */
export function boundsAround(center: Coordinate, radiusNM: number): IsraelGeoBounds {
  const latDelta = radiusNM / 60;
  const cosLat = Math.max(Math.cos((center.lat * Math.PI) / 180), 0.01);
  const lonDelta = radiusNM / (60 * cosLat);
  return {
    minLatitude: center.lat - latDelta,
    maxLatitude: center.lat + latDelta,
    minLongitude: center.lon - lonDelta,
    maxLongitude: center.lon + lonDelta,
  };
}

export const POINT_KINDS = ['compulsory', 'onRequest', 'arp', 'unlisted'] as const;
/** `unlisted`: named by a sport-aviation route but absent from CAAI's points layer; its position is the end of the line. */
export type IsraelPointKind = (typeof POINT_KINDS)[number];

/** The two published route networks. CAAI publishes them as separate GIS layers. */
export const ROUTE_NETWORKS = ['cvfr', 'lsa'] as const;
export type IsraelRouteNetwork = (typeof ROUTE_NETWORKS)[number];

export const NETWORK_TITLE: Record<IsraelRouteNetwork, string> = { cvfr: 'CVFR', lsa: 'LSA' };
/** Hebrew name of the network, as fpl.co.il words it. */
export const NETWORK_HEBREW_NAME: Record<IsraelRouteNetwork, string> = {
  cvfr: 'נתיבי התובלה הנמוכים',
  lsa: 'נתיבי התעופה הספורטיבית',
};
/** The route kinds a NOTAM "<KIND> RTE CLSD" clause names for each network (upper-case). */
export const NETWORK_CLOSURE_KINDS: Record<IsraelRouteNetwork, readonly string[]> = {
  cvfr: ['CVFR'],
  lsa: ['LSA', 'ULTRALIGHT', 'SPORT', 'SPORTS', 'SPORTIVE'],
};

export const ROUTE_ACTIVITIES = ['all_week', 'weekend', 'special', 'unspecified'] as const;
/** When a sport-aviation route is in use, from the layer's `localType`. `special` is 'מיוחד'. */
export type IsraelRouteActivity = (typeof ROUTE_ACTIVITIES)[number];

export interface IsraelReportingPoint {
  id: number;
  /** Five-letter point code ("TAVOR") or four-letter aerodrome ICAO ("LLHZ"). Not unique across rows. */
  code: string;
  nameEnglish: string | null;
  nameHebrew: string | null;
  kind: IsraelPointKind;
  latitude: number;
  longitude: number;
  network: IsraelRouteNetwork;
}

/** The altitude CAAI publishes for one direction of a segment. */
export interface IsraelRouteAltitude {
  /** Verbatim ("3500", or "2500/3500" where it changes along the leg). */
  published: string;
  /** Feet MSL; null when the published value is two numbers (don't pick one, show `published`). */
  feet: number | null;
}

export interface IsraelRouteSegment {
  id: number;
  fromCode: string;
  toCode: string;
  fromPointID: number;
  toPointID: number;
  nameEnglish: string | null;
  nameHebrew: string | null;
  lengthNM: number | null;
  isCivil: boolean;
  isMilitary: boolean;
  isByRequest: boolean;
  /** degrees true, from -> to */
  bearingTrue: number;
  altitudeForward: IsraelRouteAltitude | null;
  altitudeReverse: IsraelRouteAltitude | null;
  lowerAltitudeFeet: number | null;
  mapSheet: string | null;
  polyline: Coordinate[];
  network: IsraelRouteNetwork;
  activity: IsraelRouteActivity;
  activitySource: string | null;
  smallOnly: boolean;
}

/** Published altitude for travelling fromCode -> toCode (`forward`) or back. */
export const segmentAltitude = (segment: IsraelRouteSegment, forward: boolean): IsraelRouteAltitude | null =>
  forward ? segment.altitudeForward : segment.altitudeReverse;

export const AIRSPACE_KINDS = ['CTR', 'ATZ', 'CTA', 'TMA', 'P', 'R', 'D', 'FIR'] as const;
export type IsraelAirspaceKind = (typeof AIRSPACE_KINDS)[number];

export const AIRSPACE_AUTHORITIES = ['civil', 'military'] as const;
export type IsraelAirspaceAuthority = (typeof AIRSPACE_AUTHORITIES)[number];

export const ALTITUDE_REFERENCES = ['SFC', 'MSL', 'AGL', 'FL', 'UNL'] as const;
export type IsraelAltitudeReference = (typeof ALTITUDE_REFERENCES)[number];

/** One vertical limit of an airspace. */
export interface IsraelAirspaceLimit {
  /** Feet; null when the layer publishes no value (treated as "may apply": see airspaceContainsAltitude). */
  feet: number | null;
  reference: IsraelAltitudeReference | null;
  /** Verbatim when the layer publishes two numbers ("3000/3500"); `feet` then holds the larger volume. */
  publishedText: string | null;
}

export interface IsraelAirspace {
  id: number;
  kind: IsraelAirspaceKind;
  code: string | null;
  nameEnglish: string | null;
  nameHebrew: string | null;
  /** TMA chart label, e.g. "LLBG TMA 2 500 - 8 000" */
  label: string | null;
  authority: IsraelAirspaceAuthority | null;
  floor: IsraelAirspaceLimit;
  ceiling: IsraelAirspaceLimit;
  /** polygons[polygon][ring][vertex]; ring 0 is the outer boundary, further rings are holes. */
  polygons: Coordinate[][][];
}

/** Even-odd ray cast on a ring (Swift IsraelAirspace.ring(_:contains:)). */
function ringContains(ring: readonly Coordinate[], point: Coordinate): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  let j = ring.length - 1;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as Coordinate;
    const b = ring[j] as Coordinate;
    if (a.lat > point.lat !== b.lat > point.lat) {
      const crossLon = ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon;
      if (point.lon < crossLon) inside = !inside;
    }
    j = i;
  }
  return inside;
}

/** Whether the point is inside the lateral boundary (holes excluded). */
export function airspaceContainsLaterally(airspace: IsraelAirspace, point: Coordinate): boolean {
  return airspace.polygons.some((rings) => {
    const outer = rings[0];
    if (outer === undefined || !ringContains(outer, point)) return false;
    return !rings.slice(1).some((hole) => ringContains(hole, point));
  });
}

/**
 * Whether `feetMSL` lies between floor and ceiling, limits inclusive. Surface floors and unlimited ceilings always
 * match. A limit that is unpublished, or whose reference (AGL, FL) can't be compared with an MSL altitude, counts as
 * matching: the airspace is never reported smaller than the data allows.
 */
export function airspaceContainsAltitude(airspace: IsraelAirspace, feetMSL: number): boolean {
  const { floor, ceiling } = airspace;
  if (floor.feet !== null && floor.reference === 'MSL' && feetMSL < floor.feet) return false;
  if (ceiling.feet !== null && ceiling.reference === 'MSL' && feetMSL > ceiling.feet) return false;
  return true;
}

export interface IsraelRunway {
  id: number;
  /** ICAO; null for rows CAAI publishes without an aerodrome code */
  aerodrome: string | null;
  nameEnglish: string | null;
  nameHebrew: string | null;
  designatorA: string | null;
  designatorB: string | null;
  headingA: number | null;
  headingB: number | null;
  lengthMetres: number | null;
  widthMetres: number | null;
  /** CAAI text (Hebrew) */
  surface: string | null;
  endA: Coordinate;
  endB: Coordinate;
}

export const AERODROME_TYPES = ['airport', 'airstrip', 'heliport'] as const;
export type IsraelAerodromeType = (typeof AERODROME_TYPES)[number];

export const AERODROME_USES = [
  'civil',
  'military',
  'uas',
  'agricultural',
  'hospital',
  'foreign',
  'ultralight',
] as const;
export type IsraelAerodromeUse = (typeof AERODROME_USES)[number];

/** Prior-permission-required status as the AIP states it. `unknown` = the AIP says nothing general. */
export const PPR_VALUES = ['yes', 'no', 'unknown'] as const;
export type IsraelPPR = (typeof PPR_VALUES)[number];

export const REVIEW_STATUSES = ['unreviewed', 'reviewed'] as const;
export type IsraelAerodromeReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Where each group of values came from, e.g. "AIP 1/26 ch.ה p293,294". */
export interface IsraelAerodromeSources {
  identity: string;
  runways: string | null;
  frequencies: string | null;
  circuit: string | null;
  hours: string | null;
  remarks: string | null;
}

export interface IsraelAerodromeRunway {
  id: number;
  /** "10/28"; "?" when the AIP gives none */
  designator: string;
  lengthMetres: number;
  widthMetres: number;
  /** asphalt, concrete, dirt, gravel, grass, unknown */
  surface: string;
  headingA: number | null;
  headingB: number | null;
  /** true = true heading, false = magnetic, null = no heading published */
  headingIsTrue: boolean | null;
}

export const runwayLengthFeet = (runway: IsraelAerodromeRunway): number => Math.round(runway.lengthMetres * 3.28084);
export const runwayWidthFeet = (runway: IsraelAerodromeRunway): number => Math.round(runway.widthMetres * 3.28084);

export interface IsraelAerodromeFrequency {
  id: number;
  /** "122.200", as published */
  mhz: string;
  /** "TWR primary" */
  service: string;
  callsignHebrew: string | null;
}

export interface IsraelAerodrome {
  id: number;
  /** ICAO where one exists, else a short slug */
  code: string;
  nameHebrew: string;
  nameEnglish: string;
  type: IsraelAerodromeType;
  use: IsraelAerodromeUse;
  latitude: number;
  longitude: number;
  elevationFeet: number | null;
  circuitAltitudeFeet: number | null;
  circuitDirection: string | null;
  hours: string | null;
  ppr: IsraelPPR;
  pprText: string | null;
  remarks: string | null;
  sources: IsraelAerodromeSources;
  /** Field groups the curator was unsure about: identity, runways, frequencies, circuit, hours, elevation_ft. */
  uncertainGroups: string[];
  notes: string | null;
  reviewStatus: IsraelAerodromeReviewStatus;
  runways: IsraelAerodromeRunway[];
  frequencies: IsraelAerodromeFrequency[];
}

/** B-08 section 1 item ז: when the sport-aviation routes marked "Weekend" are in use. */
export interface IsraelLSAWeekendRule {
  source: string;
  textHebrew: string;
  textEnglish: string;
  /** "06:00" local Israel time */
  fridayStartDefault: string;
  /** "14:00": the latest Friday start any bubble has */
  fridayStartLatestPublished: string;
  holidayEveStart: string;
  layerDoesNotSay: string;
}

export interface IsraelAviationMetadata {
  schemaVersion: number;
  source: string;
  sourceURLs: string[];
  /** null unless the importer was told the amendment: never guessed */
  aipAmendment: string | null;
  /** YYYY-MM-DD, only with a known amendment */
  effectiveDate: string | null;
  sourceDataDate: string;
  downloadDate: string;
  dataLastModified: string;
  importDate: string;
  /** Line for Settings > About */
  attribution: string;
  lsaWeekendRule: IsraelLSAWeekendRule | null;
}
