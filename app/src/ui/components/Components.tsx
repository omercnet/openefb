// Port of efb-212/Views/Components: CurrencyBadge, DataAgeBadge, DatabaseUnavailableBanner, FlightCategoryDot,
// OpacitySlider, RemoteConfigBanner, SearchBar. Views take plain props; the Swift versions read AppState and
// RemoteConfigStore, which the screens that mount these will wire up.
import { useState } from 'react';
import { Linking, Text, TextInput, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';

import { InfoCircle, Magnifier, OctagonWarning, WarningTriangle, Xmark, XmarkCircleFill } from '../Icons';
import { Pressy, useTheme } from '../Primitives';
import { Radius, Space, StripMetrics, Type } from '../tokens';
import {
  APP_STORE_URL,
  DATABASE_UNAVAILABLE_BACKGROUND,
  DATABASE_UNAVAILABLE_DETAIL,
  DATABASE_UNAVAILABLE_TITLE,
  clampOpacity,
  currencyStatusColor,
  currencyStatusText,
  dataAgeBackgroundAlpha,
  dataAgeTint,
  flightCategoryAccessibilityLabel,
  flightCategoryColor,
  flightCategoryLabel,
  isAlertLevel,
  isDataAgeBadgeVisible,
  opacityAccessibilityValue,
  opacityPercentText,
  stepOpacity,
  type CurrencyStatus,
  type FlightCategory,
  type FreshnessLevel,
} from './logic';

/**
 * `color` with its alpha scaled by `alpha` (the Swift `Color.opacity(_)` multiplies: secondaryText at 0.6 with .opacity(0.2)
 * draws at 0.12); handles #RRGGBB (6 digits only; Theme has no short or 8-digit hex) and rgb(r,g,b) / rgba(r,g,b,a).
 */
function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const m = /rgba?\(([^,]+),([^,]+),([^,)]+)(?:,([^)]+))?\)/.exec(color);
  if (!m) return color;
  const base = m[4] === undefined ? 1 : Number(m[4]);
  return `rgba(${m[1]},${m[2]},${m[3]},${Math.round(base * alpha * 1000) / 1000})`;
}

const subheadline = Type.systemSubheadline;
const caption = { fontSize: 12, lineHeight: 16 } as const;
const footnote = { fontSize: 13, lineHeight: 18 } as const;

/** CurrencyBadge: status dot and label, status in words on the right (words carry the meaning, the dot reinforces it). */
export function CurrencyBadge({ status, label }: { status: CurrencyStatus; label: string }) {
  const t = useTheme();
  const text = currencyStatusText(status);
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${text}`}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View
          style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: currencyStatusColor(status, t) }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={[subheadline, { color: t.primaryText }]}>{label}</Text>
      </View>
      <Text style={[caption, { color: t.primaryText, fontWeight: '600' }]}>{text}</Text>
    </View>
  );
}

/** DataAgeBadge for an already evaluated freshness (level, display text, product name). */
export function DataAgeBadge({
  level,
  text,
  productName,
  hideWhenFresh = false,
}: {
  level: FreshnessLevel;
  text: string;
  productName: string;
  hideWhenFresh?: boolean;
}) {
  const t = useTheme();
  if (!isDataAgeBadgeVisible(level, hideWhenFresh)) return null;
  const alert = isAlertLevel(level);
  return (
    <View
      accessible
      accessibilityLabel={`${productName} age`}
      accessibilityValue={{ text }}
      testID="data-age-badge"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: Space.xs,
        paddingHorizontal: Space.s,
        paddingVertical: Space.xs,
        borderRadius: 999,
        backgroundColor: withAlpha(dataAgeTint(level, t), dataAgeBackgroundAlpha(level)),
      }}
    >
      {alert ? <WarningTriangle color={t.primaryText} bang={t.paper} /> : null}
      <Text style={[Type.systemFootnoteSemibold, { color: alert ? t.primaryText : t.secondaryText }]}>{text}</Text>
    </View>
  );
}

/** DatabaseUnavailableBanner: shown while the airport database failed to open. */
export function DatabaseUnavailableBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${DATABASE_UNAVAILABLE_TITLE}. ${DATABASE_UNAVAILABLE_DETAIL}`}
      testID="databaseUnavailableBanner"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignSelf: 'stretch',
        backgroundColor: DATABASE_UNAVAILABLE_BACKGROUND,
      }}
    >
      <OctagonWarning color="#FFFFFF" bang={DATABASE_UNAVAILABLE_BACKGROUND} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[subheadline, { color: '#FFFFFF', fontWeight: '700' }]}>{DATABASE_UNAVAILABLE_TITLE}</Text>
        <Text style={[caption, { color: 'rgba(255,255,255,0.9)' }]}>{DATABASE_UNAVAILABLE_DETAIL}</Text>
      </View>
    </View>
  );
}

/** FlightCategoryDot: category-coloured dot, optionally with the VFR/MVFR/IFR/LIFR text beside it. */
export function FlightCategoryDot({
  category,
  size = 12,
  showsLabel = false,
}: {
  category: FlightCategory;
  size?: number;
  showsLabel?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={flightCategoryAccessibilityLabel(category)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }}
    >
      <View
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: flightCategoryColor(category, t) }}
      />
      {showsLabel ? (
        <Text style={[Type.systemHeadline, { color: t.primaryText }]}>{flightCategoryLabel(category)}</Text>
      ) : null}
    </View>
  );
}

/** OpacitySlider: 0..1 slider, labelled "Sectional chart opacity", spoken as "<n> percent". */
export function OpacitySlider({ opacity, onChange }: { opacity: number; onChange: (value: number) => void }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const knobTravel = width - 28; // knob is 28 wide; the knob centre follows the finger
  const set = (x: number) => onChange(clampOpacity(knobTravel > 0 ? (x - 14) / knobTravel : 0));
  const step = (e: AccessibilityActionEvent) => {
    const next = stepOpacity(opacity, e.nativeEvent.actionName);
    if (next !== null) onChange(next);
  };
  const knob = 28;
  const fill = clampOpacity(opacity) * Math.max(0, width - knob);
  return (
    <View style={{ gap: Space.xs }}>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[Type.label, { color: t.secondaryText }]}>Opacity</Text>
        <Text style={[Type.valueSmall, { color: t.primaryText }]}>{opacityPercentText(opacity)}</Text>
      </View>
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => set(e.nativeEvent.locationX)}
        onResponderMove={(e) => set(e.nativeEvent.locationX)}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Sectional chart opacity"
        accessibilityValue={{ text: opacityAccessibilityValue(opacity) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={step}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.rule }}>
          <View style={{ height: 4, borderRadius: 2, width: fill + knob / 2, backgroundColor: t.accent }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: fill,
            width: knob,
            height: knob,
            borderRadius: knob / 2,
            backgroundColor: t.activeCell,
            borderWidth: 1,
            borderColor: t.rule,
          }}
        />
      </View>
    </View>
  );
}

export interface BannerItem {
  id: string;
  text: string;
  isCaution: boolean;
  offersUpdate: boolean;
}

/** RemoteConfigBanner: stacked, dismissible notices (update request first, then region notices). */
export function RemoteConfigBanner({ items, onDismiss }: { items: BannerItem[]; onDismiss: (id: string) => void }) {
  const t = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: 6, paddingHorizontal: 16 }} testID="remoteConfigBanner">
      {items.map((item) => (
        <View
          key={item.id}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 12,
            paddingVertical: 4,
            borderRadius: Radius.s,
            backgroundColor: item.isCaution ? withAlpha(t.caution, 0.15) : t.infoFill,
          }}
        >
          <View accessibilityElementsHidden importantForAccessibility="no">
            {item.isCaution ? <WarningTriangle color={t.caution} bang={t.paper} /> : <InfoCircle color={t.accent} />}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text maxFontSizeMultiplier={1.35} style={[footnote, { color: t.primaryText }]}>
              {item.text}
            </Text>
            {item.offersUpdate ? (
              <Text
                accessibilityRole="link"
                onPress={() => void Linking.openURL(APP_STORE_URL)}
                style={[footnote, { color: t.accent, fontWeight: '700' }]}
              >
                Open the App Store
              </Text>
            ) : null}
          </View>
          <Pressy
            accessibilityLabel="Dismiss notice"
            onPress={() => onDismiss(item.id)}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Xmark color={t.secondaryText} />
          </Pressy>
        </View>
      ))}
    </View>
  );
}

/** SearchBar: ICAO-style input (uppercase, no autocorrect, Search key) with a clear button. */
export function SearchBar({
  text,
  onChangeText,
  placeholder,
  focusOnAppear = false,
  onSubmit,
}: {
  text: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  focusOnAppear?: boolean;
  onSubmit: () => void;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: Space.s,
        paddingLeft: Space.m,
        backgroundColor: t.activeCell,
        borderRadius: Radius.s,
        borderWidth: 1,
        borderColor: t.rule,
      }}
    >
      <View accessibilityElementsHidden importantForAccessibility="no">
        <Magnifier color={t.inkSecondary} />
      </View>
      <TextInput
        value={text}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.inkSecondary}
        autoFocus={focusOnAppear}
        autoCorrect={false}
        autoCapitalize="characters"
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        accessibilityLabel={placeholder}
        style={[Type.body, { flex: 1, color: t.ink, minHeight: StripMetrics.cell, padding: 0 }]}
      />
      {text.length > 0 ? (
        <Pressy
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          style={{
            minWidth: StripMetrics.cell,
            minHeight: StripMetrics.cell,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <XmarkCircleFill color={t.inkSecondary} cross={t.activeCell} />
        </Pressy>
      ) : null}
    </View>
  );
}
