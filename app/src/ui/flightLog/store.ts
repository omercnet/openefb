// The flight log slice: the plain data the strip reads (the AppState, RecordingViewModel and MapViewModel values the
// SwiftUI views in Views/Log/FlightLogStrip.swift and FlightLogRows.swift read). GPS quality comes from state/gps.ts,
// the panel toggles from state/panels.ts and the nearest airport from columns/nearest/store.ts. The app shell
// (ui/shell/liveData.ts) feeds ownship, navigation, region and network; capture routes provide their fixture stores.
import type { IsraelAlert } from '../../domain/israel/alertEvaluator';
import type { Region } from '../../domain/core';
import type { GpsFix } from '../../domain/location/gpsStatus';
import type { PredictedEvent } from '../../domain/prediction';
import type { RecordingStatus } from '../../domain/recording/recordingCoordinator';
import { createStoreContext } from '../state/storeContext';
import type { NavState } from './logic';

/** RecordingViewModel's displayed state. */
export interface FlightLogRecording {
  status: RecordingStatus;
  /** Seconds since the recording started. */
  elapsedSeconds: number;
  /** Microphone input level, dBFS (-160 = silence). */
  levelDBFS: number;
  microphoneDenied: boolean;
}

/** Callbacks the strip raises. Each defaults to a no-op until the app shell wires it. */
export interface FlightLogActions {
  /** Clear the Direct-To or route (Clear in NOW or in the header). */
  clear: () => void;
  /** AppState.sequenceActiveRoute(forward:). */
  sequenceRoute: (forward: boolean) => void;
  /** LOG and Plan a flight: appState.selectedScreen = .log. */
  openLog: () => void;
  /** Israel NOTAM briefing. */
  openBriefing: () => void;
  /** The record control: start, request stop or cancel the countdown, by status. */
  record: () => void;
  /** Open the app's page in Settings (GPS denied). */
  openSettings: () => void;
}

export interface FlightLogData extends NavState {
  region: Region;
  /** The location stream works (AppState.gpsAvailable). */
  gpsAvailable: boolean;
  /**
   * The last fix (AppState.ownshipPosition with MapViewModel's gpsStationary), null before the first. The strip reads the
   * evaluated status from `state/gps`; the Log (LogStackView) ages this fix itself, once a second, to hide a stale ETE.
   */
  ownshipFix: GpsFix | null;
  /** AppState.ownshipPosition is set. */
  hasPosition: boolean;
  /** The fix carries an altitude (vertical accuracy >= 0; Wi-Fi-only fixes have none). */
  hasAltitude: boolean;
  /** Knots. */
  groundSpeed: number;
  /** Degrees true. */
  track: number;
  /** Feet MSL. */
  altitude: number;
  /** Feet per minute. */
  verticalSpeed: number;
  /** Nautical miles to the next waypoint. */
  distanceToNext: number | null;
  /** Degrees true to the next waypoint. */
  bearingToNext: number | null;
  /** Seconds to the next waypoint. */
  estimatedTimeEnroute: number | null;
  /** Soonest first; empty when the predictor is off. */
  predictedEvents: PredictedEvent[];
  /** Current time, epoch ms (ScenarioHooks.now). */
  nowMs: number;
  /** Device IANA time zone; Direct-To and US plan ETAs read in it, Israel routes in Asia/Jerusalem. */
  timeZone: string;
  /** null: no recorder (RecordButton hidden). */
  recording: FlightLogRecording | null;
  /** The recording database failed to open. */
  recordingUnavailable: boolean;
  isOffline: boolean;
  airspaceCheckUnavailable: boolean;
  israelAlertsSuspended: boolean;
  /** Israel in-flight alerts, highest priority first; shown only while not suspended. */
  israelAlerts: readonly IsraelAlert[];
  actions: FlightLogActions;
}

const noop = () => {};

/** Before the first fix and with nothing active: what the strip shows at launch until the services report. */
export const EMPTY_FLIGHT_LOG: FlightLogData = {
  region: 'us',
  directTo: null,
  activeFlightPlan: false,
  activeRoute: null,
  planDeparture: null,
  planDestination: null,
  gpsAvailable: false,
  ownshipFix: null,
  hasPosition: false,
  hasAltitude: false,
  groundSpeed: 0,
  track: 0,
  altitude: 0,
  verticalSpeed: 0,
  distanceToNext: null,
  bearingToNext: null,
  estimatedTimeEnroute: null,
  predictedEvents: [],
  nowMs: Date.now(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  recording: null,
  recordingUnavailable: false,
  isOffline: false,
  airspaceCheckUnavailable: false,
  israelAlertsSuspended: false,
  israelAlerts: [],
  actions: { clear: noop, sequenceRoute: noop, openLog: noop, openBriefing: noop, record: noop, openSettings: noop },
};

export const flightLog = createStoreContext<FlightLogData>(EMPTY_FLIGHT_LOG);

/** The whole slice: the state object is replaced on every setState, so it is a stable selector result. */
export const useFlightLogData = (): FlightLogData => flightLog.useData((s) => s);
