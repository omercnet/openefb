// FlightLogNext (efb-212/Views/Log/FlightLogStrip.swift): the next waypoint with its time-to in the largest type on
// screen, then the later route points; with no navigation, the nearest airport as a quiet row and Plan a flight. With
// predictions on (stage 2) predicted airspace entries join the rows in time order: the soonest item is the loud top row
// (an amber or red block when it is an event), at most 3 later rows, then "+N more". The iPhone rail (`compact`) is U5.
import { Text, View } from 'react-native';
import type { PredictedEvent } from '../../domain/prediction';
import { destinationCode, type ActiveRouteLeg } from '../../domain/route';
import { hasAirportData } from '../../domain/core';
import { WarningTriangle } from '../Icons';
import { ColumnRule, Pressy, SectionBand, useTheme } from '../Primitives';
import { Radius, Space, StripMetrics, Type } from '../tokens';
import { useFlightLog } from './hooks';
import {
  followedRoute,
  holdText,
  nextDataSpoken,
  nextDataText,
  nextIdent,
  nextItemId,
  nextItems,
  printfFixed,
  spokenDuration,
  spokenEvent,
  splitNext,
  threeDigits,
  timeToText,
  type NextItem,
} from './logic';
import { Diamond } from './parts';

const LATER_CAP = 3;
const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const;
/** lineLimit(1).minimumScaleFactor(scale): RN shrinks the text instead of truncating (native only; web truncates). */
const shrink = (scale: number) => ({ numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: scale }) as const;

export function FlightLogNext() {
  const t = useTheme();
  const { data, stale, showsPredictions, nearestEntry } = useFlightLog();
  const ete = data.estimatedTimeEnroute; // seconds
  // Below 30 kt, without an ETE or on a stale fix the times are not meaningful: show "---".
  const quiet = data.groundSpeed < 30 || ete == null || stale; // knots
  const route = followedRoute(data);
  // Predicted entries, soonest first; none when the toggle is off or the fix is stale.
  const events = showsPredictions && !stale ? data.predictedEvents : [];
  // The route points after the next one (Israel CVFR routes).
  const legs = route ? route.legs.slice(route.currentLeg + 1) : [];
  let sectionDetail: string | undefined;
  if (data.directTo != null) sectionDetail = 'direct';
  else if (route) sectionDetail = 'route';
  else if (data.activeFlightPlan) sectionDetail = 'plan';

  const ident = nextIdent(data);
  /** Seconds to the end of `legs[index]`: time to the next point plus the legs after it at ground speed. */
  const cumulativeTime = (index: number): number | null => {
    if (quiet || ete == null) return null;
    const distance = legs.slice(0, index + 1).reduce((sum, leg) => sum + leg.distanceNM, 0); // nautical miles
    return ete + (distance / data.groundSpeed) * 3600;
  };
  const waypointTimes = ident == null ? [] : [quiet ? null : ete, ...legs.map((_, i) => cumulativeTime(i))];
  const rows = splitNext(nextItems(events, waypointTimes), LATER_CAP);

  // Israel routes read their ETA in Israel time (the route-following ETA); Direct-To and US plans in device time.
  let eta: number | null = null;
  if (route) eta = route.following.nextPointETA;
  else if (!quiet && ete != null) eta = data.nowMs + ete * 1000;
  const next = {
    distanceNM: data.distanceToNext,
    bearingTrue: data.bearingToNext,
    eta,
    timeZone: route ? 'Asia/Jerusalem' : data.timeZone,
    stale,
  };
  const dataText = nextDataText(next);
  const nextTestID = route ? 'israel-route-next-point' : 'next-waypoint';
  const spokenLine = (id: string) => {
    const parts = [`NEXT ${id}`];
    if (!quiet && ete != null) parts.push(`in ${spokenDuration(ete)}`);
    const spokenData = nextDataSpoken(next);
    if (spokenData) parts.push(spokenData);
    return parts.join(' \u00B7 ');
  };

  // The time-to is the big element; without a meaningful time the ident takes its place and "---" stays small.
  const nextRow = (id: string) => {
    const time = (
      <Text
        {...hidden}
        {...shrink(0.3)}
        style={[quiet ? Type.data : Type.nextTime, { color: quiet ? t.inkSecondary : t.ink }]}
      >
        {quiet || ete == null ? '---' : timeToText(ete)}
      </Text>
    );
    const identText = (
      <Text
        {...shrink(quiet ? 0.3 : 0.6)}
        accessibilityLabel={spokenLine(id)}
        testID={nextTestID}
        style={[quiet ? Type.nextTime : Type.rowIdent, { color: stale ? t.inkSecondary : t.ink, flexShrink: 1 }]}
      >
        {id}
      </Text>
    );
    return (
      <View style={{ padding: Space.m, backgroundColor: t.activeCell }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.m }}>
          {quiet ? identText : time}
          {quiet ? time : identText}
        </View>
        <Text {...hidden} style={[Type.data, { color: t.inkSecondary, marginTop: Space.xs }]}>
          {dataText}
        </Text>
      </View>
    );
  };

  /** Amber text and glyphs for a caution, red for a warning. */
  const tone = (event: PredictedEvent) => (event.severity === 'warning' ? t.warning : t.caution);

  // The amber (red) next-thing block. Day: filled, black (white on red) text. Night: no fill, a 5pt rule, amber text.
  const eventBlock = (event: PredictedEvent) => {
    const warning = event.severity === 'warning';
    const accent = tone(event);
    let ink = 'black';
    if (t.night) ink = accent;
    else if (warning) ink = t.onWarning;
    let fill = t.cautionFill;
    if (t.night) fill = t.activeCell;
    else if (warning) fill = t.warning;
    return (
      <View
        accessible
        accessibilityLabel={spokenEvent(event)}
        testID="next-predicted-event"
        style={{ padding: Space.m, paddingLeft: Space.m + (t.night ? 5 : 0), backgroundColor: fill }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.m }}>
          <Text {...shrink(0.3)} style={[Type.nextTime, { color: ink }]}>
            {timeToText(event.secondsAhead)}
          </Text>
          <Text {...shrink(0.5)} style={[Type.rowIdent, { color: ink, flexShrink: 1 }]}>
            {event.title}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginTop: Space.xs }}>
          <WarningTriangle color={ink} bang={fill} />
          <Text style={[Type.data, { color: ink, flexShrink: 1 }]}>{holdText(event.assumption)}</Text>
        </View>
        {t.night ? (
          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: accent }} />
        ) : null}
      </View>
    );
  };

  /** A later row: time-to in row size beside the ident and a data line; `toneColor` adds the event diamond. */
  const laterLayout = (timeTo: number | null, toneColor: string | null, title: string, detail: string) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Space.s,
        paddingHorizontal: Space.m,
        paddingVertical: Space.s,
      }}
    >
      {toneColor ? <Diamond color={toneColor} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.m, flexShrink: 1 }}>
        <Text
          {...shrink(0.5)}
          style={[Type.rowTime, { color: timeTo == null ? t.inkSecondary : (toneColor ?? t.ink) }]}
        >
          {timeTo == null ? '---' : timeToText(timeTo)}
        </Text>
        <View style={{ flexShrink: 1 }}>
          <Text {...shrink(0.6)} style={[Type.rowIdent, { color: t.ink }]}>
            {title}
          </Text>
          <Text style={[Type.data, { color: t.inkSecondary }]}>{detail}</Text>
        </View>
      </View>
    </View>
  );

  const eventRow = (event: PredictedEvent) => (
    <View accessible accessibilityLabel={spokenEvent(event)} testID="next-predicted-event-row">
      {laterLayout(event.secondsAhead, tone(event), event.title, event.assumption)}
    </View>
  );

  // Index 0 is the next waypoint (pushed down by a sooner event), then the later route points.
  const waypointRow = (index: number, timeTo: number | null, later: readonly ActiveRouteLeg[]) => {
    if (index === 0 && ident != null) {
      return (
        <View accessible accessibilityLabel={spokenLine(ident)} testID={nextTestID}>
          {laterLayout(timeTo, null, ident, dataText)}
        </View>
      );
    }
    const leg = later[index - 1];
    if (!leg) return null;
    return (
      <View
        accessible
        accessibilityLabel={`Then ${leg.toCode}, ${leg.altitudeText} feet`}
        accessibilityValue={{
          text: timeTo == null ? 'no time while slow or without a fix' : `in ${spokenDuration(timeTo)}`,
        }}
      >
        {laterLayout(timeTo, null, leg.toCode, `${leg.altitudeText} FT \u00B7 ${printfFixed(leg.distanceNM, 1)} NM`)}
      </View>
    );
  };

  const item = (row: NextItem, top: boolean) => {
    if (row.kind === 'event') return top ? eventBlock(row.event) : eventRow(row.event);
    if (top && row.index === 0 && ident != null) return nextRow(ident);
    return waypointRow(row.index, row.secondsAhead, legs);
  };

  let nearestText: string;
  if (!hasAirportData(data.region)) nearestText = 'No airport data yet';
  else if (!nearestEntry) nearestText = data.gpsAvailable ? 'No landable airport in range' : 'Waiting for GPS';
  else {
    const { airport, distance, bearing } = nearestEntry;
    nearestText = `NRST ${airport.icao} ${printfFixed(distance, 1)} NM \u00B7 ${threeDigits(bearing)}\u00B0`;
  }
  const destination = route ? destinationCode(route) : null;

  return (
    <View>
      <SectionBand title="Next" detail={sectionDetail} />
      {rows.top ? item(rows.top, true) : null}
      {rows.later.map((row, index) => (
        // Swift ids are not unique when one volume is predicted twice: the index keeps React keys apart.
        <View key={`${nextItemId(row)}/${index}`}>
          <ColumnRule />
          {item(row, false)}
        </View>
      ))}
      {rows.hiddenCount > 0 ? (
        <>
          <ColumnRule />
          <Text
            testID="next-more-points"
            style={[Type.data, { color: t.inkSecondary, paddingHorizontal: Space.m, paddingVertical: Space.s }]}
          >
            {`+${rows.hiddenCount} more` + (destination != null ? ` to ${destination}` : '')}
          </Text>
        </>
      ) : null}
      {ident == null ? (
        <>
          {rows.top ? <ColumnRule /> : null}
          <Text accessibilityLabel={nearestText} style={[Type.data, { color: t.inkSecondary, padding: Space.m }]}>
            {nearestText}
          </Text>
          <Pressy
            accessibilityLabel="Plan a flight"
            onPress={data.actions.openLog}
            testID="plan-a-flight"
            style={{
              marginHorizontal: Space.m,
              marginBottom: Space.m,
              minHeight: StripMetrics.cell,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: Radius.s,
              borderWidth: 1,
              borderColor: t.rule,
              backgroundColor: t.activeCell,
            }}
          >
            <Text style={[Type.dataEmphasis, { color: t.ink, textAlign: 'center' }]}>Plan a flight</Text>
          </Pressy>
        </>
      ) : null}
    </View>
  );
}
