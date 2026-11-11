// CVFRDebriefProfileView (efb-212/Views/Flights/CVFRDebriefProfileView.swift): the flight on one distance axis in three bands. ROUTE
// is the straightened route with its reporting points; ALTITUDE is the published altitude per leg with its +-200 ft band against the
// flown altitude, scored stretches outside the band in amber and aerodrome zones hatched as not scored; RADIO is the position report
// at each point. No overall score: the verdict line names at most the two findings to look at. What is drawn is worked out in
// domain/debrief/cvfrProfile.ts. Units: nautical miles along the route (x), feet MSL (y).
import { useState, type ReactNode } from 'react';
import { Text, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import Svg, { Circle, ClipPath, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { isAerodromeCode, verdictHeadline, tightBandFeet, type CVFRDebrief } from '../../domain/debrief/cvfrDebrief';
import {
  BAND_HEIGHTS,
  TIME_ROW_HEIGHT,
  altitudeSummary,
  axisX,
  excursionShape,
  labelRows,
  longestLabel,
  profileModel,
  radioSummary,
  routeSummary,
  thousandFootRules,
  type ProfileModel,
} from '../../domain/debrief/cvfrProfile';
import { clockText } from '../../domain/debrief/cvfrView';
import { WarningTriangle } from '../Icons';
import { useTheme } from '../Primitives';
import { Radius, Space, Type, tracked, type Theme } from '../tokens';

/** IBM Plex Mono advances 0.6 em: the width of a label drawn in it, points. */
const monoWidth = (text: string, fontSize: number) => Array.from(text).length * fontSize * 0.6;

/** An SVG text style from a type role. `top` anchors the text by its top edge, as SwiftUI's `anchor: .top` does. */
function font(role: TextStyle) {
  const size = role.fontSize ?? 15;
  return { fontFamily: role.fontFamily, fontSize: size, ascent: size * 0.8 };
}

interface BandProps {
  debrief: CVFRDebrief;
  model: ProfileModel;
  width: number;
  t: Theme;
}

function Hatch({
  id,
  x,
  top,
  width,
  height,
  color,
}: {
  id: string;
  x: number;
  top: number;
  width: number;
  height: number;
  color: string;
}) {
  let d = '';
  for (let start = x - height; start < x + width; start += 7) d += `M${start} ${top + height}L${start + height} ${top}`;
  return (
    <>
      <ClipPath id={id}>
        <Rect x={x} y={top} width={width} height={height} />
      </ClipPath>
      <G clipPath={`url(#${id})`}>
        <Path d={d} stroke={color} strokeOpacity={0.5} strokeWidth={1} />
      </G>
    </>
  );
}

function Zones({
  prefix,
  model,
  width,
  top,
  bottom,
  t,
}: {
  prefix: string;
  model: ProfileModel;
  width: number;
  top: number;
  bottom: number;
  t: Theme;
}) {
  return (
    <>
      {model.zones.map((zone, i) => {
        const left = axisX(zone.from, model.totalNM, width);
        const right = axisX(zone.to, model.totalNM, width);
        return (
          <Hatch
            key={i}
            id={`${prefix}-${i}`}
            x={left}
            top={top}
            width={Math.max(1, right - left)}
            height={bottom - top}
            color={t.inkSecondary}
          />
        );
      })}
    </>
  );
}

function WaypointRules({
  model,
  width,
  top,
  bottom,
  t,
}: {
  model: ProfileModel;
  width: number;
  top: number;
  bottom: number;
  t: Theme;
}) {
  return (
    <>
      {model.stops.map((stop, i) => {
        const x = axisX(stop.distanceNM, model.totalNM, width);
        return (
          <Line
            key={i}
            x1={x}
            y1={top}
            x2={x}
            y2={bottom}
            stroke={t.inkSecondary}
            strokeWidth={1}
            strokeDasharray="2,4"
          />
        );
      })}
    </>
  );
}

function RouteBand({ model, width, t }: BandProps) {
  const height = BAND_HEIGHTS.route;
  const lineY = 28;
  const rows = labelRows(model.stops, model.totalNM, width);
  const code = font(Type.dataEmphasis);
  const hebrew = font(Type.caption);
  return (
    <Svg width={width} height={height}>
      <Zones prefix="hatch-route" model={model} width={width} top={0} bottom={height} t={t} />
      <Line
        x1={axisX(0, model.totalNM, width)}
        y1={lineY}
        x2={axisX(model.totalNM, model.totalNM, width)}
        y2={lineY}
        stroke={t.route}
        strokeWidth={4}
      />
      {model.stops.map((stop, i) => {
        const cx = axisX(stop.distanceNM, model.totalNM, width);
        const labelTop = lineY + 16 + (rows[i] ?? 0) * 40;
        return (
          <G key={i}>
            {isAerodromeCode(stop.code) ? (
              <Circle cx={cx} cy={lineY} r={7} fill={t.activeCell} stroke={t.ink} strokeWidth={2.5} />
            ) : (
              <Polygon
                points={`${cx},${lineY - 10} ${cx + 9},${lineY + 7} ${cx - 9},${lineY + 7}`}
                fill={t.activeCell}
                stroke={t.ink}
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
            )}
            <SvgText
              x={cx}
              y={labelTop + code.ascent}
              textAnchor="middle"
              fill={t.ink}
              fontFamily={code.fontFamily}
              fontSize={code.fontSize}
            >
              {stop.code}
            </SvgText>
            {stop.passage?.nameHebrew ? (
              <SvgText
                x={cx}
                y={labelTop + 19 + hebrew.ascent}
                textAnchor="middle"
                fill={t.inkSecondary}
                fontFamily={hebrew.fontFamily}
                fontSize={hebrew.fontSize}
              >
                {stop.passage.nameHebrew}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

function AltitudeBand({ debrief, model, width, t }: BandProps) {
  const height = BAND_HEIGHTS.altitude;
  const top = 8;
  const bottom = height - TIME_ROW_HEIGHT;
  const { low, high } = model.altitudeRange;
  const x = (nm: number) => axisX(nm, model.totalNM, width);
  const y = (feet: number) => bottom - ((feet - low) / (high - low)) * (bottom - top);
  const band = tightBandFeet;
  const stripLabel = font(Type.stripLabel);
  const data = font(Type.data);
  const strong = font(Type.dataEmphasis);

  let step = '';
  const second: string[] = [];
  const fills: { x: number; y: number; width: number; height: number }[] = [];
  debrief.legs.forEach((leg, i) => {
    const values = model.published[i] ?? [];
    const x0 = x(leg.startDistanceNM);
    const x1 = x(leg.endDistanceNM);
    for (const value of values)
      fills.push({ x: x0, y: y(value + band), width: x1 - x0, height: y(value - band) - y(value + band) });
    const [first, ...rest] = values;
    if (first === undefined) return;
    step += `${step === '' ? 'M' : 'L'}${x0} ${y(first)}L${x1} ${y(first)}`;
    for (const value of rest) second.push(`M${x0} ${y(value)}L${x1} ${y(value)}`);
  });

  const trace = debrief.profile.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(s.distanceNM)} ${y(s.altitudeFeet)}`).join('');

  const worst = model.longest;
  const worstSamples =
    worst === null ? [] : debrief.profile.slice(worst.sampleRange.lower, worst.sampleRange.upper + 1);
  let tag: { x: number; y: number; width: number; height: number; label: string } | null = null;
  const firstWorst = worstSamples[0];
  const lastWorst = worstSamples[worstSamples.length - 1];
  if (worst !== null && firstWorst && lastWorst) {
    const label = longestLabel(worst);
    const boxWidth = monoWidth(label, strong.fontSize) + 2 * Space.s;
    const boxHeight = strong.fontSize * 1.3 + Space.s;
    const mid = Math.min(
      Math.max(x((firstWorst.distanceNM + lastWorst.distanceNM) / 2), boxWidth / 2),
      width - boxWidth / 2,
    );
    const altitudes = worstSamples.map((s) => s.altitudeFeet);
    const anchorY = worst.deviationFeet < 0 ? y(Math.min(...altitudes)) + 6 : y(Math.max(...altitudes)) - 6 - boxHeight;
    tag = {
      x: mid - boxWidth / 2,
      y: Math.min(Math.max(top, anchorY), bottom - boxHeight),
      width: boxWidth,
      height: boxHeight,
      label,
    };
  }

  return (
    <Svg width={width} height={height}>
      {thousandFootRules({ low, high }).map((feet) => (
        <G key={feet}>
          <Line x1={x(0)} y1={y(feet)} x2={x(model.totalNM)} y2={y(feet)} stroke={t.rule} strokeWidth={1} />
          <SvgText
            x={x(model.totalNM) + 6}
            y={y(feet) + stripLabel.fontSize * 0.35}
            fill={t.inkSecondary}
            fontFamily={stripLabel.fontFamily}
            fontSize={stripLabel.fontSize}
          >
            {`${Math.round(feet / 1000)}k`}
          </SvgText>
        </G>
      ))}
      <Zones prefix="hatch-altitude" model={model} width={width} top={top} bottom={bottom} t={t} />
      {model.zones.map((zone, i) => (
        <SvgText
          key={i}
          x={x((zone.from + zone.to) / 2)}
          y={top + stripLabel.ascent}
          textAnchor="middle"
          fill={t.inkSecondary}
          fontFamily={stripLabel.fontFamily}
          fontSize={stripLabel.fontSize}
        >
          not scored
        </SvgText>
      ))}
      {fills.map((f, i) => (
        <Rect key={i} x={f.x} y={f.y} width={f.width} height={f.height} fill={t.route} fillOpacity={0.12} />
      ))}
      {second.map((d, i) => (
        <Path key={i} d={d} stroke={t.route} strokeWidth={2.5} />
      ))}
      <Path d={step} stroke={t.route} strokeWidth={2.5} fill="none" />
      {model.excursions.map((excursion, i) => {
        const shape = excursionShape(model, debrief, excursion);
        if (shape === null) return null;
        const first = shape.samples[0];
        const last = shape.samples[shape.samples.length - 1];
        if (first === undefined || last === undefined) return null;
        const d = `M${x(first.distanceNM)} ${y(shape.edgeFeet)}${shape.samples.map((s) => `L${x(s.distanceNM)} ${y(s.altitudeFeet)}`).join('')}L${x(last.distanceNM)} ${y(shape.edgeFeet)}Z`;
        // Night: an amber rule and no fill.
        return <Path key={i} d={d} fill={t.night ? 'none' : t.cautionFill} stroke={t.caution} strokeWidth={1.5} />;
      })}
      <Path d={trace} stroke={t.ink} strokeWidth={2.2} strokeLinejoin="round" fill="none" />
      <WaypointRules model={model} width={width} top={top} bottom={bottom} t={t} />
      {model.stops.map((stop, i) => {
        if (!stop.passage) return null;
        const isLast = i === model.stops.length - 1;
        return (
          <SvgText
            key={i}
            x={x(stop.distanceNM) + (isLast ? 0 : 4)}
            y={height - 5}
            textAnchor={isLast ? 'end' : 'start'}
            fill={t.inkSecondary}
            fontFamily={data.fontFamily}
            fontSize={data.fontSize}
          >
            {clockText(stop.passage.time, false)}
          </SvgText>
        );
      })}
      {tag ? (
        <G>
          <Rect
            x={tag.x}
            y={tag.y}
            width={tag.width}
            height={tag.height}
            rx={Radius.s}
            fill={t.activeCell}
            stroke={t.caution}
            strokeWidth={2}
          />
          <SvgText
            x={tag.x + tag.width / 2}
            y={tag.y + tag.height / 2 + strong.fontSize * 0.35}
            textAnchor="middle"
            fill={t.caution}
            fontFamily={strong.fontFamily}
            fontSize={strong.fontSize}
          >
            {tag.label}
          </SvgText>
        </G>
      ) : null}
    </Svg>
  );
}

function RadioBand({ debrief, model, width, t }: BandProps) {
  const height = BAND_HEIGHTS.radio;
  const rows = labelRows(model.stops, model.totalNM, width);
  const strong = font(Type.dataEmphasis);
  const data = font(Type.data);
  const caption = font(Type.caption);
  return (
    <Svg width={width} height={height}>
      {model.stops.map((stop, i) => {
        const passage = stop.passage;
        if (!passage) return null;
        const cx = axisX(stop.distanceNM, model.totalNM, width);
        const rowTop = 4 + (rows[i] ?? 0) * 50;
        const statusTop = rowTop + 22;
        return (
          <G key={i}>
            <SvgText
              x={cx}
              y={rowTop + strong.ascent}
              textAnchor="middle"
              fill={t.ink}
              fontFamily={strong.fontFamily}
              fontSize={strong.fontSize}
            >
              {stop.code}
            </SvgText>
            {!debrief.transcriptAvailable ? (
              <SvgText
                x={cx}
                y={statusTop + caption.ascent}
                textAnchor="middle"
                fill={t.inkSecondary}
                fontFamily={caption.fontFamily}
                fontSize={caption.fontSize}
              >
                not checked
              </SvgText>
            ) : passage.reported ? (
              <SvgText
                x={cx}
                y={statusTop + data.ascent}
                textAnchor="middle"
                fill={t.ok}
                fontFamily={data.fontFamily}
                fontSize={data.fontSize}
              >
                {passage.reportTime === null ? 'heard' : `heard ${clockText(passage.reportTime, false)}`}
              </SvgText>
            ) : !isAerodromeCode(stop.code) ? (
              // An amber rule and amber type: the same chip day and night.
              <G>
                <Rect
                  x={cx - (monoWidth('\u25B2 not heard', strong.fontSize) + 2 * Space.s) / 2}
                  y={statusTop}
                  width={monoWidth('\u25B2 not heard', strong.fontSize) + 2 * Space.s}
                  height={strong.fontSize * 1.3 + 2 * Space.xs}
                  rx={Radius.s}
                  fill="none"
                  stroke={t.caution}
                  strokeWidth={1.5}
                />
                <SvgText
                  x={cx}
                  y={statusTop + Space.xs + strong.ascent}
                  textAnchor="middle"
                  fill={t.caution}
                  fontFamily={strong.fontFamily}
                  fontSize={strong.fontSize}
                >
                  {'\u25B2 not heard'}
                </SvgText>
              </G>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}

function Band({
  title,
  detail,
  summary,
  children,
}: {
  title: string;
  detail: string;
  summary: string;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <View accessible accessibilityLabel={summary} style={{ gap: Space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.s }}>
        <Text style={[Type.stripLabel, tracked, { color: t.ink, textTransform: 'uppercase' }]}>{title}</Text>
        <Text style={[Type.stripLabel, { color: t.inkSecondary }]}>{detail}</Text>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {children}
      </View>
    </View>
  );
}

/** One finding as an amber chip: a rule and amber type, day and night (no filled amber block); the triangle keeps it from being colour only. */
function Chip({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel={`Caution: ${text}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Space.xs,
        paddingHorizontal: Space.m,
        paddingVertical: Space.s,
        borderRadius: Radius.s,
        borderWidth: 1.5,
        borderColor: t.caution,
      }}
    >
      <WarningTriangle color={t.caution} bang={t.paper} />
      <Text style={[Type.dataEmphasis, { color: t.caution }]}>{text}</Text>
    </View>
  );
}

export function CVFRDebriefProfile({ debrief }: { debrief: CVFRDebrief }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const model = profileModel(debrief);
  if (model.totalNM <= 0) return null;
  const headline = verdictHeadline(model.findings.length);
  const verdictLabel = [
    headline,
    ...model.findings.map((f) => `Caution: ${f}`),
    ...(debrief.transcriptAvailable ? [] : ['Reports not checked: no transcript.']),
  ].join('. ');
  const props = { debrief, model, width, t };
  return (
    <View
      testID="cvfr-profile"
      style={{ gap: Space.m }}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
    >
      <View
        testID="cvfr-verdict"
        accessible
        accessibilityLabel={verdictLabel}
        style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.s }}
      >
        <Text style={[Type.identifier, { color: t.ink }]}>{headline}</Text>
        {model.findings.map((finding) => (
          <Chip key={finding} text={finding} />
        ))}
        {debrief.transcriptAvailable ? null : (
          <Text style={[Type.caption, { color: t.inkSecondary }]}>Reports not checked: no transcript.</Text>
        )}
      </View>
      {width > 0 ? (
        <>
          <Band title="Route" detail="straightened" summary={routeSummary(model)}>
            <RouteBand {...props} />
          </Band>
          <Band title="Altitude" detail="published ±200 ft, flown" summary={altitudeSummary(debrief, model)}>
            <AltitudeBand {...props} />
          </Band>
          <Band title="Radio" detail="position report at each point" summary={radioSummary(debrief, model)}>
            <RadioBand {...props} />
          </Band>
        </>
      ) : null}
    </View>
  );
}
