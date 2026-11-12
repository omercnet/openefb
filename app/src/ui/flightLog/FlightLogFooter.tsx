// FlightLogFooter (efb-212/Views/Log/FlightLogFooter.swift): one row of 60pt cells under the strip: GPS state,
// the dark NRST cell, LAYERS, ZOOM + (RECENTER after a pan) and ZOOM -. The paper and the NRST ink run into the
// bottom safe area. `compact` (iPhone, iPad Split View, flight log hidden): the full-width footer of the compact layout,
// where the GPS cell is at most 76pt and wraps onto two lines.
import { useEffect, useMemo, useRef } from 'react';
import { Text, View } from 'react-native';
import type { StripColumnKind } from '../../domain/types';
import { hasAirportData } from '../../domain/core/region';
import { gpsStatusAccessibilityDescription } from '../../domain/location/gpsStatus';
import { entryExtras } from '../columns/nearest/logic';
import { useNearestAirports } from '../columns/nearest/refresh';
import { useNearestEntry } from '../columns/nearest/store';
import { Layers, Minus, Plus } from '../Icons';
import { CellButton, ColumnRule, Pressy, useTheme } from '../Primitives';
import { appStore, useAppStore } from '../state/appStore';
import { useGpsStatus } from '../state/gps';
import { useRegion } from '../state/region';
import { Space, StripMetrics, Type, lineHeight, tracked } from '../tokens';
import { LocationFill } from './footerIcons';
import {
  PLEX_ADVANCE,
  ZoomStepper,
  gpsText,
  monoFitScale,
  monoWrapFit,
  runMapAction,
  gpsTint,
  nearestAccessibilityText,
  nearestIdent,
  nrstBearing,
  nrstDistance,
  type NrstEntry,
} from './footerLogic';
import { footer } from './footerStore';

const GPS_MAX_WIDTH = 120; // points
const GPS_MAX_WIDTH_COMPACT = 76; // points
const GPS_DOT = 10; // points

/** Open a column, or return to the log when it is already open. */
const toggle = (column: StripColumnKind) =>
  appStore.getState().setStripColumn(appStore.getState().stripColumn === column ? 'log' : column);

/**
 * GPS and NRST share what the three 60pt cells and four 1pt dividers leave, GPS capped at 120pt (SwiftUI: 108 / 108
 * at 400pt; compact: 76pt, NRST takes the rest). Computed rather than flex: Yoga on iOS split it 120 / 96 (iOS round 1),
 * which also shrank NRST's text.
 */
export function FlightLogFooter({
  width,
  bottomInset,
  compact = false,
}: {
  width: number;
  bottomInset: number;
  compact?: boolean;
}) {
  const t = useTheme();
  const status = useGpsStatus();
  const layersOpen = useAppStore((s) => s.stripColumn === 'layers');
  const zoom = footer.useData((s) => s.zoom);
  const following = footer.useData((s) => s.following);
  const footerStore = footer.useStoreApi();
  const stepper = useRef(new ZoomStepper());
  // The camera settled or the pilot pinched: the next tap starts from the reported zoom.
  useEffect(() => stepper.current.reset(), [zoom]);
  /** Zoom one level, clamped to 2...18. Taps before the debounced zoom catches up add up; a failed one is forgotten. */
  const zoomBy = (step: number) => {
    const s = footerStore.getState();
    const level = stepper.current.step(step, s.zoom);
    runMapAction(
      () => s.zoomTo(level),
      () => stepper.current.reset(),
    );
  };

  // Never negative: a window narrower than the five cells clips instead of laying out negative widths.
  const shared = Math.max(0, width - 3 * StripMetrics.cell - 4);
  const gpsWidth = Math.min(compact ? GPS_MAX_WIDTH_COMPACT : GPS_MAX_WIDTH, shared / 2);
  const tint = gpsTint(status, t);
  // Swift: lineLimit(1) (compact: 2) + minimumScaleFactor(0.7). Plex is monospaced, so the fit is computed (no web
  // fallback needed); the compact lines are broken here so the platform cannot wrap them differently.
  const label = gpsText(status);
  const gpsRoom = gpsWidth - 2 * Space.s - GPS_DOT - Space.xs; // points
  const fit = compact
    ? monoWrapFit(label, 15, gpsRoom, 2, 0.7)
    : { scale: monoFitScale(label.length, 15, gpsRoom, 0.7), lines: [label] };
  const gpsSize = 15 * fit.scale;
  const divider = <View style={{ width: 1, height: StripMetrics.cell, backgroundColor: t.rule }} />;
  return (
    <View style={{ backgroundColor: t.paperSecondary }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View
          accessible
          accessibilityLabel={gpsStatusAccessibilityDescription(status)}
          testID="GPS status"
          style={{
            width: gpsWidth,
            height: StripMetrics.cell,
            paddingHorizontal: Space.s,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: Space.xs,
          }}
        >
          <View style={{ width: GPS_DOT, height: GPS_DOT, borderRadius: GPS_DOT / 2, backgroundColor: tint }} />
          <Text
            numberOfLines={fit.lines.length}
            testID="gps-status-text"
            style={[
              Type.dataEmphasis,
              { fontSize: gpsSize, lineHeight: lineHeight(gpsSize, 1.3), color: status.kind === 'ok' ? t.ink : tint },
            ]}
          >
            {fit.lines.join('\n')}
          </Text>
        </View>
        {divider}
        <NrstCell width={shared - gpsWidth} bottomInset={bottomInset} />
        {divider}
        <CellButton
          title="Layers"
          label="Map layers"
          accessibilityValue={layersOpen ? 'Open' : 'Closed'}
          icon={<Layers color={t.ink} />}
          onPress={() => toggle('layers')}
        />
        {divider}
        {following ? (
          <CellButton title="Zoom +" label="Zoom in" icon={<Plus color={t.ink} />} onPress={() => zoomBy(1)} />
        ) : (
          <CellButton
            title="Recenter"
            label="Recenter on aircraft"
            icon={<LocationFill color={t.ink} />}
            onPress={() => runMapAction(footerStore.getState().recenter)}
          />
        )}
        {divider}
        <CellButton title={'Zoom \u2212'} label="Zoom out" icon={<Minus color={t.ink} />} onPress={() => zoomBy(-1)} />
      </View>
      <ColumnRule style={{ position: 'absolute', top: 0, left: 0, right: 0 }} />
    </View>
  );
}

/**
 * Dark ink cell: the emergency entry point. Like SwiftUI's lineLimit(1) + minimumScaleFactor(0.6), the
 * distance / bearing column shrinks when the cell cannot hold it at 15pt (108pt on the iPad strip: 13.3pt).
 */
function NrstCell({ width, bottomInset }: { width: number; bottomInset: number }) {
  const t = useTheme();
  // MapContainerView refreshes the nearest list on every ownship or region change, whichever column is open: this cell is
  // always mounted, so it drives the refresh (the Nearest column shares the same refresher).
  useNearestAirports();
  const raw = useNearestEntry();
  // The refresher publishes plain entries; the spoken label needs the computed runway, private, military, PPR and NOTAM fields.
  const entry: NrstEntry | null = useMemo(() => (raw ? { ...raw, ...entryExtras(raw) } : null), [raw]);
  const status = useGpsStatus();
  const hasData = hasAirportData(useRegion());
  // AppState.gpsAvailable turns true with the first location and false on a location error; GpsStatus is lost
  // without an age exactly then.
  const gpsAvailable = !(status.kind === 'lost' && status.ageSeconds === null);
  const ident = nearestIdent(hasData, entry, gpsAvailable);
  const shown = hasData ? entry : null;
  const dist = shown ? nrstDistance(shown.distance) : '';
  const brg = shown ? nrstBearing(shown.bearing) : '';
  const room = width - 2 * Space.s - Space.s - ident.length * PLEX_ADVANCE * 15;
  const dataSize = 15 * monoFitScale(Math.max(dist.length, brg.length), 15, room, 0.6);
  const data = [Type.data, { fontSize: dataSize, lineHeight: lineHeight(dataSize, 1.3), color: t.paper }];
  return (
    <Pressy
      accessibilityLabel={nearestAccessibilityText(hasData, entry)}
      accessibilityHint="Opens the nearest airports list"
      testID="NRST"
      onPress={() => toggle('nearest')}
      style={{
        width,
        height: StripMetrics.cell + bottomInset,
        paddingBottom: bottomInset,
        paddingHorizontal: Space.s,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Space.s,
        backgroundColor: t.ink,
      }}
    >
      <View>
        <Text style={[Type.stripLabel, tracked, { color: t.paper }]}>NRST</Text>
        <Text numberOfLines={1} style={[Type.dataEmphasis, { color: t.paper }]}>
          {ident}
        </Text>
      </View>
      {shown ? (
        <View>
          <Text numberOfLines={1} style={data}>
            {dist}
          </Text>
          <Text numberOfLines={1} style={data}>
            {brg}
          </Text>
        </View>
      ) : null}
    </Pressy>
  );
}
