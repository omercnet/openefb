// Shared strip pieces: theme context, PressableButtonStyle, ColumnRule, section labels and the 60pt cell button
// (efb-212/Core/Interaction.swift, Views/Log/AirportColumnView.swift, Views/Log/FlightLogRows.swift).
import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { Day, Space, StripMetrics, Type, tracked, type Theme } from './tokens';

export const ThemeContext = createContext<Theme>(Day);
export const useTheme = () => useContext(ThemeContext);

/** PressableButtonStyle: dims to 55% and scales to 0.97 while pressed, instantly (no animation). */
export function Pressy({ style, children, ...rest }: Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      style={({ pressed }) => [style, pressed && { opacity: 0.55, transform: [{ scale: 0.97 }] }]}
    >
      {children}
    </Pressable>
  );
}

/** 1pt hairline between rows and sections. */
export function ColumnRule({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ height: 1, backgroundColor: t.rule }, style]} accessibilityElementsHidden importantForAccessibility="no" />;
}

/** Uppercase tracked section label ("WEATHER"). */
export function SectionLabel({ title }: { title: string }) {
  const t = useTheme();
  return (
    <Text accessibilityRole="header" style={[Type.stripLabel, tracked, { color: t.inkSecondary, textTransform: 'uppercase' }]}>
      {title}
    </Text>
  );
}

/** Section band: "NEXT" with an optional quiet detail ("direct") on the right. */
export function SectionBand({ title, detail }: { title: string; detail?: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: Space.m,
        paddingVertical: Space.xs,
        backgroundColor: t.paperSecondary,
      }}
    >
      <SectionLabel title={title} />
      {detail ? <SectionLabel title={detail} /> : null}
    </View>
  );
}

/** A 60pt strip control: glyph over an uppercase tracked label. */
export function CellButton({ title, label, accessibilityValue, icon, onPress, style }: {
  title: string;
  label: string;
  accessibilityValue?: string;
  icon: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel={label}
      accessibilityValue={accessibilityValue ? { text: accessibilityValue } : undefined}
      onPress={onPress}
      style={[{ minWidth: StripMetrics.cell, minHeight: StripMetrics.cell, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      {icon}
      <Text numberOfLines={1} style={[Type.stripLabel, tracked, { color: t.ink, marginTop: 2, textTransform: 'uppercase' }]}>
        {title}
      </Text>
    </Pressy>
  );
}
