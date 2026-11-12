// Port of Services/IsraelChartFeatures.swift (IL-3, IL-4): pure feature building for the Israel CVFR chart. Turns the
// CAAI rows (data/aviation/israelTypes) into drawable features with their label text, label placement and styling
// inputs. The NOTAM closure half lives in ./closures. Symbology (docs/research/israel-cvfr.md section 2): civil routes
// solid green, by-request routes dashed green, military routes blue and flagged "MIL". Altitudes are per direction and
// shown as published ("2500/3500" stays text).
import type {
  IsraelAerodrome,
  IsraelAirspace,
  IsraelAirspaceKind,
  IsraelAirspaceLimit,
  IsraelPointKind,
  IsraelReportingPoint,
  IsraelRouteAltitude,
  IsraelRouteSegment,
  IsraelRunway,
} from '../../../data/aviation/israelTypes';
import { CVFR_CHART_LAYERS, distanceNm, type Coordinate, type MapLayer } from '../../core';

/** How a route segment is drawn. */
export type IsraelRouteStyle = 'civil' | 'byRequest' | 'military';

/** The altitude label drawn once at the segment's midpoint, rotated to lie along the line. */
export interface IsraelChartSegmentLabel {
  /** "->2500 / <-3000" with Unicode arrows: the arrow shows which way along the drawn text the altitude applies. */
  text: string;
  coordinate: Coordinate;
  /** Clockwise degrees so the text reads along the segment and never upside down (map-aligned rotation). */
  rotationDegrees: number;
}

export interface IsraelChartSegmentFeature {
  id: number;
  fromCode: string;
  toCode: string;
  style: IsraelRouteStyle;
  polyline: Coordinate[];
  /** null when CAAI publishes no altitude in either direction. */
  label: IsraelChartSegmentLabel | null;
  /** Degrees true from -> to; closure labels rotate with it. */
  bearingTrue: number;
}

export interface IsraelChartPointFeature {
  id: number;
  code: string;
  kind: IsraelPointKind;
  coordinate: Coordinate;
}

export interface IsraelChartAirspaceFeature {
  id: number;
  kind: IsraelAirspaceKind;
  /** P/R/D: drawn in the restricted (amber caution) colour, every other kind in airspace blue. */
  isRestricted: boolean;
  /** Chart label: code or name, e.g. "LLHA CTR", "LLP11". */
  title: string;
  /** "SFC-3000" with an en dash. Empty when the source publishes no limits. */
  limits: string;
  labelCoordinate: Coordinate;
  polygons: Coordinate[][][];
}

export interface IsraelChartRunwayFeature {
  id: number;
  aerodrome: string | null;
  endA: Coordinate;
  endB: Coordinate;
}

// MARK: Routes

export function routeStyle(segment: IsraelRouteSegment): IsraelRouteStyle {
  if (segment.isMilitary) return 'military';
  if (segment.isByRequest) return 'byRequest';
  return 'civil';
}

/** Swift `truncatingRemainder` then wrap: [0, 360). */
export function normalizedDegrees(value: number): number {
  const r = value % 360;
  return r < 0 ? r + 360 : r;
}

/** Clockwise degrees that make horizontal text read along a line with this bearing, flipped so never upside down. */
export function textRotation(bearingTrue: number): number {
  const bearing = normalizedDegrees(bearingTrue);
  return bearing <= 180 ? bearing - 90 : bearing - 270;
}

/** Label text and rotation for the published altitudes; null when neither direction has one. */
export function segmentLabel(
  forward: IsraelRouteAltitude | null,
  reverse: IsraelRouteAltitude | null,
  bearingTrue: number,
  at: Coordinate,
  military: boolean,
): IsraelChartSegmentLabel | null {
  if (forward === null && reverse === null) return null;
  const bearing = normalizedDegrees(bearingTrue);
  // Text reads left-to-right from -> to when that direction is eastward (0...180). Westward segments flip the text so
  // it is never upside down, and the arrows swap with it: the right arrow always means "the way the text runs".
  const readsForward = bearing <= 180;
  const along = readsForward ? forward : reverse;
  const against = readsForward ? reverse : forward;
  const parts: string[] = [];
  if (along !== null) parts.push(`\u2192${along.published}`);
  if (against !== null) parts.push(`\u2190${against.published}`);
  let text = parts.join(' / ');
  if (military) text += '  MIL';
  return { text, coordinate: at, rotationDegrees: textRotation(bearing) };
}

/** The point halfway along the polyline's length (not the middle vertex, which can sit at a bend near one end). */
export function midpoint(polyline: readonly Coordinate[]): Coordinate | null {
  const first = polyline[0];
  if (first === undefined) return null;
  if (polyline.length === 1) return first;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < polyline.length; i += 1) {
    const d = distanceNm(polyline[i]!, polyline[i + 1]!);
    lengths.push(d);
    total += d;
  }
  if (!(total > 0)) return first;
  let remaining = total / 2;
  for (const [index, length] of lengths.entries()) {
    if (remaining <= length) {
      const t = length > 0 ? remaining / length : 0;
      const a = polyline[index]!;
      const b = polyline[index + 1]!;
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
    remaining -= length;
  }
  return polyline[polyline.length - 1]!;
}

export function segmentFeatures(segments: readonly IsraelRouteSegment[]): IsraelChartSegmentFeature[] {
  const out: IsraelChartSegmentFeature[] = [];
  for (const segment of segments) {
    if (segment.polyline.length < 2) continue;
    const style = routeStyle(segment);
    const mid = midpoint(segment.polyline);
    const label =
      mid === null
        ? null
        : segmentLabel(
            segment.altitudeForward,
            segment.altitudeReverse,
            segment.bearingTrue,
            mid,
            style === 'military',
          );
    out.push({
      id: segment.id,
      fromCode: segment.fromCode,
      toCode: segment.toCode,
      style,
      polyline: segment.polyline,
      label,
      bearingTrue: segment.bearingTrue,
    });
  }
  return out;
}

// MARK: Points

export const pointFeatures = (points: readonly IsraelReportingPoint[]): IsraelChartPointFeature[] =>
  points.map((p) => ({ id: p.id, code: p.code, kind: p.kind, coordinate: { lat: p.latitude, lon: p.longitude } }));

// MARK: Airspace

/** One vertical limit as chart text: "SFC", "UNL", "FL95", "3000", or the published two-number text. */
export function limitText(limit: IsraelAirspaceLimit): string | null {
  if (limit.publishedText !== null && limit.publishedText !== '') return limit.publishedText;
  switch (limit.reference) {
    case 'SFC':
      return 'SFC';
    case 'UNL':
      return 'UNL';
    case 'FL':
      return limit.feet === null ? 'FL' : `FL${Math.trunc(limit.feet / 100)}`;
    case 'AGL':
      return limit.feet === null ? null : `${limit.feet} AGL`;
    default: // MSL or no reference
      if (limit.feet === null) return null;
      return limit.feet === 0 ? 'SFC' : String(limit.feet);
  }
}

/** "SFC-3000" with an en dash; "" when neither limit is published (the tap sheet then says so). */
export function limitsText(floor: IsraelAirspaceLimit, ceiling: IsraelAirspaceLimit): string {
  const f = limitText(floor);
  const c = limitText(ceiling);
  if (f !== null && c !== null) return `${f}\u2013${c}`;
  if (f !== null) return `${f}\u2013?`;
  if (c !== null) return `?\u2013${c}`;
  return '';
}

export function airspaceTitle(airspace: IsraelAirspace): string {
  switch (airspace.kind) {
    case 'P':
    case 'R':
    case 'D':
      return airspace.code ?? airspace.nameEnglish ?? airspace.kind;
    case 'TMA':
      // The published label ("LLBG TMA 2 500 - 8 000") holds the limits the map draws on the second line.
      return [airspace.code, 'TMA'].filter((s): s is string => s !== null).join(' ');
    default:
      if (airspace.code !== null) return `${airspace.code} ${airspace.kind}`;
      return airspace.nameEnglish !== null ? `${airspace.nameEnglish} ${airspace.kind}` : airspace.kind;
  }
}

export const isRestricted = (kind: IsraelAirspaceKind): boolean => kind === 'P' || kind === 'R' || kind === 'D';

/** Vertex average of the outer ring of the first polygon: good enough for a label anchor. */
export function labelAnchor(polygons: readonly Coordinate[][][]): Coordinate | null {
  const ring = polygons[0]?.[0];
  if (ring === undefined || ring.length === 0) return null;
  const lat = ring.reduce((sum, c) => sum + c.lat, 0) / ring.length;
  const lon = ring.reduce((sum, c) => sum + c.lon, 0) / ring.length;
  return { lat, lon };
}

/** The FIR boundary is the whole country: it is not drawn as an airspace. */
export function airspaceFeatures(airspaces: readonly IsraelAirspace[]): IsraelChartAirspaceFeature[] {
  const out: IsraelChartAirspaceFeature[] = [];
  for (const airspace of airspaces) {
    const anchor = labelAnchor(airspace.polygons);
    if (airspace.kind === 'FIR' || anchor === null) continue;
    out.push({
      id: airspace.id,
      kind: airspace.kind,
      isRestricted: isRestricted(airspace.kind),
      title: airspaceTitle(airspace),
      limits: limitsText(airspace.floor, airspace.ceiling),
      labelCoordinate: anchor,
      polygons: airspace.polygons,
    });
  }
  return out;
}

// MARK: Runways

export const runwayFeatures = (runways: readonly IsraelRunway[]): IsraelChartRunwayFeature[] =>
  runways.map((r) => ({ id: r.id, aerodrome: r.aerodrome, endA: r.endA, endB: r.endB }));

// MARK: Defaults (IsraelChartDefaults)

/**
 * Which CVFR chart layers are on by default. Official CAAI chart shown: closures, plus reporting-point tap targets.
 * Street base: everything on.
 */
export const israelChartDefaultVisibleLayers = (officialChartPresent: boolean): MapLayer[] =>
  officialChartPresent ? ['cvfrClosures', 'cvfrPoints'] : [...CVFR_CHART_LAYERS];

// MARK: Aerodromes (IL-4)

/** Aerodromes with no ARP reporting point on the chart (those are already drawn as points); never foreign ones. */
export function aerodromesWithoutPoint(
  aerodromes: readonly IsraelAerodrome[],
  points: readonly IsraelReportingPoint[],
): IsraelAerodrome[] {
  const codes = new Set(points.filter((p) => p.kind === 'arp').map((p) => p.code.toUpperCase()));
  return aerodromes.filter((a) => a.use !== 'foreign' && !codes.has(a.code.toUpperCase()));
}

/** Code label; "*" marks an entry the curator has not reviewed, so the pilot knows to check the AIP. */
export const aerodromeLabel = (aerodrome: IsraelAerodrome): string =>
  aerodrome.reviewStatus === 'reviewed' ? aerodrome.code : `${aerodrome.code}*`;
