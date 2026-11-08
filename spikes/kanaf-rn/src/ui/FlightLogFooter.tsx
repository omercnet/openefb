// FlightLogFooter (efb-212/Views/Log/FlightLogFooter.swift): one row of 60pt cells under the strip: GPS state,
// the dark NRST cell, LAYERS, ZOOM + and ZOOM -. The paper and the NRST ink run into the bottom safe area.
import { Text, View } from 'react-native';
import { scenario } from '../fixtures/scenario';
import { Layers, Minus, Plus } from './Icons';
import { CellButton, ColumnRule, Pressy, useTheme } from './Primitives';
import { Space, StripMetrics, Type, lineHeight, tracked } from './tokens';

/** IBM Plex Mono advance width, em (every glyph). */
const PLEX_ADVANCE = 0.6;
const GPS_MAX_WIDTH = 120; // points

/**
 * GPS and NRST share what the three 60pt cells and four 1pt dividers leave, GPS capped at 120pt (SwiftUI: 108 / 108
 * at 400pt). Computed rather than flex: Yoga on iOS split it 120 / 96 (iOS round 1), which also shrank NRST's text.
 */
export function FlightLogFooter({ width, bottomInset }: { width: number; bottomInset: number }) {
  const t = useTheme();
  const gps = scenario.gps;
  const shared = width - 3 * StripMetrics.cell - 4;
  const gpsWidth = Math.min(GPS_MAX_WIDTH, shared / 2);
  const divider = <View style={{ width: 1, height: StripMetrics.cell, backgroundColor: t.rule }} />;
  return (
    <View style={{ backgroundColor: t.paperSecondary }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View
          accessible
          accessibilityLabel={gps.ok ? 'GPS 3D fix' : gps.label}
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
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: gps.ok ? t.ok : t.warning }} />
          <Text numberOfLines={1} style={[Type.dataEmphasis, { color: gps.ok ? t.ink : t.warning }]}>
            {gps.label}
          </Text>
        </View>
        {divider}
        <NrstCell width={shared - gpsWidth} bottomInset={bottomInset} />
        {divider}
        <CellButton title="Layers" label="Map layers" accessibilityValue="Closed" icon={<Layers color={t.ink} />} />
        {divider}
        <CellButton title="Zoom +" label="Zoom in" icon={<Plus color={t.ink} />} />
        {divider}
        <CellButton title={'Zoom \u2212'} label="Zoom out" icon={<Minus color={t.ink} />} />
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
  const n = scenario.nearest;
  const dist = `${n.distNm.toFixed(1)} NM`; // nautical miles
  const brg = `${String(Math.round(n.brgDeg)).padStart(3, '0')}\u00B0`; // degrees true
  const room = width - 2 * Space.s - Space.s - n.ident.length * PLEX_ADVANCE * 15;
  const need = Math.max(dist.length, brg.length) * PLEX_ADVANCE * 15;
  const dataSize = 15 * Math.max(0.6, Math.min(1, room / need));
  const data = [Type.data, { fontSize: dataSize, lineHeight: lineHeight(dataSize, 1.3), color: t.paper }];
  return (
    <Pressy
      accessibilityLabel={`Nearest airport ${n.ident}, ${n.distNm.toFixed(1)} nautical miles, bearing ${brg.slice(0, 3)} degrees`}
      accessibilityHint="Opens the nearest airports list"
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
          {n.ident}
        </Text>
      </View>
      <View>
        <Text numberOfLines={1} style={data}>
          {dist}
        </Text>
        <Text numberOfLines={1} style={data}>
          {brg}
        </Text>
      </View>
    </Pressy>
  );
}
