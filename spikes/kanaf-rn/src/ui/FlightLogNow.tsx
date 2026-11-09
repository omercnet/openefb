// FlightLogNowCell + AltitudeTape (efb-212/Views/Log/FlightLogRows.swift): the active leg, GS / TRK / ALT with
// VS, the altitude tape and Clear.
import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { scenario } from '../fixtures/scenario';
import { ArrowUp } from './Icons';
import { Pressy, SectionBand, useTheme } from './Primitives';
import { Radius, Space, StripMetrics, Type, tracked } from './tokens';

const READOUT_PT = 42; // readout digits, points

export function FlightLogNow() {
  const t = useTheme();
  const o = scenario.ownship;
  const altText = String(Math.round(o.altFt / 10) * 10); // feet MSL, nearest 10 ft
  const vsText = o.vsFpm >= 0 ? `+${o.vsFpm}` : `${o.vsFpm}`; // feet per minute
  return (
    <View>
      <SectionBand title="Now" />
      <View accessibilityLabel="Now" style={{ padding: Space.m, gap: Space.s, backgroundColor: t.activeCell }}>
        {/* "DIRECT \u25B8 KOAK": no bundled face has U+25B8 (iOS falls back to a system face), so the triangle is drawn
            in a 27pt slot: a Plex space, the glyph's 9pt advance, a Plex space. */}
        <View accessible accessibilityLabel={`Leg DIRECT to ${scenario.next.ident}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text numberOfLines={1} style={[Type.dataEmphasis, { color: t.ink }]}>DIRECT</Text>
          <Svg width={27} height={19.5}>
            <Path d="M10 8.2L16 11.6L10 15Z" fill={t.ink} />
          </Svg>
          <Text numberOfLines={1} style={[Type.dataEmphasis, { color: t.ink }]}>{scenario.next.ident}</Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Readout label="GS kt" value={String(o.gsKt)} name="Ground speed" unit="knots" />
          <Readout label={'TRK \u00B0T'} value={String(o.trkDeg).padStart(3, '0')} name="Track" unit="degrees true" />
          <View accessible accessibilityLabel="Altitude" accessibilityValue={{ text: `${altText} feet, vertical speed ${vsText} feet per minute` }}>
            <ReadoutLabel text="ALT ft MSL" />
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.xs }}>
              <Text style={[Type.readout(READOUT_PT), { color: t.ink }]}>{altText}</Text>
              {/* Arrow is positioned out of flow so the row aligns on the "+475" baseline. */}
              <View style={{ paddingLeft: 16 }}>
                <Text style={[Type.dataEmphasis, { color: t.ink }]}>{vsText}</Text>
                {Math.abs(o.vsFpm) >= 100 ? (
                  <View style={{ position: 'absolute', left: 1, top: 0, bottom: 0, justifyContent: 'center' }}>
                    <ArrowUp color={t.ink} size={14} />
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </View>
        <AltitudeTape altitudeFt={o.altFt} vsFpm={o.vsFpm} />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Pressy
            accessibilityLabel={`Clear DIRECT ${scenario.next.ident}`}
            style={{
              minWidth: StripMetrics.cell,
              minHeight: StripMetrics.cell,
              paddingHorizontal: Space.m,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: Radius.s,
              backgroundColor: t.paperSecondary,
            }}
          >
            <Text style={[Type.dataEmphasis, { color: t.ink }]}>Clear</Text>
          </Pressy>
        </View>
      </View>
    </View>
  );
}

function ReadoutLabel({ text }: { text: string }) {
  const t = useTheme();
  return (
    <Text numberOfLines={1} style={[Type.stripLabel, tracked, { color: t.inkSecondary }]}>
      {text}
    </Text>
  );
}

function Readout({ label, value, name, unit }: { label: string; value: string; name: string; unit: string }) {
  const t = useTheme();
  return (
    <View accessible accessibilityLabel={name} accessibilityValue={{ text: `${value} ${unit}` }}>
      <ReadoutLabel text={label} />
      <Text numberOfLines={1} style={[Type.readout(READOUT_PT), { color: t.ink }]}>
        {value}
      </Text>
    </View>
  );
}

/** Approximate advance of stripLabel digits (Archivo Medium 11pt), points; used only for label collision tests. */
const labelWidth = (s: string) => s.length * 6.4;

/**
 * Altitude left to right on a 0 to 4,000 ft scale (wider above 3,500 ft), the ownship marker and an arrow to
 * where one minute at the current vertical speed puts the aircraft. Same geometry as the SwiftUI Canvas.
 */
export function AltitudeTape({ altitudeFt, vsFpm }: { altitudeFt: number; vsFpm: number }) {
  const t = useTheme();
  const [width, setWidth] = useState(StripMetrics.width - 2 * Space.m);
  const height = 56;
  const top = altitudeFt > 3500 ? Math.ceil((altitudeFt * 2) / 1000) * 1000 : 4000; // feet
  const x0 = 8;
  const x1 = width - 8;
  const barY = 20;
  const barH = 16;
  const x = (ft: number) => x0 + ((x1 - x0) * Math.min(Math.max(ft, 0), top)) / top;
  const ax = x(altitudeFt);
  const midY = barY + barH / 2;
  const target = x(altitudeFt + vsFpm); // one minute ahead
  const dir = target >= ax ? 1 : -1;
  const ticks = Array.from({ length: Math.ceil(top / 1000) - 1 }, (_, i) => (i + 1) * 1000);

  const altLabel = String(Math.round(altitudeFt / 10) * 10).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const topLabel = top.toLocaleString('en-US');
  const half = labelWidth(altLabel) / 2;
  const altCenter = Math.min(Math.max(ax, x0 + half), x1 - half);
  const touches = (a0: number, a1: number) => a0 - Space.xs < altCenter + half && a1 + Space.xs > altCenter - half;
  const labelTop = height - 6 - (Type.stripLabel.lineHeight ?? 12) / 2; // label line box centered on labelY = height - 6
  const label = { position: 'absolute' as const, top: labelTop };

  return (
    <View
      accessible
      accessibilityLabel="Altitude tape"
      accessibilityValue={{ text: `${altLabel} feet, ${Math.abs(vsFpm) >= 100 ? `${vsFpm > 0 ? 'climbing' : 'descending'} ${Math.abs(vsFpm)} feet per minute` : 'level'}` }}
      style={{ height }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={width} height={height} style={{ position: 'absolute' }}>
        <Rect x={x0} y={barY} width={x1 - x0} height={barH} rx={3} fill={t.paperSecondary} />
        {ticks.map((ft) => (
          <Line key={ft} x1={x(ft)} y1={barY} x2={x(ft)} y2={barY + barH} stroke={t.rule} strokeWidth={1.5} />
        ))}
        {Math.abs(vsFpm) >= 100 ? (
          <>
            <Line x1={ax} y1={midY} x2={target - dir * 6} y2={midY} stroke={t.ink} strokeWidth={4} />
            <Path d={`M${target} ${midY}L${target - dir * 9} ${midY - 6}L${target - dir * 9} ${midY + 6}Z`} fill={t.ink} />
          </>
        ) : null}
        <Path d={`M${ax - 7} 4L${ax + 7} 4L${ax} ${barY - 2}Z`} fill={t.ink} />
      </Svg>
      {touches(x0, x0 + labelWidth('0')) ? null : (
        <Text style={[Type.stripLabel, label, { left: x0, color: t.inkSecondary }]}>0</Text>
      )}
      {touches(x1 - labelWidth(topLabel), x1) ? null : (
        <Text style={[Type.stripLabel, label, { right: width - x1, color: t.inkSecondary }]}>{topLabel}</Text>
      )}
      <Text style={[Type.stripLabel, label, { left: altCenter - 40, width: 80, textAlign: 'center', color: t.ink }]}>{altLabel}</Text>
    </View>
  );
}
