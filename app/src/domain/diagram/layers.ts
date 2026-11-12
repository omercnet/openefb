// Airport diagram overlay as layer data (R6): a fixed pool of DIAGRAM_SLOTS slots, each a GeoJSON backing fill plus an
// image-source raster layer. Slots sit below the airport dots, above the sectional (AirportDiagramOverlay.add).
import type { LayerSpec } from '../map/layerSpec';
import { collection, polygonFeature, EMPTY_COLLECTION, type FeatureCollection } from '../map/geojson';
import {
  DIAGRAM_BACKING_OPACITY_STOPS,
  DIAGRAM_DAY_BACKING,
  DIAGRAM_MIN_ZOOM,
  DIAGRAM_NIGHT_BACKING,
  DIAGRAM_NIGHT_BRIGHTNESS,
  DIAGRAM_OPACITY,
  DIAGRAM_SLOTS,
  type DiagramOverlaySnapshot,
} from './overlayController';

export const diagramBackingSourceId = (slot: number): string => `apd-backing-${slot}`;
export const diagramImageSourceId = (slot: number): string => `apd-image-${slot}`;

/** MapLibre image sources (not GeoJSON): the surface renders these ids as `ImageSource`. */
export const DIAGRAM_IMAGE_SOURCE_IDS: readonly string[] = Array.from({ length: DIAGRAM_SLOTS }, (_, i) =>
  diagramImageSourceId(i),
);
export const DIAGRAM_BACKING_SOURCE_IDS: readonly string[] = Array.from({ length: DIAGRAM_SLOTS }, (_, i) =>
  diagramBackingSourceId(i),
);
export const DIAGRAM_SOURCE_IDS: readonly string[] = [...DIAGRAM_BACKING_SOURCE_IDS, ...DIAGRAM_IMAGE_SOURCE_IDS];

const stops = DIAGRAM_BACKING_OPACITY_STOPS.flatMap(([z, o]) => [z, o]);

export const DIAGRAM_LAYER_SPECS: readonly LayerSpec[] = Array.from({ length: DIAGRAM_SLOTS }, (_, i): LayerSpec[] => [
  {
    id: `apd-backing-layer-${i}`,
    type: 'fill',
    source: diagramBackingSourceId(i),
    layer: null,
    minzoom: DIAGRAM_MIN_ZOOM,
    paint: { 'fill-color': DIAGRAM_DAY_BACKING, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], ...stops] },
    nightPaint: { 'fill-color': DIAGRAM_NIGHT_BACKING },
  },
  {
    id: `apd-image-layer-${i}`,
    type: 'raster',
    source: diagramImageSourceId(i),
    layer: null,
    minzoom: DIAGRAM_MIN_ZOOM,
    paint: { 'raster-opacity': DIAGRAM_OPACITY },
    nightPaint: {
      'raster-brightness-min': DIAGRAM_NIGHT_BRIGHTNESS.min,
      'raster-brightness-max': DIAGRAM_NIGHT_BRIGHTNESS.max,
    },
  },
]).flat();

/** MapLibre ImageSource coordinates: [top-left, top-right, bottom-right, bottom-left] as [lon, lat]. */
export type ImageQuad = [number, number][];

export interface DiagramImageSource {
  url: string;
  coordinates: ImageQuad;
}

export interface DiagramSources {
  geojson: Record<string, FeatureCollection>;
  images: Record<string, DiagramImageSource>;
  /** Forced layer visibility by id: layers show only for an occupied slot while the overlay is visible. */
  visibility: Record<string, boolean>;
}

export function diagramSources(s: DiagramOverlaySnapshot): DiagramSources {
  const out: DiagramSources = { geojson: {}, images: {}, visibility: {} };
  for (let i = 0; i < DIAGRAM_SLOTS; i++) {
    const slot = s.slots.find((x) => x.slot === i);
    out.geojson[diagramBackingSourceId(i)] = EMPTY_COLLECTION;
    out.visibility[`apd-backing-layer-${i}`] = false;
    out.visibility[`apd-image-layer-${i}`] = false;
    if (!slot) continue;
    const c = slot.image.coordinates;
    const ring = c.map(([lon, lat]) => [lat, lon]); // polygonFeature takes [lat, lon]
    const f = polygonFeature(ring, { icao: slot.image.icao });
    out.geojson[diagramBackingSourceId(i)] = f ? collection([f]) : EMPTY_COLLECTION;
    out.images[diagramImageSourceId(i)] = { url: slot.image.imageUri, coordinates: c };
    out.visibility[`apd-backing-layer-${i}`] = s.visible;
    out.visibility[`apd-image-layer-${i}`] = s.visible;
  }
  return out;
}
