// Views/Planning/IsraelFlightPlanView.swift: network, departure, destination and via points, auto-routed over the chosen
// network; a legs table with the published altitude per leg, closure and approval badges, the FPL preview with share and
// e-mail, a return flight, and Activate. Red = blocks filing, amber = caution. Reads the plan store from
// IsraelPlanProvider (store.ts). The preview's E-mail button opens a draft to the IAA filing address, never to the pilot
// (issue #39, logic.ts `flightPlanMailURL`).
import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Linking, Modal, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import { FLIGHT_PLAN_DISCLAIMER, issueMessage } from '../../../domain/israel/flightPlanMessage';
import type { IsraelDayOverride } from '../../../domain/israel/lsaTimeRules';
import type { IsraelRouteError, IsraelRoutePlan } from '../../../domain/israel/routePlanner';
import type { IsraelAerodrome, IsraelRouteNetwork } from '../../../data/aviation/israelTypes';
import { Chevron, OctagonWarning, WarningTriangle } from '../../Icons';
import { Pressy, useTheme } from '../../Primitives';
import { Radius, Space, Type, type Theme } from '../../tokens';
import {
  FILING_NOTE,
  WEEKEND_RULE_FALLBACK,
  departureTimeText,
  legRows,
  summaryCells,
  windyURL,
  type CautionBadgeText,
} from './logic';
import { useIsraelPlan, useIsraelPlanStore } from './store';

const MONO = 'Kanaf-IBMPlexMono-Regular';
const MONO_BOLD = 'Kanaf-IBMPlexMono-SemiBold';
/** Minimum touch target, points. */
const TOUCH = 44;

export interface IsraelFlightPlanSheetProps {
  /** Opens the e-mail draft and the route-weather link (default Linking.openURL). */
  openURL?: (url: string) => void;
  /** The share sheet with the message (default React Native Share). */
  share?: (text: string) => void;
}

export function IsraelFlightPlanSheet({ openURL = defaultOpenURL, share = defaultShare }: IsraelFlightPlanSheetProps) {
  const t = useTheme();
  const store = useIsraelPlanStore();
  const network = useIsraelPlan((s) => s.network);
  const plan = useIsraelPlan((s) => s.plan);
  const routeError = useIsraelPlan((s) => s.routeError);
  const [showPreview, setShowPreview] = useState(false);

  // onAppear: configure() reads the profiles (the active aircraft's usual network preselects the planner).
  useEffect(() => store.getState().configure(), [store]);

  return (
    <View style={{ flex: 1, backgroundColor: t.paper }}>
      <ScrollView keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
        <View style={{ padding: Space.l, gap: Space.l }}>
          <NetworkPicker />
          <AerodromePicker field="departure" />
          <AerodromePicker field="destination" />
          <ViaSection />
          <DepartureTime />
          {network === 'lsa' ? <LsaWeekendSection /> : null}
          <RouteOptions />
          {routeError ? <NoRouteBanner error={routeError} /> : null}
          {plan ? (
            <>
              <Summary plan={plan} />
              <LegsTable plan={plan} />
              <IssuesList />
              <Actions plan={plan} openURL={openURL} onPreview={() => setShowPreview(true)} />
            </>
          ) : null}
          <Button
            title="NOTAM briefing"
            testID="il-notam-briefing"
            onPress={() => store.getState().openBriefing()}
            style={{ alignSelf: 'stretch' }}
          />
          <Text style={[Type.caption, { color: t.secondaryText }]}>{FLIGHT_PLAN_DISCLAIMER}</Text>
        </View>
      </ScrollView>
      <PreviewSheet visible={showPreview} onDone={() => setShowPreview(false)} openURL={openURL} share={share} />
    </View>
  );
}

const defaultOpenURL = (url: string) => void Linking.openURL(url).catch(() => undefined);
const defaultShare = (message: string) => void Share.share({ message }).catch(() => undefined);

// MARK: - Shared pieces

function Button({
  title,
  onPress,
  testID,
  disabled = false,
  prominent = false,
  destructive = false,
  accessibilityLabel,
  style,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
  prominent?: boolean;
  destructive?: boolean;
  accessibilityLabel?: string;
  style?: object;
}) {
  const t = useTheme();
  const color = prominent ? t.onAccent : destructive ? t.warning : t.accentText;
  return (
    <Pressy
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      style={[
        {
          minHeight: TOUCH,
          paddingHorizontal: Space.m,
          borderRadius: Radius.m,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: prominent ? t.accent : t.fill,
          opacity: disabled ? 0.4 : 1,
          flexGrow: 1,
        },
        style,
      ]}
    >
      <Text style={[Type.systemHeadline, { color }]}>{title}</Text>
    </Pressy>
  );
}

function Caption({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[Type.caption, { color: t.secondaryText }]}>{children}</Text>;
}

/** A segmented control (Picker with .segmented style): one button per option, the selected one filled. */
function Segmented<T extends string>({
  options,
  selected,
  onSelect,
  testID,
  accessibilityLabel,
}: {
  options: readonly { value: T; title: string }[];
  selected: T;
  onSelect: (value: T) => void;
  testID: string;
  accessibilityLabel: string;
}) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', backgroundColor: t.fill, borderRadius: Radius.s, padding: 2 }}
    >
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <Pressy
            key={option.value}
            accessibilityRole="button"
            accessibilityLabel={option.title}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(option.value)}
            style={{
              flex: 1,
              minHeight: TOUCH,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: Radius.s - 2,
              backgroundColor: isSelected ? t.paper : 'transparent',
            }}
          >
            <Text style={[Type.systemSubheadline, { color: t.primaryText, fontWeight: isSelected ? '600' : '400' }]}>
              {option.title}
            </Text>
          </Pressy>
        );
      })}
    </View>
  );
}

/** DisclosureGroup: a header row that shows or hides its content. */
function Disclosure({ title, testID, children }: { title: string; testID?: string; children: ReactNode }) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <View testID={testID}>
      <Pressy
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((e) => !e)}
        style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Text style={[Type.body, { color: t.primaryText }]}>{title}</Text>
        <Chevron color={t.accentText} dir={expanded ? 'down' : 'right'} />
      </Pressy>
      {expanded ? <View style={{ gap: Space.s }}>{children}</View> : null}
    </View>
  );
}

const fieldStyle = (t: Theme) => ({
  minHeight: TOUCH,
  paddingHorizontal: Space.m,
  borderWidth: 1,
  borderColor: t.rule,
  borderRadius: Radius.s,
  color: t.primaryText,
  ...Type.body,
});

// MARK: - Pickers

const NETWORK_OPTIONS: readonly { value: IsraelRouteNetwork; title: string }[] = [
  { value: 'cvfr', title: 'CVFR' },
  { value: 'lsa', title: 'LSA (sport aviation)' },
];

/** CVFR or sport aviation (LSA). The aircraft's usual network preselects it; a tap here overrides that. */
function NetworkPicker() {
  const store = useIsraelPlanStore();
  const network = useIsraelPlan((s) => s.network);
  return (
    <Segmented
      testID="il-route-network"
      accessibilityLabel="Route network"
      options={NETWORK_OPTIONS}
      selected={network}
      onSelect={(value) => store.getState().selectNetwork(value)}
    />
  );
}

const PICKERS = {
  departure: { title: 'Departure', label: 'Departure aerodrome' },
  destination: { title: 'Destination', label: 'Destination aerodrome' },
} as const;

function AerodromePicker({ field }: { field: 'departure' | 'destination' }) {
  const t = useTheme();
  const store = useIsraelPlanStore();
  const query = useIsraelPlan((s) => (field === 'departure' ? s.departureQuery : s.destinationQuery));
  const results = useIsraelPlan((s) => (field === 'departure' ? s.departureResults : s.destinationResults));
  const { title, label } = PICKERS[field];
  const onChange = (text: string) => {
    const s = store.getState();
    void (field === 'departure' ? s.setDepartureQuery(text) : s.setDestinationQuery(text));
  };
  const onSelect = (aerodrome: IsraelAerodrome) => {
    const s = store.getState();
    if (field === 'departure') s.selectDeparture(aerodrome);
    else s.selectDestination(aerodrome);
    // The result tapped, the keyboard has done its job: it would hide the summary and legs.
    Keyboard.dismiss();
  };
  return (
    <View style={{ gap: Space.xs }}>
      <Caption>{title}</Caption>
      <TextInput
        value={query}
        onChangeText={onChange}
        placeholder="ICAO, English or Hebrew name"
        placeholderTextColor={t.secondaryText}
        autoCorrect={false}
        accessibilityLabel={label}
        style={fieldStyle(t)}
      />
      {results.map((aerodrome) => (
        <Pressy
          key={aerodrome.code}
          accessibilityLabel={`${aerodrome.code} ${aerodrome.nameEnglish}`}
          onPress={() => onSelect(aerodrome)}
          style={{ minHeight: TOUCH, flexDirection: 'row', alignItems: 'center', gap: Space.s }}
        >
          <Text style={[Type.body, { fontFamily: MONO_BOLD, color: t.primaryText }]}>{aerodrome.code}</Text>
          <Text numberOfLines={1} style={[Type.body, { color: t.primaryText, flexShrink: 1 }]}>
            {aerodrome.nameEnglish}
          </Text>
          <View style={{ flex: 1 }} />
          <Text numberOfLines={1} style={[Type.body, { color: t.secondaryText, flexShrink: 1 }]}>
            {aerodrome.nameHebrew}
          </Text>
        </Pressy>
      ))}
    </View>
  );
}

function ViaSection() {
  const t = useTheme();
  const store = useIsraelPlanStore();
  const viaCodes = useIsraelPlan((s) => s.viaCodes);
  const viaQuery = useIsraelPlan((s) => s.viaQuery);
  const viaError = useIsraelPlan((s) => s.viaError);
  const add = () => void store.getState().addVia(store.getState().viaQuery);
  return (
    <View style={{ gap: Space.xs }}>
      <Caption>Via points (optional)</Caption>
      {viaCodes.map((code, index) => (
        <View key={`${code}-${index}`} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[Type.body, { fontFamily: MONO_BOLD, color: t.primaryText, flex: 1 }]}>{code}</Text>
          <Pressy
            accessibilityLabel={`Remove via ${code}`}
            onPress={() => store.getState().removeVia(index)}
            style={{ width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={[Type.systemHeadline, { color: t.warning }]}>{'\u2212'}</Text>
          </Pressy>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: Space.s }}>
        <TextInput
          value={viaQuery}
          onChangeText={(text) => store.getState().setViaQuery(text)}
          onSubmitEditing={add}
          placeholder="Reporting point code (e.g. TAVOR)"
          placeholderTextColor={t.secondaryText}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Via point"
          style={[fieldStyle(t), { flex: 1 }]}
        />
        <Button title="Add" onPress={add} style={{ flexGrow: 0 }} />
      </View>
      {viaError ? <Text style={[Type.caption, { color: t.warning }]}>{viaError}</Text> : null}
    </View>
  );
}

/** DatePicker("Departure (local)", in: Date()...) in Asia/Jerusalem, as a 15-minute stepper (no date picker dependency). */
function DepartureTime() {
  const t = useTheme();
  const store = useIsraelPlanStore();
  const departureTime = useIsraelPlan((s) => s.departureTime);
  const step = (steps: number) => store.getState().stepDepartureTime(steps);
  return (
    <View testID="il-departure-time" style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s }}>
      <View style={{ flex: 1 }}>
        <Caption>Departure (local)</Caption>
        <Text style={[Type.body, { fontFamily: MONO, color: t.primaryText }]}>{departureTimeText(departureTime)}</Text>
      </View>
      <Button
        title="−15"
        accessibilityLabel="Departure 15 minutes earlier"
        onPress={() => step(-1)}
        style={{ flexGrow: 0 }}
      />
      <Button
        title="+15"
        accessibilityLabel="Departure 15 minutes later"
        onPress={() => step(1)}
        style={{ flexGrow: 0 }}
      />
    </View>
  );
}

const DAY_OPTIONS: readonly { value: IsraelDayOverride; title: string }[] = [
  { value: 'none', title: 'Normal day' },
  { value: 'holidayEve', title: 'Holiday eve' },
  { value: 'holiday', title: 'Holiday' },
];

/** LSA only: the pilot's holiday declaration and the AIP's weekend definition, as published. */
function LsaWeekendSection() {
  const t = useTheme();
  const store = useIsraelPlanStore();
  const dayOverride = useIsraelPlan((s) => s.dayOverride);
  const rule = useIsraelPlan((s) => s.weekendRule);
  return (
    <>
      <Segmented
        testID="il-day-override"
        accessibilityLabel="Departure day"
        options={DAY_OPTIONS}
        selected={dayOverride}
        onSelect={(value) => store.getState().setDayOverride(value)}
      />
      <Disclosure title="Weekend-only routes (AIP B-08)" testID="il-weekend-rule">
        {rule ? (
          <>
            <Text style={[Type.caption, { color: t.primaryText }]}>{rule.textEnglish}</Text>
            <Text style={[Type.caption, { color: t.primaryText, writingDirection: 'rtl', textAlign: 'right' }]}>
              {rule.textHebrew}
            </Text>
            <Caption>
              {`Source: ${rule.source}. The route data does not say which Friday start applies to which route, and has no holiday calendar, so declare a holiday above.`}
            </Caption>
          </>
        ) : (
          <Text style={[Type.caption, { color: t.primaryText }]}>{WEEKEND_RULE_FALLBACK}</Text>
        )}
      </Disclosure>
    </>
  );
}

function RouteOptions() {
  const store = useIsraelPlanStore();
  const allowByRequest = useIsraelPlan((s) => s.allowByRequest);
  const allowMilitary = useIsraelPlan((s) => s.allowMilitary);
  return (
    <Disclosure title="Route options">
      <Toggle
        title="Allow by-request routes (ATC approval, not fileable)"
        value={allowByRequest}
        onChange={(v) => store.getState().setAllowByRequest(v)}
      />
      <Toggle
        title="Allow military routes (IAF approval, not fileable)"
        value={allowMilitary}
        onChange={(v) => store.getState().setAllowMilitary(v)}
      />
    </Disclosure>
  );
}

function Toggle({ title, value, onChange }: { title: string; value: boolean; onChange: (value: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: TOUCH, gap: Space.s }}>
      <Text style={[Type.body, { color: t.primaryText, flex: 1 }]}>{title}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={title} />
    </View>
  );
}

// MARK: - Result

function NoRouteBanner({ error }: { error: IsraelRouteError }) {
  const t = useTheme();
  return (
    <View
      testID="il-no-route"
      style={{ padding: Space.l, gap: Space.xs, borderRadius: Radius.m, backgroundColor: `${t.warning}1F` }}
    >
      <Text style={[Type.systemHeadline, { color: t.warning }]}>{error.message || 'No route'}</Text>
      <Text style={[Type.systemSubheadline, { color: t.primaryText, writingDirection: 'rtl', textAlign: 'right' }]}>
        {error.hebrewDescription}
      </Text>
    </View>
  );
}

function Summary({ plan }: { plan: IsraelRoutePlan }) {
  const t = useTheme();
  return (
    <View testID="il-summary" style={{ flexDirection: 'row', gap: Space.xl }}>
      {summaryCells(plan).map((cell) => (
        <View key={cell.label}>
          <Text style={[Type.stripLabel, { color: t.secondaryText }]}>{cell.label}</Text>
          <Text style={[Type.value, { color: t.primaryText }]}>{cell.value}</Text>
        </View>
      ))}
    </View>
  );
}

const ALT_WIDTH = 90;
const NUMBER_WIDTH = 56;

function LegsTable({ plan }: { plan: IsraelRoutePlan }) {
  const t = useTheme();
  const head = [Type.stripLabel, { color: t.secondaryText, fontWeight: '600' as const }];
  const cell = [Type.data, { color: t.primaryText, textAlign: 'right' as const }];
  return (
    <View testID="il-legs">
      <View style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.rule }}>
        <Text style={[head, { flex: 1 }]}>{'FROM \u2192 TO'}</Text>
        <Text style={[head, { width: ALT_WIDTH, textAlign: 'right' }]}>ALT FT</Text>
        <Text style={[head, { width: NUMBER_WIDTH, textAlign: 'right' }]}>NM</Text>
        <Text style={[head, { width: NUMBER_WIDTH, textAlign: 'right' }]}>ETE MIN</Text>
      </View>
      {legRows(plan).map((row) => (
        <View
          key={row.key}
          style={{ paddingVertical: Space.s, gap: 2, borderBottomWidth: 1, borderBottomColor: t.rule }}
        >
          <View style={{ flexDirection: 'row' }}>
            <Text style={[Type.dataEmphasis, { color: t.primaryText, flex: 1 }]}>{row.route}</Text>
            <Text style={[cell, { width: ALT_WIDTH }]}>{row.altitude}</Text>
            <Text style={[cell, { width: NUMBER_WIDTH }]}>{row.distance}</Text>
            <Text style={[cell, { width: NUMBER_WIDTH }]}>{row.eteMinutes}</Text>
          </View>
          {row.badges.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs }}>
              {row.badges.map((badge, index) => (
                <Badge key={index} badge={badge} />
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function Badge({ badge }: { badge: CautionBadgeText }) {
  const t = useTheme();
  const color = badge.blocksFiling ? t.warning : t.caution;
  return (
    <Text
      style={[
        Type.caption,
        {
          fontWeight: '700',
          color,
          backgroundColor: `${color}2E`,
          paddingHorizontal: Space.s,
          paddingVertical: 3,
          borderRadius: 999,
          overflow: 'hidden',
        },
      ]}
    >
      {badge.text}
    </Text>
  );
}

/** Every issue: red with an octagon when it blocks filing, amber with a triangle otherwise. */
function IssuesList({ cautionsOnly = false }: { cautionsOnly?: boolean }) {
  const t = useTheme();
  const issues = useIsraelPlan((s) => s.issues);
  const bang = t.night ? '#000000' : '#FFFFFF';
  return (
    <>
      {issues
        .filter((issue) => !cautionsOnly || !issue.blocksFiling)
        .map((issue) => {
          const color = issue.blocksFiling ? t.warning : t.caution;
          return (
            <View
              key={JSON.stringify(issue.kind)}
              style={{ flexDirection: 'row', gap: Space.s, alignItems: 'flex-start' }}
            >
              {issue.blocksFiling ? (
                <OctagonWarning color={color} bang={bang} size={17} />
              ) : (
                <WarningTriangle color={color} bang={bang} />
              )}
              <Text style={[Type.systemSubheadline, { color, flex: 1 }]}>{issueMessage(issue)}</Text>
            </View>
          );
        })}
    </>
  );
}

// MARK: - Actions

function Actions({
  plan,
  openURL,
  onPreview,
}: {
  plan: IsraelRoutePlan;
  openURL: (url: string) => void;
  onPreview: () => void;
}) {
  const store = useIsraelPlanStore();
  const canFile = useIsraelPlan((s) => s.canFile);
  const isActive = useIsraelPlan((s) => s.isActive);
  const windy = windyURL(plan);
  return (
    <View style={{ gap: Space.m }}>
      <View style={{ flexDirection: 'row', gap: Space.m }}>
        <Button title="FPL message" testID="il-fpl-preview" prominent disabled={!canFile} onPress={onPreview} />
        <Button title="Return flight" testID="il-return" onPress={() => void store.getState().planReturn()} />
      </View>
      <View style={{ flexDirection: 'row', gap: Space.m }}>
        <Button
          title={isActive ? 'Active' : 'Activate'}
          testID="il-activate"
          disabled={!canFile || isActive}
          onPress={() => store.getState().activate()}
        />
        {windy ? <Button title="Route weather" onPress={() => openURL(windy)} /> : null}
        <Button title="Clear" destructive onPress={() => store.getState().clear()} style={{ flexGrow: 0 }} />
      </View>
    </View>
  );
}

// MARK: - FPL preview

function PreviewSheet({
  visible,
  onDone,
  openURL,
  share,
}: {
  visible: boolean;
  onDone: () => void;
  openURL: (url: string) => void;
  share: (text: string) => void;
}) {
  const t = useTheme();
  const store = useIsraelPlanStore();
  const fplText = useIsraelPlan((s) => s.fplText);
  const summary = useIsraelPlan((s) => s.hebrewSummary);
  // onAppear: the pilot may have edited a profile since the route was computed.
  useEffect(() => {
    if (visible) store.getState().refreshMessage();
  }, [visible, store]);
  const mail = useIsraelPlan((s) => (s.fplText === '' ? null : s.mailURL()));
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onDone}>
      <View style={{ flex: 1, backgroundColor: t.paper }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: Space.l,
            minHeight: TOUCH + Space.m,
            borderBottomWidth: 1,
            borderBottomColor: t.rule,
          }}
        >
          <Text accessibilityRole="header" style={[Type.systemHeadline, { color: t.primaryText }]}>
            FPL message
          </Text>
          <Button title="Done" onPress={onDone} style={{ flexGrow: 0 }} />
        </View>
        <ScrollView>
          <View style={{ padding: Space.l, gap: Space.l }}>
            <Text
              testID="il-fpl-text"
              selectable
              style={[
                Type.data,
                { color: t.primaryText, padding: Space.l, borderRadius: Radius.m, backgroundColor: t.fill },
              ]}
            >
              {fplText}
            </Text>
            <Text selectable style={[Type.body, { color: t.primaryText, writingDirection: 'rtl', textAlign: 'right' }]}>
              {summary}
            </Text>
            <IssuesList cautionsOnly />
            <Text style={[Type.caption, { color: t.secondaryText }]}>{FILING_NOTE}</Text>
            <Text style={[Type.caption, { color: t.secondaryText }]}>{FLIGHT_PLAN_DISCLAIMER}</Text>
            <View style={{ flexDirection: 'row', gap: Space.m }}>
              <Button
                title="Share"
                testID="il-fpl-share"
                prominent
                onPress={() => {
                  store.getState().fplShared('share');
                  share(`${fplText}\n\n${summary}`);
                }}
              />
              {mail ? (
                <Button
                  title="E-mail"
                  testID="il-fpl-email"
                  onPress={() => {
                    store.getState().fplShared('email');
                    openURL(mail);
                  }}
                />
              ) : null}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
