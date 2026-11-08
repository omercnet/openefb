// FlightLogFooter (efb-212/Views/Log/FlightLogFooter.swift): one row of 60pt cells under the strip: GPS state,
// the dark NRST cell, LAYERS, ZOOM + and ZOOM -. The paper and the NRST ink run into the bottom safe area.
import { useState } from 'react';
import { Text, View } from 'react-native';
import { scenario } from '../fixtures/scenario';
import { Layers, Minus, Plus } from './Icons';
import { CellButton, ColumnRule, Pressy, useTheme } from './Primitives';
import { Space, StripMetrics, Type, tracked } from './tokens';

/** IBM Plex Mono advance width, em (every glyph). */
const PLEX_ADVANCE = 0.6;

export function FlightLogFooter({ bottomInset }: { bottomInset: number }) {
  const t = useTheme();
  const gps = scenario.gps;
  const divider = <View style={{ width: 1, height: StripMetrics.cell, backgroundColor: t.rule }} />;
  return (
    <View style={{ backgroundColor: t.paperSecondary }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View
          accessible
          accessibilityLabel={gps.ok ? 'GPS 3D fix' : gps.label}
          style={{
            flex: 1,
            maxWidth: 120,
            minWidth: StripMetrics.cell,
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
        <NrstCell bottomInset={bottomInset} />
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
 * distance / bearing column shrinks when the 108pt cell cannot hold it at 15pt (it does on the iPad strip).
 */
function NrstCell({ bottomInset }: { bottomInset: number }) {
  const t = useTheme();
  const n = scenario.nearest;
  const [cellWidth, setCellWidth] = useState(108);
  const dist = `${n.distNm.toFixed(1)} NM`; // nautical miles
  const brg = `${String(Math.round(n.brgDeg)).padStart(3, '0')}\u00B0`; // degrees true
  const room = cellWidth - 2 * Space.s - Space.s - n.ident.length * PLEX_ADVANCE * 15;
  const need = Math.max(dist.length, brg.length) * PLEX_ADVANCE * 15;
  const dataSize = 15 * Math.max(0.6, Math.min(1, room / need));
  return (
    <Pressy
      accessibilityLabel={`Nearest airport ${n.ident}, ${n.distNm.toFixed(1)} nautical miles, bearing ${brg.slice(0, 3)} degrees`}
      accessibilityHint="Opens the nearest airports list"
      onLayout={(e) => setCellWidth(e.nativeEvent.layout.width)}
      style={{
        flex: 1,
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
        <Text numberOfLines={1} style={[Type.data, { fontSize: dataSize, lineHeight: dataSize * 1.3, color: t.paper }]}>
          {dist}
        </Text>
        <Text numberOfLines={1} style={[Type.data, { fontSize: dataSize, lineHeight: dataSize * 1.3, color: t.paper }]}>
          {brg}
        </Text>
      </View>
    </Pressy>
  );
}
