// Port of Views/Aircraft/AircraftListView.swift: the aircraft profiles, the active one marked, and the way to the pilot profile.
// Navigation is the shell's (I1): the screen reports where the user wants to go. The shell creates the store and loads it.
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useStore } from 'zustand';
import { aircraftRowSummary } from '../../domain/profiles/aircraft';
import { FormScreen, FormSection, LinkRow, NoteRow, RowButton, RowFrame } from '../form/Form';
import { Checkmark, PersonCircle } from '../form/FormIcons';
import { accentText, FormType } from '../form/formStyle';
import { Plus } from '../Icons';
import { Pressy, useTheme } from '../Primitives';
import type { AircraftStore } from '../state/aircraftStore';
import type { AircraftProfile } from '../../data/models';

export interface AircraftListNavigation {
  onBack?: () => void;
  /** The "+" button: present the editor for a new aircraft. */
  onAdd: () => void;
  onEdit: (id: string) => void;
  /** Pilot > Pilot Profile */
  onOpenPilot: () => void;
}

function AircraftRow({
  profile,
  isActive,
  onSelect,
  onEdit,
}: {
  profile: AircraftProfile;
  isActive: boolean;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const t = useTheme();
  const summary = aircraftRowSummary(profile);
  const spoken = [summary.title, summary.subtitle, summary.fuelLine].filter((part) => part !== null).join(', ');
  return (
    <RowFrame style={{ gap: 0 }} testID={`aircraft-row-${profile.id}`}>
      <RowButton
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ selected: isActive }}
        onPress={onSelect}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[FormType.headline, { color: t.primaryText }]}>{summary.title}</Text>
            {summary.subtitle ? (
              <Text style={[FormType.subheadline, { color: t.secondaryText }]}>{summary.subtitle}</Text>
            ) : null}
            {summary.fuelLine ? (
              <Text style={[FormType.caption, { color: t.secondaryText }]}>{summary.fuelLine}</Text>
            ) : null}
          </View>
          {isActive ? (
            <View accessible accessibilityLabel="Selected">
              <Checkmark color={accentText(t)} size={22} />
            </View>
          ) : null}
        </View>
      </RowButton>
      <Pressy
        accessibilityLabel={`Edit ${summary.title}`}
        onPress={onEdit}
        testID={`aircraft-edit-${profile.id}`}
        style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'flex-end' }}
      >
        <Text style={[FormType.body, { color: accentText(t) }]}>Edit</Text>
      </Pressy>
    </RowFrame>
  );
}

export function AircraftListScreen({
  store,
  navigation,
}: {
  store: AircraftStore;
  navigation: AircraftListNavigation;
}) {
  const t = useTheme();
  const { loaded, profiles, activeId, error } = useStore(store);
  useEffect(() => {
    void store.getState().load();
  }, [store]);
  return (
    <FormScreen
      largeTitle
      title="Aircraft & Pilot"
      onBack={navigation.onBack}
      testID="aircraft-list-screen"
      trailing={
        <Pressy
          accessibilityLabel="Add aircraft"
          onPress={navigation.onAdd}
          testID="aircraft-add"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Plus color={accentText(t)} />
        </Pressy>
      }
    >
      {error ? (
        <FormSection>
          <NoteRow tone="caution" text={error} testID="aircraft-error" />
        </FormSection>
      ) : null}
      <FormSection header="Aircraft Profiles" headerDetail={profiles.length > 0 ? String(profiles.length) : undefined}>
        {profiles.map((profile) => (
          <AircraftRow
            key={profile.id}
            profile={profile}
            isActive={profile.id === activeId}
            onSelect={() => void store.getState().select(profile.id)}
            onEdit={() => navigation.onEdit(profile.id)}
          />
        ))}
        {loaded && profiles.length === 0 ? (
          <RowFrame accessible>
            <Text style={[FormType.body, { color: t.secondaryText, fontStyle: 'italic' }]}>
              No aircraft profiles yet
            </Text>
          </RowFrame>
        ) : null}
      </FormSection>
      <FormSection header="Pilot">
        <LinkRow
          label="Pilot Profile"
          leading={<PersonCircle color={accentText(t)} />}
          onPress={navigation.onOpenPilot}
          testID="pilot-profile-link"
        />
      </FormSection>
    </FormScreen>
  );
}
