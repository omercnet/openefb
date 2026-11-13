// Web preview stand-in for the replay map (the real one is native-only, like MapSurface.web.tsx): the fitted track and the marker
// drawn flat on the same ground colour, so the replay screen can be tried in the browser.
import { useMemo, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { useStore } from 'zustand';
import { FIT_PADDING, REPLAY_COLOR, trackBounds } from '../../domain/replay/replayMap';
import { useTheme } from '../Primitives';
import type { ReplayViewStore } from '../state/replayStore';

export function ReplayMap({ store }: { store: ReplayViewStore }) {
  const t = useTheme();
  const track = useStore(store, (s) => s.trackPoints);
  const coordinate = useStore(store, (s) => s.coordinate);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const orange = t.night ? REPLAY_COLOR.night : REPLAY_COLOR.day;

  // The engine moves the marker every 50 ms: only the marker follows it; the bounds and the polyline depend on the track and size.
  const bounds = useMemo(() => trackBounds(track), [track]);
  const project = useMemo(
    () => (lon: number, lat: number) => {
      if (!bounds) return { x: 0, y: 0 };
      const [west, south, east, north] = bounds;
      const squeeze = Math.cos((((south + north) / 2) * Math.PI) / 180); // a degree of longitude is shorter away from the equator
      const spanX = Math.max((east - west) * squeeze, 1e-9);
      const spanY = Math.max(north - south, 1e-9);
      const room = {
        width: Math.max(size.width - FIT_PADDING.left - FIT_PADDING.right, 1),
        height: Math.max(size.height - FIT_PADDING.top - FIT_PADDING.bottom, 1),
      };
      const scale = Math.min(room.width / spanX, room.height / spanY);
      const x = FIT_PADDING.left + (room.width - spanX * scale) / 2 + (lon - west) * squeeze * scale;
      const y = FIT_PADDING.top + (room.height - spanY * scale) / 2 + (north - lat) * scale;
      return { x, y };
    },
    [bounds, size],
  );
  const line = useMemo(
    () =>
      track
        .map((p) => {
          const { x, y } = project(p.longitude, p.latitude);
          return `${x},${y}`;
        })
        .join(' '),
    [track, project],
  );
  const marker = project(coordinate.lon, coordinate.lat);

  return (
    <View
      style={{ flex: 1, backgroundColor: t.night ? '#10141A' : '#B9C7A8' }}
      onLayout={(e: LayoutChangeEvent) => setSize(e.nativeEvent.layout)}
    >
      {size.width > 0 ? (
        <Svg width={size.width} height={size.height}>
          <Polyline
            points={line}
            fill="none"
            stroke={orange}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Circle cx={marker.x} cy={marker.y} r={11.25} fill={orange} stroke="#FFFFFF" strokeWidth={1.5} />
          <Circle cx={marker.x} cy={marker.y} r={2} fill="#FFFFFF" />
        </Svg>
      ) : null}
    </View>
  );
}
