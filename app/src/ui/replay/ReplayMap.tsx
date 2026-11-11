// ReplayMapView (efb-212/Views/Flights/ReplayMapView.swift): a separate map for the replay, with the recorded track as an orange
// line and the replay position as an orange marker; it fits the whole track once the style has loaded and follows the marker
// until the pilot pans. MapLibre React Native has no imperative layers, so the track and the marker are two GeoJSON sources.
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type StyleSpecification,
} from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import baseStyle from '../../../assets/base-style.json';
import {
  FIT_PADDING,
  REPLAY_COLOR,
  replayMarkerData,
  replayTrackData,
  trackBounds,
} from '../../domain/replay/replayMap';
import { useTheme } from '../Primitives';
import type { ReplayViewStore } from '../state/replayStore';

/** The camera before the track is fitted: the centre of the contiguous US, as in Swift. */
const INITIAL_VIEW = { center: [-98, 39] as [number, number], zoom: 5 };

/** base-style.json with the FAA sectional shown (the style ships it hidden; the SwiftUI app turns it on at runtime). */
const MAP_STYLE: StyleSpecification = (() => {
  const style = baseStyle as unknown as StyleSpecification;
  return {
    ...style,
    layers: style.layers.map((layer) =>
      layer.id === 'base-vfr-sectional' && layer.type === 'raster'
        ? { ...layer, layout: { ...layer.layout, visibility: 'visible' } }
        : layer,
    ),
  };
})();

export function ReplayMap({ store }: { store: ReplayViewStore }) {
  const t = useTheme();
  const track = useStore(store, (s) => s.trackPoints);
  const coordinate = useStore(store, (s) => s.coordinate);
  const heading = useStore(store, (s) => s.heading);
  const autoFollow = useStore(store, (s) => s.autoFollow);
  const camera = useRef<CameraRef>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const trackData = useMemo(() => replayTrackData(track), [track]);
  const markerData = useMemo(() => replayMarkerData(coordinate, heading), [coordinate, heading]);
  const orange = t.night ? REPLAY_COLOR.night : REPLAY_COLOR.day;

  // didFinishLoading style: fit the whole track.
  useEffect(() => {
    const bounds = trackBounds(track);
    if (styleLoaded && bounds) camera.current?.fitBounds(bounds, { padding: FIT_PADDING, duration: 500 });
  }, [styleLoaded, track]);

  // updateUIView: with auto-follow on, centre on the marker without animation each time it moves (20 Hz while playing, and when
  // scrubbing), and when the re-centre button turns auto-follow back on. Loading the style alone does not move the camera.
  const previous = useRef({ autoFollow, coordinate });
  useEffect(() => {
    const before = previous.current;
    previous.current = { autoFollow, coordinate };
    if (!styleLoaded || !autoFollow) return;
    if (!before.autoFollow || before.coordinate !== coordinate) {
      camera.current?.jumpTo({ center: [coordinate.lon, coordinate.lat] });
    }
  }, [styleLoaded, autoFollow, coordinate]);

  return (
    <Map
      style={{ flex: 1 }}
      mapStyle={MAP_STYLE}
      compass={false}
      onDidFinishLoadingStyle={() => setStyleLoaded(true)}
      // A pan by the pilot turns auto-follow off (Swift: the camera change reason .gesturePan; here any user gesture).
      onRegionDidChange={(e) => {
        if (e.nativeEvent.userInteraction) store.getState().onUserPan();
      }}
    >
      <Camera ref={camera} initialViewState={INITIAL_VIEW} />
      <GeoJSONSource id="replay-track" data={trackData}>
        <Layer
          type="line"
          id="replay-track-line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': orange, 'line-width': 3 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="replay-marker" data={markerData}>
        {/* 24 pt orange disc with a white outline, and a 4 pt white dot in the middle: replayed, not live (the ownship is a blue chevron). */}
        <Layer
          type="circle"
          id="replay-marker-disc"
          paint={{
            'circle-radius': 11.25,
            'circle-color': orange,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#FFFFFF',
          }}
        />
        <Layer type="circle" id="replay-marker-dot" paint={{ 'circle-radius': 2, 'circle-color': '#FFFFFF' }} />
      </GeoJSONSource>
    </Map>
  );
}
