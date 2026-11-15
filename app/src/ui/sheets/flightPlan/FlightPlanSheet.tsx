// Views/Planning/FlightPlanView.swift: the "Flight Plans" screen pushed from the log. In the US: a departure and a
// destination airport field, each with a search dropdown; with both picked, the summary card (distance, ETE, fuel) and
// Save Plan / Clear; below, the saved plans, most recently used first (tap to load, Delete to remove), or "No saved
// plans". In Israel the screen is the Israel planner (IsraelFlightPlanSheet) instead, as in Swift.
//
// Props:
// - `region` (optional, default: the app's region from `regionSlice`): 'israel' renders IsraelFlightPlanSheet, which
//   needs an IsraelPlanProvider above it; 'us' renders the US planner, which needs a FlightPlanProvider above it
//   (store.ts; I1 builds the store over the aviation database, the plan repository, the aircraft store, the app's
//   navigation and the map).
// - `openURL`, `share` (optional): handed to IsraelFlightPlanSheet (its e-mail draft and share sheet); the US planner
//   opens and shares nothing.
//
// On mount the US planner calls `configure()` (Swift onAppear): saved plans load and the most recent one is restored
// without cancelling an active Direct-To.
import { useEffect, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, View, type TextStyle } from 'react-native';
import type { Region } from '../../../domain/core/region';
import type { Airport } from '../../../domain/core';
import type { FlightPlanRecord } from '../../../data/models';
import { Airplane } from '../../Icons';
import { ArrowRight, CheckmarkCircleFill } from './planIcons';
import { Pressy, useTheme } from '../../Primitives';
import { useRegion } from '../../state/region';
import { Radius, Space, type Theme } from '../../tokens';
import { IsraelFlightPlanSheet, formColors } from '../israelPlan/IsraelFlightPlanSheet';
import { FlightPlanSummaryCard, materialFill } from './FlightPlanSummaryCard';
import {
  AIRPORT_SEARCH_PLACEHOLDER,
  EMPTY_SAVED_PLANS_DESCRIPTION,
  EMPTY_SAVED_PLANS_TITLE,
  formattedETE,
  relativeText,
  savedPlanAccessibilityLabel,
  savedPlanDistanceText,
} from './logic';
import { useFlightPlan, useFlightPlanStore } from './store';

export interface FlightPlanSheetProps {
  /** Which planner to show; default: the app's region. */
  region?: Region;
  /** Israel planner only: opens the FPL e-mail draft and the route-weather link (default Linking.openURL). */
  openURL?: (url: string) => void;
  /** Israel planner only: the share sheet with the FPL message (default React Native Share). */
  share?: (text: string) => void;
}

/** The navigation title the pushing stack shows (`.navigationTitle("Flight Plans")`). */
export const FLIGHT_PLANS_TITLE = 'Flight Plans';

export function FlightPlanSheet({ region, openURL, share }: FlightPlanSheetProps) {
  const appRegion = useRegion();
  if ((region ?? appRegion) === 'israel') return <IsraelFlightPlanSheet openURL={openURL} share={share} />;
  return <UsFlightPlan />;
}

/** Minimum touch target, points. */
const TOUCH = 44;
/** SF .body, .subheadline bold, .headline and .caption. */
const SF_BODY: TextStyle = { fontSize: 17, lineHeight: 22 };
const SF_SUBHEADLINE_BOLD: TextStyle = { fontSize: 15, lineHeight: 20, fontWeight: '700' };
const SF_HEADLINE: TextStyle = { fontSize: 17, lineHeight: 22, fontWeight: '600' };
const SF_TITLE2_BOLD: TextStyle = { fontSize: 22, lineHeight: 28, fontWeight: '700' };
const SF_CAPTION: TextStyle = { fontSize: 12, lineHeight: 16 };

function UsFlightPlan() {
  const t = useTheme();
  const store = useFlightPlanStore();
  // onAppear: load the saved plans and restore the most recent one.
  useEffect(() => void store.getState().configure(), [store]);
  return (
    <View testID="flight-plan" style={{ flex: 1, backgroundColor: formColors(t).background }}>
      <PlanCreator />
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.rule, marginVertical: Space.s }} />
      <SavedPlans />
    </View>
  );
}

// MARK: - Plan creator

function PlanCreator() {
  const store = useFlightPlanStore();
  const departure = useFlightPlan((s) => s.selectedDeparture);
  const destination = useFlightPlan((s) => s.selectedDestination);
  const distanceNM = useFlightPlan((s) => s.distanceNM);
  const seconds = useFlightPlan((s) => s.estimatedTimeSeconds);
  const fuel = useFlightPlan((s) => s.estimatedFuelGallons);
  return (
    <View style={{ padding: Space.l, gap: Space.m }}>
      <AirportField field="departure" />
      <AirportField field="destination" />
      {departure && destination ? (
        <>
          <FlightPlanSummaryCard
            distanceNM={distanceNM}
            ete={formattedETE(seconds)}
            fuelGallons={fuel}
            departure={departure.icao}
            destination={destination.icao}
          />
          <View style={{ flexDirection: 'row', gap: Space.m }}>
            <Button title="Save Plan" testID="fp-save" prominent onPress={() => void store.getState().savePlan()} />
            <Button title="Clear" testID="fp-clear" destructive onPress={() => store.getState().clearPlan()} />
          </View>
        </>
      ) : null}
    </View>
  );
}

const FIELDS = {
  departure: { title: 'Departure', label: 'Departure airport' },
  destination: { title: 'Destination', label: 'Destination airport' },
} as const;

function AirportField({ field }: { field: 'departure' | 'destination' }) {
  const t = useTheme();
  const store = useFlightPlanStore();
  const query = useFlightPlan((s) => (field === 'departure' ? s.departureQuery : s.destinationQuery));
  const results = useFlightPlan((s) => (field === 'departure' ? s.departureResults : s.destinationResults));
  const { title, label } = FIELDS[field];
  const onChange = (text: string) => {
    const s = store.getState();
    void (field === 'departure' ? s.setDepartureQuery(text) : s.setDestinationQuery(text));
  };
  const onSelect = (airport: Airport) => {
    const s = store.getState();
    if (field === 'departure') s.selectDeparture(airport);
    else s.selectDestination(airport);
    Keyboard.dismiss();
  };
  return (
    <View style={{ gap: Space.xs }}>
      <Text style={[SF_CAPTION, { color: t.secondaryText }]}>{title}</Text>
      <TextInput
        testID={`fp-${field}`}
        value={query}
        onChangeText={onChange}
        placeholder={AIRPORT_SEARCH_PLACEHOLDER}
        placeholderTextColor={formColors(t).placeholder}
        autoCorrect={false}
        autoCapitalize="characters"
        accessibilityLabel={label}
        style={fieldStyle(t)}
      />
      {results.length > 0 ? (
        <View
          testID={`fp-${field}-results`}
          style={{ backgroundColor: materialFill(t), borderRadius: Radius.s, overflow: 'hidden' }}
        >
          {results.map((airport, index) => (
            <View key={airport.icao}>
              {index > 0 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.rule }} /> : null}
              <Pressy
                accessibilityLabel={`${airport.icao}, ${airport.name}`}
                onPress={() => onSelect(airport)}
                style={{
                  minHeight: TOUCH,
                  justifyContent: 'center',
                  paddingHorizontal: Space.m,
                  paddingVertical: Space.s,
                }}
              >
                <Text style={[SF_SUBHEADLINE_BOLD, { color: t.primaryText }]}>{airport.icao}</Text>
                <Text numberOfLines={1} style={[SF_CAPTION, { color: t.secondaryText }]}>
                  {airport.name}
                </Text>
              </Pressy>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A .roundedBorder TextField: a hairline grey border, radius 4, 34 pt tall, SF body. */
const fieldStyle = (t: Theme): TextStyle => ({
  height: 34,
  paddingHorizontal: 7,
  paddingVertical: 0,
  borderWidth: StyleSheet.hairlineWidth,
  borderColor: formColors(t).fieldBorder,
  borderRadius: Radius.xs,
  backgroundColor: formColors(t).background,
  color: t.primaryText,
  fontSize: SF_BODY.fontSize,
});

/** Vertical padding of a .bordered button around its 22 pt label: 34 pt tall, the hit area reaches 44 pt. */
const BUTTON_PAD = 6;

/** .borderedProminent (accent capsule) or .bordered (secondarySystemFill capsule; red text for role: .destructive). */
function Button({
  title,
  onPress,
  testID,
  prominent = false,
  destructive = false,
}: {
  title: string;
  onPress: () => void;
  testID: string;
  prominent?: boolean;
  destructive?: boolean;
}) {
  const t = useTheme();
  const height = (SF_BODY.lineHeight ?? 22) + 2 * BUTTON_PAD;
  const slop = (TOUCH - height) / 2;
  return (
    <Pressy
      testID={testID}
      onPress={onPress}
      accessibilityLabel={title}
      hitSlop={{ top: slop, bottom: slop }}
      style={{
        minHeight: height,
        paddingVertical: BUTTON_PAD,
        paddingHorizontal: Space.m,
        borderRadius: height / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: prominent ? t.accent : formColors(t).buttonFill,
      }}
    >
      <Text style={[SF_BODY, { color: prominent ? t.onAccent : destructive ? t.warning : t.accentText }]}>{title}</Text>
    </Pressy>
  );
}

// MARK: - Saved plans

/** `.relative` dates tick: the rows re-read the clock every second while there are any. */
const RELATIVE_TICK_MS = 1000;

function SavedPlans() {
  const store = useFlightPlanStore();
  const plans = useFlightPlan((s) => s.savedPlans);
  const activeID = useFlightPlan((s) => s.activePlanID);
  const [now, setNow] = useState(() => store.getState().now());
  const hasPlans = plans.length > 0;
  useEffect(() => {
    if (!hasPlans) return undefined;
    const timer = setInterval(() => setNow(store.getState().now()), RELATIVE_TICK_MS);
    return () => clearInterval(timer);
  }, [store, hasPlans]);

  if (!hasPlans) return <EmptySavedPlans />;
  return (
    <ScrollView testID="fp-saved-plans" style={{ flex: 1 }}>
      {plans.map((record, index) => (
        <View key={record.id}>
          {index > 0 ? <SeparatorInset /> : null}
          <SavedPlanRow record={record} isActive={record.id === activeID} now={now} />
        </View>
      ))}
    </ScrollView>
  );
}

function SeparatorInset() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.rule, marginLeft: Space.l }} />;
}

function SavedPlanRow({ record, isActive, now }: { record: FlightPlanRecord; isActive: boolean; now: number }) {
  const t = useTheme();
  const store = useFlightPlanStore();
  const remove = () => void store.getState().deletePlan(record);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: Space.l, paddingRight: Space.s }}>
      <Pressy
        testID={`fp-saved-${record.id}`}
        onPress={() => void store.getState().loadPlan(record)}
        accessibilityLabel={savedPlanAccessibilityLabel(record, now, isActive)}
        accessibilityState={{ selected: isActive }}
        // The List's swipe to delete, for VoiceOver and TalkBack.
        accessibilityActions={[{ name: 'delete', label: 'Delete' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'delete') remove();
        }}
        style={{ flex: 1, minHeight: TOUCH, paddingVertical: Space.s, flexDirection: 'row', alignItems: 'center' }}
      >
        <View style={{ flex: 1, gap: Space.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}>
            <Text style={[SF_HEADLINE, { color: t.primaryText }]}>{record.departureICAO}</Text>
            <ArrowRight color={t.secondaryText} size={11} />
            <Text style={[SF_HEADLINE, { color: t.primaryText }]}>{record.destinationICAO}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: Space.s }}>
            <Text style={[SF_CAPTION, { color: t.secondaryText }]}>{savedPlanDistanceText(record)}</Text>
            <Text style={[SF_CAPTION, { color: t.secondaryText }]}>{relativeText(record.lastUsedAt, now)}</Text>
          </View>
        </View>
        {isActive ? (
          <View testID="fp-active-mark">
            <CheckmarkCircleFill color={t.ok} check={formColors(t).background} />
          </View>
        ) : null}
      </Pressy>
      <Pressy
        testID={`fp-delete-${record.id}`}
        onPress={remove}
        accessibilityLabel={`Delete ${record.departureICAO} to ${record.destinationICAO}`}
        style={{ minHeight: TOUCH, minWidth: TOUCH, justifyContent: 'center', paddingHorizontal: Space.s }}
      >
        <Text style={[SF_BODY, { color: t.warning }]}>Delete</Text>
      </Pressy>
    </View>
  );
}

/** ContentUnavailableView("No saved plans", systemImage: "airplane.circle", description: ...). */
function EmptySavedPlans() {
  const t = useTheme();
  return (
    <View
      testID="fp-saved-empty"
      accessible
      accessibilityLabel={`${EMPTY_SAVED_PLANS_TITLE}. ${EMPTY_SAVED_PLANS_DESCRIPTION}`}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.xl, gap: Space.s }}
    >
      <View style={{ minHeight: TOUCH, justifyContent: 'center' }}>
        <Airplane color={t.secondaryText} />
      </View>
      <Text style={[SF_TITLE2_BOLD, { color: t.primaryText, textAlign: 'center' }]}>{EMPTY_SAVED_PLANS_TITLE}</Text>
      <Text style={[SF_BODY, { color: t.secondaryText, textAlign: 'center' }]}>{EMPTY_SAVED_PLANS_DESCRIPTION}</Text>
    </View>
  );
}
