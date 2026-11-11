// The log stack in three tenses (efb-212/Views/Log/LogStackView.swift): NEXT (the active plan, plan a flight), NOW (the
// flight in progress), FLOWN (recorded flights and logbook entries, newest first), then the logbook totals. Under a
// navigation bar with the Map button, the title and the Settings link. Reads the `log` slice; actions go to `logActions`.
import { useMemo, type ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { evaluateGpsStatus, isGpsStale } from '../../domain/location/gpsStatus';
import { Pressy, useTheme } from '../Primitives';
import { Type } from '../tokens';
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
import { activePlanSpoken, activePlanText, flownItemKey, flownItems, isLive, nowRowTexts, totalsTexts } from './logic';
import { log, logActions } from './store';

/** Inline navigation bar under the status bar (points, from reference/ipad-log.png). */
const NAV_BAR_HEIGHT = 54;
/** iOS 26 glass toolbar buttons: a 44 pt circle (one glyph) and an 80 x 44 capsule, 10 pt from the edges. */
const GLASS_SIZE = 44;
const GLASS_EDGE = 10;
/** The glass fill over the Day paper and its soft drop shadow. */
const GLASS_FILL = '#F9FBFD';
const GLASS_SHADOW = '0px 8px 32px rgba(20, 25, 31, 0.09)';
/** Toolbar targets stay 60 pt (StripMetrics.cell) around the 44 pt glass. */
const HIT_SLOP = 8;

function NavigationBar() {
  const t = useTheme();
  const { openMap, openSettings } = logActions.useData((a) => a);
  const glass = {
    position: 'absolute' as const,
    top: 0,
    height: GLASS_SIZE,
    borderRadius: GLASS_SIZE / 2,
    backgroundColor: GLASS_FILL,
    boxShadow: GLASS_SHADOW,
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

/** The scrolling sections. Section headers pin to the top while their rows scroll, as in a plain List. */
function Sections({ bottomInset }: { bottomInset: number }) {
  const data = log.useData((s) => s);
  const actions = logActions.useData((a) => a);
  const items = useMemo(() => flownItems(data.flights, data.entries), [data.flights, data.entries]);
  const totals = useMemo(() => totalsTexts(data.entries), [data.entries]);
  const planText = activePlanText(data.activePlanCodes);
  const live = isLive(data.recording, data.hasActiveNavigation);
  const eteStale = isGpsStale(evaluateGpsStatus(data.ownshipFix, data.gpsAvailable, data.nowMs));
  const now = nowRowTexts({
    directToIcao: data.directToIcao,
    planCodes: data.activePlanCodes,
    recording: data.recording,
    elapsedSeconds: data.recordingElapsedSeconds,
    nextIdent: data.nextIdent,
    eteSeconds: eteStale ? null : data.estimatedTimeEnrouteSeconds,
  });

  // Children in order; header indices feed stickyHeaderIndices.
  const children: ReactElement[] = [];
  const headers: number[] = [];
  const header = (el: ReactElement) => {
    headers.push(children.length);
    children.push(el);
  };

  header(<LogSectionHeader key="h-next" title="Next" />);
  if (planText) {
    children.push(
      <ActivePlanRow
        key="active-plan"
        text={planText}
        spoken={activePlanSpoken(data.activePlanCodes) ?? planText}
        onPress={actions.openPlanner}
      />,
    );
  }
  children.push(<PlanFlightRow key="plan-flight" onPress={actions.openPlanner} />);

  if (live) {
    header(<LogSectionHeader key="h-now" title="Now" />);
    children.push(<NowRow key="now" now={now} eteStale={eteStale} onPress={actions.openMap} />);
  }

  header(<LogSectionHeader key="h-flown" title="Flown" trailing={<AddEntryButton onPress={actions.addEntry} />} />);
  if (items.length === 0) children.push(<FlownEmptyRow key="flown-empty" />);
  for (const item of items) {
    children.push(
      item.kind === 'flight' ? (
        <FlownFlightRow
          key={flownItemKey(item)}
          flight={item.flight}
          entry={item.entry}
          onOpen={() => actions.openFlight(item.flight.id)}
          onOpenEntry={actions.openEntry}
          onDeleteEntry={actions.deleteEntry}
        />
      ) : (
        <FlownEntryRow
          key={flownItemKey(item)}
          entry={item.entry}
          onOpen={() => actions.openEntry(item.entry.id)}
          onDelete={actions.deleteEntry}
        />
      ),
    );
  }

  header(<LogSectionHeader key="h-totals" title="Totals" />);
  children.push(<TotalsRow key="totals" totals={totals} />);

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
