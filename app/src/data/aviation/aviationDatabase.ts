// Read-only queries over the bundled aviation.sqlite (R-tree spatial indexes, FTS5 search). Port of the query half of
// Data/AviationDatabase.swift; installing and versioning the file is in install.ts. Takes the `Db` interface, so Jest
// runs it on Node's sqlite and the app on expo-sqlite.
import { distanceNm, type Coordinate } from '../../domain/geo';
import type { Db, SqlRow } from '../db';
import {
  AIRPORT_TYPES,
  AIRSPACE_CLASSES,
  FREQUENCY_TYPES,
  LIGHTING_TYPES,
  NAVAID_TYPES,
  OWNERSHIP_TYPES,
  SURFACE_TYPES,
  parseEnum,
  type Airport,
  type Airspace,
  type AirspaceGeometry,
  type AviationDataCycle,
  type Frequency,
  type Navaid,
  type Runway,
} from './types';

/** Initial search radius for nearestAirports, doubled until enough airports are found. */
export const NEAREST_INITIAL_RADIUS_NM = 25;
/** Largest circle nearestAirports searches before returning fewer than requested. */
export const NEAREST_MAX_RADIUS_NM = 400;

export interface AviationDatabase {
  /** One airport by exact ICAO identifier, with runways and frequencies. */
  airport(icao: string): Promise<Airport | null>;
  /** NASR cycle from the `metadata` table; null when the table or its dates are missing or unparseable. */
  dataCycle(): Promise<AviationDataCycle | null>;
  /** Airports whose R-tree box meets the box covering the radius around center. No runways or frequencies. */
  airportsNear(center: Coordinate, radiusNM: number): Promise<Airport[]>;
  /** Public fixed-wing airports with a tower frequency in that box. Used at low zoom. */
  toweredAirportsNear(center: Coordinate, radiusNM: number): Promise<Airport[]>;
  /** The nearest `count` airports by great-circle distance, with runways and frequencies. */
  nearestAirports(center: Coordinate, count: number): Promise<Airport[]>;
  /** FTS5 prefix search over ICAO, name and FAA identifier. Empty or symbol-only input returns nothing. */
  searchAirports(query: string, limit?: number): Promise<Airport[]>;
  airspacesNear(center: Coordinate, radiusNM: number): Promise<Airspace[]>;
  /** Airspaces containing the point: R-tree candidates, then ray casting (polygons) or distance (circles). */
  airspacesContaining(point: Coordinate): Promise<Airspace[]>;
  navaidsNear(center: Coordinate, radiusNM: number): Promise<Navaid[]>;
}

/**
 * Builds a safe FTS5 MATCH expression from raw user text: splits on non-alphanumerics, quotes each token and adds
 * prefix matching, so quotes, dashes and other FTS5 syntax can never cause a parse error. `KPAO-1` becomes
 * `"KPAO"* "1"*`. Null when the input has no alphanumeric token.
 */
export function ftsMatchExpression(query: string): string | null {
  const tokens = query.split(/[^\p{L}\p{M}\p{N}]+/u).filter((token) => token.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(' ');
}

/** Ray-casting point-in-polygon test on [latitude, longitude] vertices. */
export function pointInPolygon(point: Coordinate, polygon: readonly (readonly number[])[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  let j = polygon.length - 1;
  for (let i = 0; i < polygon.length; i += 1) {
    const [yi, xi] = polygon[i] as [number, number];
    const [yj, xj] = polygon[j] as [number, number];
    const straddlesLatitude = yi > point.lat !== yj > point.lat;
    const slope = ((xj - xi) * (point.lat - yi)) / (yj - yi);
    const crossingLongitude = slope + xi;
    if (straddlesLatitude && point.lon < crossingLongitude) inside = !inside;
    j = i;
  }
  return inside;
}

interface Box {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** The degree box covering a radius around center: 1 NM of latitude is 1/60 degree, longitude widens with latitude. */
function boxAround(center: Coordinate, radiusNM: number, minCosine?: number): Box {
  const latDelta = radiusNM / 60;
  const cosine = Math.cos((center.lat * Math.PI) / 180);
  const lonDelta = radiusNM / (60 * (minCosine === undefined ? cosine : Math.max(cosine, minCosine)));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLon: center.lon - lonDelta,
    maxLon: center.lon + lonDelta,
  };
}

/** R-tree overlap parameters in the order of the `r.min_lat <= ? AND r.max_lat >= ? AND r.min_lon <= ? AND r.max_lon >= ?` clause. */
const boxParams = (box: Box): number[] => [box.maxLat, box.minLat, box.maxLon, box.minLon];

const RTREE_WHERE = `r.min_lat <= ? AND r.max_lat >= ?
        AND r.min_lon <= ? AND r.max_lon >= ?`;

const text = (row: SqlRow, key: string): string | null => {
  const value = row[key];
  return typeof value === 'string' ? value : null;
};
const num = (row: SqlRow, key: string): number | null => {
  const value = row[key];
  return typeof value === 'number' ? value : null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Swift: `UUID(uuidString: id) ?? UUID()`, printed upper case. */
function uuidOrNew(raw: string | null): string {
  return (raw !== null && UUID_PATTERN.test(raw) ? raw : randomUuid()).toUpperCase();
}

function parseFuelTypes(json: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function airportFromRow(row: SqlRow, runways: Runway[], frequencies: Frequency[]): Airport {
  return {
    icao: text(row, 'icao') as string,
    faaID: text(row, 'faa_id'),
    name: text(row, 'name') as string,
    latitude: num(row, 'latitude') as number,
    longitude: num(row, 'longitude') as number,
    elevation: num(row, 'elevation') as number,
    type: parseEnum(AIRPORT_TYPES, row.type ?? 'airport', 'airport'),
    ownership: parseEnum(OWNERSHIP_TYPES, row.ownership ?? 'public', 'public'),
    ctafFrequency: num(row, 'ctaf_frequency'),
    unicomFrequency: num(row, 'unicom_frequency'),
    artccID: text(row, 'artcc_id'),
    fssID: text(row, 'fss_id'),
    magneticVariation: num(row, 'magnetic_variation'),
    patternAltitude: num(row, 'pattern_altitude'),
    fuelTypes: parseFuelTypes(text(row, 'fuel_types')),
    hasBeaconLight: row.has_beacon_light === 1,
    runways,
    frequencies,
  };
}

function runwayFromRow(row: SqlRow): Runway {
  return {
    id: text(row, 'id') as string,
    length: num(row, 'length') as number,
    width: num(row, 'width') as number,
    surface: parseEnum(SURFACE_TYPES, row.surface ?? 'other', 'other'),
    lighting: parseEnum(LIGHTING_TYPES, row.lighting ?? 'none', 'none'),
    baseEndID: text(row, 'base_end_id') as string,
    reciprocalEndID: text(row, 'reciprocal_end_id') as string,
    baseEndLatitude: num(row, 'base_end_latitude') as number,
    baseEndLongitude: num(row, 'base_end_longitude') as number,
    reciprocalEndLatitude: num(row, 'reciprocal_end_latitude') as number,
    reciprocalEndLongitude: num(row, 'reciprocal_end_longitude') as number,
    baseEndElevation: null,
    reciprocalEndElevation: null,
  };
}

function frequencyFromRow(row: SqlRow): Frequency {
  return {
    id: uuidOrNew(text(row, 'id')),
    type: parseEnum(FREQUENCY_TYPES, row.type ?? 'other', 'other'),
    frequency: num(row, 'frequency') as number,
    name: text(row, 'name') as string,
  };
}

function airspaceFromRow(row: SqlRow): Airspace | null {
  const radiusNM = num(row, 'radius_nm');
  const centerLat = num(row, 'center_latitude');
  const centerLon = num(row, 'center_longitude');
  const coordinatesJSON = text(row, 'coordinates');

  let geometry: AirspaceGeometry;
  if (radiusNM !== null && radiusNM > 0 && centerLat !== null && centerLon !== null) {
    geometry = { kind: 'circle', center: [centerLat, centerLon], radiusNM };
  } else {
    const coordinates = coordinatesJSON === null ? null : parseCoordinates(coordinatesJSON);
    if (coordinates === null || coordinates.length === 0) return null;
    geometry = { kind: 'polygon', coordinates };
  }

  return {
    id: uuidOrNew(text(row, 'id')),
    classification: parseEnum(AIRSPACE_CLASSES, row.class ?? 'echo', 'echo'),
    name: text(row, 'name') ?? 'Unknown',
    floor: num(row, 'floor_altitude') ?? 0,
    ceiling: num(row, 'ceiling_altitude') ?? 18000,
    geometry,
  };
}

/** A JSON array of [lat, lon] number pairs, or null when it is anything else (Swift: decode as [[Double]]). */
function parseCoordinates(json: string): number[][] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    const ok =
      Array.isArray(parsed) &&
      parsed.every((pair) => Array.isArray(pair) && pair.every((value) => typeof value === 'number'));
    return ok ? (parsed as number[][]) : null;
  } catch {
    return null;
  }
}

function navaidFromRow(row: SqlRow): Navaid {
  return {
    id: text(row, 'id') as string,
    name: text(row, 'name') as string,
    type: parseEnum(NAVAID_TYPES, row.type ?? 'vor', 'vor'),
    latitude: num(row, 'latitude') as number,
    longitude: num(row, 'longitude') as number,
    frequency: num(row, 'frequency') as number,
    magneticVariation: num(row, 'magnetic_variation'),
    elevation: num(row, 'elevation'),
  };
}

/** `yyyy-MM-dd` as epoch ms at 00:00 UTC; null for anything that is not a real calendar date. */
function parseUtcDate(value: string | undefined): number | null {
  const match = value === undefined ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  const valid = back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
  return valid ? ms : null;
}

export function createAviationDatabase(db: Db): AviationDatabase {
  const fetchRunways = async (icao: string): Promise<Runway[]> =>
    (await db.all('SELECT * FROM runways WHERE airport_icao = ?', [icao])).map(runwayFromRow);
  const fetchFrequencies = async (icao: string): Promise<Frequency[]> =>
    (await db.all('SELECT * FROM frequencies WHERE airport_icao = ?', [icao])).map(frequencyFromRow);

  const airportsNear = async (center: Coordinate, radiusNM: number): Promise<Airport[]> => {
    const rows = await db.all(
      `SELECT a.* FROM airports a
       INNER JOIN airports_rtree r ON a.rowid = r.rowid
       WHERE ${RTREE_WHERE}`,
      boxParams(boxAround(center, radiusNM)),
    );
    return rows.map((row) => airportFromRow(row, [], []));
  };

  const airspacesNear = async (center: Coordinate, radiusNM: number): Promise<Airspace[]> => {
    const rows = await db.all(
      `SELECT a.* FROM airspaces a
       INNER JOIN airspaces_rtree r ON a.rowid = r.rowid
       WHERE ${RTREE_WHERE}`,
      boxParams(boxAround(center, radiusNM)),
    );
    return rows.flatMap((row) => airspaceFromRow(row) ?? []);
  };

  return {
    async airport(icao) {
      const row = await db.get('SELECT * FROM airports WHERE icao = ?', [icao]);
      if (row === null) return null;
      return airportFromRow(row, await fetchRunways(icao), await fetchFrequencies(icao));
    },

    async dataCycle() {
      const table = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'metadata'");
      if (table === null) return null;
      const values = new Map<string, string>();
      for (const row of await db.all('SELECT key, value FROM metadata')) {
        const key = text(row, 'key');
        const value = text(row, 'value');
        // Swift: Dictionary(uniquingKeysWith: first wins).
        if (key !== null && value !== null && !values.has(key)) values.set(key, value);
      }
      const effectiveMs = parseUtcDate(values.get('nasr_effective'));
      const expiresMs = parseUtcDate(values.get('nasr_expires'));
      if (effectiveMs === null || expiresMs === null) return null;
      return { source: values.get('source') ?? 'FAA NASR', effectiveMs, expiresMs };
    },

    airportsNear,

    async toweredAirportsNear(center, radiusNM) {
      const rows = await db.all(
        `SELECT a.* FROM airports a
         INNER JOIN airports_rtree r ON a.rowid = r.rowid
         WHERE ${RTREE_WHERE}
           AND a.type = 'airport' AND a.ownership = 'public'
           AND EXISTS (SELECT 1 FROM frequencies f
                       WHERE f.airport_icao = a.icao AND f.type = 'tower')`,
        boxParams(boxAround(center, radiusNM, 0.01)),
      );
      return rows.map((row) => airportFromRow(row, [], []));
    },

    /**
     * Searches a circle, not a box: the R-tree box covering the circle is queried, each candidate's true great-circle
     * distance is computed, and only airports inside the circle count. The radius doubles until `count` airports are
     * inside it, so a box-corner airport never outranks a closer one just outside the box.
     */
    async nearestAirports(center, count) {
      if (count <= 0) return [];
      let radiusNM = NEAREST_INITIAL_RADIUS_NM;
      let withinCircle: { airport: Airport; distanceNM: number }[] = [];
      for (;;) {
        const candidates = await airportsNear(center, radiusNM);
        withinCircle = candidates
          .map((airport) => ({
            airport,
            distanceNM: distanceNm(center, { lat: airport.latitude, lon: airport.longitude }),
          }))
          .filter((entry) => entry.distanceNM <= radiusNM);
        if (withinCircle.length >= count || radiusNM >= NEAREST_MAX_RADIUS_NM) break;
        radiusNM = Math.min(radiusNM * 2, NEAREST_MAX_RADIUS_NM);
      }
      const topN = withinCircle.sort((a, b) => a.distanceNM - b.distanceNM).slice(0, count);
      // Runways for the nearest airports (needed for the emergency HUD).
      return Promise.all(
        topN.map(async ({ airport }) => ({
          ...airport,
          runways: await fetchRunways(airport.icao),
          frequencies: await fetchFrequencies(airport.icao),
        })),
      );
    },

    async searchAirports(query, limit = 20) {
      const match = ftsMatchExpression(query);
      if (match === null) return [];
      const rows = await db.all(
        `SELECT a.* FROM airports a
         INNER JOIN airports_fts fts ON a.rowid = fts.rowid
         WHERE airports_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
        [match, limit],
      );
      return rows.map((row) => airportFromRow(row, [], []));
    },

    airspacesNear,

    async airspacesContaining(point) {
      // Swift looks 30 NM around the point, not at the point itself; kept as is (a radius of 0 would decode fewer rows,
      // a candidate optimisation once the port is characterised, see docs/port-notes/D5.md).
      const candidates = await airspacesNear(point, 30);
      return candidates.filter(({ geometry }) =>
        geometry.kind === 'polygon'
          ? pointInPolygon(point, geometry.coordinates)
          : distanceNm(point, { lat: geometry.center[0], lon: geometry.center[1] }) <= geometry.radiusNM,
      );
    },

    async navaidsNear(center, radiusNM) {
      const rows = await db.all(
        `SELECT * FROM navaids n
         INNER JOIN navaids_rtree r ON n.rowid = r.rowid
         WHERE ${RTREE_WHERE}`,
        boxParams(boxAround(center, radiusNM)),
      );
      return rows.map(navaidFromRow);
    },
  };
}
