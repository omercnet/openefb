// Read-only queries over the bundled israel-aviation.sqlite (tools/caai-importer, CAAI GIS layers, WGS-84). Port of
// Data/IsraelAviationDatabase.swift and its protocol. R-tree indexes serve the spatial lookups; point-in-polygon runs on
// the few candidates they return. Opening the file (install, schema check) is in israelOpen.ts.
import type { Coordinate } from '../../domain/geo';
import { AppFailure } from '../../domain/errors';
import type { Db, SqlParams, SqlRow, SqlValue } from '../db';
import {
  AERODROME_TYPES,
  AERODROME_USES,
  AIRSPACE_AUTHORITIES,
  AIRSPACE_KINDS,
  ALTITUDE_REFERENCES,
  POINT_KINDS,
  PPR_VALUES,
  REVIEW_STATUSES,
  ROUTE_ACTIVITIES,
  ROUTE_NETWORKS,
  airspaceContainsAltitude,
  airspaceContainsLaterally,
  boundsAround,
  type IsraelAerodrome,
  type IsraelAerodromeFrequency,
  type IsraelAerodromeRunway,
  type IsraelAirspace,
  type IsraelAirspaceKind,
  type IsraelAirspaceLimit,
  type IsraelAviationMetadata,
  type IsraelGeoBounds,
  type IsraelLSAWeekendRule,
  type IsraelReportingPoint,
  type IsraelRouteAltitude,
  type IsraelRouteNetwork,
  type IsraelRouteSegment,
  type IsraelRunway,
} from './israelTypes';

/** Schema version this code reads (`metadata.schema_version`). */
export const SUPPORTED_SCHEMA_VERSION = 3;

export interface IsraelAviationDatabase {
  metadata(): Promise<IsraelAviationMetadata>;

  reportingPoint(code: string, network?: IsraelRouteNetwork): Promise<IsraelReportingPoint | null>;
  reportingPoints(bounds: IsraelGeoBounds, network?: IsraelRouteNetwork): Promise<IsraelReportingPoint[]>;

  routeSegments(bounds: IsraelGeoBounds, network?: IsraelRouteNetwork): Promise<IsraelRouteSegment[]>;
  routeSegment(from: string, to: string, network?: IsraelRouteNetwork): Promise<IsraelRouteSegment | null>;

  /** IsraelRouteSegmentLookup (CVFR). A lookup failure answers "unknown"; the closure mapper reports unknown codes. */
  knowsPoint(code: string): Promise<boolean>;
  /** IsraelRouteSegmentLookup (CVFR): the segment joining two points in that direction, or null. */
  segment(from: string, to: string): Promise<IsraelRouteSegment | null>;

  /** Airspaces whose boundary contains the point; with an altitude (feet MSL) also whose limits do. */
  airspacesContaining(coordinate: Coordinate, altitudeFeetMSL?: number | null): Promise<IsraelAirspace[]>;
  airspacesNear(coordinate: Coordinate, radiusNM: number): Promise<IsraelAirspace[]>;
  airspacesOfKind(kind: IsraelAirspaceKind): Promise<IsraelAirspace[]>;

  runwaysOfAerodrome(aerodrome: string): Promise<IsraelRunway[]>;
  runwaysIn(bounds: IsraelGeoBounds): Promise<IsraelRunway[]>;

  aerodrome(code: string): Promise<IsraelAerodrome | null>;
  aerodromesIn(bounds: IsraelGeoBounds): Promise<IsraelAerodrome[]>;
  nearestAerodromes(coordinate: Coordinate, count: number): Promise<IsraelAerodrome[]>;
  searchAerodromes(query: string, limit: number): Promise<IsraelAerodrome[]>;
}

const corrupted = (): AppFailure => new AppFailure({ kind: 'databaseCorrupted' });

/** R-tree overlap arguments in the order the queries use: maxLat, minLat, maxLon, minLon. */
const boxArguments = (b: IsraelGeoBounds): number[] => [b.maxLatitude, b.minLatitude, b.maxLongitude, b.minLongitude];

const RTREE_OVERLAP = 'r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?';

// Row accessors. The schema's NOT NULL columns are read as present; a null there is a corrupt file (Swift would trap).
const str = (row: SqlRow, key: string): string | null => {
  const value = row[key];
  return typeof value === 'string' ? value : null;
};
const num = (row: SqlRow, key: string): number | null => {
  const value = row[key];
  return typeof value === 'number' ? value : null;
};
const reqStr = (row: SqlRow, key: string): string => str(row, key) ?? fail();
const reqNum = (row: SqlRow, key: string): number => num(row, key) ?? fail();
function fail(): never {
  throw corrupted();
}

/** Swift `Enum(rawValue:)` for values that must be known: anything else is a corrupt file. */
function strictEnum<T extends string>(values: readonly T[], raw: SqlValue | undefined): T {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : fail();
}
function lenientEnum<T extends string>(values: readonly T[], raw: SqlValue | undefined): T | null {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

function decodeJSON(text: string | null): unknown {
  try {
    return JSON.parse(text ?? fail());
  } catch {
    throw corrupted();
  }
}

/** [lat, lon] pair from the importer's JSON; anything but two numbers is dropped (Swift compactMap). */
function toCoordinate(pair: unknown): Coordinate | null {
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const [lat, lon] = pair as unknown[];
  return typeof lat === 'number' && typeof lon === 'number' ? { lat, lon } : null;
}
const toCoordinates = (list: unknown): Coordinate[] => {
  if (!Array.isArray(list)) throw corrupted();
  return list.flatMap((pair) => toCoordinate(pair) ?? []);
};

function pointFromRow(row: SqlRow): IsraelReportingPoint {
  return {
    id: reqNum(row, 'id'),
    code: reqStr(row, 'code'),
    nameEnglish: str(row, 'name_en'),
    nameHebrew: str(row, 'name_he'),
    kind: lenientEnum(POINT_KINDS, row.kind) ?? 'onRequest',
    latitude: reqNum(row, 'lat'),
    longitude: reqNum(row, 'lon'),
    network: lenientEnum(ROUTE_NETWORKS, row.network) ?? 'cvfr',
  };
}

const routeAltitude = (text: string | null, feet: number | null): IsraelRouteAltitude | null =>
  text === null ? null : { published: text, feet };

function segmentFromRow(row: SqlRow): IsraelRouteSegment {
  const polyline = decodeJSON(str(row, 'polyline'));
  if (!Array.isArray(polyline)) throw corrupted();
  return {
    id: reqNum(row, 'id'),
    fromCode: reqStr(row, 'from_code'),
    toCode: reqStr(row, 'to_code'),
    fromPointID: reqNum(row, 'from_point_id'),
    toPointID: reqNum(row, 'to_point_id'),
    nameEnglish: str(row, 'name_en'),
    nameHebrew: str(row, 'name_he'),
    lengthNM: num(row, 'length_nm'),
    isCivil: reqNum(row, 'civil') !== 0,
    isMilitary: reqNum(row, 'military') !== 0,
    isByRequest: reqNum(row, 'by_request') !== 0,
    bearingTrue: reqNum(row, 'bearing_true'),
    altitudeForward: routeAltitude(str(row, 'alt_forward_text'), num(row, 'alt_forward_ft')),
    altitudeReverse: routeAltitude(str(row, 'alt_reverse_text'), num(row, 'alt_reverse_ft')),
    lowerAltitudeFeet: num(row, 'lower_alt_ft'),
    mapSheet: str(row, 'map_sheet'),
    polyline: polyline.flatMap((pair) => toCoordinate(pair) ?? []),
    network: lenientEnum(ROUTE_NETWORKS, row.network) ?? 'cvfr',
    activity: lenientEnum(ROUTE_ACTIVITIES, row.activity) ?? 'unspecified',
    activitySource: str(row, 'activity_source'),
    smallOnly: (num(row, 'small_only') ?? 0) !== 0,
  };
}

const limitFrom = (row: SqlRow, prefix: 'floor' | 'ceiling'): IsraelAirspaceLimit => ({
  feet: num(row, `${prefix}_ft`),
  reference: lenientEnum(ALTITUDE_REFERENCES, row[`${prefix}_ref`]),
  publishedText: str(row, `${prefix}_text`),
});

function airspaceFromRow(row: SqlRow): IsraelAirspace {
  const kind = strictEnum(AIRSPACE_KINDS, row.kind);
  const polygons = decodeJSON(str(row, 'polygons'));
  if (!Array.isArray(polygons) || !polygons.every((p) => Array.isArray(p) && p.every(Array.isArray))) throw corrupted();
  return {
    id: reqNum(row, 'id'),
    kind,
    code: str(row, 'code'),
    nameEnglish: str(row, 'name_en'),
    nameHebrew: str(row, 'name_he'),
    label: str(row, 'label'),
    authority: lenientEnum(AIRSPACE_AUTHORITIES, row.authority),
    floor: limitFrom(row, 'floor'),
    ceiling: limitFrom(row, 'ceiling'),
    polygons: (polygons as unknown[][][]).map((rings) => rings.map(toCoordinates)),
  };
}

function runwayFromRow(row: SqlRow): IsraelRunway {
  return {
    id: reqNum(row, 'id'),
    aerodrome: str(row, 'aerodrome'),
    nameEnglish: str(row, 'name_en'),
    nameHebrew: str(row, 'name_he'),
    designatorA: str(row, 'designator_a'),
    designatorB: str(row, 'designator_b'),
    headingA: num(row, 'heading_a'),
    headingB: num(row, 'heading_b'),
    lengthMetres: num(row, 'length_m'),
    widthMetres: num(row, 'width_m'),
    surface: str(row, 'surface'),
    endA: { lat: reqNum(row, 'a_lat'), lon: reqNum(row, 'a_lon') },
    endB: { lat: reqNum(row, 'b_lat'), lon: reqNum(row, 'b_lon') },
  };
}

function aerodromeFromRow(
  row: SqlRow,
  runways: IsraelAerodromeRunway[],
  frequencies: IsraelAerodromeFrequency[],
): IsraelAerodrome {
  const type = strictEnum(AERODROME_TYPES, row.type);
  const use = strictEnum(AERODROME_USES, row.use);
  const ppr = strictEnum(PPR_VALUES, row.ppr);
  const reviewStatus = strictEnum(REVIEW_STATUSES, row.review_status);
  const uncertain = str(row, 'uncertain');
  return {
    id: reqNum(row, 'id'),
    code: reqStr(row, 'code'),
    nameHebrew: reqStr(row, 'name_he'),
    nameEnglish: reqStr(row, 'name_en'),
    type,
    use,
    latitude: reqNum(row, 'lat'),
    longitude: reqNum(row, 'lon'),
    elevationFeet: num(row, 'elevation_ft'),
    circuitAltitudeFeet: num(row, 'circuit_altitude_ft'),
    circuitDirection: str(row, 'circuit_direction'),
    hours: str(row, 'hours'),
    ppr,
    pprText: str(row, 'ppr_text'),
    remarks: str(row, 'remarks'),
    sources: {
      identity: reqStr(row, 'source_identity'),
      runways: str(row, 'source_runways'),
      frequencies: str(row, 'source_frequencies'),
      circuit: str(row, 'source_circuit'),
      hours: str(row, 'source_hours'),
      remarks: str(row, 'source_remarks'),
    },
    // Swift: split(separator: ",") drops empty pieces.
    uncertainGroups: uncertain === null ? [] : uncertain.split(',').filter((group) => group.length > 0),
    notes: str(row, 'notes'),
    reviewStatus,
    runways,
    frequencies,
  };
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Swift `try? JSONDecoder().decode(IsraelLSAWeekendRule.self, ...)`: every field is a required string. */
function parseWeekendRule(text: string | null): IsraelLSAWeekendRule | null {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const field = (key: string): string => (typeof raw[key] === 'string' ? (raw[key] as string) : fail());
    return {
      source: field('source'),
      textHebrew: field('text_he'),
      textEnglish: field('text_en'),
      fridayStartDefault: field('friday_start_default'),
      fridayStartLatestPublished: field('friday_start_latest_published'),
      holidayEveStart: field('holiday_eve_start'),
      layerDoesNotSay: field('layer_does_not_say'),
    };
  } catch {
    return null;
  }
}

function parseUrls(text: string | null): string[] {
  if (text === null) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createIsraelAviationDatabase(db: Db): IsraelAviationDatabase {
  const spatial = async <T>(
    sql: string,
    prefixParams: SqlParams,
    bounds: IsraelGeoBounds,
    map: (row: SqlRow) => T,
  ): Promise<T[]> => (await db.all(sql, [...prefixParams, ...boxArguments(bounds)])).map(map);

  /** Attach runways and frequencies to each aerodrome row with two queries, however many rows there are. */
  const aerodromes = async (rows: SqlRow[]): Promise<IsraelAerodrome[]> => {
    if (rows.length === 0) return [];
    const codes = rows.map((row) => reqStr(row, 'code'));
    const marks = codes.map(() => '?').join(',');
    const runways = new Map<string, IsraelAerodromeRunway[]>();
    for (const row of await db.all(
      `SELECT * FROM aerodrome_runways WHERE aerodrome IN (${marks}) ORDER BY id`,
      codes,
    )) {
      const heading = str(row, 'heading_ref');
      const list = runways.get(reqStr(row, 'aerodrome')) ?? [];
      list.push({
        id: reqNum(row, 'id'),
        designator: reqStr(row, 'designator'),
        lengthMetres: reqNum(row, 'length_m'),
        widthMetres: reqNum(row, 'width_m'),
        surface: reqStr(row, 'surface'),
        headingA: num(row, 'heading_a'),
        headingB: num(row, 'heading_b'),
        headingIsTrue: heading === null ? null : heading === 'T',
      });
      runways.set(reqStr(row, 'aerodrome'), list);
    }
    const frequencies = new Map<string, IsraelAerodromeFrequency[]>();
    for (const row of await db.all(
      `SELECT * FROM aerodrome_frequencies WHERE aerodrome IN (${marks}) ORDER BY id`,
      codes,
    )) {
      const list = frequencies.get(reqStr(row, 'aerodrome')) ?? [];
      list.push({
        id: reqNum(row, 'id'),
        mhz: reqStr(row, 'mhz'),
        service: reqStr(row, 'service'),
        callsignHebrew: str(row, 'callsign_he'),
      });
      frequencies.set(reqStr(row, 'aerodrome'), list);
    }
    return rows.map((row) => {
      const code = reqStr(row, 'code');
      return aerodromeFromRow(row, runways.get(code) ?? [], frequencies.get(code) ?? []);
    });
  };

  const routeSegment: IsraelAviationDatabase['routeSegment'] = async (from, to, network = 'cvfr') => {
    const row = await db.get('SELECT * FROM route_segments WHERE network = ? AND from_code = ? AND to_code = ?', [
      network,
      from.toUpperCase(),
      to.toUpperCase(),
    ]);
    return row === null ? null : segmentFromRow(row);
  };

  return {
    async metadata() {
      const values = new Map<string, string | null>();
      for (const row of await db.all('SELECT key, value FROM metadata'))
        values.set(reqStr(row, 'key'), str(row, 'value'));
      const text = (key: string): string | null => values.get(key) ?? null;
      const schema = text('schema_version');
      const schemaVersion = schema === null || !/^[+-]?\d+$/.test(schema) ? null : Number(schema);
      const source = text('source');
      const sourceDataDate = text('source_data_date');
      const downloadDate = text('download_date');
      const dataLastModified = text('data_last_modified');
      const importDate = text('import_date');
      const attribution = text('attribution');
      if (
        schemaVersion === null ||
        source === null ||
        sourceDataDate === null ||
        downloadDate === null ||
        dataLastModified === null ||
        importDate === null ||
        attribution === null
      ) {
        throw corrupted();
      }
      return {
        schemaVersion,
        source,
        sourceURLs: parseUrls(text('source_urls')),
        aipAmendment: text('aip_amendment'),
        effectiveDate: text('effective_date'),
        sourceDataDate,
        downloadDate,
        dataLastModified,
        importDate,
        attribution,
        lsaWeekendRule: parseWeekendRule(text('lsa_weekend_rule')),
      };
    },

    async reportingPoint(code, network = 'cvfr') {
      const row = await db.get(
        `SELECT p.* FROM reporting_points p
         WHERE p.network = ? AND p.code = ?
         ORDER BY EXISTS (SELECT 1 FROM route_segments s WHERE s.from_point_id = p.id OR s.to_point_id = p.id) DESC, p.id
         LIMIT 1`,
        [network, code.toUpperCase()],
      );
      return row === null ? null : pointFromRow(row);
    },

    reportingPoints: (bounds, network = 'cvfr') =>
      spatial(
        `SELECT p.* FROM reporting_points p
         JOIN reporting_points_rtree r ON r.rowid = p.id
         WHERE p.network = ? AND ${RTREE_OVERLAP}
         ORDER BY p.id`,
        [network],
        bounds,
        pointFromRow,
      ),

    routeSegments: (bounds, network = 'cvfr') =>
      spatial(
        `SELECT s.* FROM route_segments s
         JOIN route_segments_rtree r ON r.rowid = s.id
         WHERE s.network = ? AND ${RTREE_OVERLAP}
         ORDER BY s.id`,
        [network],
        bounds,
        segmentFromRow,
      ),

    routeSegment,

    async knowsPoint(code) {
      try {
        const row = await db.get(
          "SELECT EXISTS (SELECT 1 FROM reporting_points WHERE network = 'cvfr' AND code = ?) AS found",
          [code.toUpperCase()],
        );
        return row !== null && row.found === 1;
      } catch {
        return false;
      }
    },

    async segment(from, to) {
      try {
        return await routeSegment(from, to, 'cvfr');
      } catch {
        return null;
      }
    },

    async airspacesContaining(coordinate, altitudeFeetMSL = null) {
      const candidates = await db.all(
        `SELECT a.* FROM airspaces a
         JOIN airspaces_rtree r ON r.rowid = a.id
         WHERE ${RTREE_OVERLAP}
         ORDER BY a.id`,
        [coordinate.lat, coordinate.lat, coordinate.lon, coordinate.lon],
      );
      return candidates
        .map(airspaceFromRow)
        .filter(
          (airspace) =>
            airspaceContainsLaterally(airspace, coordinate) &&
            (altitudeFeetMSL === null || airspaceContainsAltitude(airspace, altitudeFeetMSL)),
        );
    },

    airspacesNear: (coordinate, radiusNM) =>
      spatial(
        `SELECT a.* FROM airspaces a
         JOIN airspaces_rtree r ON r.rowid = a.id
         WHERE ${RTREE_OVERLAP}
         ORDER BY a.id`,
        [],
        boundsAround(coordinate, radiusNM),
        airspaceFromRow,
      ),

    async airspacesOfKind(kind) {
      return (await db.all('SELECT * FROM airspaces WHERE kind = ? ORDER BY id', [kind])).map(airspaceFromRow);
    },

    async runwaysOfAerodrome(aerodrome) {
      return (await db.all('SELECT * FROM runways WHERE aerodrome = ? ORDER BY id', [aerodrome.toUpperCase()])).map(
        runwayFromRow,
      );
    },

    runwaysIn: (bounds) =>
      spatial(
        `SELECT w.* FROM runways w
         JOIN runways_rtree r ON r.rowid = w.id
         WHERE ${RTREE_OVERLAP}
         ORDER BY w.id`,
        [],
        bounds,
        runwayFromRow,
      ),

    async aerodrome(code) {
      const rows = await db.all('SELECT * FROM aerodromes WHERE code = ?', [code.toUpperCase()]);
      return (await aerodromes(rows))[0] ?? null;
    },

    async aerodromesIn(bounds) {
      const rows = await db.all(
        `SELECT a.* FROM aerodromes a
         JOIN aerodromes_rtree r ON r.rowid = a.id
         WHERE ${RTREE_OVERLAP}
         ORDER BY a.code`,
        boxArguments(bounds),
      );
      return aerodromes(rows);
    },

    async nearestAerodromes(coordinate, count) {
      if (count <= 0) return [];
      // Equirectangular ordering is exact enough to rank a country-sized table; callers compute true distances.
      const cosLat = Math.cos((coordinate.lat * Math.PI) / 180);
      const rows = await db.all(
        `SELECT * FROM aerodromes
         ORDER BY (lat - ?) * (lat - ?) + ((lon - ?) * ?) * ((lon - ?) * ?), code
         LIMIT ?`,
        [coordinate.lat, coordinate.lat, coordinate.lon, cosLat, coordinate.lon, cosLat, count],
      );
      return aerodromes(rows);
    },

    async searchAerodromes(query, limit) {
      const trimmed = query.trim();
      if (trimmed.length === 0 || limit <= 0) return [];
      const escaped = trimmed.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
      const prefix = `${escaped}%`;
      const contains = `%${escaped}%`;
      // SQLite LIKE folds ASCII case only: the codes and English names are ASCII, Hebrew has no case.
      const rows = await db.all(
        `SELECT a.*, CASE
             WHEN upper(a.code) = upper(?) THEN 0
             WHEN a.code LIKE ? ESCAPE '\\' THEN 1
             WHEN a.name_en LIKE ? ESCAPE '\\' OR a.name_he LIKE ? ESCAPE '\\' THEN 2
             ELSE 3 END AS rank
         FROM aerodromes a
         WHERE a.code LIKE ? ESCAPE '\\' OR a.name_en LIKE ? ESCAPE '\\' OR a.name_he LIKE ? ESCAPE '\\'
         ORDER BY rank, a.code
         LIMIT ?`,
        [trimmed, prefix, prefix, prefix, prefix, contains, contains, limit],
      );
      return aerodromes(rows);
    },
  };
}
