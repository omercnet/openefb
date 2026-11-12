// AltitudeTape (efb-212/Views/Log/FlightLogRows.swift): altitude left to right on a 0 to 4,000 ft scale (wider above
// 3,500 ft), the ownship marker and an arrow to where one minute at the current vertical speed puts the aircraft. With a
// predicted floor ahead (stage 2): the airspace hatched from its floor up, its label, the time to it in amber under the
// floor, and a dashed amber line from the arrow tip to the floor. Same geometry as the SwiftUI Canvas.
import { useId, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';
import { useTheme } from '../Primitives';
import { Space, StripMetrics, Type } from '../tokens';
import { grouped, roundAway, scaleTop, spokenDuration, spokenTitle, timeToText, type TapeFloor } from './logic';

const HEIGHT = 56;
const X_INSET = 8;
const BAR_Y = 20;
const BAR_H = 16;

/** Approximate advance of stripLabel text (Archivo Medium 11pt), points; used only for the label collision tests. */
const labelWidth = (s: string) => s.length * 6.4;

type Span = { minX: number; maxX: number };
/** Two horizontal spans closer than Space.xs. */
const touches = (a: Span, b: Span | null) => b != null && a.minX - Space.xs < b.maxX && a.maxX + Space.xs > b.minX;

export function AltitudeTape({
  altitudeFeet,
  verticalSpeedFPM,
  floor = null,
}: {
  /** Feet MSL; null when there is no current vertical fix (nothing is drawn as current). */
  altitudeFeet: number | null;
  /** Feet per minute. */
  verticalSpeedFPM: number;
  /** The soonest predicted floor; drawn only with a current altitude. */
  floor?: TapeFloor | null;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(StripMetrics.width - 2 * Space.m);
  // One clip path per tape (two tapes on a page must not share an SVG id); useId's punctuation is not id-safe.
  const clipId = `tape-floor-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const shown = altitudeFeet == null ? null : floor;
  const top = scaleTop(altitudeFeet, shown?.feet ?? null); // feet
  const x0 = X_INSET;
  const x1 = width - X_INSET;
  const x = (ft: number) => x0 + ((x1 - x0) * Math.min(Math.max(ft, 0), top)) / top;
  const ticks = Array.from({ length: Math.ceil(top / 1000) - 1 }, (_, i) => (i + 1) * 1000);
  const labelTop = HEIGHT - 6 - (Type.stripLabel.lineHeight ?? 12) / 2; // label line box centred on y = height - 6
  const label = { position: 'absolute' as const, top: labelTop };
  const centered = (text: string, centerX: number) => {
    const half = labelWidth(text) / 2;
    const c = Math.min(Math.max(centerX, x0 + half), x1 - half);
    return { text, centerX: c, minX: c - half, maxX: c + half };
  };

  const topLabel = grouped(top);
  const zero: Span = { minX: x0, maxX: x0 + labelWidth('0') };
  const end: Span = { minX: x1 - labelWidth(topLabel), maxX: x1 };
  const altLabel = altitudeFeet == null ? null : centered(grouped(roundAway(altitudeFeet / 10) * 10), x(altitudeFeet));
  const timeLabel = shown ? centered(timeToText(shown.secondsAhead), x(shown.feet)) : null;
  // The altitude wins: a floor time it would touch moves up beside the floor label; an end label either touches goes.
  const timeMovesUp = timeLabel != null && touches(timeLabel, altLabel);
  const timeSpan = timeMovesUp ? null : timeLabel;
  const floorX = shown ? x(shown.feet) : null;

  let graphics = null;
  let floorLabel = null;
  if (altitudeFeet != null) {
    const ax = x(altitudeFeet);
    const midY = BAR_Y + BAR_H / 2;
    const target = x(altitudeFeet + verticalSpeedFPM); // one minute ahead
    const dir = target >= ax ? 1 : -1;
    graphics = (
      <>
        {floorX != null && verticalSpeedFPM >= 100 && target < floorX - 4 ? (
          // Climbing toward the floor: dashed amber from the arrow tip to it.
          <Line
            x1={target}
            y1={midY}
            x2={floorX - 4}
            y2={midY}
            stroke={t.caution}
            strokeWidth={3}
            strokeDasharray="4 4"
          />
        ) : null}
        {Math.abs(verticalSpeedFPM) >= 100 ? (
          <>
            <Line x1={ax} y1={midY} x2={target - dir * 6} y2={midY} stroke={t.ink} strokeWidth={4} />
            <Path
              d={`M${target} ${midY}L${target - dir * 9} ${midY - 6}L${target - dir * 9} ${midY + 6}Z`}
              fill={t.ink}
            />
          </>
        ) : null}
        <Path d={`M${ax - 7} 4L${ax + 7} 4L${ax} ${BAR_Y - 2}Z`} fill={t.ink} />
      </>
    );
    // Above the bar: the floor label at the right end (with the time when it moved up), else beside the marker on
    // whichever side it fits; not drawn when neither side fits.
    if (shown) {
      const moved = timeMovesUp ? timeLabel : null;
      const w = labelWidth(shown.label) + (moved ? moved.maxX - moved.minX + Space.xs : 0);
      const marker = { minX: ax - 7, maxX: ax + 7 };
      let maxX: number | null = x1;
      if (touches({ minX: x1 - w, maxX: x1 }, marker)) {
        if (marker.minX - Space.xs - w >= x0) maxX = marker.minX - Space.xs;
        else if (marker.maxX + Space.xs + w <= x1) maxX = marker.maxX + Space.xs + w;
        else maxX = null;
      }
      if (maxX != null) {
        const topY = 9 - (Type.stripLabel.lineHeight ?? 12) / 2;
        floorLabel = (
          <Text
            numberOfLines={1}
            style={[Type.stripLabel, { position: 'absolute', top: topY, left: maxX - w, width: w, color: t.airspace }]}
          >
            {moved ? <Text style={{ color: t.caution }}>{`${moved.text} `}</Text> : null}
            {shown.label}
          </Text>
        );
      }
    }
  }

  let spoken = 'No current altitude';
  if (altitudeFeet != null) {
    const vs = Math.abs(verticalSpeedFPM);
    const vertical =
      vs >= 100 ? `${verticalSpeedFPM > 0 ? 'climbing' : 'descending'} ${Math.trunc(vs)} feet per minute` : 'level';
    const ahead = shown ? `, ${spokenTitle(shown.label)} in ${spokenDuration(shown.secondsAhead)}` : '';
    spoken = `${roundAway(altitudeFeet / 10) * 10} feet, ${vertical}${ahead}`;
  }

  return (
    <View
      accessible
      accessibilityLabel="Altitude tape"
      accessibilityValue={{ text: spoken }}
      style={{ height: HEIGHT }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      <Svg width={width} height={HEIGHT} style={{ position: 'absolute' }}>
        <Rect x={x0} y={BAR_Y} width={x1 - x0} height={BAR_H} rx={3} fill={t.paperSecondary} />
        {ticks.map((ft) => (
          <Line key={ft} x1={x(ft)} y1={BAR_Y} x2={x(ft)} y2={BAR_Y + BAR_H} stroke={t.rule} strokeWidth={1.5} />
        ))}
        {floorX != null ? (
          // The airspace from its floor to the top of the scale, hatched, and a 3pt line at the floor.
          <>
            <Defs>
              <ClipPath id={clipId}>
                <Rect x={floorX} y={BAR_Y} width={x1 - floorX} height={BAR_H} />
              </ClipPath>
            </Defs>
            <Rect x={floorX} y={BAR_Y} width={x1 - floorX} height={BAR_H} fill={t.airspace} fillOpacity={0.15} />
            <G clipPath={`url(#${clipId})`}>
              {Array.from({ length: Math.ceil((x1 - floorX + BAR_H) / 7) }, (_, i) => floorX - BAR_H + i * 7).map(
                (s) => (
                  <Line
                    key={s}
                    x1={s}
                    y1={BAR_Y + BAR_H}
                    x2={s + BAR_H}
                    y2={BAR_Y}
                    stroke={t.airspace}
                    strokeOpacity={0.6}
                    strokeWidth={1.5}
                  />
                ),
              )}
            </G>
            <Line x1={floorX} y1={BAR_Y - 4} x2={floorX} y2={BAR_Y + BAR_H + 4} stroke={t.airspace} strokeWidth={3} />
          </>
        ) : null}
        {graphics}
      </Svg>
      {touches(zero, altLabel) || touches(zero, timeSpan) ? null : (
        <Text style={[Type.stripLabel, label, { left: x0, color: t.inkSecondary }]}>0</Text>
      )}
      {touches(end, altLabel) || touches(end, timeSpan) ? null : (
        <Text style={[Type.stripLabel, label, { right: width - x1, color: t.inkSecondary }]}>{topLabel}</Text>
      )}
      {timeLabel && !timeMovesUp ? (
        <Text
          style={[
            Type.stripLabel,
            label,
            { left: timeLabel.centerX - 40, width: 80, textAlign: 'center', color: t.caution },
          ]}
        >
          {timeLabel.text}
        </Text>
      ) : null}
      {altLabel ? (
        <Text
          style={[
            Type.stripLabel,
            label,
            { left: altLabel.centerX - 40, width: 80, textAlign: 'center', color: t.ink },
          ]}
        >
          {altLabel.text}
        </Text>
      ) : null}
      {floorLabel}
    </View>
  );
}
