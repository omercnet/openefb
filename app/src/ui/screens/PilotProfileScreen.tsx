// Port of Views/Aircraft/PilotProfileView.swift: the pilot profiles, the active pilot's details, currency status (FAR 61.23,
// 61.56, 61.57) and night landings. What it shows for a given set of profiles is decided in domain/profiles/pilotScreen.ts,
// including a Swift bug that is kept on purpose (a sole inactive pilot shows nothing; see docs/port-notes/U7.md).
// Navigation is the shell's (I1): the screen reports where the user wants to go.
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { useStore } from 'zustand';
import type { PilotProfile } from '../../data/models';
import { formatDay } from '../../domain/calendar';
import {
  landingCountText,
  pilotInfoRows,
  pilotRowSubtitle,
  pilotRowTitle,
  recentNightLandings,
} from '../../domain/profiles/pilot';
import { pilotScreenLayout } from '../../domain/profiles/pilotScreen';
import { CurrencyBadge } from '../components/Components';
import { ButtonRow, FormScreen, FormSection, LabeledRow, NoteRow, RowButton, RowFrame } from '../form/Form';
import { Checkmark, MoonFill, Pencil, PersonPlus } from '../form/FormIcons';
import { accentText, FormType } from '../form/formStyle';
import { Plus } from '../Icons';
import { Pressy, useTheme } from '../Primitives';
import type { PilotStore } from '../state/pilotStore';

export interface PilotProfileNavigation {
  onBack?: () => void;
  /** Present the editor for this pilot. */
  onEdit: (id: string) => void;
  /** Present the night landing sheet. */
  onLogNightLandings: () => void;
}

function PilotRow({ profile, isActive, onSelect }: { profile: PilotProfile; isActive: boolean; onSelect: () => void }) {
  const t = useTheme();
  const title = pilotRowTitle(profile);
  const subtitle = pilotRowSubtitle(profile);
  return (
    <RowButton
      accessibilityRole="button"
      accessibilityLabel={subtitle === null ? title : `${title}, ${subtitle}`}
      accessibilityState={{ selected: isActive }}
      onPress={onSelect}
      testID={`pilot-row-${profile.id}`}
    >
      <RowFrame style={{ minHeight: 60 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[FormType.headline, { color: t.primaryText }]}>{title}</Text>
          {subtitle ? <Text style={[FormType.subheadline, { color: t.secondaryText }]}>{subtitle}</Text> : null}
        </View>
        {isActive ? (
          <View accessible accessibilityLabel="Selected">
            <Checkmark color={accentText(t)} size={22} />
          </View>
        ) : null}
      </RowFrame>
    </RowButton>
  );
}

export function PilotProfileScreen({ store, navigation }: { store: PilotStore; navigation: PilotProfileNavigation }) {
  const t = useTheme();
  const { loaded, profiles, activeId, currency, error } = useStore(store);
  useEffect(() => {
    void store.getState().load();
  }, [store]);
  const layout = pilotScreenLayout(profiles);
  const { active } = layout;
  // Create Pilot Profile and the toolbar plus: add a blank profile, then open the editor on it.
  const createAndEdit = async () => {
    const id = await store.getState().create();
    if (id !== null) navigation.onEdit(id);
  };
  return (
    <FormScreen
      title="Pilot Profile"
      onBack={navigation.onBack}
      testID="pilot-profile-screen"
      trailing={
        layout.showAddToolbar ? (
          <Pressy
            accessibilityLabel="Add pilot profile"
            onPress={() => void createAndEdit()}
            testID="pilot-add"
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Plus color={accentText(t)} />
          </Pressy>
        ) : undefined
      }
    >
      {error ? (
        <FormSection>
          <NoteRow tone="caution" text={error} testID="pilot-error" />
        </FormSection>
      ) : null}

      {!loaded ? null : layout.empty ? (
        <FormSection>
          <ButtonRow
            title="Create Pilot Profile"
            icon={<PersonPlus color={accentText(t)} />}
            onPress={() => void createAndEdit()}
            testID="pilot-create"
          />
        </FormSection>
      ) : (
        <>
          {layout.showProfileList ? (
            <FormSection header="Pilot Profiles">
              {profiles.map((profile) => (
                <PilotRow
                  key={profile.id}
                  profile={profile}
                  isActive={profile.id === activeId}
                  onSelect={() => void store.getState().select(profile.id)}
                />
              ))}
            </FormSection>
          ) : null}

          {active ? (
            <>
              <FormSection header="Pilot Info">
                {pilotInfoRows(active).map((row) => (
                  <LabeledRow key={row.label} label={row.label} value={row.value} />
                ))}
                <ButtonRow
                  title="Edit Profile"
                  icon={<Pencil color={accentText(t)} />}
                  onPress={() => navigation.onEdit(active.id)}
                  testID="pilot-edit"
                />
              </FormSection>

              <FormSection header="Currency Status">
                {(
                  [
                    ['Medical Certificate', currency.medical],
                    ['Flight Review', currency.flightReview],
                    ['Night Currency (61.57)', currency.night],
                  ] as const
                ).map(([label, status]) => (
                  <RowFrame key={label}>
                    <View style={{ flex: 1 }}>
                      <CurrencyBadge status={status} label={label} />
                    </View>
                  </RowFrame>
                ))}
              </FormSection>

              <FormSection header="Night Landings">
                <ButtonRow
                  title="Log Night Landings"
                  icon={<MoonFill color={accentText(t)} />}
                  onPress={navigation.onLogNightLandings}
                  testID="pilot-log-night-landings"
                />
                {recentNightLandings(active.nightLandingEntries).map((entry, i) => (
                  <RowFrame key={`${entry.date}-${i}`} accessible>
                    <Text style={[FormType.subheadline, { flex: 1, color: t.primaryText }]}>
                      {formatDay(entry.date)}
                    </Text>
                    <Text style={[FormType.subheadline, { color: t.secondaryText }]}>
                      {landingCountText(entry.count)}
                    </Text>
                  </RowFrame>
                ))}
              </FormSection>
            </>
          ) : null}

          <FormSection>
            <ButtonRow
              title="Add Pilot Profile"
              icon={<PersonPlus color={accentText(t)} />}
              onPress={() => void store.getState().create()}
              testID="pilot-add-another"
            />
          </FormSection>
        </>
      )}
    </FormScreen>
  );
}
