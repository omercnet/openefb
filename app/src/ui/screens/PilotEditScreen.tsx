// Port of Views/Aircraft/PilotEditView.swift and the NightLandingEntrySheet of PilotProfileView.swift, each presented as a sheet
// by the shell. The form rules are in domain/profiles/pilot.ts.
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useStore } from 'zustand';
import { CERTIFICATE_TYPES, MEDICAL_CLASSES, type CertificateType, type MedicalClass } from '../../data/models';
import {
  CERTIFICATE_TYPE_NAMES,
  MEDICAL_CLASS_NAMES,
  NIGHT_LANDING_STEPPER,
  pilotFormFromProfile,
  type PilotForm,
} from '../../domain/profiles/pilot';
import { DateRow, DeleteRow, StepperRow } from '../form/Controls';
import {
  BarButton,
  FormScreen,
  FormSection,
  NoteRow,
  PickerRow,
  RowFrame,
  SwitchRow,
  TextFieldRow,
} from '../form/Form';
import { FormType } from '../form/formStyle';
import { useTheme } from '../Primitives';
import type { PilotStore } from '../state/pilotStore';

const NONE = 'none';
const certificateOptions = [
  { value: NONE, title: 'None' },
  ...CERTIFICATE_TYPES.map((value) => ({ value, title: CERTIFICATE_TYPE_NAMES[value] })),
];
const medicalOptions = [
  { value: NONE, title: 'None' },
  ...MEDICAL_CLASSES.map((value) => ({ value, title: MEDICAL_CLASS_NAMES[value] })),
];

const NIGHT_LANDING_HINT =
  'Log full-stop night landings for FAR 61.57 currency tracking. Requires 3 landings within 90 days for night passenger-carrying currency.';

export function PilotEditScreen({
  store,
  profileId,
  now,
  onClose,
}: {
  store: PilotStore;
  profileId: string;
  now: () => number;
  /** Cancel, a saved pilot, or a deleted one. */
  onClose: () => void;
}) {
  const { loaded, profiles, saving, error } = useStore(store);
  // The editor can be the first screen opened (a deep link), so it loads the list itself when nobody has.
  useEffect(() => {
    if (!loaded) void store.getState().load();
  }, [store, loaded]);
  const profile = profiles.find((p) => p.id === profileId) ?? null;
  // The form follows the stored profile until the first edit, then it is the user's (Swift's onAppear loadProfile).
  const [edited, setEdited] = useState<PilotForm | null>(null);
  const form = edited ?? (profile === null ? null : pilotFormFromProfile(profile, now()));
  const cancel = <BarButton title="Cancel" onPress={onClose} testID="pilot-cancel" />;

  if (form === null) {
    return (
      <FormScreen title="Edit Pilot" leading={cancel} testID="pilot-edit-screen">
        {loaded ? (
          <FormSection>
            <NoteRow tone="caution" text="This pilot profile no longer exists." />
          </FormSection>
        ) : error ? (
          <FormSection>
            <NoteRow tone="caution" text={error} testID="pilot-error" />
          </FormSection>
        ) : null}
      </FormScreen>
    );
  }

  const base = form; // the form as stored, for an update that arrives before the first edit
  const update = (patch: Partial<PilotForm>) => setEdited((prev) => ({ ...(prev ?? base), ...patch }));
  const save = async () => {
    if ((await store.getState().save(profileId, form)) === 'saved') onClose();
  };

  return (
    <FormScreen
      title="Edit Pilot"
      leading={cancel}
      trailing={<BarButton title="Save" bold disabled={saving} onPress={() => void save()} testID="pilot-save" />}
      testID="pilot-edit-screen"
    >
      {error ? (
        <FormSection>
          <NoteRow tone="caution" text={error} testID="pilot-error" />
        </FormSection>
      ) : null}

      <FormSection header="Personal">
        <TextFieldRow
          placeholder="Name"
          accessibilityLabel="Name"
          value={form.name}
          onChangeText={(name) => update({ name })}
          textContentType="name"
          testID="pilot-name"
        />
        <TextFieldRow
          placeholder="Certificate Number"
          accessibilityLabel="Certificate number"
          value={form.certificateNumber}
          onChangeText={(certificateNumber) => update({ certificateNumber })}
          autoCorrect={false}
        />
        <TextFieldRow
          placeholder="Phone (for flight plans)"
          accessibilityLabel="Phone number"
          value={form.phone}
          onChangeText={(phone) => update({ phone })}
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
        />
        <TextFieldRow
          placeholder="Email"
          accessibilityLabel="Email"
          value={form.email}
          onChangeText={(email) => update({ email })}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </FormSection>

      <FormSection header="Certificate">
        <PickerRow
          label="Certificate Type"
          options={certificateOptions}
          value={form.certificateType ?? NONE}
          onChange={(value) => update({ certificateType: value === NONE ? null : (value as CertificateType) })}
        />
        <PickerRow
          label="Medical Class"
          options={medicalOptions}
          value={form.medicalClass ?? NONE}
          onChange={(value) => update({ medicalClass: value === NONE ? null : (value as MedicalClass) })}
        />
      </FormSection>

      <FormSection header="Dates">
        <SwitchRow
          label="Medical Expiry"
          value={form.hasMedicalExpiry}
          onValueChange={(hasMedicalExpiry) => update({ hasMedicalExpiry })}
        />
        {form.hasMedicalExpiry ? (
          <DateRow
            label="Medical Expiry"
            value={form.medicalExpiry}
            onChange={(medicalExpiry) => update({ medicalExpiry })}
          />
        ) : null}
        <SwitchRow
          label="Flight Review Date"
          value={form.hasFlightReview}
          onValueChange={(hasFlightReview) => update({ hasFlightReview })}
        />
        {form.hasFlightReview ? (
          <DateRow
            label="Flight Review Date"
            value={form.flightReviewDate}
            onChange={(flightReviewDate) => update({ flightReviewDate })}
          />
        ) : null}
      </FormSection>

      <FormSection header="Experience">
        <TextFieldRow
          placeholder="Total Hours"
          accessibilityLabel="Total hours"
          value={form.totalHours}
          onChangeText={(totalHours) => update({ totalHours })}
          keyboardType="decimal-pad"
        />
      </FormSection>

      <FormSection>
        <DeleteRow
          title="Delete Pilot Profile"
          question={`Delete ${profile?.name === '' || profile === null ? 'this pilot profile' : profile.name}? This cannot be undone.`}
          disabled={saving}
          onConfirm={() =>
            void store
              .getState()
              .remove(profileId)
              .then((gone) => gone && onClose())
          }
          testID="pilot-delete"
        />
      </FormSection>
    </FormScreen>
  );
}

/** The sheet behind "Log Night Landings": a date and 1 to 10 landings, added to the active pilot. */
export function NightLandingScreen({
  store,
  now,
  onClose,
}: {
  store: PilotStore;
  now: () => number;
  onClose: () => void;
}) {
  const t = useTheme();
  const { saving, error } = useStore(store);
  const [date, setDate] = useState(now);
  const [count, setCount] = useState<number>(NIGHT_LANDING_STEPPER.initial);
  const save = async () => {
    const result = await store.getState().addNightLandings(date, count);
    if (result === 'saved' || result === 'noActivePilot') onClose();
  };
  return (
    <FormScreen
      title="Log Night Landings"
      leading={<BarButton title="Cancel" onPress={onClose} testID="night-landings-cancel" />}
      trailing={
        <BarButton title="Save" bold disabled={saving} onPress={() => void save()} testID="night-landings-save" />
      }
      testID="night-landings-screen"
    >
      {error ? (
        <FormSection>
          <NoteRow tone="caution" text={error} testID="pilot-error" />
        </FormSection>
      ) : null}
      <FormSection header="Night Landing Entry">
        <DateRow label="Date" value={date} onChange={setDate} />
        <StepperRow
          label="Landings"
          value={count}
          min={NIGHT_LANDING_STEPPER.min}
          max={NIGHT_LANDING_STEPPER.max}
          onChange={setCount}
          testID="night-landings-stepper"
        />
      </FormSection>
      <FormSection>
        <RowFrame accessible>
          <Text style={[FormType.caption, { flex: 1, color: t.secondaryText }]}>{NIGHT_LANDING_HINT}</Text>
        </RowFrame>
      </FormSection>
    </FormScreen>
  );
}
