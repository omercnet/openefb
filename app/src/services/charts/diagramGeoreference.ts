// Airport diagram georeferencing as it ships inside a chart pack (owner decision Q6): the transform is computed
// offline (tools/apd-georef, tools/caai-apd), never on the device. This is the interface the map track (M4) consumes.
//
// Wire format: the JSON that Swift's `AirportDiagramGeoreference` (Services/AirportDiagramGeoreferencer.swift) encodes,
// field for field, so packs built by the existing tools decode unchanged. STABLE: change it only together with the
// tools that write it.
//
// Geometry (same as Swift):
// - PDF user space: points, origin bottom-left, y up. `pageBox` is the media box; `clipBox` is the neatline (the part
//   of the page that belongs on the map); `masks` are circles (magnified insets) to blank out.
// - `a b c d tx ty` is the affine map page point -> local metres, x east and y north of the reference point:
//   x' = a*x + c*y + tx, y' = b*x + d*y + ty.
// - Metres convert to degrees with the WGS-84 series in `metresPerDegree` at `referenceLatitude`.
import {
  asObject,
  DecodeError,
  optDouble,
  reqArray,
  reqDouble,
  reqInt,
  reqString,
  type JsonObject,
} from '../jsonDecode';

/** PDF points, user space. */
export interface DiagramRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** PDF points, user space. */
export interface DiagramCircle {
  centerX: number;
  centerY: number;
  radius: number;
}

export type GeoreferenceMethod = 'grid' | 'gridRunwayChecked' | 'runway';
export type GeoreferenceLabelSource = 'text' | 'ocr' | 'none';

export interface GeoreferenceDiagnostics {
  method: GeoreferenceMethod;
  labelSource: GeoreferenceLabelSource;
  latitudeLabels: number;
  longitudeLabels: number;
  /** 0, 90, 180, 270: page "up" relative to true north. */
  rotationDegrees: number;
  /** Feet per PDF point. */
  feetPerPoint: number;
  scaleRatio: number | null;
  runwaysMatched: number;
  runwayResidualFeet: number | null;
  runwayMidpointFeet: number | null;
  runwayEndFeet: number | null;
  runwayBestMidpointFeet: number | null;
  runwayMedianMidpointFeet: number | null;
  maskedInsets: number;
}

/** A validated page-to-ground transform for one airport diagram. */
export interface AirportDiagramGeoreference {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
  /** Unused for geometry; kept for Codable symmetry of the page frame. */
  reference: DiagramRect;
  referenceLatitude: number; // degrees
  referenceLongitude: number; // degrees
  pageBox: DiagramRect;
  clipBox: DiagramRect;
  masks: DiagramCircle[];
  diagnostics: GeoreferenceDiagnostics;
}

export interface LatLon {
  lat: number;
  lon: number;
}

export interface PagePoint {
  x: number;
  y: number;
}

/** Metres per degree of latitude / longitude at `latitude` degrees (WGS-84 series). */
export function metresPerDegree(latitude: number): { lat: number; lon: number } {
  const phi = (latitude * Math.PI) / 180;
  return {
    lat: 111_132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi),
    lon: 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

/** Ground position of a page point. */
export function coordinateForPagePoint(g: AirportDiagramGeoreference, p: PagePoint): LatLon {
  const x = g.a * p.x + g.c * p.y + g.tx;
  const y = g.b * p.x + g.d * p.y + g.ty;
  const m = metresPerDegree(g.referenceLatitude);
  return { lat: g.referenceLatitude + y / m.lat, lon: g.referenceLongitude + x / m.lon };
}

/** Page point of a ground position. Throws when the transform is singular (decodeGeoreference rejects those). */
export function pagePointForCoordinate(g: AirportDiagramGeoreference, position: LatLon): PagePoint {
  const m = metresPerDegree(g.referenceLatitude);
  const x = (position.lon - g.referenceLongitude) * m.lon - g.tx;
  const y = (position.lat - g.referenceLatitude) * m.lat - g.ty;
  const det = g.a * g.d - g.b * g.c;
  if (det === 0) throw new Error('georeference transform is singular');
  return { x: (g.d * x - g.c * y) / det, y: (-g.b * x + g.a * y) / det };
}

/** Ground corners of the clip box in the order of Swift's MLNCoordinateQuad: top-left, bottom-left, bottom-right,
 * top-right of the rendered image. NOT the order of MapLibre JS / React Native ImageSource (TL, TR, BR, BL): use
 * `clipCornersForImageSource` for that. */
export function clipCorners(g: AirportDiagramGeoreference): [LatLon, LatLon, LatLon, LatLon] {
  const { x, y, width, height } = g.clipBox;
  const minX = Math.min(x, x + width);
  const maxX = Math.max(x, x + width);
  const minY = Math.min(y, y + height);
  const maxY = Math.max(y, y + height);
  return [
    coordinateForPagePoint(g, { x: minX, y: maxY }),
    coordinateForPagePoint(g, { x: minX, y: minY }),
    coordinateForPagePoint(g, { x: maxX, y: minY }),
    coordinateForPagePoint(g, { x: maxX, y: maxY }),
  ];
}

/** The clip box corners in MapLibre ImageSource order: top-left, top-right, bottom-right, bottom-left, each as
 * [lon, lat] (GeoJSON order, as the ImageSource `coordinates` option takes them). */
export function clipCornersForImageSource(g: AirportDiagramGeoreference): [number, number][] {
  const [tl, bl, br, tr] = clipCorners(g);
  return [tl, tr, br, bl].map((c) => [c.lon, c.lat]);
}

// MARK: Decoding (Swift Codable semantics)

function decodeRect(value: unknown, path: string): DiagramRect {
  const o = asObject(value, path);
  return { x: reqDouble(o, 'x'), y: reqDouble(o, 'y'), width: reqDouble(o, 'width'), height: reqDouble(o, 'height') };
}

function oneOf<T extends string>(o: JsonObject, key: string, allowed: readonly T[]): T {
  const v = reqString(o, key);
  const found = allowed.find((a) => a === v);
  if (!found) throw new DecodeError(`${key}: unknown value ${v}`);
  return found;
}

/** Decodes a georeference JSON from the pack. Throws DecodeError for a malformed or non-invertible transform: a wrong
 * overlay is worse than none, so the caller draws nothing. */
export function decodeGeoreference(body: string): AirportDiagramGeoreference {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new DecodeError('georeference is not JSON');
  }
  const o = asObject(json, 'georeference');
  const d = asObject(o.diagnostics, 'diagnostics');
  const g: AirportDiagramGeoreference = {
    a: reqDouble(o, 'a'),
    b: reqDouble(o, 'b'),
    c: reqDouble(o, 'c'),
    d: reqDouble(o, 'd'),
    tx: reqDouble(o, 'tx'),
    ty: reqDouble(o, 'ty'),
    reference: decodeRect(o.reference, 'reference'),
    referenceLatitude: reqDouble(o, 'referenceLatitude'),
    referenceLongitude: reqDouble(o, 'referenceLongitude'),
    pageBox: decodeRect(o.pageBox, 'pageBox'),
    clipBox: decodeRect(o.clipBox, 'clipBox'),
    masks: reqArray(o, 'masks').map((m) => {
      const c = asObject(m, 'masks[]');
      return { centerX: reqDouble(c, 'centerX'), centerY: reqDouble(c, 'centerY'), radius: reqDouble(c, 'radius') };
    }),
    diagnostics: {
      method: oneOf(d, 'method', ['grid', 'gridRunwayChecked', 'runway']),
      labelSource: oneOf(d, 'labelSource', ['text', 'ocr', 'none']),
      latitudeLabels: reqInt(d, 'latitudeLabels'),
      longitudeLabels: reqInt(d, 'longitudeLabels'),
      rotationDegrees: reqInt(d, 'rotationDegrees'),
      feetPerPoint: reqDouble(d, 'feetPerPoint'),
      scaleRatio: optDouble(d, 'scaleRatio'),
      runwaysMatched: reqInt(d, 'runwaysMatched'),
      runwayResidualFeet: optDouble(d, 'runwayResidualFeet'),
      runwayMidpointFeet: optDouble(d, 'runwayMidpointFeet'),
      runwayEndFeet: optDouble(d, 'runwayEndFeet'),
      runwayBestMidpointFeet: optDouble(d, 'runwayBestMidpointFeet'),
      runwayMedianMidpointFeet: optDouble(d, 'runwayMedianMidpointFeet'),
      maskedInsets: reqInt(d, 'maskedInsets'),
    },
  };
  // JS-only guards: a transform that cannot be inverted, or a reference outside the globe, is never drawn.
  if (g.a * g.d - g.b * g.c === 0) throw new DecodeError('georeference transform is singular');
  if (Math.abs(g.referenceLatitude) > 90 || Math.abs(g.referenceLongitude) > 180) {
    throw new DecodeError('georeference reference point is not on the globe');
  }
  return g;
}
