// The Israel overlays as map data (plan risk R6): sources and layer specs from IsraelChartOverlay.swift (add*Layers,
// applyPalette, applyOfficial), IsraelLSAOverlay.swift, IsraelBriefingMapHighlight.swift and
// IsraelOfficialChartLayer.swift. Draw order bottom to top is the Swift insertion order: airspace, runways, aerodromes,
// routes, closures, points, then the LSA network and the briefing highlight (both added on top in Swift). Swift drew
// labels and point symbols as UIKit sprites; here labels are `text-field` symbols in 'Noto Sans Regular' (the only
// glyph stack in assets/base-style.json) and point symbols are circles.
import type {
  IsraelAerodrome,
  IsraelAirspace,
  IsraelReportingPoint,
  IsraelRouteSegment,
  IsraelRunway,
} from '../../../data/aviation/israelTypes';
import type { IsraelAviationDatabase } from '../../../data/aviation/israelDatabase';
import { AIRSPACE_KINDS, WHOLE_COUNTRY } from '../../../data/aviation/israelTypes';
import type { Coordinate, MapLayer } from '../../core';
import { collection, EMPTY_COLLECTION, point, type Feature, type FeatureCollection, type Position } from '../geojson';
import type { LayerSpec, StyleValue } from '../layerSpec';
import { NIGHT_RASTER } from '../layers';
import {
  aerodromeLabel,
  aerodromesWithoutPoint,
  airspaceFeatures,
  pointFeatures,
  runwayFeatures,
  segmentFeatures,
  type IsraelChartSegmentFeature,
} from './chartFeatures';
import { closureFeatures, type IsraelChartClosureMark } from './closures';
import {
  ISRAEL_DAY_PALETTE,
  ISRAEL_NIGHT_PALETTE,
  LABEL_FONT_SIZE,
  israelPalette,
  symbolForAerodromeType,
  symbolForPointKind,
  type IsraelChartPalette,
} from './style';

export const ISRAEL_SOURCE_IDS: string[] = [
  'il-airspace',
  'il-airspace-labels',
  'il-runways',
  'il-aerodromes',
  'il-routes',
  'il-route-labels',
  'il-closures',
  'il-closure-labels',
  'il-points',
  'il-lsa-routes',
  'il-lsa-points',
  'il-brief-highlight',
];

/** Swift Zoom: below these the chart thins out so labels never pile up. */
const ZOOM = {
  altitudeLabels: 9,
  compulsoryIcons: 7,
  compulsoryLabels: 9,
  requestIcons: 9,
  requestLabels: 10.5,
  arpLabels: 8.5,
  tmaLabels: 7.5,
  airspaceLabels: 8.5,
  runways: 9,
  lsaPoints: 8.5,
  lsaLabels: 10,
} as const;

const FONT = ['Noto Sans Regular'];
/** Purple: not used by the CVFR chart (IsraelLSAOverlay.routeColor). */
const LSA_ROUTE_COLOR = '#8C38C7';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
/** Swift iconOffset was in points; text-offset is in ems of the label's font size. */
const POINT_LABEL_OFFSET = [0, 9 / LABEL_FONT_SIZE.pointCode];
const CLOSURE_LABEL_OFFSET = [0, -13 / LABEL_FONT_SIZE.closure];

const zoomStops = (...stops: number[]): StyleValue[] => ['interpolate', ['linear'], ['zoom'], ...stops];
const eq = (key: string, value: StyleValue): StyleValue[] => ['==', ['get', key], value];
const ne = (key: string, value: StyleValue): StyleValue[] => ['!=', ['get', key], value];

/** A spec whose colours come from the palette: `paint` from the day palette, `nightPaint` from the night one. */
function themed(
  spec: Omit<LayerSpec, 'paint' | 'nightPaint'>,
  paint: (p: IsraelChartPalette) => Record<string, StyleValue>,
  fixed: Record<string, StyleValue> = {},
): LayerSpec {
  return { ...spec, paint: { ...fixed, ...paint(ISRAEL_DAY_PALETTE) }, nightPaint: paint(ISRAEL_NIGHT_PALETTE) };
}

function label(
  id: string,
  source: string,
  layer: MapLayer,
  layout: Record<string, StyleValue>,
  color: (p: IsraelChartPalette) => StyleValue,
  extra: Partial<LayerSpec> = {},
): LayerSpec {
  return themed(
    { id, type: 'symbol', source, layer, ...extra, layout: { 'text-font': FONT, ...layout } },
    (p) => ({ 'text-color': color(p), 'text-halo-color': p.labelHalo }),
    { 'text-halo-width': 1.5 },
  );
}

const circleSymbol = (id: string, source: string, minzoom: number, filter?: StyleValue[]): LayerSpec =>
  themed(
    { id, type: 'circle', source, layer: 'cvfrPoints', minzoom, ...(filter ? { filter } : {}) },
    (p) => ({
      'circle-color': ['match', ['get', 'symbol'], 'compulsory', p.symbol, TRANSPARENT],
      'circle-stroke-color': p.symbol,
    }),
    {
      'circle-radius': ['match', ['get', 'symbol'], 'aerodrome', 5.5, 'airstrip', 4, 'heliport', 6, 5],
      'circle-stroke-width': ['match', ['get', 'symbol'], 'heliport', 1.8, 2.2],
    },
  );

const routeWidth = zoomStops(6, 1.6, 9, 2.6, 13, 4.5);
const roundLine = { 'line-cap': 'round', 'line-join': 'round' };

const lsaRoute = (id: string, filter: StyleValue[], dash: number[] | null): LayerSpec => ({
  id,
  type: 'line',
  source: 'il-lsa-routes',
  layer: 'lsaRoutes',
  filter,
  layout: roundLine,
  paint: {
    'line-color': LSA_ROUTE_COLOR,
    'line-width': zoomStops(6, 1.4, 9, 2.4, 13, 4.0),
    'line-opacity': 0.9,
    ...(dash ? { 'line-dasharray': dash } : {}),
  },
});

export const ISRAEL_LAYER_SPECS: LayerSpec[] = [
  // Airspace (addAreaLayers)
  themed(
    {
      id: 'il-as-fill-civil',
      type: 'fill',
      source: 'il-airspace',
      layer: 'cvfrAirspace',
      filter: eq('restricted', false),
    },
    (p) => ({ 'fill-color': p.airspace, 'fill-opacity': p.airspaceFillOpacity }),
  ),
  themed(
    {
      id: 'il-as-line-civil',
      type: 'line',
      source: 'il-airspace',
      layer: 'cvfrAirspace',
      filter: eq('restricted', false),
      layout: { 'line-join': 'round' },
    },
    (p) => ({ 'line-color': p.airspace }),
    { 'line-width': 1.6, 'line-dasharray': [4, 2] },
  ),
  themed(
    {
      id: 'il-as-fill-restricted',
      type: 'fill',
      source: 'il-airspace',
      layer: 'cvfrAirspace',
      filter: eq('restricted', true),
    },
    (p) => ({ 'fill-color': p.restricted, 'fill-opacity': p.airspaceFillOpacity + 0.05 }),
  ),
  themed(
    {
      id: 'il-as-line-restricted',
      type: 'line',
      source: 'il-airspace',
      layer: 'cvfrAirspace',
      filter: eq('restricted', true),
      layout: { 'line-join': 'round' },
    },
    (p) => ({ 'line-color': p.restricted }),
    { 'line-width': 2.0 },
  ),
  ...(
    [
      ['il-as-labels-tma', eq('kind', 'TMA'), ZOOM.tmaLabels],
      ['il-as-labels-other', ne('kind', 'TMA'), ZOOM.airspaceLabels],
    ] as const
  ).map(([id, filter, minzoom]) =>
    label(
      id,
      'il-airspace-labels',
      'cvfrAirspace',
      {
        'text-field': ['get', 'label'],
        'text-size': LABEL_FONT_SIZE.airspace,
        'text-allow-overlap': false,
        'text-padding': 4,
      },
      (p) => ['case', ['get', 'restricted'], p.restricted, p.airspace],
      { filter: [...filter], minzoom },
    ),
  ),
  // Runways
  themed(
    {
      id: 'il-runway-lines',
      type: 'line',
      source: 'il-runways',
      layer: 'cvfrRunways',
      minzoom: ZOOM.runways,
      layout: { 'line-cap': 'butt' },
    },
    (p) => ({ 'line-color': p.runway }),
    { 'line-width': zoomStops(9, 2.5, 12, 4.5, 15, 8) },
  ),
  // Aerodromes (IL-4)
  circleSymbol('il-aerodrome-icons', 'il-aerodromes', ZOOM.requestIcons),
  label(
    'il-aerodrome-labels',
    'il-aerodromes',
    'cvfrPoints',
    {
      'text-field': ['get', 'label'],
      'text-size': LABEL_FONT_SIZE.pointCode,
      'text-anchor': 'top',
      'text-offset': POINT_LABEL_OFFSET,
      'text-allow-overlap': false,
      'text-padding': 2,
    },
    (p) => p.labelText,
    { minzoom: ZOOM.requestLabels },
  ),
  // Routes
  ...(
    [
      ['il-route-civil', 'civil'],
      ['il-route-request', 'byRequest'],
      ['il-route-military', 'military'],
    ] as const
  ).map(([id, style]) =>
    themed(
      { id, type: 'line', source: 'il-routes', layer: 'cvfrRoutes', filter: eq('style', style), layout: roundLine },
      (p) => ({ 'line-color': style === 'military' ? p.militaryRoute : p.civilRoute }),
      { 'line-width': routeWidth, ...(style === 'byRequest' ? { 'line-dasharray': [2.2, 1.6] } : {}) },
    ),
  ),
  label(
    'il-route-alt-labels',
    'il-route-labels',
    'cvfrRoutes',
    {
      'text-field': ['get', 'label'],
      'text-size': LABEL_FONT_SIZE.altitude,
      'text-rotate': ['get', 'rot'],
      'text-rotation-alignment': 'map',
      'text-allow-overlap': false,
      'text-padding': 3,
    },
    (p) => ['case', ['get', 'military'], p.militaryText, p.altitudeText],
    { minzoom: ZOOM.altitudeLabels },
  ),
  // Closures: a wide dashed casing reads as "struck through"; red when full, amber when partial or unread.
  ...(
    [
      ['il-closure-casing', eq('sev', 'full'), (p: IsraelChartPalette) => p.closure],
      ['il-closure-caution-casing', ne('sev', 'full'), (p: IsraelChartPalette) => p.restricted],
    ] as const
  ).map(([id, filter, color]) =>
    themed(
      {
        id,
        type: 'line',
        source: 'il-closures',
        layer: 'cvfrClosures',
        filter: [...filter],
        layout: { 'line-cap': 'butt' },
      },
      (p) => ({ 'line-color': color(p) }),
      { 'line-width': zoomStops(6, 4, 9, 6, 13, 9), 'line-dasharray': [1.2, 1.0] },
    ),
  ),
  label(
    'il-closure-label-symbols',
    'il-closure-labels',
    'cvfrClosures',
    {
      'text-field': ['get', 'label'],
      'text-size': LABEL_FONT_SIZE.closure,
      'text-rotate': ['get', 'rot'],
      'text-rotation-alignment': 'map',
      // A closure must never be hidden by label collision.
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-offset': CLOSURE_LABEL_OFFSET,
    },
    (p) => ['case', ['==', ['get', 'sev'], 'full'], p.closureText, p.restricted],
  ),
  // Points
  circleSymbol('il-point-icons', 'il-points', ZOOM.compulsoryIcons, ne('kind', 'onRequest')),
  circleSymbol('il-point-icons-request', 'il-points', ZOOM.requestIcons, eq('kind', 'onRequest')),
  ...(
    [
      ['il-point-labels-compulsory', 'compulsory', ZOOM.compulsoryLabels],
      ['il-point-labels-request', 'onRequest', ZOOM.requestLabels],
      ['il-point-labels-arp', 'arp', ZOOM.arpLabels],
    ] as const
  ).map(([id, kind, minzoom]) =>
    label(
      id,
      'il-points',
      'cvfrPoints',
      {
        'text-field': ['get', 'code'],
        'text-size': LABEL_FONT_SIZE.pointCode,
        'text-anchor': 'top',
        'text-offset': POINT_LABEL_OFFSET,
        'text-allow-overlap': false,
        'text-padding': 2,
      },
      (p) => p.labelText,
      { filter: eq('kind', kind), minzoom },
    ),
  ),
  // LSA network (IsraelLSAOverlay); no night palette in Swift.
  lsaRoute('il-lsa-route-allweek', eq('activity', 'all_week'), null),
  lsaRoute('il-lsa-route-weekend', eq('activity', 'weekend'), [3, 2]),
  lsaRoute('il-lsa-route-other', ['all', ne('activity', 'all_week'), ne('activity', 'weekend')], [0.6, 2]),
  {
    id: 'il-lsa-point-circles',
    type: 'circle',
    source: 'il-lsa-points',
    layer: 'lsaRoutes',
    minzoom: ZOOM.lsaPoints,
    paint: {
      'circle-radius': 3.5,
      'circle-color': LSA_ROUTE_COLOR,
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 1.2,
    },
  },
  {
    id: 'il-lsa-point-labels',
    type: 'symbol',
    source: 'il-lsa-points',
    layer: 'lsaRoutes',
    minzoom: ZOOM.lsaLabels,
    layout: {
      'text-field': ['get', 'code'],
      'text-font': FONT,
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
    },
    paint: { 'text-color': LSA_ROUTE_COLOR, 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 },
  },
  // Briefing highlight: not gated by a layer toggle (Swift drew it whenever "Show on map" was tapped).
  {
    id: 'il-brief-highlight-fill',
    type: 'fill',
    source: 'il-brief-highlight',
    layer: null,
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.22 },
  },
  {
    id: 'il-brief-highlight-line',
    type: 'line',
    source: 'il-brief-highlight',
    layer: null,
    layout: roundLine,
    paint: { 'line-color': ['get', 'color'], 'line-width': 4 },
  },
];

// MARK: Official chart (IsraelOfficialChartLayer, IsraelChartOverlay.applyOfficial)

/**
 * The official CAAI chart raster. Not in ISRAEL_LAYER_SPECS: it is not toggle-gated (shown whenever a pack is
 * installed) and sits above the street base but below every flight layer, so the surface inserts it there.
 */
export const ISRAEL_OFFICIAL_CHART_SOURCE_ID = 'israel-official-chart-source';
export const ISRAEL_OFFICIAL_CHART_LAYER: LayerSpec = {
  id: 'israel-official-chart',
  type: 'raster',
  source: ISRAEL_OFFICIAL_CHART_SOURCE_ID,
  layer: null,
  paint: { 'raster-brightness-max': 1, 'raster-saturation': 0 },
  nightPaint: { ...NIGHT_RASTER },
};

/** `mbtiles:///absolute/path`, percent-encoded like Swift's urlPathAllowed (Application Support has a space). */
export const israelOfficialChartUrl = (absolutePath: string): string =>
  `mbtiles://${encodeURI(absolutePath).replace(/\?/g, '%3F').replace(/#/g, '%23')}`;

export interface IsraelLayerOverrides {
  /** Layer id -> forced visibility (wins over the toggle). */
  visibility: Record<string, boolean>;
  /** Layer id -> paint merged over the spec's (day or night) paint. */
  paint: Record<string, Record<string, StyleValue>>;
}

/**
 * IsraelChartOverlay.applyOfficial. With the official chart as base, it already prints routes, points and airspace:
 * airspace fills stay as near-invisible tap targets even when their toggle is off, point and aerodrome symbols are
 * near-invisible tap targets, and point labels are hidden. Without it, nothing is overridden.
 */
export function israelOfficialChartOverrides(
  present: boolean,
  visible: ReadonlySet<MapLayer>,
  night: boolean,
): IsraelLayerOverrides {
  const out: IsraelLayerOverrides = { visibility: {}, paint: {} };
  if (!present) return out;
  const p = israelPalette(night);
  const airspaceOn = visible.has('cvfrAirspace');
  for (const [id, base] of [
    ['il-as-fill-civil', p.airspaceFillOpacity],
    ['il-as-fill-restricted', p.airspaceFillOpacity + 0.05],
  ] as const) {
    out.visibility[id] = true;
    out.paint[id] = { 'fill-opacity': airspaceOn ? base : 0.01 };
  }
  for (const id of ['il-point-icons', 'il-point-icons-request', 'il-aerodrome-icons']) {
    out.paint[id] = { 'circle-opacity': 0.02, 'circle-stroke-opacity': 0.02 };
  }
  for (const id of [
    'il-point-labels-compulsory',
    'il-point-labels-request',
    'il-point-labels-arp',
    'il-aerodrome-labels',
  ]) {
    out.visibility[id] = false;
  }
  return out;
}

// MARK: Sources

/** Already-loaded Israel rows (IsraelChartData) plus closure and LSA data. */
export interface IsraelChartInput {
  /** CVFR network points and segments. */
  points: readonly IsraelReportingPoint[];
  segments: readonly IsraelRouteSegment[];
  airspaces: readonly IsraelAirspace[];
  runways: readonly IsraelRunway[];
  aerodromes: readonly IsraelAerodrome[];
  /** Drawn closures (IsraelChartClosureSet.marks); none when absent. */
  closureMarks?: ReadonlyMap<number, IsraelChartClosureMark>;
  /** The LSA network; empty sources when absent (Swift installs it only while shown). */
  lsa?: { points: readonly IsraelReportingPoint[]; segments: readonly IsraelRouteSegment[] };
}

/** IsraelChartData.load: every CVFR row the chart draws, FIR and foreign aerodromes excluded. */
export async function loadIsraelChartInput(db: IsraelAviationDatabase): Promise<IsraelChartInput> {
  const points = await db.reportingPoints(WHOLE_COUNTRY);
  const segments = await db.routeSegments(WHOLE_COUNTRY);
  const airspaces: IsraelAirspace[] = [];
  for (const kind of AIRSPACE_KINDS) if (kind !== 'FIR') airspaces.push(...(await db.airspacesOfKind(kind)));
  const runways = await db.runwaysIn(WHOLE_COUNTRY);
  const aerodromes = (await db.aerodromesIn(WHOLE_COUNTRY)).filter((a) => a.use !== 'foreign');
  return { points, segments, airspaces, runways, aerodromes };
}

const pos = (c: Coordinate): Position => [c.lon, c.lat];
const line = (coords: readonly Coordinate[], properties: Feature['properties']): Feature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords.map(pos) },
  properties,
});
/** GeoJSON ring, closed explicitly (MapLibre native closed it implicitly). */
function ring(coords: readonly Coordinate[]): Position[] {
  const out = coords.map(pos);
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) out.push(first);
  return out;
}

/** The two closure sources (Swift applyClosures). */
export function israelClosureSources(
  segments: readonly IsraelChartSegmentFeature[],
  marks: ReadonlyMap<number, IsraelChartClosureMark>,
): Record<string, FeatureCollection> {
  const features = closureFeatures(segments, marks);
  return {
    'il-closures': collection(features.map((f) => line(f.polyline, { sev: f.mark.severity }))),
    'il-closure-labels': collection(
      features.map((f) =>
        point(f.labelCoordinate.lat, f.labelCoordinate.lon, {
          label: f.mark.text,
          sev: f.mark.severity,
          rot: f.rotationDegrees,
        }),
      ),
    ),
  };
}

/** The LSA sources (IsraelLSAOverlay.install). */
export function israelLSASources(lsa: IsraelChartInput['lsa']): Record<string, FeatureCollection> {
  if (lsa === undefined) return { 'il-lsa-routes': EMPTY_COLLECTION, 'il-lsa-points': EMPTY_COLLECTION };
  return {
    'il-lsa-routes': collection(
      lsa.segments
        .filter((s) => s.polyline.length >= 2)
        .map((s) => line(s.polyline, { id: s.id, activity: s.activity })),
    ),
    'il-lsa-points': collection(lsa.points.map((p) => point(p.latitude, p.longitude, { code: p.code, kind: p.kind }))),
  };
}

/** Every Israel source keyed by ISRAEL_SOURCE_IDS. The briefing highlight is empty; see israelBriefingHighlightSource. */
export function buildIsraelSources(input: IsraelChartInput): Record<string, FeatureCollection> {
  const areas: Feature[] = [];
  const areaLabels: Feature[] = [];
  for (const f of airspaceFeatures(input.airspaces)) {
    for (const polygon of f.polygons) {
      const outer = polygon[0];
      if (outer === undefined || outer.length < 3) continue;
      const holes = polygon.slice(1).filter((r) => r.length >= 3);
      areas.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring(outer), ...holes.map(ring)] },
        properties: { id: f.id, kind: f.kind, restricted: f.isRestricted },
      });
    }
    const text = f.limits === '' ? f.title : `${f.title}\n${f.limits}`;
    areaLabels.push(
      point(f.labelCoordinate.lat, f.labelCoordinate.lon, { label: text, kind: f.kind, restricted: f.isRestricted }),
    );
  }

  const segments = segmentFeatures(input.segments);
  const routeLabels: Feature[] = [];
  for (const s of segments) {
    if (s.label === null) continue;
    const { coordinate, text, rotationDegrees } = s.label;
    routeLabels.push(
      point(coordinate.lat, coordinate.lon, { label: text, rot: rotationDegrees, military: s.style === 'military' }),
    );
  }

  return {
    'il-airspace': collection(areas),
    'il-airspace-labels': collection(areaLabels),
    'il-runways': collection(
      runwayFeatures(input.runways).map((r) => line([r.endA, r.endB], { aerodrome: r.aerodrome ?? '' })),
    ),
    'il-aerodromes': collection(
      aerodromesWithoutPoint(input.aerodromes, input.points).map((a) =>
        point(a.latitude, a.longitude, {
          code: a.code,
          symbol: symbolForAerodromeType(a.type),
          label: aerodromeLabel(a),
        }),
      ),
    ),
    'il-routes': collection(segments.map((s) => line(s.polyline, { id: s.id, style: s.style }))),
    'il-route-labels': collection(routeLabels),
    ...israelClosureSources(segments, input.closureMarks ?? new Map()),
    'il-points': collection(
      pointFeatures(input.points).map((p) =>
        point(p.coordinate.lat, p.coordinate.lon, {
          id: p.id,
          code: p.code,
          kind: p.kind,
          symbol: symbolForPointKind(p.kind),
        }),
      ),
    ),
    ...israelLSASources(input.lsa),
    'il-brief-highlight': EMPTY_COLLECTION,
  };
}
