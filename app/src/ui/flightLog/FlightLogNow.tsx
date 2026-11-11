// FlightLogNowCell + LegProgressBar (efb-212/Views/Log/FlightLogRows.swift): the active leg with its progress, GS / TRK /
// ALT with VS, the altitude tape, the Israel route cautions and the route controls. Stale rules: "---" without a fix,
// values grey and announced ", stale" when the fix is lost, ALT and VS dashed without a vertical fix. The iPhone
// variant (`compact`, 38pt readouts) is U5.
import { Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { currentLeg, isLastLeg } from '../../domain/route';
import { ArrowUp } from '../Icons';
import { SectionBand, useTheme } from '../Primitives';
import { Space, Type, tracked } from '../tokens';
import { AltitudeTape } from './AltitudeTape';
import { useFlightLog } from './hooks';
import {
  altitudeText,
  followedRoute,
  hasActiveNavigation,
  nextIdent,
  offRouteText,
  printfFixed,
  roundAway,
  routeTitle,
  tapeFloor,
  threeDigits,
} from './logic';
import { ControlButton } from './parts';

const READOUT_PT = 42; // readout digits, points

export function FlightLogNow() {
  return (
    <View>
      <SectionBand title="Now" />
      <FlightLogNowCell />
    </View>
  );
}

export function FlightLogNowCell() {
  const t = useTheme();
  const { data, stale, showsPredictions } = useFlightLog();
  const route = followedRoute(data);
  const leg = route ? currentLeg(route) : null;
  // A fix exists and the cell has something to show (values still dim when stale).
  const hasFix = data.gpsAvailable && data.hasPosition;
  const hasAltitude = data.hasAltitude;
  const vertical = hasFix && hasAltitude;
  const vs = Math.trunc(data.verticalSpeed); // feet per minute

  const gsValue = hasFix ? String(Math.trunc(data.groundSpeed)) : '---'; // knots
  const trkValue = hasFix ? threeDigits(data.track) : '---'; // degrees true
  const altValue = vertical ? String(roundAway(data.altitude / 10) * 10) : '---'; // feet MSL, nearest 10 ft
  const vsValue = vertical ? `${vs >= 0 ? '+' : ''}${vs}` : '---';
  // Climb or descent arrow; none within 100 fpm of level.
  const vsArrow = vertical && Math.abs(data.verticalSpeed) >= 100 ? (data.verticalSpeed > 0 ? 'up' : 'down') : null;
  const altDimmed = stale || !hasAltitude;

  const ident = nextIdent(data);
  const clear = (
    <ControlButton
      title="Clear"
      label={`Clear ${routeTitle(data) ?? 'navigation'}`}
      testID="clear-direct-to"
      onPress={data.actions.clear}
    />
  );
  const following = route?.following;
  const offRoute = following?.isOffRoute ? offRouteText(following) : null;
  const altitudeCaution = following?.isAltitudeCaution && leg ? altitudeText(following, leg.altitudeText) : null;

  return (
    <View accessibilityLabel="Now" style={{ padding: Space.m, gap: Space.s, backgroundColor: t.activeCell }}>
      {route && leg ? (
        <View style={{ gap: Space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: Space.s }}>
            <LegText from={leg.fromCode} to={leg.toCode} testID="israel-route-leg" />
            <Text
              accessibilityLabel={`Published altitude ${leg.altitudeText} feet`}
              testID="israel-route-altitude"
              style={[Type.dataEmphasis, { color: t.ink }]}
            >
              {`${leg.altitudeText} FT MSL`}
            </Text>
          </View>
          {data.distanceToNext != null && leg.distanceNM > 0 ? (
            <LegProgress toGo={data.distanceToNext} length={leg.distanceNM} />
          ) : null}
        </View>
      ) : ident != null ? (
        <LegText from={data.directTo == null ? (data.planDeparture ?? 'PPOS') : 'DIRECT'} to={ident} />
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Readout label="GS kt" value={gsValue} name="Ground speed" unit="knots" dimmed={stale} />
        <Readout label={'TRK \u00B0T'} value={trkValue} name="Track" unit="degrees true" dimmed={stale} />
        <View
          accessible
          accessibilityLabel="Altitude"
          accessibilityValue={{
            text: `${altValue} feet, vertical speed ${vsValue} feet per minute${altDimmed ? ', stale' : ''}`,
          }}
        >
          <ReadoutLabel text="ALT ft MSL" />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.xs }}>
            <Text style={[Type.readout(READOUT_PT), { color: altDimmed ? t.inkSecondary : t.ink }]}>{altValue}</Text>
            {/* The arrow is out of flow so the row aligns on the "+475" baseline. */}
            <View style={{ paddingLeft: vsArrow && !altDimmed ? 16 : 0 }}>
              <Text style={[Type.dataEmphasis, { color: altDimmed ? t.inkSecondary : t.ink }]}>{vsValue}</Text>
              {vsArrow && !altDimmed ? (
                <View
                  style={{
                    position: 'absolute',
                    left: 1,
                    top: 0,
                    bottom: 0,
                    justifyContent: 'center',
                    transform: vsArrow === 'down' ? [{ rotate: '180deg' }] : undefined,
                  }}
                >
                  <ArrowUp color={t.ink} size={14} />
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </View>
      <AltitudeTape
        altitudeFeet={hasFix && hasAltitude && !stale ? data.altitude : null}
        verticalSpeedFPM={data.verticalSpeed}
        floor={showsPredictions && !stale ? tapeFloor(data.predictedEvents) : null}
      />
      {offRoute ? <Caution text={offRoute} testID="israel-route-off-route" /> : null}
      {altitudeCaution ? <Caution text={altitudeCaution} testID="israel-route-altitude-caution" /> : null}
      {route ? (
        <View style={{ flexDirection: 'row', gap: Space.s }}>
          <ControlButton
            title="Prev"
            label="Previous leg"
            testID="israel-route-previous"
            enabled={route.currentLeg > 0}
            onPress={() => data.actions.sequenceRoute(false)}
          />
          <ControlButton
            title="Next"
            label="Next leg"
            testID="israel-route-next"
            enabled={!isLastLeg(route)}
            onPress={() => data.actions.sequenceRoute(true)}
          />
          <View style={{ flex: 1 }} />
          {clear}
        </View>
      ) : hasActiveNavigation(data) ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>{clear}</View>
      ) : null}
    </View>
  );
}

/**
 * "DIRECT \u25B8 KOAK": no bundled face has U+25B8 (iOS falls back to a system face), so the triangle is drawn in a
 * 27pt slot: a Plex space, the glyph's 9pt advance, a Plex space.
 */
function LegText({ from, to, testID }: { from: string; to: string; testID?: string }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Leg ${from} to ${to}`}
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}
    >
      <Text numberOfLines={1} style={[Type.dataEmphasis, { color: t.ink }]}>
        {from}
      </Text>
      <Svg width={27} height={19.5}>
        <Path d="M10 8.2L16 11.6L10 15Z" fill={t.ink} />
      </Svg>
      <Text numberOfLines={1} style={[Type.dataEmphasis, { color: t.ink, flexShrink: 1 }]}>
        {to}
      </Text>
    </View>
  );
}

/** LegProgressBar: distance flown along the active leg in route magenta, with "4.5 / 12.0 NM". */
function LegProgress({ toGo, length }: { toGo: number; length: number }) {
  const t = useTheme();
  const flown = Math.min(Math.max(length - toGo, 0), length); // nautical miles
  const fraction = Math.min(Math.max(flown / length, 0), 1);
  return (
    <View
      accessible
      accessibilityLabel="Leg progress"
      accessibilityValue={{ text: `${printfFixed(flown, 1)} of ${printfFixed(length, 1)} nautical miles flown` }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s }}
    >
      <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: t.paperSecondary, overflow: 'hidden' }}>
        <View style={{ width: `${fraction * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.route }} />
      </View>
      <Text numberOfLines={1} style={[Type.data, { color: t.inkSecondary }]}>
        {`${printfFixed(flown, 1)} / ${printfFixed(length, 1)} NM`}
      </Text>
    </View>
  );
}

/** Amber route caution: amber type on an amber rule (no filled amber block at night). */
function Caution({ text, testID }: { text: string; testID: string }) {
  const t = useTheme();
  return (
    <View testID={testID} style={{ paddingVertical: Space.s, paddingHorizontal: Space.m }}>
      <Text style={[Type.dataEmphasis, { color: t.caution }]}>{text}</Text>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: t.caution }} />
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

function Readout({
  label,
  value,
  name,
  unit,
  dimmed,
}: {
  label: string;
  value: string;
  name: string;
  unit: string;
  dimmed: boolean;
}) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={name}
      accessibilityValue={{ text: `${value} ${unit}${dimmed ? ', stale' : ''}` }}
    >
      <ReadoutLabel text={label} />
      <Text numberOfLines={1} style={[Type.readout(READOUT_PT), { color: dimmed ? t.inkSecondary : t.ink }]}>
        {value}
      </Text>
    </View>
  );
}
