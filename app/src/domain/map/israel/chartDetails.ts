// Port of Services/IsraelChartDetails.swift (what the CVFR tap sheets show) and the data half of
// IsraelChartOverlay.hitTest. Published text is always preserved ("2500/3500", "3000/3500"), and altitude references
// IL-1 inferred (the layers carry none) are labelled as inferred.
import type {
  IsraelAerodrome,
  IsraelAirspace,
  IsraelAirspaceKind,
  IsraelAirspaceLimit,
  IsraelPointKind,
  IsraelReportingPoint,
  IsraelRouteAltitude,
  IsraelRouteSegment,
} from '../../../data/aviation/israelTypes';
import type { Properties } from '../geojson';
import { airspaceTitle, isRestricted } from './chartFeatures';
import type { IsraelChartClosureMark, IsraelClosureSeverity } from './closures';

export interface IsraelRouteAltitudeRow {
  segmentID: number;
  from: string;
  to: string;
  /** "2500 ft", "2500/3500 ft" (as published), or "none published". */
  altitude: string;
  /** "Civil", "By request (ATC approval)", "Military (IAF approval)". */
  routeType: string;
  /** "CLSD to 13:30Z" when a drawn closure covers the segment. */
  closure: string | null;
  closureSeverity: IsraelClosureSeverity | null;
  closureNotes: string[];
}

export interface IsraelPointDetail {
  id: number;
  code: string;
  nameEnglish: string | null;
  nameHebrew: string | null;
  kindText: string;
  rows: IsraelRouteAltitudeRow[];
}

export interface IsraelAirspaceDetail {
  id: number;
  title: string;
  nameEnglish: string | null;
  nameHebrew: string | null;
  typeText: string;
  floor: string;
  ceiling: string;
  /** The chart label as published ("LLBG TMA 2 500 - 8 000"). */
  rawText: string | null;
  authority: string | null;
  /** Shown whenever a limit's reference was inferred rather than published. */
  referenceNote: string | null;
}

export type IsraelChartSelection =
  | { kind: 'point'; detail: IsraelPointDetail }
  | { kind: 'airspaces'; details: IsraelAirspaceDetail[] }
  /** An aerodrome symbol or ARP: opens the airport sheet for this code, not a chart sheet. */
  | { kind: 'aerodrome'; code: string };

export function selectionId(selection: IsraelChartSelection): string {
  switch (selection.kind) {
    case 'point':
      return `point-${selection.detail.id}`;
    case 'airspaces':
      return `airspaces-${selection.details.map((d) => d.id).join(',')}`;
    case 'aerodrome':
      return `aerodrome-${selection.code}`;
  }
}

const KIND_TEXT: Record<IsraelPointKind, string> = {
  compulsory: 'Compulsory reporting point',
  onRequest: 'On-request reporting point',
  arp: 'Aerodrome reference point',
  unlisted: 'Sport-aviation route end (not a published point)',
};

export function routeTypeText(segment: IsraelRouteSegment): string {
  if (segment.isMilitary) return 'Military (IAF approval)';
  if (segment.isByRequest) return 'By request (ATC approval)';
  return 'Civil';
}

const altitudeText = (altitude: IsraelRouteAltitude | null): string =>
  altitude === null ? 'none published' : `${altitude.published} ft`;

/** The point with every segment that starts or ends at it, one row per direction. */
export function pointDetail(
  point: IsraelReportingPoint,
  segments: readonly IsraelRouteSegment[],
  closures: ReadonlyMap<number, IsraelChartClosureMark>,
): IsraelPointDetail {
  const code = point.code.toUpperCase();
  const rows: IsraelRouteAltitudeRow[] = [];
  for (const segment of segments) {
    if (segment.fromCode.toUpperCase() !== code && segment.toCode.toUpperCase() !== code) continue;
    const mark = closures.get(segment.id);
    const shared = {
      segmentID: segment.id,
      routeType: routeTypeText(segment),
      closure: mark?.text ?? null,
      closureSeverity: mark?.severity ?? null,
      closureNotes: mark?.notes ?? [],
    };
    rows.push({
      ...shared,
      from: segment.fromCode,
      to: segment.toCode,
      altitude: altitudeText(segment.altitudeForward),
    });
    rows.push({
      ...shared,
      from: segment.toCode,
      to: segment.fromCode,
      altitude: altitudeText(segment.altitudeReverse),
    });
  }
  // Leaving this point first, then arriving; stable by neighbour code (Swift tuple order: string, then segment id).
  rows.sort((l, r) => {
    const lLeaving = l.from.toUpperCase() === code;
    const rLeaving = r.from.toUpperCase() === code;
    if (lLeaving !== rLeaving) return lLeaving ? -1 : 1;
    const lk = l.to + l.from;
    const rk = r.to + r.from;
    if (lk !== rk) return lk < rk ? -1 : 1;
    return l.segmentID - r.segmentID;
  });
  return {
    id: point.id,
    code: point.code,
    nameEnglish: point.nameEnglish,
    nameHebrew: point.nameHebrew,
    kindText: KIND_TEXT[point.kind],
    rows,
  };
}

const TYPE_TEXT: Record<IsraelAirspaceKind, string> = {
  CTR: 'CTR (control zone)',
  ATZ: 'ATZ (aerodrome traffic zone)',
  CTA: 'CTA (control area)',
  TMA: 'TMA (terminal control area)',
  P: 'P (prohibited area)',
  R: 'R (restricted area)',
  D: 'D (danger area)',
  FIR: 'FIR',
};

/** "3000 ft MSL", "SFC (ground)", "FL95", "3000/3500 ft (as published)", "not published". */
export function limitDetail(limit: IsraelAirspaceLimit): string {
  if (limit.publishedText !== null && limit.publishedText !== '') return `${limit.publishedText} ft (as published)`;
  const feet = limit.feet;
  switch (limit.reference) {
    case 'SFC':
      return 'SFC (ground)';
    case 'UNL':
      return 'Unlimited';
    case 'FL':
      return feet === null ? 'FL (value not published)' : `FL${Math.trunc(feet / 100)}`;
    case 'AGL':
      return feet === null ? 'not published' : `${feet} ft AGL`;
    case 'MSL':
      return feet === null ? 'not published' : `${feet} ft MSL`;
    case null:
      return feet === null ? 'not published' : `${feet} ft`;
  }
}

/** IL-1 sets MSL for every non-zero limit because the CAAI layers carry no reference. Say so. */
export function referenceNote(floor: IsraelAirspaceLimit, ceiling: IsraelAirspaceLimit): string | null {
  const inferred = [floor, ceiling].some((l) => l.reference === 'MSL' && l.publishedText === null);
  return inferred
    ? 'Altitude reference (MSL) is inferred from the AIP; the CAAI data does not state it. Check the AIP.'
    : null;
}

export function airspaceDetail(airspace: IsraelAirspace): IsraelAirspaceDetail {
  return {
    id: airspace.id,
    title: airspaceTitle(airspace),
    nameEnglish: airspace.nameEnglish,
    nameHebrew: airspace.nameHebrew,
    typeText: TYPE_TEXT[airspace.kind],
    floor: limitDetail(airspace.floor),
    ceiling: limitDetail(airspace.ceiling),
    rawText: airspace.label,
    authority: airspace.authority === null ? null : airspace.authority === 'military' ? 'Military' : 'Civil',
    referenceNote: referenceNote(airspace.floor, airspace.ceiling),
  };
}

/** Prohibited, restricted and danger areas first, then the rest, each by id. */
export const airspaceDetails = (airspaces: readonly IsraelAirspace[]): IsraelAirspaceDetail[] =>
  [...airspaces]
    .sort((l, r) => {
      const a = isRestricted(l.kind);
      const b = isRestricted(r.kind);
      if (a !== b) return a ? -1 : 1;
      return l.id - r.id;
    })
    .map(airspaceDetail);

/** What a tap needs from the loaded chart data. */
export interface IsraelSelectionData {
  points: readonly IsraelReportingPoint[];
  segments: readonly IsraelRouteSegment[];
  airspaces: readonly IsraelAirspace[];
  aerodromes: readonly IsraelAerodrome[];
}

/**
 * IsraelChartOverlay.hitTest, nearest-symbol half: the properties of the nearest rendered feature of the point or
 * aerodrome icon layers. An aerodrome (own symbol, or an ARP that IL-4 has a record for) opens the airport sheet; other
 * points open the CVFR point sheet. Finding the nearest feature on screen is the surface's job.
 */
export function israelSelectionFromFeature(
  props: Properties,
  data: IsraelSelectionData,
  closures: ReadonlyMap<number, IsraelChartClosureMark>,
): IsraelChartSelection | null {
  const id = typeof props.id === 'number' ? props.id : null;
  const found = id === null ? undefined : data.points.find((p) => p.id === id);
  if (found !== undefined) {
    // IsraelChartData.load drops foreign aerodromes, so an ARP of one opens the point sheet.
    if (found.kind === 'arp' && data.aerodromes.some((a) => a.use !== 'foreign' && a.code === found.code)) {
      return { kind: 'aerodrome', code: found.code };
    }
    return { kind: 'point', detail: pointDetail(found, data.segments, closures) };
  }
  return typeof props.code === 'string' ? { kind: 'aerodrome', code: props.code } : null;
}

/** IsraelChartOverlay.hitTest, area half: airspace ids of the fill features under the tap. */
export function israelAirspaceSelection(
  ids: readonly number[],
  airspaces: readonly IsraelAirspace[],
): IsraelChartSelection | null {
  const wanted = new Set(ids);
  const hits = airspaces.filter((a) => wanted.has(a.id));
  return hits.length === 0 ? null : { kind: 'airspaces', details: airspaceDetails(hits) };
}
