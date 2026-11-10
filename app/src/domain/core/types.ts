// Navigation vocabulary shared by state and UI (port of Core/Types.swift StripColumn).

/** What the strip column beside the chart shows. The flight log by default. */
export type StripColumnKind = 'log' | 'airport' | 'nearest' | 'layers' | 'search';

/** Base map style (port of MapStyle). */
export const MAP_STYLES = ['vfrSectional', 'street'] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

/** Toggleable map layers (port of MapLayer). */
export const MAP_LAYERS = [
  'sectional',
  'airports',
  'airspace',
  'tfrs',
  'advisories',
  'weatherDots',
  'navaids',
  'route',
  'ownship',
  'cvfrRoutes',
  'cvfrPoints',
  'cvfrAirspace',
  'cvfrRunways',
  'cvfrClosures',
  'lsaRoutes',
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

export const CVFR_CHART_LAYERS: readonly MapLayer[] = [
  'cvfrRoutes',
  'cvfrPoints',
  'cvfrAirspace',
  'cvfrRunways',
  'cvfrClosures',
];

export const isCvfrChartLayer = (layer: MapLayer): boolean => CVFR_CHART_LAYERS.includes(layer);
