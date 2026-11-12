// Port of Views/Aircraft/AircraftEditView.swift, presented as a sheet by the shell. The form rules (what Save writes, how the
// numbers are read) are in domain/profiles/aircraft.ts.
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import {
  aircraftFormFromProfile,
  emptyAircraftForm,
  ROUTE_NETWORK_OPTIONS,
  V_SPEED_FIELDS,
  type AircraftForm,
} from '../../domain/profiles/aircraft';
import { DateRow, DeleteRow, FieldRow } from '../form/Controls';
import {
  BarButton,
  ButtonRow,
  FormScreen,
  FormSection,
  NoteRow,
  PickerRow,
  SwitchRow,
  TextFieldRow,
} from '../form/Form';
import type { AircraftStore } from '../state/aircraftStore';

const ISRAEL_FOOTER = 'Preselects the CVFR or sport-aviation (LSA) route network when you plan a flight in Israel.';

export function AircraftEditScreen({
  store,
  profileId,
  now,
  onClose,
}: {
  store: AircraftStore;
  /** null creates a new aircraft. */
  profileId: string | null;
  now: () => number;
  /** Cancel, a saved aircraft, or a deleted one. */
  onClose: () => void;
}) {
  const { loaded, profiles, saving, error } = useStore(store);
  const profile = profileId === null ? null : (profiles.find((p) => p.id === profileId) ?? null);
  const [form, setForm] = useState<AircraftForm | null>(() => (profileId === null ? emptyAircraftForm(now()) : null));
  const [showValidation, setShowValidation] = useState(false);
  /** Bumped by Try Again: reads the route network once more after a failed read. */
  const [attempt, setAttempt] = useState(0);

  // The editor can be the first screen opened (a deep link), so it loads the list itself when nobody has.
  useEffect(() => {
    if (!loaded) void store.getState().load();
  }, [store, loaded]);

  // An existing aircraft's route network is kept apart from the profile, so the form waits for it.
  useEffect(() => {
    if (profileId === null || profile === null || form !== null) return;
    let cancelled = false;
    void store
      .getState()
      .routeNetworkFor(profileId)
      .then((read) => {
        // Unreadable: no form (saving would erase the stored choice); the error and Try Again are shown instead.
        if (!cancelled && read !== null) setForm(aircraftFormFromProfile(profile, read.network, now()));
      });
    return () => {
      cancelled = true;
    };
  }, [store, profileId, profile, form, now, attempt]);

  const update = (patch: Partial<AircraftForm>) => setForm((f) => (f === null ? f : { ...f, ...patch }));
  const save = async () => {
    if (form === null) return;
    const result = await store.getState().save(profileId, form);
    if (result === 'saved') onClose();
    else if (result === 'invalid') setShowValidation(true);
  };
  const cancel = <BarButton title="Cancel" onPress={onClose} testID="aircraft-cancel" />;
  const title = profileId === null ? 'New Aircraft' : 'Edit Aircraft';

  if (form === null) {
    return (
      <FormScreen title={title} leading={cancel} testID="aircraft-edit-screen">
        {loaded && profile === null ? (
          <FormSection>
            <NoteRow tone="caution" text="This aircraft profile no longer exists." />
          </FormSection>
        ) : error ? (
          <FormSection>
            <NoteRow tone="caution" text={error} testID="aircraft-error" />
            {profile !== null ? (
              <ButtonRow title="Try Again" onPress={() => setAttempt((n) => n + 1)} testID="aircraft-retry" />
            ) : null}
          </FormSection>
        ) : null}
      </FormScreen>
    );
  }

  return (
    <FormScreen
      title={title}
      leading={cancel}
      trailing={<BarButton title="Save" bold disabled={saving} onPress={() => void save()} testID="aircraft-save" />}
      testID="aircraft-edit-screen"
    >
      {error ? (
        <FormSection>
          <NoteRow tone="caution" text={error} testID="aircraft-error" />
        </FormSection>
      ) : null}

      <FormSection header="Aircraft Info">
        <TextFieldRow
          placeholder="N-number (e.g., N12345)"
          accessibilityLabel="N-number"
          value={form.nNumber}
          onChangeText={(nNumber) => update({ nNumber })}
          autoCapitalize="characters"
          autoCorrect={false}
          testID="aircraft-n-number"
        />
        {showValidation && form.nNumber.trim() === '' ? (
          <NoteRow tone="warning" text="N-number is required" testID="aircraft-n-number-error" />
        ) : null}
        <TextFieldRow
          placeholder="Aircraft type (e.g., Cessna 172SP)"
          accessibilityLabel="Aircraft type"
          value={form.aircraftType}
          onChangeText={(aircraftType) => update({ aircraftType })}
          autoCorrect={false}
        />
        <TextFieldRow
          placeholder="ICAO type (e.g., C172)"
          accessibilityLabel="ICAO type designator"
          value={form.icaoType}
          onChangeText={(icaoType) => update({ icaoType })}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <TextFieldRow
          placeholder="Persons on board (flight plans)"
          accessibilityLabel="Persons on board"
          value={form.personsOnBoard}
          onChangeText={(personsOnBoard) => update({ personsOnBoard })}
          keyboardType="number-pad"
        />
      </FormSection>

      <FormSection header="Israel" footer={ISRAEL_FOOTER}>
        <PickerRow
          label="Usual route network"
          options={ROUTE_NETWORK_OPTIONS}
          value={form.routeNetwork}
          onChange={(routeNetwork) => update({ routeNetwork })}
          testID="aircraft-route-network"
        />
      </FormSection>

      <FormSection header="Performance">
        <TextFieldRow
          placeholder="Usable Fuel (gal)"
          accessibilityLabel="Usable fuel in gallons"
          value={form.fuelCapacity}
          onChangeText={(fuelCapacity) => update({ fuelCapacity })}
          keyboardType="decimal-pad"
        />
        <TextFieldRow
          placeholder="Fuel Burn (GPH)"
          accessibilityLabel="Fuel burn in gallons per hour"
          value={form.fuelBurn}
          onChangeText={(fuelBurn) => update({ fuelBurn })}
          keyboardType="decimal-pad"
        />
        <TextFieldRow
          placeholder="Cruise Speed (kts)"
          accessibilityLabel="Cruise speed in knots"
          value={form.cruiseSpeed}
          onChangeText={(cruiseSpeed) => update({ cruiseSpeed })}
          keyboardType="decimal-pad"
        />
      </FormSection>

      <FormSection header="V-Speeds (Optional)">
        <SwitchRow
          label="Show V-Speeds"
          value={form.showVSpeeds}
          onValueChange={(showVSpeeds) => update({ showVSpeeds })}
        />
        {form.showVSpeeds
          ? V_SPEED_FIELDS.map(({ key, label }) => (
              <FieldRow
                key={key}
                label={label}
                accessibilityLabel={`${label} in knots`}
                placeholder="kts"
                fieldWidth={96}
                small
                value={form.vSpeeds[key]}
                onChangeText={(text) => update({ vSpeeds: { ...form.vSpeeds, [key]: text } })}
                keyboardType="number-pad"
                testID={`aircraft-vspeed-${key}`}
              />
            ))
          : null}
      </FormSection>

      <FormSection header="Inspection Dates">
        <SwitchRow
          label="Annual Due"
          value={form.hasAnnualDue}
          onValueChange={(hasAnnualDue) => update({ hasAnnualDue })}
        />
        {form.hasAnnualDue ? (
          <DateRow label="Annual Due" value={form.annualDue} onChange={(annualDue) => update({ annualDue })} />
        ) : null}
        <SwitchRow
          label="Transponder Due"
          value={form.hasTransponderDue}
          onValueChange={(hasTransponderDue) => update({ hasTransponderDue })}
        />
        {form.hasTransponderDue ? (
          <DateRow
            label="Transponder Due"
            value={form.transponderDue}
            onChange={(transponderDue) => update({ transponderDue })}
          />
        ) : null}
      </FormSection>

      {profileId !== null ? (
        <FormSection>
          <DeleteRow
            title="Delete Aircraft"
            question={`Delete ${profile?.nNumber ?? 'this aircraft'}? This cannot be undone.`}
            disabled={saving}
            onConfirm={() =>
              void store
                .getState()
                .remove(profileId)
                .then((gone) => gone && onClose())
            }
            testID="aircraft-delete"
          />
        </FormSection>
      ) : null}
    </FormScreen>
  );
}
