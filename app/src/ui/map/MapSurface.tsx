// Production native map surface: MapLibre React Native v11 with the SwiftUI app's base-style.json (street vector map plus
// the FAA VFR sectional, shown at runtime), and every flight-data layer rendered from the layer registry
// (src/domain/map/layers.ts and the Israel registry). Risk R6: layers are DATA. The surface maps the registry with one
// loop, so the React child count is fixed (one source per registry source, one layer per spec) whatever is on screen.
// The surface is presentational: data comes from MapDataController (hooks in useMapData.ts), camera moves from the
// camera reducer, and navigation is wired by I1.
import { Camera, GeoJSONSource, Images, Layer, Map, type CameraRef, type MapRef } from '@maplibre/maplibre-react-native';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Coordinate, MapLayer, Region } from '../../domain/core';
import type { CameraCommand } from '../../domain/map/camera';
import { EMPTY_COLLECTION, type FeatureCollection } from '../../domain/map/geojson';
import { isLayerVisible, type LayerSpec } from '../../domain/map/layerSpec';
import { OWNSHIP_LIVE_ICON, OWNSHIP_STALE_ICON, TRACK_RULER_TICK_ICON } from '../../domain/map/layers';
import { PROBED_LAYERS, useMapStatus } from './mapStatus';
import { groupBySource, styleFor } from './surfaceModel';

/** What the surface tells its owner about the viewport. `userInteraction` is true for finger gestures. */
export interface MapViewChange {
  center: Coordinate;
  zoom: number;
  bearing: number;
  northEast: Coordinate;
  southWest: Coordinate;
  userInteraction: boolean;
  animated: boolean;
}

export interface MapSurfaceProps {
  night: boolean;
  /** Runtime visibility of the FAA sectional (MapService.setMapStyle sectional flag). */
  sectional: boolean;
  region: Region;
  visibleLayers: ReadonlySet<MapLayer>;
  /** Layer registry in draw order (core + Israel). Sources used by the specs are rendered, in first-use order. */
  layers: readonly LayerSpec[];
  /** GeoJSON per source id; a missing id draws nothing. */
  sources: Readonly<Record<string, FeatureCollection>>;
  initialView: { center: Coordinate; zoom: number };
  /** Applied when `seq` changes; null means no pending move. */
  camera: { seq: number; command: CameraCommand | null };
  onViewChange?: (change: MapViewChange) => void;
  onStyleLoaded?: () => void;
}

type AnyLayerProps = Parameters<typeof Layer>[0];

const LayerFromSpec = memo(function LayerFromSpec({ spec, visible, night }: { spec: LayerSpec; visible: boolean; night: boolean }) {
  const props = {
    id: spec.id,
    type: spec.type,
    ...(spec.minzoom === undefined ? {} : { minzoom: spec.minzoom }),
    ...(spec.maxzoom === undefined ? {} : { maxzoom: spec.maxzoom }),
    ...(spec.filter ? { filter: spec.filter } : {}),
    paint: night && spec.nightPaint ? { ...spec.paint, ...spec.nightPaint } : spec.paint,
    layout: { ...spec.layout, visibility: visible ? 'visible' : 'none' },
  };
  return <Layer {...(props as unknown as AnyLayerProps)} />;
});

export function MapSurface({
  night,
  sectional,
  region,
  visibleLayers,
  layers,
  sources,
  initialView,
  camera,
  onViewChange,
  onStyleLoaded,
}: MapSurfaceProps) {
  const mapRef = useRef<MapRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const mapStyle = useMemo(() => styleFor(night, sectional), [night, sectional]);
  const groups = useMemo(() => groupBySource(layers), [layers]);
  const reporter = useMapStatus(night);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Imperative camera moves from the reducer. Each `seq` is applied once.
  // A command is only dropped once it was handed to the Camera: one that arrives before the ref exists (or before the
  // map loaded) stays pending and is flushed on the next effect run or when the map finishes loading.
  const pending = useRef<{ seq: number; command: CameraCommand } | null>(null);
  const appliedSeq = useRef(-1);
  const flushCamera = useCallback(() => {
    const p = pending.current;
    const cam = cameraRef.current;
    if (!p || !cam) return;
    pending.current = null;
    const c = p.command;
    cam
      .setStop({
        ...(c.center ? { center: [c.center.lon, c.center.lat] as [number, number] } : {}),
        ...(c.zoom === null ? {} : { zoom: c.zoom }),
        bearing: c.direction,
        duration: c.animated ? 400 : 0,
      })
      .catch((e: unknown) => console.warn('camera move failed', e));
  }, []);
  useEffect(() => {
    if (camera.seq !== appliedSeq.current) {
      appliedSeq.current = camera.seq;
      if (camera.command) pending.current = { seq: camera.seq, command: camera.command };
    }
    flushCamera();
  }, [camera, flushCamera]);

  return (
    <Map
      ref={mapRef}
      style={{ flex: 1 }}
      mapStyle={mapStyle}
      compass={false}
      onWillStartLoadingMap={() => reporter.report('willStartLoadingMap')}
      onDidFinishLoadingStyle={() => reporter.report('didFinishLoadingStyle')}
      onDidFailLoadingMap={() => reporter.report('didFailLoadingMap')}
      onDidFinishRenderingMapFully={() => {
        if (reporter.has('didFinishRenderingMapFully')) return;
        reporter.report('didFinishRenderingMapFully');
        // Give symbol placement a moment, count what each layer placed, then tell CI the map is ready.
        // Data layers fill in as the aviation database opens, so the probe repeats until airports were placed (or 15 tries).
        const probe = async (attempt: number) => {
          if (!mounted.current) return;
          const rendered: Record<string, number | string> = {};
          for (const id of PROBED_LAYERS) {
            rendered[id] =
              (await mapRef.current?.queryRenderedFeatures({ layers: [id] }).then(
                (f) => f.length,
                (e) => String(e),
              )) ?? 'no map';
          }
          const dataReady = typeof rendered['airport-circles'] === 'number' && rendered['airport-circles'] > 0;
          if (!mounted.current) return; // unmounted while querying: never write a stale status
          if (dataReady || attempt >= 15) reporter.markRendered(rendered);
          else setTimeout(() => void probe(attempt + 1), 1000);
        };
        setTimeout(() => void probe(1), 1000);
      }}
      onDidFinishLoadingMap={() => {
        reporter.report('didFinishLoadingMap');
        flushCamera();
        onStyleLoaded?.();
      }}
      onRegionDidChange={(e) => {
        const ev = e.nativeEvent;
        const [west, south, east, north] = ev.bounds;
        onViewChange?.({
          center: { lat: ev.center[1], lon: ev.center[0] },
          zoom: ev.zoom,
          bearing: ev.bearing,
          northEast: { lat: north, lon: east },
          southWest: { lat: south, lon: west },
          userInteraction: ev.userInteraction,
          animated: ev.animated,
        });
      }}
    >
      <Camera
        ref={cameraRef}
        initialViewState={{ center: [initialView.center.lon, initialView.center.lat], zoom: initialView.zoom }}
      />
      <Images
        images={{
          [OWNSHIP_LIVE_ICON]: require('./icons/ownship.png'),
          [OWNSHIP_STALE_ICON]: require('./icons/ownship-stale.png'),
          [TRACK_RULER_TICK_ICON]: { source: require('./icons/tick.png'), sdf: true },
        }}
        onImageMissing={(e) => reporter.addMissingImage(e.nativeEvent.image)}
      />
      {groups.map((g) => (
        <GeoJSONSource key={g.source} id={g.source} data={sources[g.source] ?? EMPTY_COLLECTION}>
          {g.specs.map((spec) => (
            <LayerFromSpec key={spec.id} spec={spec} night={night} visible={isLayerVisible(spec, visibleLayers, region)} />
          ))}
        </GeoJSONSource>
      ))}
    </Map>
  );
}
