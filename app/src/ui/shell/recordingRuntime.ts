// The recording services wired together (Swift: MapContainerView.initializeServices builds the RecordingCoordinator,
// RecordingViewModel, FlightPersistenceService and FlightRecoveryService on the recording database). Every platform piece
// comes in through `deps`, so the test runs the same composition on fakes.
import type { Db } from '../../data/db';
import { flightRecordRepository } from '../../data/repositories';
import { openRecordingDatabase, type RecordingDatabase, type RouteLeg } from '../../data/recording';
import type { AviationDatabase } from '../../data/aviation/aviationDatabase';
import { createAirportLookup } from '../../adapters/airportLookup';
import type { MicrophonePermission } from '../../domain/ports/microphonePermission';
import type { LocationSource } from '../../domain/ports/location';
import type { ActiveRouteLeg } from '../../domain/route/activeRoute';
import type { AudioRecorderLike, RecordingStore, TranscriptionServiceLike } from '../../domain/recording/collaborators';
import { FlightPersistenceService } from '../../domain/recording/flightPersistence';
import { FlightRecoveryService, type RecoveryAudioFiles } from '../../domain/recording/flightRecovery';
import { RecordingCoordinator, type RecordingTelemetry } from '../../domain/recording/recordingCoordinator';
import { createTrackRecorderFactory } from '../../domain/recording/trackRecorderAdapter';
import { createRecordingStore, type RecordingViewStore } from '../state/recordingStore';

export interface RecordingFilesLike extends RecoveryAudioFiles {
  readonly appSupportRoot: string;
  removeFile(path: string): Promise<void>;
}

export interface RecordingRuntimeDeps {
  /** The user database (flight records and logbook entries). */
  userDb: Db;
  /** The recording database file, opened here (separate from the user database, as in Swift). */
  openRecordingDb: () => Promise<Db>;
  aviation: Pick<AviationDatabase, 'nearestAirports'> | null;
  location: LocationSource;
  audio: AudioRecorderLike;
  /** Built over the recording database once it is open (it stores the transcript segments). */
  makeTranscription: (store: RecordingDatabase) => TranscriptionServiceLike;
  microphone: MicrophonePermission;
  files: RecordingFilesLike;
  telemetry?: RecordingTelemetry;
  /** AppState.activeAircraftProfileID / activePilotProfileID. */
  activeProfileIds: () => { aircraftProfileID: string | null; pilotProfileID: string | null };
  /** AppState.activeRoute.legs; empty without a plan. */
  activeRouteLegs: () => readonly ActiveRouteLeg[];
  now?: () => number;
  newId?: () => string;
}

export interface RecordingRuntime {
  coordinator: RecordingCoordinator;
  store: RecordingViewStore;
  database: RecordingDatabase;
  persistence: FlightPersistenceService;
  recovery: FlightRecoveryService;
  /** Saves crashed or killed recordings found on disk as flights; the one in progress is never touched. */
  recoverOrphans(profiles: { aircraftProfileID: string | null; pilotProfileID: string | null }): Promise<string[]>;
  dispose(): void;
}

/** RecordingDatabase.saveRouteLegs takes from/to codes. */
export const routeLegsOf = (legs: readonly ActiveRouteLeg[]): RouteLeg[] =>
  legs.map((l) => ({ from: l.fromCode, to: l.toCode }));

/** Rejects when the recording database cannot be opened: the caller then shows the strip without a record control. */
export async function createRecordingRuntime(deps: RecordingRuntimeDeps): Promise<RecordingRuntime> {
  const database = await openRecordingDatabase(await deps.openRecordingDb());
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => globalThis.crypto.randomUUID());

  const recordingStore: RecordingStore = {
    transcriptSegmentCount: async (flightID) => (await database.transcriptSegments(flightID)).length,
    insertTranscript: (s) =>
      database.insertTranscript({
        id: newId(),
        flightID: s.flightID,
        timestamp: now(),
        text: s.text,
        confidence: s.confidence,
        audioStartTime: s.audioStartTime,
        audioEndTime: s.audioEndTime,
        flightPhase: s.flightPhase,
      }),
  };
  const coordinator = new RecordingCoordinator({
    recordingStore,
    audioRecorder: deps.audio,
    transcriptionService: deps.makeTranscription(database),
    makeTrackRecorder: createTrackRecorderFactory({ store: database, source: deps.location }),
    audioFileURL: deps.files.pathFor,
    ...(deps.telemetry ? { telemetry: deps.telemetry } : {}),
  });
  const persistence = new FlightPersistenceService({
    recordingStore: database,
    db: deps.userDb,
    airports: deps.aviation ? createAirportLookup(deps.aviation) : null,
    removeFile: deps.files.removeFile,
    appSupportRoot: deps.files.appSupportRoot,
    now,
    newId,
  });
  const store = createRecordingStore({
    coordinator,
    microphone: deps.microphone,
    persistence,
    activeProfileIds: deps.activeProfileIds,
    activeRouteLegs: () => routeLegsOf(deps.activeRouteLegs()),
    saveRouteLegs: (legs, flightId) => database.saveRouteLegs(legs, flightId),
  });
  const recovery = new FlightRecoveryService({
    recordingStore: database,
    persistence,
    flights: flightRecordRepository(deps.userDb),
    audio: deps.files,
    now,
  });
  return {
    coordinator,
    store,
    database,
    persistence,
    recovery,
    recoverOrphans: (profiles) =>
      recovery.recoverOrphans({
        activeFlightID: store.getState().activeFlightId,
        aircraftProfileID: profiles.aircraftProfileID,
        pilotProfileID: profiles.pilotProfileID,
      }),
    dispose: () => store.getState().dispose(),
  };
}
