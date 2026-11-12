import { createStore, type StoreApi } from 'zustand';
import { describeError } from '../../domain/describeError';
import type { ReplayEngine } from '../../domain/replay/replayEngine';
import type {
  PhaseMarkerFraction,
  ReplayAudioPlayer,
  ReplayStore,
  ReplayTrackPoint,
  ReplayTranscriptSegment,
} from '../../domain/replay/types';

// View model of the replay screen (ViewModels/ReplayViewModel.swift): panel visibility, auto-follow, the speed picker and the
// loading state, over the ReplayEngine (L8), whose position is the single source of truth. The store mirrors the engine's state
// (Swift views read the @Observable engine directly; the engine notifies, so the store follows it) and loads the flight.

/** The part of a FlightRecord the replay needs. */
export interface ReplayFlight {
  id: string;
  /** Relative to the app's data directory (Swift: under Application Support). */
  audioFileURL: string | null;
}

/** A transcript segment as the panel shows it: the engine's timing plus the words and the phase. */
export interface TranscriptLine extends ReplayTranscriptSegment {
  text: string;
  flightPhase: string;
}

/** What loadFlight reads (RecordingDatabase); the transcript comes with its text. */
export interface ReplaySource extends Omit<ReplayStore, 'transcriptSegments'> {
  transcriptSegments(flightID: string): Promise<TranscriptLine[]>;
}

export interface ReplayViewDeps {
  engine: ReplayEngine;
  /** AppState.getOrCreateRecordingDatabase(): null when the database cannot be opened. */
  source(): Promise<ReplaySource | null>;
  /** The player for a flight's audio file, or null when the file is not there (Swift checked that it exists). */
  openAudio(relativePath: string): Promise<ReplayAudioPlayer | null>;
}

export interface ReplayViewState {
  // The engine's state, mirrored.
  /** Seconds from the start of the recording. */
  position: number;
  isPlaying: boolean;
  speed: number;
  audioMuted: boolean;
  coordinate: { lat: number; lon: number };
  /** Feet MSL. */
  altitude: number;
  /** Knots. */
  groundSpeed: number;
  /** Degrees true. */
  heading: number;
  /** The segment being played; null between segments. */
  transcriptIndex: number | null;
  totalDuration: number;
  phaseMarkers: PhaseMarkerFraction[];
  trackPoints: ReplayTrackPoint[];
  segments: TranscriptLine[];

  // The screen's own state.
  /** Starts closed; loading a flight opens it only when the flight has a transcript. */
  isTranscriptPanelExpanded: boolean;
  /** The map centres on the marker; a pan turns it off and the re-centre button turns it on. */
  autoFollow: boolean;
  showSpeedPicker: boolean;
  isLoading: boolean;
  loadError: string | null;

  loadFlight(flight: ReplayFlight): Promise<void>;
  togglePlayPause(): void;
  seekTo(position: number): void;
  selectSpeed(speed: number): void;
  toggleSpeedPicker(): void;
  toggleTranscriptPanel(): void;
  onUserPan(): void;
  recenter(): void;
  /** Releases the timer and the audio when the screen goes. */
  cleanup(): void;
}

export type ReplayViewStore = StoreApi<ReplayViewState>;

const DATABASE_NOT_OPENED = 'The recording database could not be opened. Reinstall Kanaf.';

export function createReplayStore(deps: ReplayViewDeps): ReplayViewStore {
  const { engine } = deps;
  /** Bumped by every load and by cleanup: a load that is no longer the latest must not touch the state. */
  let loadToken = 0;

  const mirror = () => ({
    position: engine.currentPosition,
    isPlaying: engine.isPlaying,
    speed: engine.playbackSpeed,
    audioMuted: engine.audioMuted,
    coordinate: engine.currentCoordinate,
    altitude: engine.currentAltitude,
    groundSpeed: engine.currentSpeed,
    heading: engine.currentHeading,
    transcriptIndex: engine.currentTranscriptIndex,
    totalDuration: engine.totalDuration,
    phaseMarkers: engine.phaseMarkerFractions,
    trackPoints: engine.trackPoints,
  });

  /** The flight's audio, when it has a file that opens; the track replays without it. */
  const openAudio = async (flight: ReplayFlight): Promise<ReplayAudioPlayer | null> => {
    if (!flight.audioFileURL) return null;
    try {
      return await deps.openAudio(flight.audioFileURL);
    } catch {
      return null;
    }
  };

  const store = createStore<ReplayViewState>()((set) => {
    const fail = (token: number, message: string) => {
      if (token === loadToken) set({ loadError: message, isLoading: false });
    };

    return {
      ...mirror(),
      segments: [],
      isTranscriptPanelExpanded: false,
      autoFollow: true,
      showSpeedPicker: false,
      isLoading: true,
      loadError: null,

      async loadFlight(flight) {
        const token = ++loadToken;
        set({ isLoading: true, loadError: null });
        // The engine keeps the segments it is given; the panel needs the same list with its text.
        let segments: TranscriptLine[] = [];
        try {
          const source = await deps.source();
          if (token !== loadToken) return;
          if (source === null) return fail(token, DATABASE_NOT_OPENED);

          const audio = await openAudio(flight);
          if (token !== loadToken) {
            audio?.stop(); // opened for a flight that is no longer wanted
            return;
          }

          const reading: ReplayStore = {
            trackPoints: (id) => source.trackPoints(id),
            phaseMarkers: (id) => source.phaseMarkers(id),
            transcriptSegments: async (id) => (segments = await source.transcriptSegments(id)),
          };
          await engine.loadFlight(flight.id, reading, audio);
          // Superseded while reading: the engine returned without attaching this player, and cleanup only stops an attached one.
          if (token !== loadToken) audio?.stop();
        } catch (error) {
          return fail(token, `Track data could not be read: ${describeError(error)}`);
        }
        // Outside the try: only a failed read is a read error, not whatever a listener of the store does with the new state.
        if (token === loadToken) set({ segments, isTranscriptPanelExpanded: segments.length > 0, isLoading: false });
      },

      togglePlayPause() {
        if (engine.isPlaying) engine.pause();
        else engine.play();
      },
      seekTo: (position) => engine.seekTo(position),
      selectSpeed(speed) {
        engine.setSpeed(speed);
        set({ showSpeedPicker: false });
      },
      toggleSpeedPicker: () => set((s) => ({ showSpeedPicker: !s.showSpeedPicker })),
      toggleTranscriptPanel: () => set((s) => ({ isTranscriptPanelExpanded: !s.isTranscriptPanelExpanded })),
      onUserPan: () => set({ autoFollow: false }),
      recenter: () => set({ autoFollow: true }),
      cleanup() {
        loadToken += 1;
        engine.cleanup();
      },
    };
  });

  engine.subscribe(() => store.setState(mirror()));
  return store;
}
