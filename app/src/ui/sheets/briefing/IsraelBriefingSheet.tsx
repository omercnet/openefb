// Israel pre-flight NOTAM briefing (IL-BRIEF), port of Views/Briefing/IsraelBriefingView.swift: every LLLL/aerodrome
// NOTAM for the flight window, closures first, with read/unread tracking. The content of the sheet only: the caller
// presents it (BriefingOverMap for the capture route; I1 from the map controls and the Israel flight plan screen) and sets
// the view model's route and ownship first, as the SwiftUI .task does. Laid out like the SwiftUI inset-grouped List.
// Differences from Swift: the Telemetry "Israel.briefingOpened" signal and the map highlight itself (MapLibre) belong to
// the caller (BriefingActions); the "Nothing to show" alert is a system Alert; ViewThatFits for the row buttons becomes
// a wrapping row; the filters' DisclosureGroup, segmented pickers and stepper are drawn in React Native.
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, RefreshControl, ScrollView, Switch, Text, TextInput, View, type TextStyle } from 'react-native';
import { useStore } from 'zustand';
import type { BriefingRow } from '../../../domain/israel/briefingFilter';
import { BRIEFING_SECTIONS, BRIEFING_SECTION_TITLE, briefingRowId } from '../../../domain/israel/briefingFilter';
import { DataAgeBadge } from '../../components/Components';
import { ArrowUpRight, Chevron, OctagonWarning, WarningTriangle } from '../../Icons';
import { Pressy, useTheme } from '../../Primitives';
import { Space, Type, type Theme } from '../../tokens';
import {
  BriefingTimeFormat,
  CANNOT_SHOW_TEXT,
  CORRIDOR_STEPPER,
  DISTANCE_CHOICES,
  DISTANCE_CHOICE_TITLE,
  EMPTY_TEXT,
  IMS_AVIATION_URL,
  IMS_LINK_TITLE,
  WEATHER_TEXT,
  WINDOW_CHOICES,
  WINDOW_CHOICE_TITLE,
  canShowOnMap,
  closureBadge,
  corridorText,
  distanceNote,
  distanceText,
  filterSummary,
  highlightTint,
  isListable as listable,
  briefingFreshness,
  isReplacement,
  otherRouteLabel,
  plainText,
  rowAccessibilityLabel,
  rowsInSection,
  statusContent,
  unreadCount,
  visibleRows,
  windowText,
  type Banner,
  type StatusContent,
} from './logic';
import type { BriefingActions, IsraelBriefingViewModel } from './store';

/** iOS grouped-list colors (systemGroupedBackground, secondarySystemGroupedBackground, separator). */
const grouped = (t: Theme) =>
  t.night
    ? { background: '#000000', card: '#1C1C1E', separator: 'rgba(84,84,88,0.6)' }
    : { background: '#F2F2F7', card: '#FFFFFF', separator: 'rgba(60,60,67,0.29)' };

/** SF body (17 pt): buttons, links and the navigation bar items in a List. */
const systemBody: TextStyle = { fontSize: 17, lineHeight: 22 };
const semibold = (style: TextStyle): TextStyle => ({ ...style, fontFamily: 'Kanaf-ArchivoRoman-SemiBold' });
const CARD_RADIUS = 26; // iOS 26 inset-grouped section corners
const ROW_MIN_HEIGHT = 44;

function Card({ children, testID }: { children: ReactNode; testID?: string }) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      style={{ backgroundColor: grouped(t).card, borderRadius: CARD_RADIUS, paddingHorizontal: Space.xl - 4 }}
    >
      {children}
    </View>
  );
}

/** A List row: 44 pt minimum, a separator above every row but the first. */
function Row({ children, first = false, indent = 0 }: { children: ReactNode; first?: boolean; indent?: number }) {
  const t = useTheme();
  return (
    <View style={{ minHeight: ROW_MIN_HEIGHT, justifyContent: 'center', paddingVertical: Space.s + 3 }}>
      {first ? null : (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: indent,
            right: 0,
            height: 0.5,
            backgroundColor: grouped(t).separator,
          }}
        />
      )}
      {children}
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[
        systemBody,
        { color: t.secondaryText, paddingHorizontal: Space.xl - 4, paddingTop: Space.l, paddingBottom: Space.s },
      ]}
    >
      {title}
    </Text>
  );
}

/** Label(text, systemImage: "exclamationmark.triangle.fill") in the tone's color, body semibold. */
function BannerLabel({ banner }: { banner: Banner }) {
  const t = useTheme();
  const color = banner.tone === 'warning' ? t.warning : t.caution;
  return (
    <View
      accessible
      accessibilityLabel={banner.text}
      style={{ flexDirection: 'row', alignItems: 'center', gap: Space.l }}
    >
      <View style={{ width: 24, alignItems: 'center' }}>
        <WarningTriangle color={color} bang={grouped(t).card} />
      </View>
      <Text style={[semibold(Type.body), { color, flex: 1 }]}>{banner.text}</Text>
    </View>
  );
}

/** A plain List button: accent text, 44 pt. */
function ListButton({
  title,
  onPress,
  testID,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressy
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={title}
      style={{ minHeight: ROW_MIN_HEIGHT, justifyContent: 'center' }}
    >
      <Text style={[systemBody, { color: disabled ? t.secondaryText : t.accentText }]}>{title}</Text>
    </Pressy>
  );
}

/** .buttonStyle(.bordered): accent text on an accent-tinted capsule. */
function BorderedButton({
  title,
  onPress,
  testID,
  icon,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
  icon?: ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressy
      testID={testID}
      onPress={onPress}
      accessibilityLabel={title}
      style={{
        minHeight: ROW_MIN_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Space.xs + 2,
        paddingHorizontal: Space.l,
        borderRadius: 999,
        backgroundColor: t.infoFill,
      }}
    >
      {icon}
      <Text numberOfLines={1} style={[systemBody, { color: t.accentText }]}>
        {title}
      </Text>
    </Pressy>
  );
}

/** Picker(...).pickerStyle(.segmented). */
function Segmented<T extends string>({
  options,
  titles,
  value,
  onChange,
  testID,
  label,
}: {
  options: readonly T[];
  titles: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  label: string;
}) {
  const t = useTheme();
  return (
    <View
      testID={testID}
      accessibilityLabel={label}
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: t.fill, borderRadius: 999, padding: 2 }}
    >
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressy
            key={option}
            testID={`${testID}-${option}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={{
              flex: 1,
              minHeight: 32,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              backgroundColor: selected ? grouped(t).card : 'transparent',
            }}
          >
            <Text style={[Type.label, { color: t.primaryText }]}>{titles[option]}</Text>
          </Pressy>
        );
      })}
    </View>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const t = useTheme();
  const { min, max, step } = CORRIDOR_STEPPER;
  const button = (title: string, next: number, enabled: boolean, testID: string) => (
    <Pressy
      testID={testID}
      accessibilityLabel={title === '-' ? 'Decrement' : 'Increment'}
      disabled={!enabled}
      onPress={() => onChange(next)}
      style={{ width: 46, minHeight: 32, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={[systemBody, { color: enabled ? t.primaryText : t.secondaryText }]}>
        {title === '-' ? '\u2212' : '+'}
      </Text>
    </Pressy>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={[Type.body, { color: t.primaryText, flex: 1 }]}>{corridorText(value)}</Text>
      <View style={{ flexDirection: 'row', backgroundColor: t.fill, borderRadius: 999 }}>
        {button('-', Math.max(min, value - step), value > min, 'briefing-corridor-minus')}
        {button('+', Math.min(max, value + step), value < max, 'briefing-corridor-plus')}
      </View>
    </View>
  );
}

function ClosureBadges({ row }: { row: BriefingRow }) {
  const t = useTheme();
  const spec = closureBadge(row);
  const other = otherRouteLabel(row);
  return (
    <>
      {spec ? (
        <View
          testID={spec.testID}
          accessible
          accessibilityLabel={spec.text}
          style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}
        >
          {spec.icon === 'xmark.octagon.fill' ? (
            <OctagonWarning color={t.warning} bang={grouped(t).card} size={15} />
          ) : (
            <WarningTriangle color={t.caution} bang={grouped(t).card} />
          )}
          <Text style={[Type.labelBold, { color: spec.tone === 'warning' ? t.warning : t.caution }]}>{spec.text}</Text>
        </View>
      ) : null}
      {other ? (
        <Text
          testID="briefing-badge-other-route"
          accessibilityLabel={other.accessibilityLabel}
          style={[Type.labelBold, { color: t.secondaryText }]}
        >
          {other.text}
        </Text>
      ) : null}
    </>
  );
}

function NotamRow({
  row,
  read,
  expanded,
  onToggleRaw,
  onMarkRead,
  onMarkUnread,
  onShowOnMap,
}: {
  row: BriefingRow;
  read: boolean;
  expanded: boolean;
  onToggleRaw: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onShowOnMap: () => void;
}) {
  const t = useTheme();
  const notam = row.notam;
  const distance = distanceText(row.distanceNM);
  const caption = [Type.caption, { color: t.secondaryText }];
  return (
    <Pressy
      testID={`briefing-row-${notam.id}`}
      accessibilityRole="none"
      accessibilityLabel={rowAccessibilityLabel(notam, read, row)}
      onPress={onMarkRead}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: Space.m, paddingVertical: Space.xs }}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{
          width: 12,
          height: 12,
          borderRadius: 6,
          marginTop: 6,
          backgroundColor: read ? 'transparent' : t.accentText,
        }}
      />
      <View style={{ flex: 1, gap: Space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: Space.s }}>
          <Text style={[Type.valueSmall, { color: t.primaryText }]}>{notam.id}</Text>
          <Text style={[Type.label, { color: t.secondaryText }]}>{notam.location}</Text>
          {isReplacement(notam) ? <Text style={[Type.sectionHeader, { color: t.secondaryText }]}>REPLACES</Text> : null}
          <View style={{ flex: 1 }} />
          <ClosureBadges row={row} />
        </View>
        <Text style={caption}>{BriefingTimeFormat.validity(notam, true)}</Text>
        <Text style={caption}>{BriefingTimeFormat.validity(notam, false)}</Text>
        {distance ? <Text style={caption}>{distance}</Text> : null}
        <Text numberOfLines={expanded ? undefined : 5} style={[Type.body, { color: t.primaryText }]}>
          {plainText(notam)}
        </Text>
        {expanded ? (
          <Text selectable style={[Type.data, { fontSize: 13, color: t.secondaryText }]}>
            {notam.raw}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: Space.m }}>
          {canShowOnMap(notam) ? (
            <BorderedButton testID="briefing-show-on-map" title="Show on map" onPress={onShowOnMap} />
          ) : null}
          <BorderedButton title={expanded ? 'Hide raw' : 'Raw'} onPress={onToggleRaw} />
          <View style={{ flex: 1 }} />
          <BorderedButton title={read ? 'Mark unread' : 'Mark read'} onPress={read ? onMarkUnread : onMarkRead} />
        </View>
      </View>
    </Pressy>
  );
}

/** The NOTAM briefing sheet's content: navigation bar, status, filters, the sections of rows and the weather pointer. */
export function IsraelBriefingSheet({ model, actions }: { model: IsraelBriefingViewModel; actions: BriefingActions }) {
  const t = useTheme();
  const colors = grouped(t);
  const state = useStore(model.store);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [highlightActive, setHighlightActive] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    void model.load();
  }, [model]);

  const now = model.now();
  const freshness = briefingFreshness(state.report, now);
  const rows = visibleRows(state, now, model.isRead);
  const unread = unreadCount(rows, model.isRead);
  const status = statusContent(state, now);
  const note = distanceNote(state);

  const set = (patch: Partial<typeof state>) => model.store.setState(patch);
  const toggleRaw = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const showOnMap = (row: BriefingRow) => {
    model.markRead(row.notam);
    if (!actions.showOnMap(row.notam, highlightTint(row))) {
      Alert.alert('Nothing to show', CANNOT_SHOW_TEXT, [{ text: 'OK', style: 'cancel' }]);
      return;
    }
    setHighlightActive(true);
    actions.dismiss();
  };

  return (
    <View testID="israel-briefing" style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: Space.m,
          paddingTop: Space.m,
          paddingBottom: Space.s,
        }}
      >
        <NavPill title="Done" onPress={actions.dismiss} />
        <Text
          accessibilityRole="header"
          style={[Type.systemHeadline, { flex: 1, textAlign: 'center', color: t.primaryText }]}
        >
          NOTAM briefing
        </Text>
        <NavPill
          testID="briefing-mark-all-read"
          title="Mark all read"
          disabled={unread === 0}
          onPress={() => model.markAllRead()}
        />
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: Space.xl - 4,
          paddingTop: Space.xl + 4,
          paddingBottom: Space.xxl,
          gap: Space.m,
        }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void model.load(true)} />}
      >
        <StatusCard
          status={status}
          onShowStale={() => set({ showStaleList: true })}
          onRetry={() => void model.load(true)}
        />

        <View style={{ height: Space.l }} />
        <Card testID="briefing-filters">
          <Pressy
            testID="briefing-filters-toggle"
            accessibilityState={{ expanded: filtersOpen }}
            onPress={() => setFiltersOpen((open) => !open)}
            style={{
              minHeight: ROW_MIN_HEIGHT,
              flexDirection: 'row',
              alignItems: 'center',
              paddingVertical: Space.m + 2,
            }}
          >
            <View style={{ flex: 1, gap: Space.xs }}>
              <Text style={[semibold(Type.body), { color: t.primaryText }]}>Filters</Text>
              <Text style={[Type.caption, { color: t.secondaryText }]}>{filterSummary(state)}</Text>
            </View>
            <Chevron color={t.primaryText} dir={filtersOpen ? 'down' : 'right'} />
          </Pressy>
          {filtersOpen ? (
            <>
              <Row>
                <Segmented
                  testID="briefing-window"
                  label="Window"
                  options={WINDOW_CHOICES}
                  titles={WINDOW_CHOICE_TITLE}
                  value={state.windowChoice}
                  onChange={(windowChoice) => set({ windowChoice })}
                />
                <Text style={[Type.caption, { color: t.secondaryText, paddingTop: Space.s }]}>
                  {windowText(model.window)}
                </Text>
              </Row>
              <Row>
                <Segmented
                  testID="briefing-distance"
                  label="Distance from"
                  options={DISTANCE_CHOICES}
                  titles={DISTANCE_CHOICE_TITLE}
                  value={state.distanceChoice}
                  onChange={(distanceChoice) => set({ distanceChoice })}
                />
              </Row>
              {state.distanceChoice !== 'off' ? (
                <Row>
                  <Stepper value={state.corridorNM} onChange={(corridorNM) => set({ corridorNM })} />
                  {note ? <Text style={[Type.caption, { color: t.caution, paddingTop: Space.s }]}>{note}</Text> : null}
                </Row>
              ) : null}
              <Row>
                <TextInput
                  testID="briefing-aerodrome"
                  accessibilityLabel="Aerodrome filter"
                  placeholder="Aerodrome (LLHZ, LLBG)"
                  placeholderTextColor={t.secondaryText}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={state.aerodromeFilter}
                  onChangeText={(aerodromeFilter) => set({ aerodromeFilter })}
                  style={[systemBody, { minHeight: ROW_MIN_HEIGHT, color: t.primaryText }]}
                />
              </Row>
              <Row>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[systemBody, { flex: 1, color: t.primaryText }]}>Unread only</Text>
                  <Switch
                    testID="briefing-unread-only"
                    accessibilityLabel="Unread only"
                    value={state.unreadOnly}
                    onValueChange={(unreadOnly) => set({ unreadOnly })}
                  />
                </View>
              </Row>
              {highlightActive ? (
                <Row>
                  <ListButton
                    title="Clear map highlight"
                    onPress={() => {
                      actions.clearHighlight();
                      setHighlightActive(false);
                    }}
                  />
                </Row>
              ) : null}
            </>
          ) : null}
        </Card>

        {state.report !== null && listable(freshness, state.showStaleList) ? (
          <>
            {rows.length === 0 ? (
              <Card>
                <Row first>
                  <Text style={[Type.body, { color: t.secondaryText }]}>{EMPTY_TEXT}</Text>
                </Row>
              </Card>
            ) : null}
            {BRIEFING_SECTIONS.map((section) => {
              const sectionRows = rowsInSection(rows, section);
              if (sectionRows.length === 0) return null;
              return (
                <View key={section} testID={`briefing-section-${section}`}>
                  <SectionHeader title={BRIEFING_SECTION_TITLE[section]} />
                  <Card>
                    {sectionRows.map((row, i) => {
                      const id = briefingRowId(row);
                      const read = model.isRead(row.notam);
                      return (
                        <Row key={id} first={i === 0}>
                          <NotamRow
                            row={row}
                            read={read}
                            expanded={expanded.has(id)}
                            onToggleRaw={() => toggleRaw(id)}
                            onMarkRead={() => model.markRead(row.notam)}
                            onMarkUnread={() => model.markUnread(row.notam)}
                            onShowOnMap={() => showOnMap(row)}
                          />
                        </Row>
                      );
                    })}
                  </Card>
                </View>
              );
            })}
          </>
        ) : null}

        <View>
          <SectionHeader title="Weather" />
          <Card>
            <Row first>
              <Text style={[Type.body, { color: t.secondaryText }]}>{WEATHER_TEXT}</Text>
            </Row>
            <Row indent={0}>
              <Pressy
                testID="briefing-ims-link"
                accessibilityRole="link"
                accessibilityLabel={IMS_LINK_TITLE}
                onPress={() => actions.openURL(IMS_AVIATION_URL)}
                style={{ minHeight: ROW_MIN_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: Space.l }}
              >
                <View
                  style={{
                    width: 24,
                    height: 24,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 1.5,
                    borderColor: t.accentText,
                    borderRadius: 5,
                  }}
                >
                  <ArrowUpRight color={t.accentText} />
                </View>
                <Text style={[systemBody, { color: t.accentText }]}>{IMS_LINK_TITLE}</Text>
              </Pressy>
            </Row>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

/** A navigation-bar button: SF body on a glass capsule (iOS 26 toolbar items). */
function NavPill({
  title,
  onPress,
  disabled = false,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressy
      testID={testID}
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: ROW_MIN_HEIGHT + 4,
        paddingHorizontal: Space.l + 2,
        justifyContent: 'center',
        borderRadius: 999,
        backgroundColor: grouped(t).card,
        shadowColor: '#000000',
        shadowOpacity: 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <Text style={[systemBody, { color: disabled ? t.secondaryText : t.primaryText, opacity: disabled ? 0.6 : 1 }]}>
        {title}
      </Text>
    </Pressy>
  );
}

function StatusCard({
  status,
  onShowStale,
  onRetry,
}: {
  status: StatusContent;
  onShowStale: () => void;
  onRetry: () => void;
}) {
  const t = useTheme();
  if (status.kind === 'empty') return null;
  return (
    <Card testID="briefing-status">
      {status.kind === 'feed' ? (
        <>
          <Row first>
            {/* HStack { label, badge, Spacer, count }: only the spacer gives way, the labels keep their full width
                (flexShrink 0, no numberOfLines or width). An Android device showed "Fee"; the likely cause is Android's
                highQuality line breaker wrapping the last glyph of a tightly measured word onto a hidden second line,
                which the simple strategy avoids (U4b-plan.md: unverified on a device). */}
            <View testID="briefing-feed-row" style={{ flexDirection: 'row', alignItems: 'center', gap: Space.s }}>
              <Text
                testID="briefing-feed-label"
                textBreakStrategy="simple"
                style={[Type.label, { color: t.secondaryText, flexShrink: 0 }]}
              >
                Feed
              </Text>
              <DataAgeBadge
                level={status.freshness.level}
                text={status.freshness.text}
                productName={status.productName}
              />
              <View style={{ flex: 1 }} />
              <Text style={[Type.caption, { color: t.secondaryText, flexShrink: 0 }]}>{`${status.count} NOTAMs`}</Text>
            </View>
          </Row>
          {status.banners.map((banner) => (
            <Row key={banner.text}>
              <BannerLabel banner={banner} />
            </Row>
          ))}
          {status.showStaleButton ? (
            <Row indent={0}>
              <ListButton testID="briefing-show-stale" title="Show last known list anyway" onPress={onShowStale} />
            </Row>
          ) : null}
          {status.trailing.map((banner) => (
            <Row key={banner.text}>
              <BannerLabel banner={banner} />
            </Row>
          ))}
        </>
      ) : status.kind === 'loading' ? (
        <Row first>
          <Text style={[Type.body, { color: t.primaryText }]}>Loading NOTAMs</Text>
        </Row>
      ) : (
        <>
          <Row first>
            <BannerLabel banner={status.banner} />
          </Row>
          <Row indent={0}>
            <ListButton title="Retry" onPress={onRetry} />
          </Row>
        </>
      )}
    </Card>
  );
}
