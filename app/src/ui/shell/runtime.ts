// The production composition root: builds the services from the platform adapters and runs the launch sequence
// (startup.ts). Imported only by the live app route, never by tests or capture routes, because it requires the bundled
// databases. Tests build the same pieces with fakes (startup.test.ts, liveData.test.ts).
import Constants from 'expo-constants';
import { createLocationSource } from '../../adapters/location';
import { createNetworkStatusSource, type NetworkStatusSource } from '../../adapters/network';
import baseStyle from '../../../assets/base-style.json';
import { createMapLibreOfflineEngine } from '../../adapters/maplibreOffline';
import { OfflineMapService } from '../../domain/offline/offlineMapService';
import { chartFileSystem, chartRoot } from '../../adapters/chartFileSystem';
import { fileDownloader } from '../../adapters/fileDownloader';
import { createSecretStore } from '../../adapters/secretStore';
import { NotamService, loadNotamCredentials } from '../../services/notamService';
import { TerminalProcedureService } from '../../services/terminal/terminalProcedureService';
import { openAviationDatabase, openIsraelDatabase } from '../../adapters/aviationDb';
import { fileTextStorage } from '../../adapters/fileTextStorage';
import { openExpoSqliteDb } from '../../adapters/expoSqliteDb';
import { migrate } from '../../data/migrate';
import type { LocationSource } from '../../domain/ports/location';
import { AirSigmetService } from '../../services/airSigmetService';
import { createRemoteConfigService } from '../../services/remoteConfigService';
import { RemoteConfigStore } from '../../services/remoteConfigStore';
import { NotamReadStateStore } from '../../services/notamReadStateStore';
import { IsraelNotamService } from '../../services/israelNotamService';
import { TfrService } from '../../services/tfrService';
import { WeatherService } from '../../services/weatherService';
import { loadLayerSettings, type LayerSettings } from './layersSettings';
import { asCoordinatorAudio } from '../../adapters/coordinatorAudio';
import { createAudioRecorder } from '../../adapters/audioRecorder';
import { createLowPowerMode, type LowPowerSource } from '../../adapters/lowPower';
import { createMicrophonePermission } from '../../adapters/microphonePermission';
import type { Preferences } from '../../domain/ports/preferences';
import { createDebriefModel } from '../../adapters/debriefModel';
import { createReplayAudioPlayer } from '../../adapters/replayAudioPlayer';
import { DebriefEngine as DomainDebriefEngine } from '../../domain/debriefEngine';
import type { ReplayAudioPlayer } from '../../domain/replay/types';
import { createPreferences } from '../../adapters/preferences';
import { createRecordingFiles } from '../../adapters/recordingFiles';
import { prepareSpeechAssets } from '../../adapters/speechAnalyzer';
import { createTelemetry, startTelemetry } from '../../adapters/telemetry';
import { createTranscriptionService } from '../../adapters/transcription';
import type { Telemetry } from '../../domain/telemetry/telemetry';
import { appStore } from '../state/appStore';
import { regionSlice } from '../state/region';
import { createProfiles, type Profiles } from './profiles';
import { createRecordingRuntime, type RecordingRuntime } from './recordingRuntime';
import { runStartup, type StartedApp } from './startup';

/** The user database file (SwiftData's default store in the Swift app); the in-memory fallback uses ':memory:'. */
export const USER_DB_NAME = 'kanaf.db';

export interface AppRuntime {
  started: StartedApp<RemoteConfigStore>;
  weather: WeatherService;
  tfr: TfrService;
  israelNotam: IsraelNotamService;
  notamReadStore: NotamReadStateStore;
  terminal: TerminalProcedureService;
  /** The AI debrief; null where the platform has none (Android, owner decision Q8). */
  debrief: DomainDebriefEngine | null;
  /** The player for a flight's saved audio (a path relative to Application Support), or null without the file. */
  openReplayAudio: (relativePath: string) => ReplayAudioPlayer | null;
  profiles: Profiles;
  preferences: Preferences;
  /** Low Power Mode doubles the data refresh intervals. */
  lowPower: LowPowerSource;
  telemetry: Telemetry;
  notamConfigured: () => Promise<boolean>;
  /** The FAA NOTAM service (free key from Settings); the airport column's NOTAM list. */
  notams: NotamService;
  offline: OfflineMapService;
  advisories: AirSigmetService;
  layerSettings: LayerSettings;
  location: LocationSource;
  network: NetworkStatusSource;
}

const log = (message: string) => console.warn(message);

/** CFBundleVersion / versionCode as the remote config compares it; 0 when the build has none. */
const buildNumber = (): number => Number(Constants.nativeBuildVersion) || 0;

export async function startRuntime(): Promise<AppRuntime> {
  const fetchLike = globalThis.fetch as unknown as import('../../services/ports').FetchLike;
  const remote = createRemoteConfigService({ fetch: fetchLike, log });
  const started = await runStartup<RemoteConfigStore>({
    openUserDb: () => openExpoSqliteDb(USER_DB_NAME),
    openFallbackUserDb: () => openExpoSqliteDb(':memory:'),
    migrate: (db) => migrate(db),
    openAviation: openAviationDatabase,
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a Metro asset module, as aviationDb.ts does
    openIsrael: () => openIsraelDatabase(require('../../../assets/israel-aviation.sqlite')),
    openRemoteConfig: () =>
      RemoteConfigStore.open({ service: remote, storage: fileTextStorage, buildNumber: buildNumber(), log }),
    log,
  });
  const notamReadStore = await NotamReadStateStore.open(fileTextStorage, log);
  const layerSettings = await loadLayerSettings(started.userDb, fileTextStorage, log);
  const preferences = createPreferences();
  const telemetry = createTelemetry({ region: () => regionSlice.store.getState().region });
  // iOS has no SFSpeechRecognizer fallback: fetch the on-device speech model now, so a flight can be transcribed.
  void prepareSpeechAssets().catch((e) => log(`Speech assets: ${String(e)}`));
  startTelemetry(telemetry); // counts the launch; nothing is sent unless EXPO_PUBLIC_TELEMETRY_URL is set
  const debriefModel = createDebriefModel();
  const debrief = debriefModel.offered ? new DomainDebriefEngine({ model: debriefModel, telemetry }) : null;
  return {
    started,
    layerSettings,
    notamReadStore,
    preferences,
    lowPower: createLowPowerMode(),
    profiles: createProfiles(started.userDb, preferences),
    telemetry,
    debrief,
    openReplayAudio: (path) => createReplayAudioPlayer(path),
    terminal: new TerminalProcedureService({
      fetch: fetchLike,
      downloader: fileDownloader,
      fs: chartFileSystem,
      baseDir: `${chartRoot('dtpp')}`,
      log,
    }),
    // NotamService.isConfigured: a complete FAA key pair is in the keychain.
    notams: new NotamService({
      fetch: fetchLike,
      credentials: () => loadNotamCredentials(createSecretStore()),
      log,
    }),
    notamConfigured: async () => (await loadNotamCredentials(createSecretStore())) !== null,
    weather: new WeatherService({ fetch: fetchLike, log }),
    tfr: new TfrService({ fetch: fetchLike, log }),
    offline: new OfflineMapService({
      engine: createMapLibreOfflineEngine(),
      baseStyle: () => baseStyle,
    }),
    israelNotam: new IsraelNotamService({ fetch: fetchLike, storage: fileTextStorage, log }),
    advisories: new AirSigmetService({ fetch: fetchLike, log }),
    location: createLocationSource(),
    network: createNetworkStatusSource(),
  };
}

let starting: Promise<AppRuntime> | null = null;

/** One runtime per process: the route may remount, the databases and services must not be opened twice. */
/** The recording services on the real adapters (Swift: MapContainerView.initializeServices). Rejects when the recording database cannot be opened. */
export function startRecordingServices(runtime: AppRuntime): Promise<RecordingRuntime> {
  const files = createRecordingFiles();
  return createRecordingRuntime({
    userDb: runtime.started.userDb,
    openRecordingDb: () => openExpoSqliteDb('recording.sqlite'),
    aviation: runtime.started.aviation,
    location: runtime.location,
    audio: asCoordinatorAudio(createAudioRecorder()),
    makeTranscription: (store) => createTranscriptionService({ store }),
    microphone: createMicrophonePermission(),
    files,
    telemetry: runtime.telemetry,
    activeProfileIds: () => runtime.profiles.activeIds(),
    activeRouteLegs: () => appStore.getState().navigation.activeRoute?.legs ?? [],
  });
}

export const getRuntime = (): Promise<AppRuntime> => (starting ??= startRuntime());
