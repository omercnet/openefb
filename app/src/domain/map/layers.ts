// The core map layers as data: sources and layer specs in draw order, bottom to top. Order and paints follow
// MapService.onStyleLoaded (ownship first, then airports, navaids, airspace, weather, TFRs; advisories, the track ruler
// and the route sit below ownship via insertLayer, so here they come before it). Israel overlays add their own
// registry (domain/map/israel) which the surface appends. Colours are the iOS system colours the SwiftUI app used.
import type { LayerSpec } from './layerSpec';

export const MAP_COLORS = {
  ownship: '#007AFF', // systemBlue
  ownshipStale: '#8E8E93', // systemGray
  airspace: '#007AFF',
  weatherDot: '#34C759', // systemGreen
  tfr: '#FF3B30', // systemRed
  airportDay: '#32ADE6', // systemCyan
  airportNight: '#388C9E', // NightPalette.airportDot
  navaidDay: '#AF52DE', // systemPurple
  navaidNight: '#73529E', // NightPalette.navaidDot
  dotRing: '#141414', // white 0.08
  routeDay: '#D100D1', // Palette.routeLineDay
  routeNight: '#F26BF2', // Palette.routeLineNight
  rulerDay: '#14191F',
  rulerNight: '#B6B0A3',
  rulerHaloDay: '#FFFFFF',
  rulerHaloNight: '#0D1013',
} as const;

export const NIGHT_RASTER = { 'raster-brightness-max': 0.55, 'raster-saturation': -0.35 } as const;

export const SOURCE_IDS = [
  'advisories',
  'track-ruler-line',
  'track-ruler-ticks',
  'ownship',
  'airports',
  'navaids',
  'airspaces',
  'weather-dots',
  'tfrs',
  'route-line',
] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const OWNSHIP_LIVE_ICON = 'ownship-chevron';
export const OWNSHIP_STALE_ICON = 'ownship-chevron-stale';
export const TRACK_RULER_TICK_ICON = 'track-ruler-tick';
const FONT = ['Noto Sans Regular'];

export const CORE_LAYER_SPECS: readonly LayerSpec[] = [
  {
    id: 'advisory-fill',
    type: 'fill',
    source: 'advisories',
    layer: 'advisories',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] },
  },
  {
    id: 'advisory-border',
    type: 'line',
    source: 'advisories',
    layer: 'advisories',
    filter: ['==', ['get', 'stale'], 0],
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [4, 2] },
  },
  {
    id: 'advisory-border-stale',
    type: 'line',
    source: 'advisories',
    layer: 'advisories',
    filter: ['==', ['get', 'stale'], 1],
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [1, 3] },
  },
  {
    id: 'track-ruler-line',
    type: 'line',
    source: 'track-ruler-line',
    layer: null,
    paint: { 'line-color': MAP_COLORS.rulerDay, 'line-width': 2 },
    nightPaint: { 'line-color': MAP_COLORS.rulerNight },
  },
  {
    id: 'track-ruler-ticks',
    type: 'symbol',
    source: 'track-ruler-ticks',
    layer: null,
    layout: {
      'icon-image': TRACK_RULER_TICK_ICON,
      'icon-rotate': ['get', 'track'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['get', 'label'],
      'text-font': FONT,
      'text-size': 12,
      'text-anchor': ['get', 'anchor'],
      'text-offset': [0.7, 0.7],
      'text-allow-overlap': true,
    },
    paint: {
      'icon-color': MAP_COLORS.rulerDay,
      'text-color': MAP_COLORS.rulerDay,
      'text-halo-color': MAP_COLORS.rulerHaloDay,
      'text-halo-width': 1.5,
    },
    nightPaint: {
      'icon-color': MAP_COLORS.rulerNight,
      'text-color': MAP_COLORS.rulerNight,
      'text-halo-color': MAP_COLORS.rulerHaloNight,
    },
  },
  {
    id: 'ownship-symbol',
    type: 'symbol',
    source: 'ownship',
    layer: 'ownship',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': 1,
    },
  },
  {
    id: 'airport-circles',
    type: 'circle',
    source: 'airports',
    layer: 'airports',
    paint: {
      'circle-radius': 6.5,
      'circle-color': MAP_COLORS.airportDay,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': MAP_COLORS.dotRing,
      'circle-opacity': 1,
    },
    nightPaint: { 'circle-color': MAP_COLORS.airportNight },
  },
  {
    id: 'navaid-circles',
    type: 'circle',
    source: 'navaids',
    layer: 'navaids',
    paint: {
      'circle-radius': 5,
      'circle-color': MAP_COLORS.navaidDay,
      'circle-stroke-width': 2,
      'circle-stroke-color': MAP_COLORS.dotRing,
    },
    nightPaint: { 'circle-color': MAP_COLORS.navaidNight },
  },
  {
    id: 'airspace-fill',
    type: 'fill',
    source: 'airspaces',
    layer: 'airspace',
    paint: { 'fill-color': MAP_COLORS.airspace, 'fill-opacity': 0.1 },
  },
  {
    id: 'airspace-border',
    type: 'line',
    source: 'airspaces',
    layer: 'airspace',
    paint: { 'line-color': MAP_COLORS.airspace, 'line-width': 2 },
  },
  {
    id: 'airspace-labels',
    type: 'symbol',
    source: 'airspaces',
    layer: 'airspace',
    layout: { 'text-field': ['get', 'label'], 'text-font': FONT, 'text-size': 10, 'text-allow-overlap': false },
    paint: { 'text-color': '#3C3C4399' }, // secondaryLabel
  },
  {
    id: 'weather-circles',
    type: 'circle',
    source: 'weather-dots',
    layer: 'weatherDots',
    paint: {
      'circle-radius': 8,
      'circle-stroke-width': 1,
      'circle-stroke-color': '#FFFFFF',
      // Swift draws every dot green (its TODO: data-driven VFR/MVFR/IFR/LIFR colours); parity kept, see port notes.
      'circle-color': MAP_COLORS.weatherDot,
    },
  },
  {
    id: 'tfr-fill',
    type: 'fill',
    source: 'tfrs',
    layer: 'tfrs',
    paint: { 'fill-color': MAP_COLORS.tfr, 'fill-opacity': ['get', 'opacity'] },
  },
  {
    id: 'tfr-border',
    type: 'line',
    source: 'tfrs',
    layer: 'tfrs',
    filter: ['==', ['get', 'stale'], 0],
    paint: { 'line-color': MAP_COLORS.tfr, 'line-width': 2 },
  },
  {
    id: 'tfr-border-stale',
    type: 'line',
    source: 'tfrs',
    layer: 'tfrs',
    filter: ['==', ['get', 'stale'], 1],
    paint: { 'line-color': MAP_COLORS.tfr, 'line-width': 2, 'line-dasharray': [2, 2] },
  },
  {
    id: 'route-line-layer',
    type: 'line',
    source: 'route-line',
    layer: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': MAP_COLORS.routeDay, 'line-width': 3 },
    nightPaint: { 'line-color': MAP_COLORS.routeNight },
  },
];
