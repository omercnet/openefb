// The grouped-list pieces SwiftUI gives Settings, the profile editors and the logbook entry for free: Form, Section,
// LabeledContent, Toggle, Picker, TextField, Button, ProgressView. Plain React Native views over the theme, no native module,
// so they render the same on iOS, Android and the web preview.
import { Children, Fragment, isValidElement, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chevron } from '../Icons';
import { Pressy, useTheme } from '../Primitives';
import { Space } from '../tokens';
import { Checkmark, UpDownChevrons } from './FormIcons';
import { accentText, FormMetrics, FormType, toneColor, type Tone } from './formStyle';

/**
 * A screen of grouped sections under an inline navigation bar (NavigationStack + Form). Navigation itself is the shell's.
 * Needs a SafeAreaProvider above it (expo-router's root has one) for the status bar inset.
 */
export function FormScreen({
  title,
  onBack,
  leading,
  trailing,
  children,
  testID,
}: {
  title: string;
  /** Shows a Back button in the bar's leading slot. */
  onBack?: () => void;
  /** Replaces the Back button (a sheet's Cancel). */
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: t.paper }} testID={testID}>
      <View style={{ paddingTop: insets.top }}>
        <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: Space.s }}>
          <View style={{ flex: 1, alignItems: 'flex-start' }}>
            {leading ?? (onBack ? <BackButton onPress={onBack} /> : null)}
          </View>
          <Text accessibilityRole="header" numberOfLines={1} style={[FormType.headline, { color: t.primaryText }]}>
            {title}
          </Text>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>{trailing}</View>
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: Space.xxl + insets.bottom }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel="Back"
      onPress={onPress}
      style={{ minWidth: 44, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 }}
    >
      <Chevron color={accentText(t)} dir="left" />
      <Text style={[FormType.body, { color: accentText(t) }]}>Back</Text>
    </Pressy>
  );
}

/** A hairline between rows, inset like the row text. */
export function Separator() {
  const t = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ height: 1, marginLeft: FormMetrics.pad, backgroundColor: t.rule, opacity: 0.6 }}
    />
  );
}

/** Section("header") { rows } with an optional footer. Falsy children are skipped, so rows can be conditional. */
export function FormSection({ header, footer, children }: { header?: string; footer?: string; children?: ReactNode }) {
  const t = useTheme();
  const rows = Children.toArray(children);
  if (rows.length === 0) return null;
  const textInset = FormMetrics.margin + FormMetrics.pad;
  return (
    <View style={{ marginTop: Space.xl }}>
      {header ? (
        <Text
          accessibilityRole="header"
          style={[
            FormType.headline,
            { fontWeight: '500', color: t.secondaryText, paddingHorizontal: textInset, paddingBottom: Space.s },
          ]}
        >
          {header}
        </Text>
      ) : null}
      <View
        style={{
          marginHorizontal: FormMetrics.margin,
          backgroundColor: t.activeCell,
          borderRadius: FormMetrics.radius,
          overflow: 'hidden',
        }}
      >
        {rows.map((row, i) => (
          <Fragment key={isValidElement(row) && row.key !== null ? row.key : i}>
            {i > 0 ? <Separator /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <Text
          style={[FormType.footnote, { color: t.secondaryText, paddingHorizontal: textInset, paddingTop: Space.s }]}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** The frame every row shares: 52 pt minimum, 20 pt text inset. Exported for rows with their own content (the pack rows). */
export function RowFrame({
  children,
  style,
  testID,
  accessible,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessible?: boolean;
}) {
  return (
    <View
      accessible={accessible}
      testID={testID}
      style={[
        {
          minHeight: FormMetrics.row,
          paddingHorizontal: FormMetrics.pad,
          paddingVertical: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: Space.m,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A tappable row: dims while pressed (no scale, unlike a button). */
function RowButton({ children, ...rest }: Omit<PressableProps, 'style'> & { children: ReactNode }) {
  return (
    <Pressable {...rest} style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}>
      {children}
    </Pressable>
  );
}

/** LabeledContent("Version", value: ...): label left, value right; a long value wraps right-aligned. */
export function LabeledRow({
  label,
  value,
  valueTone = 'secondary',
  small,
  testID,
}: {
  label: string;
  value: string;
  valueTone?: Tone;
  /** The value in caption size (the "Data" attribution). */
  small?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <RowFrame accessible testID={testID}>
      <Text style={[FormType.body, { color: t.primaryText }]}>{label}</Text>
      <Text
        style={[
          small ? FormType.caption : FormType.body,
          { flex: 1, textAlign: 'right', color: toneColor(t, valueTone) },
        ]}
      >
        {value}
      </Text>
    </RowFrame>
  );
}

/** NavigationLink (a chevron) or Link (accent text, opens elsewhere). */
export function LinkRow({
  label,
  onPress,
  kind = 'push',
  detail,
  detailTone = 'secondary',
  leading,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: 'push' | 'external';
  detail?: string;
  detailTone?: Tone;
  leading?: ReactNode;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <RowButton
      accessibilityRole={kind === 'external' ? 'link' : 'button'}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      testID={testID}
    >
      <RowFrame>
        {leading}
        <Text style={[FormType.body, { flex: 1, color: kind === 'external' ? accentText(t) : t.primaryText }]}>
          {label}
        </Text>
        {detail ? <Text style={[FormType.footnote, { color: toneColor(t, detailTone) }]}>{detail}</Text> : null}
        {kind === 'push' ? <Chevron color={t.secondaryText} dir="right" /> : null}
      </RowFrame>
    </RowButton>
  );
}

export function SwitchRow({
  label,
  value,
  onValueChange,
  disabled,
  testID,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <RowFrame>
      <Text style={[FormType.body, { flex: 1, color: t.primaryText }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        disabled={disabled}
        onValueChange={onValueChange}
        testID={testID}
        value={value}
      />
    </RowFrame>
  );
}

export interface PickerOption<T extends string> {
  value: T;
  title: string;
}

/** Picker: the row shows the current choice; tapping opens the options inline, each a radio row. */
export function PickerRow<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  options: readonly PickerOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.title ?? '';
  return (
    <View>
      <RowButton
        accessibilityLabel={`${label}, ${current}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: disabled === true }}
        disabled={disabled}
        onPress={() => setOpen((o) => !o)}
        testID={testID}
      >
        <RowFrame>
          <Text style={[FormType.body, { flex: 1, color: t.primaryText }]}>{label}</Text>
          <Text style={[FormType.body, { color: t.secondaryText }]}>{current}</Text>
          <UpDownChevrons color={t.secondaryText} />
        </RowFrame>
      </RowButton>
      {open
        ? options.map((o) => (
            <Fragment key={o.value}>
              <Separator />
              <RowButton
                accessibilityLabel={o.title}
                accessibilityRole="radio"
                accessibilityState={{ selected: o.value === value }}
                onPress={() => {
                  setOpen(false);
                  if (o.value !== value) onChange(o.value);
                }}
                testID={testID ? `${testID}-${o.value}` : undefined}
              >
                <RowFrame style={{ paddingLeft: FormMetrics.pad + Space.l }}>
                  <Text style={[FormType.body, { flex: 1, color: t.primaryText }]}>{o.title}</Text>
                  {o.value === value ? <Checkmark color={accentText(t)} /> : null}
                </RowFrame>
              </RowButton>
            </Fragment>
          ))
        : null}
    </View>
  );
}

/** TextField("placeholder", text:) as a row. The placeholder is also the accessibility label unless one is given. */
export function TextFieldRow({ style, ...props }: TextInputProps) {
  const t = useTheme();
  return (
    <RowFrame>
      <TextInput
        accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
        placeholderTextColor={t.secondaryText}
        {...props}
        style={[FormType.body, { flex: 1, minHeight: 32, paddingVertical: 0, color: t.primaryText }, style]}
      />
    </RowFrame>
  );
}

/** Button("title") in a form: accent text, or red when destructive. */
export function ButtonRow({
  title,
  onPress,
  tone = 'accent',
  disabled,
  testID,
}: {
  title: string;
  onPress: () => void;
  tone?: 'accent' | 'warning';
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <RowButton
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
    >
      <RowFrame>
        <Text style={[FormType.body, { color: toneColor(t, tone), opacity: disabled ? 0.4 : 1 }]}>{title}</Text>
      </RowFrame>
    </RowButton>
  );
}

/** A borderless text button inside a custom row (the pack rows' Download, Pause, Delete): a 44 pt target. */
export function InlineButton({
  title,
  onPress,
  tone = 'accent',
  testID,
}: {
  title: string;
  onPress: () => void;
  tone?: 'accent' | 'warning';
  testID?: string;
}) {
  const t = useTheme();
  return (
    <Pressy
      accessibilityLabel={title}
      onPress={onPress}
      testID={testID}
      style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
    >
      <Text style={[FormType.body, { color: toneColor(t, tone) }]}>{title}</Text>
    </Pressy>
  );
}

/** A caption line inside a section (Text(...).font(.caption)). */
export function NoteRow({ text, tone = 'secondary', testID }: { text: string; tone?: Tone; testID?: string }) {
  const t = useTheme();
  return (
    <RowFrame accessible testID={testID}>
      <Text style={[FormType.caption, { flex: 1, color: toneColor(t, tone) }]}>{text}</Text>
    </RowFrame>
  );
}

/** ProgressView(value:): a thin determinate bar. */
export function ProgressBar({ percent }: { percent: number }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent, text: `${percent} percent` }}
      style={{ height: 4, borderRadius: 2, backgroundColor: t.paperSecondary, overflow: 'hidden' }}
    >
      <View style={{ width: `${percent}%`, height: 4, backgroundColor: accentText(t) }} />
    </View>
  );
}
