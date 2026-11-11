// The Layers column's rows (LayersColumnView.swift): segmentRow (equal-width 60pt buttons, drawn here: a platform
// segmented picker is too small a target in flight), the toggle rows over RN Switch (UISwitch on iOS), the
// "Age" data-age line and the unavailable row.
import { useState } from 'react';
import { Platform, Switch, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import {
  evaluateFreshness,
  productDisplayName,
  type DataProduct,
  type FreshnessInput,
} from '../../../domain/core/freshness';
import { DataAgeBadge } from '../../components/Components';
import { Pressy, useTheme } from '../../Primitives';
import { Radius, Space, StripMetrics, Type } from '../../tokens';

/** TypeRole.body.weight(.medium) / (.semibold): Archivo at 15pt in the bundled weights. */
export const bodyMedium = { ...Type.body, fontFamily: 'Kanaf-ArchivoRoman-Medium' };
const bodySemibold = { ...Type.body, fontFamily: 'Kanaf-ArchivoRoman-SemiBold' };
const padded: ViewStyle = { paddingHorizontal: Space.l };

export function SegmentRow<T extends string>({
  options,
  selected,
  title,
  onSelect,
  label,
  testID,
}: {
  options: readonly T[];
  selected: T;
  title: (option: T) => string;
  onSelect: (option: T) => void;
  label: string;
  testID: string;
}) {
  const t = useTheme();
  return (
    // Swift labels the HStack container (.accessibilityElement(children: .contain)); a non-accessible RN View is not
    // spoken on iOS, so each segment carries the group label too ("Display mode, Day"). The container keeps the role
    // and label for web.
    <View
      role="group"
      accessibilityLabel={label}
      testID={testID}
      style={{ flexDirection: 'row', borderRadius: Radius.s, borderWidth: 1, borderColor: t.rule, overflow: 'hidden' }}
    >
      {options.map((option) => {
        const on = option === selected;
        return (
          <Pressy
            key={option}
            accessibilityLabel={`${label}, ${title(option)}`}
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(option)}
            style={{
              flex: 1,
              minHeight: StripMetrics.cell - 2, // inside the 1pt border: 60pt overall like the Swift frame
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? t.activeCell : t.paperSecondary,
            }}
          >
            <Text style={[on ? bodySemibold : Type.body, { color: on ? t.ink : t.inkSecondary }]}>{title(option)}</Text>
          </Pressy>
        );
      })}
    </View>
  );
}

/** Off track of the web / Android switch, sampled from the reference; iOS keeps the UISwitch default. */
const OFF_TRACK = Platform.OS === 'ios' ? undefined : '#B9BABE';
const webSwitch =
  Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF', thumbColor: '#FFFFFF', style: { width: 63, height: 28 } } : {};

/** A 60pt row: medium body label and a Switch tinted per layer (`.tint(...)`). */
export function ToggleRow({
  label,
  value,
  onChange,
  tint,
  hint,
  testID,
  inset = true,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  tint: string;
  hint?: string;
  testID?: string;
  inset?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        { minHeight: StripMetrics.cell, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
        inset && padded,
      ]}
    >
      <Text style={[bodyMedium, { color: t.ink }]} accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: OFF_TRACK, true: tint }}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ checked: value }}
        testID={testID ?? label}
        {...webSwitch}
      />
    </View>
  );
}

/**
 * One-line caption under a row (inkSecondary). `minScale` is SwiftUI's minimumScaleFactor: native text uses
 * adjustsFontSizeToFit; react-native-web has none, so there an invisible unconstrained copy measures the line.
 */
export function Caption({
  text,
  color,
  minScale,
  style,
}: {
  text: string;
  color?: string;
  minScale?: number;
  style?: TextStyle;
}) {
  const t = useTheme();
  const [natural, setNatural] = useState(0);
  const [box, setBox] = useState(0);
  const base = [Type.caption, { color: color ?? t.inkSecondary }, style];
  if (!minScale || Platform.OS !== 'web') {
    return (
      <Text numberOfLines={1} adjustsFontSizeToFit={!!minScale} minimumFontScale={minScale} style={base}>
        {text}
      </Text>
    );
  }
  const size = 13 * (natural > box && box > 0 ? Math.max(minScale, box / natural) : 1); // Type.caption is 13pt
  return (
    <View onLayout={(e) => setBox(e.nativeEvent.layout.width)}>
      <Text numberOfLines={1} style={[base, { fontSize: size }]}>
        {text}
      </Text>
      <View pointerEvents="none" style={{ position: 'absolute', width: 10_000, alignItems: 'flex-start', opacity: 0 }}>
        <Text style={base} onLayout={(e) => setNatural(e.nativeEvent.layout.width)}>
          {text}
        </Text>
      </View>
    </View>
  );
}

/** "Age" and the product's DataAgeBadge. */
export function AgeLine({ product, input, style }: { product: DataProduct; input: FreshnessInput; style?: ViewStyle }) {
  const f = evaluateFreshness(product, input);
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: Space.xs }, style]}>
      <Caption text="Age" />
      <DataAgeBadge level={f.level} text={f.text} productName={productDisplayName(product)} />
    </View>
  );
}

/** Disabled row for a layer the region has no data source for. Plain reason, never an empty layer. */
export function UnavailableRow({ label, reason, inset = true }: { label: string; reason: string; inset?: boolean }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}, unavailable`}
      accessibilityValue={{ text: reason }}
      testID={`unavailable-${label}`}
      style={[{ minHeight: StripMetrics.cell, justifyContent: 'center', gap: 2 }, inset && padded]}
    >
      <Text style={[bodyMedium, { color: t.inkSecondary }]}>{label}</Text>
      <Caption text={reason} />
    </View>
  );
}
