// The log stack in three tenses (efb-212/Views/Log/LogStackView.swift): NEXT (the active plan, plan a flight), NOW (the
// flight in progress), FLOWN (recorded flights and logbook entries, newest first), then the logbook totals. Under a
// navigation bar with the Map button, the title and the Settings link. Navigation, recording, ETE and GPS availability
// come from the strip's shared `flightLog` slice, flights, entries and the last fix from the `log` slice; actions go to
// `logActions`. Each section selects only its own fields, so a recording-time, clock or GPS update re-renders the Now row
// alone.
import { useMemo, type ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { RecordingStatus } from '../../domain/recording/recordingCoordinator';
import { evaluateGpsStatus, isGpsStale } from '../../domain/location/gpsStatus';
import { hasActiveNavigation, nextIdent } from '../flightLog/logic';
import { flightLog } from '../flightLog/store';
import { Pressy, useTheme } from '../Primitives';
import { Type, type Theme } from '../tokens';
import { useNow } from './clock';
import { GearGlyph, MapGlyph } from './LogIcons';
import {
  ActivePlanRow,
  AddEntryButton,
  FlownEmptyRow,
  FlownEntryRow,
  FlownFlightRow,
  LogSectionHeader,
  NowRow,
  PlanFlightRow,
  TotalsRow,
} from './LogRows';
import {
  activePlanCodes,
  activePlanSpoken,
  activePlanText,
  deleteUnsignedEntry,
  flownItemKey,
  flownItems,
  isLive,
  nowRowTexts,
  totalsTexts,
} from './logic';
import { log, logActions } from './store';

/** Inline navigation bar under the status bar (points, from reference/ipad-log.png). */
const NAV_BAR_HEIGHT = 54;
/** iOS 26 glass toolbar buttons: a 44 pt circle (one glyph) and an 80 x 44 capsule, 10 pt from the edges. */
const GLASS_SIZE = 44;
const GLASS_EDGE = 10;
/**
 * The glass fill and its soft drop shadow: by day the values measured over the Day paper in the reference, at night the
 * raised night paper with a darker shadow (a near-white disk would glare in the cockpit).
 */
const glassFillFor = (t: Theme) =>
  t.night
    ? { fill: t.paperSecondary, shadow: '0px 8px 32px rgba(0, 0, 0, 0.5)' }
    : { fill: '#F9FBFD', shadow: '0px 8px 32px rgba(20, 25, 31, 0.09)' };
/** Toolbar targets stay 60 pt (StripMetrics.cell) around the 44 pt glass. */
const HIT_SLOP = 8;

function NavigationBar() {
  const t = useTheme();
  const openMap = logActions.useData((a) => a.openMap);
  const openSettings = logActions.useData((a) => a.openSettings);
  const glassFill = glassFillFor(t);
  const glass = {
    position: 'absolute' as const,
    top: 0,
    height: GLASS_SIZE,
    borderRadius: GLASS_SIZE / 2,
    backgroundColor: glassFill.fill,
    boxShadow: glassFill.shadow,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  return (
    <View style={{ height: NAV_BAR_HEIGHT, backgroundColor: t.paper, zIndex: 1 }}>
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: GLASS_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text accessibilityRole="header" style={[Type.systemHeadline, { color: t.primaryText }]}>
          Log
        </Text>
      </View>
      <Pressy
        onPress={openMap}
        accessibilityLabel="Back to map"
        testID="log-map-button"
        hitSlop={HIT_SLOP}
        style={[glass, { left: GLASS_EDGE, width: GLASS_SIZE }]}
      >
        <MapGlyph color={t.primaryText} />
      </Pressy>
      <Pressy
        onPress={openSettings}
        accessibilityLabel="Settings"
        testID="log-settings-link"
        hitSlop={HIT_SLOP}
        style={[glass, { right: GLASS_EDGE, width: 80 }]}
      >
        <GearGlyph color={t.primaryText} />
      </Pressy>
    </View>
  );
}

const IDLE: RecordingStatus = { kind: 'idle' };

/** The active plan row, when there is a plan. */
function ActivePlanSection() {
  const openPlanner = logActions.useData((a) => a.openPlanner);
  const text = flightLog.useData((s) => activePlanText(activePlanCodes(s)));
  const spoken = flightLog.useData((s) => activePlanSpoken(activePlanCodes(s)));
  if (text == null) return null;
  return <ActivePlanRow text={text} spoken={spoken ?? text} onPress={openPlanner} />;
}

function PlanFlightSection() {
  const openPlanner = logActions.useData((a) => a.openPlanner);
  return <PlanFlightRow onPress={openPlanner} />;
}

/** The flight in progress. The only subscriber of the clock, which ages the last fix once a second. */
function NowSection() {
  const openMap = logActions.useData((a) => a.openMap);
  const directTo = flightLog.useData((s) => s.directTo);
  const activeFlightPlan = flightLog.useData((s) => s.activeFlightPlan);
  const activeRoute = flightLog.useData((s) => s.activeRoute);
  const planDeparture = flightLog.useData((s) => s.planDeparture);
  const planDestination = flightLog.useData((s) => s.planDestination);
  const status = flightLog.useData((s) => s.recording?.status ?? IDLE);
  const elapsedSeconds = flightLog.useData((s) => s.recording?.elapsedSeconds ?? 0);
  const estimatedTimeEnroute = flightLog.useData((s) => s.estimatedTimeEnroute);
  const gpsAvailable = flightLog.useData((s) => s.gpsAvailable);
  const ownshipFix = flightLog.useData((s) => s.ownshipFix);
  const nowMs = useNow();
  const nav = { directTo, activeFlightPlan, activeRoute, planDeparture, planDestination };
  const stale = isGpsStale(evaluateGpsStatus(ownshipFix, gpsAvailable, nowMs));
  const now = nowRowTexts({
    directToIcao: directTo,
    planCodes: activePlanCodes(nav),
    recording: status,
    elapsedSeconds,
    nextIdent: nextIdent(nav),
    eteSeconds: stale ? null : estimatedTimeEnroute,
  });
  return <NowRow now={now} eteStale={stale} onPress={openMap} />;
}

function AddEntrySection() {
  const addEntry = logActions.useData((a) => a.addEntry);
  return <AddEntryButton onPress={addEntry} />;
}

/** Recorded flights and logbook entries, newest first, or the empty state. */
function FlownSection() {
  const flights = log.useData((s) => s.flights);
  const entries = log.useData((s) => s.entries);
  const openFlight = logActions.useData((a) => a.openFlight);
  const openEntry = logActions.useData((a) => a.openEntry);
  const deleteEntry = logActions.useData((a) => a.deleteEntry);
  const items = useMemo(() => flownItems(flights, entries), [flights, entries]);
  if (items.length === 0) return <FlownEmptyRow />;
  const onDelete = (entry: Parameters<typeof deleteUnsignedEntry>[0]) => deleteUnsignedEntry(entry, deleteEntry);
  return (
    <>
      {items.map((item) =>
        item.kind === 'flight' ? (
          <FlownFlightRow
            key={flownItemKey(item)}
            flight={item.flight}
            entry={item.entry}
            onOpen={() => openFlight(item.flight.id)}
            onOpenEntry={openEntry}
            onDeleteEntry={onDelete}
          />
        ) : (
          <FlownEntryRow
            key={flownItemKey(item)}
            entry={item.entry}
            onOpen={() => openEntry(item.entry.id)}
            onDelete={onDelete}
          />
        ),
      )}
    </>
  );
}

function TotalsSection() {
  const entries = log.useData((s) => s.entries);
  const totals = useMemo(() => totalsTexts(entries), [entries]);
  return <TotalsRow totals={totals} />;
}

/**
 * The scrolling sections. Section headers pin to the top while their rows scroll, as in a plain List. This container
 * re-renders only when Now or the active plan row appears or goes.
 */
function Sections({ bottomInset }: { bottomInset: number }) {
  const live = flightLog.useData((s) => isLive(s.recording?.status ?? IDLE, hasActiveNavigation(s)));
  const hasPlan = flightLog.useData((s) => activePlanCodes(s) != null);

  // Children in order; header indices feed stickyHeaderIndices.
  const children: ReactElement[] = [];
  const headers: number[] = [];
  const header = (el: ReactElement) => {
    headers.push(children.length);
    children.push(el);
  };

  header(<LogSectionHeader key="h-next" title="Next" />);
  if (hasPlan) children.push(<ActivePlanSection key="active-plan" />);
  children.push(<PlanFlightSection key="plan-flight" />);
  if (live) {
    header(<LogSectionHeader key="h-now" title="Now" />);
    children.push(<NowSection key="now" />);
  }
  header(<LogSectionHeader key="h-flown" title="Flown" trailing={<AddEntrySection />} />);
  children.push(<FlownSection key="flown" />);
  header(<LogSectionHeader key="h-totals" title="Totals" />);
  children.push(<TotalsSection key="totals" />);

  return (
    <ScrollView
      testID="log-list"
      stickyHeaderIndices={headers}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: bottomInset }}
    >
      {children}
    </ScrollView>
  );
}

/** The Log under the status bar band: navigation bar, then the sections, scrolling clear of the home indicator. */
export function LogStack({ bottomInset = 0 }: { bottomInset?: number }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.paper }}>
      <NavigationBar />
      <Sections bottomInset={bottomInset} />
    </View>
  );
}
