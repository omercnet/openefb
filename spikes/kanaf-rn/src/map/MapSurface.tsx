// Native chart: MapLibre React Native v11 with the SwiftUI app's base-style.json (street vector map plus the
// FAA VFR sectional raster from zoom 8), airport dots from aviation.sqlite (R-tree bbox on the visible region),
// the track ruler and the ownship chevron. Layer order and paints follow efb-212/Services/MapService.swift.
// kanaf-rn://map?animate=1 (Android) or `-KanafAnimate 1` (iOS launch argument) moves the ownship along its track at
// 10 Hz for 60 s and records JS frame pacing. Map lifecycle events and MapLibre native warnings are logged as
// "SPIKE_MAP {...}" and written to map-status.json so CI can wait for a fully rendered map before a screenshot.
import { Camera, GeoJSONSource, Images, Layer, LogManager, Map, type MapRef, type StyleSpecification } from '@maplibre/maplibre-react-native';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Settings } from 'react-native';
import baseStyle from '../../assets/base-style.json';
import { scenario } from '../fixtures/scenario';
import { ANIMATION_FILE, MAP_STATUS_FILE, writeResult } from '../native/resultFile';
import { airportsInBox, openAviationDb } from './aviationDb';
import { destination, pacing, trackRuler } from './geo';

const { ownship } = scenario;
const ORIGIN: [number, number] = [ownship.lon, ownship.lat];
const UPDATE_MS = 100; // 10 Hz, the SwiftUI app's location update rate
const ANIMATION_MS = 60_000;

// MapService / DesignTokens colors: ruler ink and halo per display mode, night raster dimming (NightPalette).
const INK = { day: '#14191F', night: '#B6B0A3' };
const HALO = { day: '#FFFFFF', night: '#0D1013' };
const NIGHT_RASTER = { 'raster-brightness-max': 0.55, 'raster-saturation': -0.35 };

/**
 * base-style.json with the FAA sectional shown, dimmed and desaturated at night (MapService.applyDisplayMode).
 * The style ships the sectional with `visibility: none`; the SwiftUI app turns it on at runtime in
 * MapService.setMapStyle(_:sectional:) (`isVisible = sectional`), so a plain copy of the style shows no chart.
 */
function styleFor(night: boolean): StyleSpecification {
  const style = baseStyle as unknown as StyleSpecification;
  return {
    ...style,
    layers: style.layers.map((l) => (l.id === 'base-vfr-sectional' && l.type === 'raster'
      ? { ...l, layout: { ...l.layout, visibility: 'visible' }, paint: night ? { ...l.paint, ...NIGHT_RASTER } : l.paint }
      : l)),
  };
}

type MapStatus = {
  platform: string; night: boolean; events: Record<string, number>; fullyRendered: boolean; failed: boolean; native: string[];
};

/** Records the first occurrence of a lifecycle event (ms since mount), then logs and persists the cumulative status. */
function report(status: MapStatus, t0: number, event: string) {
  if (event in status.events) return; // render events repeat on every change; the first one is what CI waits for
  status.events[event] = Math.round(performance.now() - t0);
  if (event === 'didFinishRenderingMapFully') status.fullyRendered = true;
  if (event === 'didFailLoadingMap') status.failed = true;
  console.log('SPIKE_MAP ' + JSON.stringify(status));
  writeResult(MAP_STATUS_FILE, status).catch((e) => console.warn('map status write failed', e));
}

export function MapSurface({ night }: { night: boolean }) {
  const mapRef = useRef<MapRef>(null);
  const mapStyle = useMemo(() => styleFor(night), [night]);
  const t0 = useRef(performance.now()).current;
  const status = useRef<MapStatus>({ platform: Platform.OS, night, events: {}, fullyRendered: false, failed: false, native: [] }).current;
  const [position, setPosition] = useState(ORIGIN);
  const [airports, setAirports] = useState<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const url = Linking.useURL();
  const animate = Platform.OS === 'ios' ? String(Settings.get('KanafAnimate') ?? '') === '1' : /[?&]animate=1\b/.test(url ?? '');

  // MapLibre native warnings and errors (tile, glyph, sprite and style failures) into the status file.
  useEffect(() => {
    LogManager.onLog(({ level, tag, message }) => {
      // Capped so the SPIKE_MAP logcat line stays under Android's ~4 KB limit.
      if (status.native.length < 12) status.native.push(`${level} ${tag} ${message}`.slice(0, 200));
      return false; // keep MapLibre's own console output
    });
    LogManager.start();
    // Persist late native messages too, and mark a map that never reached "fully rendered" within 40 s.
    const snapshot = setTimeout(() => report(status, t0, 'snapshot40s'), 40_000);
    return () => {
      clearTimeout(snapshot);
      LogManager.stop();
    };
  }, [status, t0]);

  const loadAirports = async (bounds: [number, number, number, number]) => {
    try {
      const rows = await airportsInBox(await openAviationDb(), bounds);
      setAirports({
        type: 'FeatureCollection',
        features: rows.map((a) => ({ type: 'Feature', id: a.icao, geometry: { type: 'Point', coordinates: [a.longitude, a.latitude] }, properties: { icao: a.icao } })),
      });
    } catch (e) {
      console.warn('airport query failed', e);
    }
  };

  useEffect(() => {
    if (!animate) return;
    const start = performance.now();
    const frames: number[] = []; // requestAnimationFrame deltas, ms
    const updates: number[] = []; // 10 Hz timer deltas, ms
    let lastFrame = start;
    let lastUpdate = start;
    let raf = 0;
    const onFrame = () => {
      const now = performance.now();
      frames.push(now - lastFrame);
      lastFrame = now;
      raf = requestAnimationFrame(onFrame);
    };
    raf = requestAnimationFrame(onFrame);
    const timer = setInterval(() => {
      const now = performance.now();
      updates.push(now - lastUpdate);
      lastUpdate = now;
      // NM flown = knots * hours
      setPosition(destination(ORIGIN, (ownship.gsKt * (now - start)) / 3_600_000, ownship.trkDeg));
      if (now - start < ANIMATION_MS) return;
      clearInterval(timer);
      cancelAnimationFrame(raf);
      const result = {
        platform: Platform.OS,
        durationMs: Math.round(now - start),
        targetUpdateMs: UPDATE_MS,
        rafDeltaMs: pacing(frames),
        updateDeltaMs: pacing(updates),
        map: status,
      };
      console.log('SPIKE_ANIM ' + JSON.stringify(result));
      writeResult(ANIMATION_FILE, result).catch((e) => console.warn('animation result write failed', e));
    }, UPDATE_MS);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(raf);
    };
  }, [animate, status]);

  const ruler = useMemo(() => trackRuler(position, ownship.trkDeg, ownship.gsKt, scenario.trackRulerMinutes), [position]);
  const ownshipShape = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: position }, properties: { heading: ownship.trkDeg } }] }),
    [position],
  );
  const ink = night ? INK.night : INK.day;

  return (
    <Map
      ref={mapRef}
      style={{ flex: 1 }}
      mapStyle={mapStyle}
      compass={false}
      onWillStartLoadingMap={() => report(status, t0, 'willStartLoadingMap')}
      onDidFinishLoadingStyle={() => report(status, t0, 'didFinishLoadingStyle')}
      onDidFailLoadingMap={() => report(status, t0, 'didFailLoadingMap')}
      onDidFinishRenderingMapFully={() => report(status, t0, 'didFinishRenderingMapFully')}
      onDidFinishLoadingMap={() => {
        report(status, t0, 'didFinishLoadingMap');
        mapRef.current?.getBounds().then(loadAirports);
      }}
      onRegionDidChange={(e) => loadAirports(e.nativeEvent.bounds)}
    >
      <Camera initialViewState={{ center: scenario.map.center, zoom: scenario.map.zoom }} />
      <Images images={{ 'ownship-chevron': require('./icons/ownship.png'), 'track-ruler-tick': { source: require('./icons/tick.png'), sdf: true } }} />
      <GeoJSONSource id="airports" data={airports}>
        {/* Green flight-category dot with a white ring, as drawn over the sectional in the reference screenshots */}
        <Layer type="circle" id="airport-circles" paint={{ 'circle-radius': 8, 'circle-color': '#34C759', 'circle-stroke-width': 1, 'circle-stroke-color': '#FFFFFF' }} />
      </GeoJSONSource>
      <GeoJSONSource id="track-ruler-line" data={ruler.line}>
        <Layer type="line" id="track-ruler-line" paint={{ 'line-color': ink, 'line-width': 2 }} />
      </GeoJSONSource>
      <GeoJSONSource id="track-ruler-ticks" data={ruler.ticks}>
        <Layer
          type="symbol"
          id="track-ruler-ticks"
          layout={{
            'icon-image': 'track-ruler-tick',
            'icon-rotate': ['get', 'track'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['get', 'label'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 12,
            'text-anchor': ['get', 'anchor'],
            'text-offset': [0.7, 0.7],
            'text-allow-overlap': true,
          }}
          paint={{ 'icon-color': ink, 'text-color': ink, 'text-halo-color': night ? HALO.night : HALO.day, 'text-halo-width': 1.5 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="ownship" data={ownshipShape}>
        <Layer
          type="symbol"
          id="ownship-symbol"
          layout={{
            'icon-image': 'ownship-chevron',
            'icon-rotate': ['get', 'heading'],
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
          }}
        />
      </GeoJSONSource>
    </Map>
  );
}
