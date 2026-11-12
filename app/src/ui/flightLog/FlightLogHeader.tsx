// FlightLogHeader (efb-212/Views/Log/FlightLogRows.swift): LOG, route title, SEARCH, BRIEF (Israel), CLEAR (instruments
// hidden), REC. 60pt high; the controls keep their full cell width, the title takes what is left on one line. With the
// flight log hidden (`showsNextTime`, the full-width header of the U5 layout) the title carries the next time-to, or the
// soonest predicted entry in amber (red for a warning).
import { Text, View } from 'react-native';
import { ListBullet, Magnifier, Xmark } from '../Icons';
import { useTheme } from '../Primitives';
import { useAppStore } from '../state/appStore';
import { Space, StripMetrics, Type } from '../tokens';
import { hasAirportData } from '../../domain/core';
import { useFlightLog } from './hooks';
import {
  hasActiveNavigation,
  nextIdent,
  nextItems,
  routeTitle,
  spokenDuration,
  spokenEvent,
  timeToText,
} from './logic';
import { DocMagnifier, FlightLogCellButton } from './parts';
import { RecordButton } from './RecordButton';

export function FlightLogHeader({
  showsNextTime = false,
  onClear,
}: {
  /** The flight log is hidden (no NEXT on screen): the title carries the next waypoint's time-to. */
  showsNextTime?: boolean;
  /** The instruments are hidden (no NOW cell): the header carries Clear while navigation is active. */
  onClear?: () => void;
}) {
  const t = useTheme();
  const { data, stale, showsPredictions } = useFlightLog();
  const setStripColumn = useAppStore((s) => s.setStripColumn);
  const ident = nextIdent(data);
  const ete = data.estimatedTimeEnroute; // seconds
  const route = routeTitle(data);

  // The predicted entry the title carries instead of the waypoint time when it comes first.
  const first =
    showsNextTime && showsPredictions && !stale
      ? nextItems(data.predictedEvents, ident == null ? [] : [ete])[0]
      : undefined;
  const event = first?.kind === 'event' ? first.event : null;
  // "9:12" to the next waypoint; none when hidden, with no next waypoint, no ETE or a stale fix.
  const next =
    !event && showsNextTime && ident != null && !stale && ete != null
      ? { text: timeToText(ete), spoken: spokenDuration(ete) }
      : null;

  let title = null;
  if (event) {
    const tone = event.severity === 'warning' ? t.warning : t.caution;
    const part = <Text style={{ color: tone }}>{`${event.title} \u00B7 ${timeToText(event.secondsAhead)}`}</Text>;
    title = route ? (
      <>
        <Text style={{ color: t.ink }}>{`${route} \u00B7 `}</Text>
        {part}
      </>
    ) : (
      part
    );
  } else if (route) {
    title = <Text style={{ color: t.ink }}>{next ? `${route} \u00B7 ${next.text}` : route}</Text>;
  }
  const spoken = [
    route ? `Route ${route}` + (next ? `, next in ${next.spoken}` : '') : null,
    event ? spokenEvent(event) : null,
  ]
    .filter((s) => s != null)
    .join(', ');

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: StripMetrics.cell,
        backgroundColor: t.paperSecondary,
      }}
    >
      <FlightLogCellButton
        title="Log"
        label="Flight log"
        icon={<ListBullet color={t.ink} />}
        onPress={data.actions.openLog}
        testID="flight-log-button"
      />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
        accessibilityLabel={spoken || 'No route'}
        testID={title ? 'active-navigation-bar' : 'no-route'}
        style={[Type.dataEmphasis, { color: t.inkSecondary, flex: 1, paddingHorizontal: Space.s }]}
      >
        {title ?? 'No route'}
      </Text>
      {hasAirportData(data.region) ? (
        <FlightLogCellButton
          title="Search"
          label="Search airports"
          icon={<Magnifier color={t.ink} />}
          onPress={() => setStripColumn('search')}
        />
      ) : null}
      {data.region === 'israel' ? (
        // Israel NOTAM briefing (IL-BRIEF)
        <FlightLogCellButton
          title="Brief"
          label="NOTAM briefing"
          icon={<DocMagnifier color={t.ink} />}
          onPress={data.actions.openBriefing}
          testID="israel-briefing-button"
        />
      ) : null}
      {onClear && hasActiveNavigation(data) ? (
        <FlightLogCellButton
          title="Clear"
          label={`Clear ${route ?? 'navigation'}`}
          icon={<Xmark color={t.ink} size={17} />}
          onPress={onClear}
          testID="clear-direct-to"
        />
      ) : null}
      {data.recording ? (
        <RecordButton
          status={data.recording.status}
          elapsed={data.recording.elapsedSeconds}
          level={data.recording.levelDBFS}
          microphoneDenied={data.recording.microphoneDenied}
          onPress={data.actions.record}
        />
      ) : null}
    </View>
  );
}
