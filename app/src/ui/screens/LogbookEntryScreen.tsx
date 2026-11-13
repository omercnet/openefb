// Port of Views/Logbook/LogbookEntryEditView.swift: the editor of one logbook entry, or its read-only summary once it is
// confirmed. The form rules are in domain/logbook/logbookForm.ts. The list of entries belongs to the log stack (U3).
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useStore } from 'zustand';
import {
  logbookEditsFromForm,
  logbookFormFromEntry,
  logbookSummary,
  type LogbookForm,
} from '../../domain/logbook/logbookForm';
import { DateRow, FieldRow, StepperRow, TextAreaRow } from '../form/Controls';
import { BarButton, FormScreen, FormSection, LabeledRow, NoteRow, RowFrame } from '../form/Form';
import { LockFill } from '../form/FormIcons';
import { accentText, FormType } from '../form/formStyle';
import { useTheme } from '../Primitives';
import type { LogbookEntryStore } from '../state/logbookEntryStore';

export function LogbookEntryScreen({
  store,
  entryId,
  onClose,
}: {
  store: LogbookEntryStore;
  entryId: string;
  /** Back, a saved entry, or a confirmed one; none at the root of a stack. */
  onClose?: () => void;
}) {
  const t = useTheme();
  const { loaded, entry, saving, error } = useStore(store);
  const [edited, setEdited] = useState<LogbookForm | null>(null);
  useEffect(() => {
    void store.getState().load(entryId);
  }, [store, entryId]);

  // The Swift capture shows the screen at the root of its stack, with no Back (the shell passes onClose when it pushes it).
  const back = onClose ? <BarButton title="Back" onPress={onClose} testID="logbook-back" /> : undefined;
  if (entry === null) {
    return (
      <FormScreen largeTitle title="Edit Entry" leading={back} testID="logbook-entry-screen">
        {loaded || error ? (
          <FormSection>
            <NoteRow tone="caution" text={error ?? 'This logbook entry no longer exists.'} testID="logbook-error" />
          </FormSection>
        ) : null}
      </FormScreen>
    );
  }

  // A confirmed entry is locked: its fields show as stored, whatever was being typed.
  const readOnly = entry.isConfirmed;
  const form = readOnly ? logbookFormFromEntry(entry) : (edited ?? logbookFormFromEntry(entry));
  const base = form; // the form as stored, for an update that arrives before the first edit
  const update = (patch: Partial<LogbookForm>) => setEdited((prev) => ({ ...(prev ?? base), ...patch }));
  const parsed = logbookEditsFromForm(form);
  const submit = async (confirm: boolean) => {
    const result = await (confirm ? store.getState().confirm(form) : store.getState().save(form));
    if (result === 'saved') onClose?.();
  };
  const summary = logbookSummary(entry);

  return (
    <FormScreen
      largeTitle
      title={readOnly ? 'Flight Details' : 'Edit Entry'}
      leading={back}
      trailing={
        readOnly ? undefined : (
          <View style={{ flexDirection: 'row' }}>
            <BarButton
              title="Save"
              disabled={saving || !parsed.ok}
              onPress={() => void submit(false)}
              testID="logbook-save"
            />
            <BarButton
              title="Confirm"
              bold
              tone="ok"
              disabled={saving || !parsed.ok}
              onPress={() => void submit(true)}
              testID="logbook-confirm"
            />
          </View>
        )
      }
      testID="logbook-entry-screen"
    >
      {error ? (
        <FormSection>
          <NoteRow tone="caution" text={error} testID="logbook-error" />
        </FormSection>
      ) : null}
      {readOnly ? (
        <FormSection>
          <RowFrame accessible testID="logbook-locked">
            <LockFill color={t.secondaryText} />
            <Text style={[FormType.subheadline, { flex: 1, color: t.secondaryText }]}>
              This entry has been confirmed and is locked.
            </Text>
          </RowFrame>
        </FormSection>
      ) : null}
      {!readOnly && !parsed.ok ? (
        <FormSection>
          <NoteRow tone="caution" text={parsed.error} testID="logbook-form-error" />
        </FormSection>
      ) : null}

      <FormSection header="Flight Info">
        <DateRow label="Date" value={form.date} onChange={(date) => update({ date })} disabled={readOnly} />
        <FieldRow
          label="Departure"
          placeholder="ICAO"
          fieldWidth={120}
          value={form.departureICAO}
          onChangeText={(departureICAO) => update({ departureICAO })}
          autoCapitalize="characters"
          autoCorrect={false}
          readOnly={readOnly}
          testID="logbook-departure"
        />
        <FieldRow
          label="Arrival"
          placeholder="ICAO"
          fieldWidth={120}
          value={form.arrivalICAO}
          onChangeText={(arrivalICAO) => update({ arrivalICAO })}
          autoCapitalize="characters"
          autoCorrect={false}
          readOnly={readOnly}
          testID="logbook-arrival"
        />
        <FieldRow
          label="Route"
          placeholder="Waypoints"
          value={form.route}
          onChangeText={(route) => update({ route })}
          readOnly={readOnly}
        />
      </FormSection>

      <FormSection header="Duration">
        <FieldRow
          label="Block Time"
          accessibilityLabel="Block time in hours"
          placeholder="0.0"
          suffix="hrs"
          fieldWidth={80}
          value={form.blockTimeHours}
          onChangeText={(blockTimeHours) => update({ blockTimeHours })}
          keyboardType="decimal-pad"
          readOnly={readOnly}
          testID="logbook-block-time"
        />
      </FormSection>

      <FormSection header="Aircraft">
        <FieldRow
          label="Aircraft Type"
          accessibilityLabel="Aircraft type"
          placeholder="e.g. C172"
          fieldWidth={120}
          value={form.aircraftType}
          onChangeText={(aircraftType) => update({ aircraftType })}
          readOnly={readOnly}
        />
      </FormSection>

      <FormSection header="Landings">
        <StepperRow
          label="Day Landings"
          value={form.dayLandingCount}
          min={0}
          max={99}
          onChange={(dayLandingCount) => update({ dayLandingCount })}
          disabled={readOnly}
          testID="logbook-day-landings"
        />
        <StepperRow
          label="Night Landings (61.57)"
          value={form.nightLandingCount}
          min={0}
          max={99}
          onChange={(nightLandingCount) => update({ nightLandingCount })}
          disabled={readOnly}
          testID="logbook-night-landings"
        />
      </FormSection>

      <FormSection header="Notes">
        <TextAreaRow
          accessibilityLabel="Notes"
          value={form.notes}
          onChangeText={(notes) => update({ notes })}
          readOnly={readOnly}
          testID="logbook-notes"
        />
      </FormSection>

      {readOnly ? (
        <FormSection header="Summary">
          <LabeledRow label="Duration" value={summary.duration} testID="logbook-summary-duration" />
          {summary.departureName !== null ? <LabeledRow label="Departure" value={summary.departureName} /> : null}
          {summary.arrivalName !== null ? <LabeledRow label="Arrival" value={summary.arrivalName} /> : null}
          {summary.hasDebrief ? (
            <RowFrame accessible>
              <Text style={[FormType.body, { color: accentText(t) }]}>AI Debrief Available</Text>
            </RowFrame>
          ) : null}
        </FormSection>
      ) : null}
    </FormScreen>
  );
}
