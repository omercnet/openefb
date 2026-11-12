// Form controls the profile and logbook editors need beyond Form.tsx: a date row with an inline calendar (SwiftUI DatePicker,
// displayedComponents: .date), Stepper, a label-and-field row, a multi-line text area and a two-step delete. Plain React Native
// views over the theme, like the rest of the form kit.
import { useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { formatDay, localDateParts, monthGrid, monthTitle, shiftMonth, withLocalDate } from '../../domain/calendar';
import { Chevron } from '../Icons';
import { Pressy, useTheme } from '../Primitives';
import { Space } from '../tokens';
import { RowButton, RowFrame, Separator } from './Form';
import { accentText, FormMetrics, FormType, toneColor } from './formStyle';
import { dayAccessibilityLabel, stepValue, WEEKDAY_LETTERS } from './logic';

function CalendarGrid({ value, onChange }: { value: number; onChange: (epochMs: number) => void }) {
  const t = useTheme();
  const selected = localDateParts(value);
  const [shown, setShown] = useState({ year: selected.year, month: selected.month });
  const move = (delta: number) => setShown((s) => shiftMonth(s.year, s.month, delta));
  return (
    <View style={{ paddingHorizontal: FormMetrics.pad, paddingBottom: Space.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressy
          accessibilityLabel="Previous month"
          onPress={() => move(-1)}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Chevron color={accentText(t)} dir="left" />
        </Pressy>
        <Text accessibilityRole="header" style={[FormType.headline, { color: t.primaryText }]}>
          {monthTitle(shown.year, shown.month)}
        </Text>
        <Pressy
          accessibilityLabel="Next month"
          onPress={() => move(1)}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Chevron color={accentText(t)} dir="right" />
        </Pressy>
      </View>
      <View
        style={{ flexDirection: 'row' }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {WEEKDAY_LETTERS.map((letter, i) => (
          <Text key={i} style={[FormType.caption, { flex: 1, textAlign: 'center', color: t.secondaryText }]}>
            {letter}
          </Text>
        ))}
      </View>
      {monthGrid(shown.year, shown.month).map((week) => (
        <View key={`${week[0].year}-${week[0].month}-${week[0].day}`} style={{ flexDirection: 'row' }}>
          {week.map((d) => {
            const isSelected = d.year === selected.year && d.month === selected.month && d.day === selected.day;
            return (
              <Pressable
                key={`${d.month}-${d.day}`}
                accessibilityRole="button"
                accessibilityLabel={dayAccessibilityLabel(d.year, d.month, d.day)}
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  onChange(withLocalDate(value, d.year, d.month, d.day));
                  if (!d.inMonth) setShown({ year: d.year, month: d.month });
                }}
                style={{ flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isSelected ? t.accent : 'transparent',
                  }}
                >
                  <Text
                    style={[
                      FormType.body,
                      { color: isSelected ? t.onAccent : d.inMonth ? t.primaryText : t.secondaryText },
                    ]}
                  >
                    {d.day}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** DatePicker(label, selection:, displayedComponents: .date): the day on the right; tapping the row opens the calendar below it. */
export function DateRow({
  label,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  /** Epoch ms. Choosing a day keeps the time of day. */
  value: number;
  onChange: (epochMs: number) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const day = formatDay(value);
  return (
    <View>
      <RowButton
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${day}`}
        accessibilityState={{ expanded: open, disabled: disabled === true }}
        disabled={disabled}
        onPress={() => setOpen((o) => !o)}
        testID={testID}
      >
        <RowFrame>
          <Text style={[FormType.body, { flex: 1, color: t.primaryText }]}>{label}</Text>
          <View style={{ backgroundColor: t.fill, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={[FormType.body, { color: disabled ? t.secondaryText : open ? accentText(t) : t.primaryText }]}>
              {day}
            </Text>
          </View>
        </RowFrame>
      </RowButton>
      {open ? (
        <>
          <Separator />
          <CalendarGrid value={value} onChange={onChange} />
        </>
      ) : null}
    </View>
  );
}

/** Stepper("Label: value", value:, in: min...max). One adjustable element for a screen reader, two 44 pt buttons for touch. */
export function StepperRow({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const step = (delta: number) => onChange(stepValue(value, delta, min, max));
  const button = (title: string, delta: number, atLimit: boolean) => (
    <Pressy
      accessibilityElementsHidden
      importantForAccessibility="no"
      disabled={disabled === true || atLimit}
      onPress={() => step(delta)}
      style={{
        width: 44,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled || atLimit ? 0.4 : 1,
      }}
    >
      <Text style={[FormType.title2, { color: accentText(t) }]}>{title}</Text>
    </Pressy>
  );
  return (
    <RowFrame
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value, text: String(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      accessibilityState={{ disabled: disabled === true }}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      testID={testID}
    >
      <Text style={[FormType.body, { flex: 1, color: t.primaryText }]}>{`${label}: ${value}`}</Text>
      <View style={{ flexDirection: 'row', backgroundColor: t.fill, borderRadius: 8 }}>
        {button('\u2212', -1, value <= min)}
        <View style={{ width: 1, marginVertical: 6, backgroundColor: t.rule }} />
        {button('+', 1, value >= max)}
      </View>
    </RowFrame>
  );
}

/**
 * A label on the left and a right-aligned field (the logbook's Departure and Arrival, a V-speed's "kts"). `fieldWidth` caps the
 * field the way SwiftUI's `.frame(maxWidth:)` does, leaving the rest of the row to the label; without it the field takes the row.
 */
export function FieldRow({
  label,
  readOnly,
  suffix,
  fieldWidth,
  small,
  style,
  ...input
}: TextInputProps & {
  label: string;
  /** Locked: the text is shown but cannot be edited. */
  readOnly?: boolean;
  /** A unit after the field ("hrs"); not read out, the field's label says it. */
  suffix?: string;
  fieldWidth?: number;
  /** The label in subheadline size (a V-speed's). */
  small?: boolean;
}) {
  const t = useTheme();
  return (
    <RowFrame>
      <Text
        style={[
          small ? FormType.subheadline : FormType.body,
          { color: t.primaryText },
          fieldWidth ? { flex: 1 } : null,
        ]}
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={input.accessibilityLabel ?? label}
        placeholderTextColor={t.secondaryText}
        editable={readOnly !== true}
        {...input}
        style={[
          FormType.body,
          {
            minHeight: 32,
            paddingVertical: 0,
            textAlign: 'right',
            color: readOnly ? t.secondaryText : t.primaryText,
          },
          fieldWidth ? { width: fieldWidth } : { flex: 1 },
          style,
        ]}
      />
      {suffix ? (
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[FormType.body, { color: t.secondaryText }]}
        >
          {suffix}
        </Text>
      ) : null}
    </RowFrame>
  );
}

/** A multi-line text area (TextEditor, 80 pt minimum). */
export function TextAreaRow({ readOnly, style, ...input }: TextInputProps & { readOnly?: boolean }) {
  const t = useTheme();
  return (
    <RowFrame>
      <TextInput
        multiline
        textAlignVertical="top"
        placeholderTextColor={t.secondaryText}
        editable={readOnly !== true}
        {...input}
        style={[
          FormType.body,
          { flex: 1, minHeight: 80, paddingVertical: 4, color: readOnly ? t.secondaryText : t.primaryText },
          style,
        ]}
      />
    </RowFrame>
  );
}

/**
 * A destructive row that asks first: the first tap shows the question with Cancel and Delete. Swift deleted on a swipe with no
 * question; a button next to Save is easier to hit by mistake than a swipe, so this one asks.
 */
export function DeleteRow({
  title,
  question,
  onConfirm,
  disabled,
  testID,
}: {
  title: string;
  question: string;
  onConfirm: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const t = useTheme();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <RowButton
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: disabled === true }}
        disabled={disabled}
        onPress={() => setAsking(true)}
        testID={testID}
      >
        <RowFrame>
          <Text style={[FormType.body, { color: toneColor(t, 'warning'), opacity: disabled ? 0.4 : 1 }]}>{title}</Text>
        </RowFrame>
      </RowButton>
    );
  }
  return (
    <RowFrame
      accessibilityRole="alert"
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: Space.s, paddingVertical: 12 }}
    >
      <Text style={[FormType.body, { color: t.primaryText }]}>{question}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressy
          accessibilityLabel="Cancel"
          onPress={() => setAsking(false)}
          style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={[FormType.body, { color: accentText(t) }]}>Cancel</Text>
        </Pressy>
        <Pressy
          accessibilityLabel="Delete"
          onPress={() => {
            setAsking(false);
            onConfirm();
          }}
          testID={testID ? `${testID}-confirm` : undefined}
          style={{ minWidth: 44, minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={[FormType.body, { color: toneColor(t, 'warning'), fontWeight: '600' }]}>Delete</Text>
        </Pressy>
      </View>
    </RowFrame>
  );
}
