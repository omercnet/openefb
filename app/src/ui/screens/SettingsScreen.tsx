// Port of Views/Settings/SettingsView.swift. Navigation is the shell's (I1): the screen reports where the user wants to go.
import { Linking, Platform } from 'react-native';
import { isLayerAvailable, REGIONS, regionDisplayName } from '../../domain/core/region';
import { DISPLAY_MODES, displayModeTitle } from '../../domain/displayMode';
import { NOTAM_REGISTRATION_URL } from '../../domain/settings/notamCredentials';
import { aviationDataRow, formatCycleDate } from '../../domain/settings/settingsFormat';
import {
  ButtonRow,
  FormScreen,
  FormSection,
  LabeledRow,
  LinkRow,
  NoteRow,
  PickerRow,
  SwitchRow,
  TextFieldRow,
} from '../form/Form';
import { AirplaneCircle } from '../form/FormIcons';
import { accentText } from '../form/formStyle';
import { useTheme } from '../Primitives';
import { canSaveNotamKey, type SettingsServices } from '../state/settingsStore';
import { useSettings } from '../state/useSettings';
import { IsraelChartSection, IsraelDiagramSection } from './IsraelPackSections';

const FEEDBACK_URL = 'mailto:kanaf@omer.io?subject=Kanaf%20Beta%20Feedback';
const SOURCE_URL = 'https://github.com/omercnet/openefb';
const REGION_FOOTER =
  "Switching recenters the map and reloads that region's data sources. Layers with no source in a region are shown as unavailable.";
const OFFLINE_MAPS_FOOTER = 'Street map packs for use without internet. Data \u00A9 CAAI; see About.';
const DISPLAY_FOOTER = 'Night uses a dim palette that protects night vision. Auto follows the sun at your position.';
const NOTAM_FOOTER =
  'The FAA NOTAM API needs a free client ID and secret from the FAA developer portal. Kanaf keeps them in the iPad Keychain.';
const PRIVACY_FOOTER = 'Anonymous app usage and crash summaries. No location, no flight data.';

export interface SettingsNavigation {
  /** Leading Back button. Omit when the shell supplies its own. */
  onBack?: () => void;
  /** Settings > Profiles > Aircraft & Pilot */
  onOpenProfiles: () => void;
  /** Both "Offline Maps" links (offline maps, M3) */
  onOpenOfflineMaps: () => void;
  /** Settings > Legal > Disclaimers */
  onOpenDisclaimers: () => void;
  /** Opens a web or mailto link. Default: Linking.openURL. */
  openURL?: (url: string) => void;
}

// SwiftUI's Link does nothing when the URL cannot be opened (no mail account, no browser), so a rejection is dropped.
const openExternally = (url: string) => void Linking.openURL(url).catch(() => undefined);

const regionOptions = REGIONS.map((value) => ({ value, title: regionDisplayName(value) }));
const displayOptions = DISPLAY_MODES.map((value) => ({ value, title: displayModeTitle(value) }));

export function SettingsScreen({
  services,
  navigation,
}: {
  /** Must keep its identity while the screen is mounted. */
  services: SettingsServices;
  navigation: SettingsNavigation;
}) {
  const t = useTheme();
  const s = useSettings(services);
  const open = navigation.openURL ?? openExternally;
  const { appInfo, remoteConfig } = services;
  const now = services.now();
  const aviation = aviationDataRow(s.dataCycle, now);
  const ignored = remoteConfig.ignored;

  return (
    <FormScreen title="Settings" onBack={navigation.onBack} testID="settings-screen">
      <FormSection header="About">
        <LabeledRow label="Version" value={appInfo.version} />
        <LabeledRow label="Build" value={appInfo.build} />
        <LabeledRow label="Configuration" value={remoteConfig.sourceDescription} testID="remote-config-source" />
        {remoteConfig.updateRequest ? (
          <NoteRow tone="caution" text={remoteConfig.updateRequest.text} testID="remote-config-update" />
        ) : null}
        {ignored.length > 0 ? (
          <NoteRow text={`${ignored.length} value(s) in the configuration file were ignored: ${ignored.join('; ')}`} />
        ) : null}
        {remoteConfig.lastError ? <NoteRow text={`Last configuration check: ${remoteConfig.lastError}`} /> : null}
        <NoteRow text="Beta build. Report problems with Send Feedback below." />
        {s.loadError ? <NoteRow tone="caution" text={`Some settings could not be read: ${s.loadError}`} /> : null}
        <LabeledRow label="Data" value={s.dataAttribution} small testID="region-attribution" />
      </FormSection>

      <FormSection header="Feedback">
        <LinkRow kind="external" label="Send Feedback" onPress={() => open(FEEDBACK_URL)} />
        {Platform.OS === 'ios' ? <NoteRow text="In TestFlight, a screenshot also opens the feedback form." /> : null}
      </FormSection>

      <FormSection header="Profiles">
        <LinkRow
          label="Aircraft & Pilot"
          leading={<AirplaneCircle color={accentText(t)} />}
          detail={s.currencyToRenew > 0 ? `${s.currencyToRenew} to renew` : undefined}
          detailTone="caution"
          onPress={navigation.onOpenProfiles}
          testID="aircraft-pilot-link"
        />
      </FormSection>

      <FormSection header="Region" footer={REGION_FOOTER}>
        <PickerRow
          label="Region"
          options={regionOptions}
          value={s.region}
          onChange={(region) => void s.setRegion(region)}
          disabled={!s.loaded}
          testID="region-picker"
        />
        {s.regionSaveError ? (
          <>
            <NoteRow tone="caution" text={s.regionSaveError} />
            <ButtonRow title="Try Saving Again" onPress={() => void s.setRegion(s.region)} testID="region-retry" />
          </>
        ) : null}
        {s.regionDataError ? <NoteRow text={s.regionDataError} testID="region-data-unavailable-text" /> : null}
      </FormSection>

      {s.region === 'israel' ? (
        <>
          <IsraelChartSection store={services.israelChart} formatBytes={services.formatBytes} />
          <IsraelDiagramSection store={services.israelDiagrams} />
          <FormSection footer={OFFLINE_MAPS_FOOTER}>
            <LinkRow label="Offline Maps" onPress={navigation.onOpenOfflineMaps} testID="region-offline-maps-link" />
          </FormSection>
        </>
      ) : null}

      <FormSection header="Display" footer={DISPLAY_FOOTER}>
        <PickerRow
          label="Display mode"
          options={displayOptions}
          value={s.displayMode}
          onChange={(mode) => void s.setDisplayMode(mode)}
          disabled={!s.loaded}
          testID="display-mode-picker"
        />
        {s.preferenceError && s.preferenceErrorFor === 'displayMode' ? (
          <NoteRow tone="caution" text={s.preferenceError} />
        ) : null}
      </FormSection>

      {isLayerAvailable(s.region, 'sectional') ? (
        <FormSection header="Charts">
          <LabeledRow
            label="Sectional cycle"
            value={`valid to ${formatCycleDate(services.sectionalCycleExpires(now))}`}
          />
          <LabeledRow
            label="Airport data"
            value={aviation.text}
            valueTone={aviation.expired ? 'warning' : 'secondary'}
            testID="aviation-data-cycle-line"
          />
          <LinkRow label="Offline Maps" onPress={navigation.onOpenOfflineMaps} testID="offline-maps-link" />
          <NoteRow text="Sectionals change every 56 days. What works offline is listed under Offline Maps." />
        </FormSection>
      ) : null}

      {isLayerAvailable(s.region, 'notams') ? (
        <FormSection header="NOTAM API" footer={NOTAM_FOOTER}>
          <LabeledRow
            label="Status"
            value={s.notam.configured ? 'Configured' : 'Not configured'}
            valueTone={s.notam.configured ? 'primary' : 'secondary'}
          />
          <TextFieldRow
            placeholder="Client ID"
            value={s.notam.clientID}
            onChangeText={s.setNotamClientID}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
          />
          <TextFieldRow
            placeholder="Client Secret"
            value={s.notam.clientSecret}
            onChangeText={s.setNotamClientSecret}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <ButtonRow title="Save Key" disabled={!canSaveNotamKey(s.notam)} onPress={() => void s.saveNotamKey()} />
          {s.notam.configured ? (
            <ButtonRow title="Remove Key" tone="warning" onPress={() => void s.removeNotamKey()} />
          ) : null}
          {s.notam.message ? <NoteRow text={s.notam.message} /> : null}
          <LinkRow kind="external" label="Get a free FAA NOTAM API key" onPress={() => open(NOTAM_REGISTRATION_URL)} />
        </FormSection>
      ) : null}

      <FormSection header="Privacy" footer={PRIVACY_FOOTER}>
        <SwitchRow
          label="Share anonymous usage data"
          value={s.shareUsageData}
          onValueChange={(enabled) => void s.setShareUsageData(enabled)}
          disabled={!s.loaded}
          testID="share-usage-data-toggle"
        />
        {s.preferenceError && s.preferenceErrorFor === 'shareUsageData' ? (
          <NoteRow tone="caution" text={s.preferenceError} />
        ) : null}
      </FormSection>

      <FormSection header="Legal">
        <LinkRow label="Disclaimers" onPress={navigation.onOpenDisclaimers} />
        <LabeledRow label="License" value="MPL-2.0" />
        <LinkRow kind="external" label="Source Code" onPress={() => open(SOURCE_URL)} />
      </FormSection>
    </FormScreen>
  );
}
