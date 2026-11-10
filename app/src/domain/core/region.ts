// Port of Core/Region.swift (pure parts). Persistence (RegionStore, SwiftData) belongs to the data layer.
import type { Coordinate } from './geometry';
import type { MapLayer, MapStyle } from './types';
import { formatAltimeter, type AltimeterUnit } from './units';

export const REGIONS = ['us', 'israel'] as const;
export type Region = (typeof REGIONS)[number];

export const DEFAULT_REGION: Region = 'israel';

export const REGION_DATA_LAYERS = [
  'sectional',
  'airports',
  'airspace',
  'navaids',
  'tfrs',
  'advisories',
  'notams',
  'airportCharts',
  'airportDiagrams',
  'pireps',
  'windsAloft',
  'cvfrRoutes',
  'cvfrPoints',
  'cvfrAirspace',
  'cvfrRunways',
  'cvfrClosures',
  'aerodromes',
  'israelDiagrams',
] as const;
export type RegionDataLayer = (typeof REGION_DATA_LAYERS)[number];

export const CVFR_CHART_DATA_LAYERS: ReadonlySet<RegionDataLayer> = new Set<RegionDataLayer>([
  'cvfrRoutes',
  'cvfrPoints',
  'cvfrAirspace',
  'cvfrRunways',
  'cvfrClosures',
]);
export const ISRAEL_ONLY_DATA_LAYERS: ReadonlySet<RegionDataLayer> = new Set<RegionDataLayer>([
  ...CVFR_CHART_DATA_LAYERS,
  'aerodromes',
  'israelDiagrams',
]);

export interface WeatherStation {
  id: string; // ICAO
  name: string;
  lat: number;
  lon: number;
  hasMetar: boolean;
  hasTaf: boolean;
}

const ISRAEL_STATIONS: readonly WeatherStation[] = [
  { id: 'LLBG', name: 'Tel Aviv / Ben Gurion', lat: 32.011, lon: 34.887, hasMetar: true, hasTaf: true },
  { id: 'LLHA', name: 'Haifa', lat: 32.809, lon: 35.043, hasMetar: true, hasTaf: true },
  { id: 'LLER', name: 'Eilat / Ramon', lat: 29.722, lon: 35.012, hasMetar: true, hasTaf: true },
  { id: 'LLIB', name: 'Rosh Pina', lat: 32.981, lon: 35.572, hasMetar: true, hasTaf: true },
  { id: 'LLHZ', name: 'Herzliya', lat: 32.181, lon: 34.835, hasMetar: false, hasTaf: true },
];

/** Parse a stored raw value; anything unknown reads as the default region (RegionStore behaviour). */
export function parseRegion(raw: string | null | undefined): Region {
  return (REGIONS as readonly string[]).includes(raw ?? '') ? (raw as Region) : DEFAULT_REGION;
}

export function regionDisplayName(r: Region): string {
  return r === 'us' ? 'United States' : 'Israel';
}

/** The US has no bounding box: everything is inside. Israel is a lat/lon box. */
export function regionContains(r: Region, c: Coordinate): boolean {
  if (r === 'us') return true;
  return c.lat >= 29.0 && c.lat <= 33.6 && c.lon >= 33.8 && c.lon <= 36.2;
}

export function regionDefaultCenter(r: Region): Coordinate {
  return r === 'us' ? { lat: 39.0, lon: -98.0 } : { lat: 32.0, lon: 34.9 };
}

export function regionDefaultZoom(r: Region): number {
  return r === 'us' ? 5.0 : 6.7;
}

export function regionAltimeterUnit(r: Region): AltimeterUnit {
  return r === 'us' ? 'inHg' : 'hPa';
}

export function weatherStations(r: Region): readonly WeatherStation[] {
  return r === 'us' ? [] : ISRAEL_STATIONS;
}

export const metarStationIds = (r: Region): string[] =>
  weatherStations(r)
    .filter((s) => s.hasMetar)
    .map((s) => s.id);
export const tafStationIds = (r: Region): string[] =>
  weatherStations(r)
    .filter((s) => s.hasTaf)
    .map((s) => s.id);

export function weatherStation(r: Region, id: string): WeatherStation | undefined {
  const key = id.toUpperCase();
  return weatherStations(r).find((s) => s.id === key);
}

export function availableLayers(r: Region): ReadonlySet<RegionDataLayer> {
  if (r === 'israel') return ISRAEL_ONLY_DATA_LAYERS;
  return new Set(REGION_DATA_LAYERS.filter((l) => !ISRAEL_ONLY_DATA_LAYERS.has(l)));
}

export const isLayerAvailable = (r: Region, layer: RegionDataLayer): boolean => availableLayers(r).has(layer);

export function regionSupports(r: Region, layer: MapLayer): boolean {
  switch (layer) {
    case 'weatherDots':
    case 'route':
    case 'ownship':
      return true;
    case 'lsaRoutes': // the LSA network ships in the same Israel database
      return isLayerAvailable(r, 'cvfrRoutes');
    default:
      return isLayerAvailable(r, layer);
  }
}

export const unavailableReason = (r: Region): string => `Not available in ${regionDisplayName(r)} yet`;

export const hasAirportData = (r: Region): boolean =>
  isLayerAvailable(r, 'airports') || isLayerAvailable(r, 'aerodromes');

export const availableMapStyles = (_r: Region): MapStyle[] => ['street'];

export function fallbackDataAttribution(r: Region): string {
  return r === 'us'
    ? 'Aeronautical data: FAA NASR. Weather: NOAA Aviation Weather Center.'
    : 'Aeronautical data: Civil Aviation Authority of Israel (CAAI)';
}

export const formattedAltimeter = (r: Region, hPa: number): string => formatAltimeter(hPa, regionAltimeterUnit(r));
