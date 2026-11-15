// The stores behind the screens of one recorded flight (FlightDetailView, DebriefView, ReplayView): the flight detail with its
// CVFR debrief, the AI debrief on the on-device model, and the replay. Built when the flight opens, on the recording database.
import type { FlightRecord } from '../../data/models';
import type { RecordingDatabase } from '../../data/recording';
import { WHOLE_COUNTRY } from '../../data/aviation/israelTypes';
import type { IsraelAviationDatabase } from '../../data/aviation/israelDatabase';
import { loadCVFRDebrief, type CVFRNetworkSource } from '../../domain/debrief/cvfrDebriefLoader';
import { buildMetadata } from '../../domain/debrief/flightDetail';
import { buildPromptForFlight } from '../../domain/debrief/flightSummaryBuilder';
import type { DebriefEngine as DomainDebriefEngine } from '../../domain/debriefEngine';
import type { DebriefEngine, DebriefEngineState } from '../../domain/ports/debriefEngine';
import type { ReplayAudioPlayer } from '../../domain/replay/types';
import { ReplayEngine } from '../../domain/replay/replayEngine';
import { createDebriefStore, type DebriefViewStore } from '../state/debriefStore';
import { createFlightDetailStore, type FlightDetailStore } from '../state/flightDetailStore';
import { createReplayStore, type ReplayViewStore } from '../state/replayStore';

type DebriefStorage = Pick<RecordingDatabase, 'insertDebrief' | 'debrief'>;

/** The debrief engine as the screens use it (one flight at a time, saved with the flight in `store`). */
export function portEngineFor(engine: DomainDebriefEngine, store: DebriefStorage): DebriefEngine {
  let cached: DebriefEngineState | null = null;
  const read = (): DebriefEngineState => ({
    availability: engine.availabilityStatus,
    isGenerating: engine.isGenerating,
    partial: engine.partialDebrief,
    completed: engine.completedDebrief,
    error: engine.error,
  });
  return {
    get state() {
      return (cached ??= read());
    },
    subscribe: (listener) =>
      engine.subscribe(() => {
        cached = null;
        listener();
      }),
    checkAvailability: () => engine.checkAvailability(),
    prewarm: () => engine.prewarm(),
    generateDebrief: (prompt, flightId) => engine.generateDebrief(prompt, store, flightId),
    loadExistingDebrief: (flightId) => engine.loadExistingDebrief(store, flightId),
    discard: () => engine.discard(),
  };
}

export interface FlightScreenDeps {
  flight: FlightRecord;
  database: RecordingDatabase;
  /** null outside the Israel region or without the database: the flight has no CVFR section. */
  israel: Pick<IsraelAviationDatabase, 'routeSegments' | 'reportingPoints'> | null;
  /** null where the platform has no debrief (Android, owner decision Q8). */
  debrief: DomainDebriefEngine | null;
  openAudio: (relativePath: string) => ReplayAudioPlayer | null;
}

export interface FlightScreenStores {
  detail: FlightDetailStore;
  /** null when there is no engine: the AI debrief screen cannot be opened. */
  debrief: DebriefViewStore | null;
  replay: ReplayViewStore;
  dispose(): void;
}

export function createFlightScreenStores(deps: FlightScreenDeps): FlightScreenStores {
  const { flight, database } = deps;
  const engine = deps.debrief ? portEngineFor(deps.debrief, database) : null;
  const network: CVFRNetworkSource | null = deps.israel
    ? {
        routeSegments: () => deps.israel!.routeSegments(WHOLE_COUNTRY),
        reportingPoints: () => deps.israel!.reportingPoints(WHOLE_COUNTRY),
      }
    : null;
  const detail = createFlightDetailStore({
    engine,
    loadCvfr: async () => (network ? loadCVFRDebrief(flight.id, database, network) : null),
  });
  const debrief = engine
    ? createDebriefStore({
        engine,
        flightId: flight.id,
        buildPrompt: () => buildPromptForFlight(flight.id, database, buildMetadata(flight)),
      })
    : null;
  const replay = createReplayStore({
    engine: new ReplayEngine(),
    source: async () => database,
    openAudio: async (path) => deps.openAudio(path),
  });
  return {
    detail,
    debrief,
    replay,
    dispose() {
      detail.getState().dispose();
      debrief?.getState().dispose();
    },
  };
}
