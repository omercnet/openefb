// Deterministic fakes for the fidelity captures of the replay screen (kanaf-dev://replay, replayfast) and the web preview: a
// pattern flight from Haifa over the Jezreel valley and back (one point per 5 s, from taxi to postflight), its transcript and phase
// markers, on a real ReplayEngine. The engine is paused until the screen plays it, so a capture does not drift.
import { bearingDeg, destinationPoint, distanceNm, type Coordinate } from '../../domain/core/geometry';
import { ReplayEngine } from '../../domain/replay/replayEngine';
import type { ReplayPhaseMarker, ReplayTrackPoint } from '../../domain/replay/types';
import {
  createReplayStore,
  type ReplayFlight,
  type ReplaySource,
  type ReplayViewStore,
  type TranscriptLine,
} from '../state/replayStore';
import { captureRecordingLab, type RecordingLab } from './captureRecordingFixtures';

const START = 1_790_000_000_000;
const STEP_SECONDS = 5;
const WAYPOINTS: Coordinate[] = [
  { lat: 32.809, lon: 35.043 }, // Haifa
  { lat: 32.66, lon: 35.11 }, // Yokneam
  { lat: 32.61, lon: 35.29 }, // Afula
  { lat: 32.585, lon: 35.18 }, // Megiddo
  { lat: 32.809, lon: 35.043 },
];
const ROUTE_NM = WAYPOINTS.slice(1).reduce((sum, to, i) => sum + distanceNm(WAYPOINTS[i]!, to), 0);

/** Taxis for 30 s, flies the waypoints climbing over the first 3 NM and descending over the last 3, and parks for 30 s. */
function pattern(): ReplayTrackPoint[] {
  const points: ReplayTrackPoint[] = [];
  let leg = 0;
  let position = WAYPOINTS[0]!;
  let flown = 0;
  let parked = 0;
  for (let t = 0; parked < 7; t += STEP_SECONDS) {
    const remaining = ROUTE_NM - flown;
    const arrived = remaining < 0.02;
    const speedKt = t < 30 || arrived ? 0 : Math.min(104, 40 + (t - 30) * 1.2, 40 + remaining * 40);
    const course = bearingDeg(position, WAYPOINTS[leg + 1]!);
    points.push({
      timestamp: START + t * 1000,
      latitude: position.lat,
      longitude: position.lon,
      altitudeFeet: 40 + 2400 * Math.max(0, Math.min(1, flown / 3, remaining / 3)),
      groundSpeedKnots: speedKt,
      courseDegrees: course,
    });
    if (arrived) parked += 1;
    let step = Math.min((speedKt * STEP_SECONDS) / 3600, remaining);
    flown += step;
    while (step > 0) {
      const target = WAYPOINTS[leg + 1]!;
      const left = distanceNm(position, target);
      if (step < left || leg + 2 >= WAYPOINTS.length) {
        position = step < left ? destinationPoint(position, step, bearingDeg(position, target)) : target;
        step = 0;
      } else {
        position = target;
        step -= left;
        leg += 1;
      }
    }
  }
  return points;
}

export const CAPTURE_TRACK = pattern();
/** Seconds from the start of the recording to the last point. */
const DURATION = (CAPTURE_TRACK[CAPTURE_TRACK.length - 1]!.timestamp - START) / 1000;

export const CAPTURE_LINES: TranscriptLine[] = [
  {
    audioStartTime: 12,
    audioEndTime: 21,
    text: 'Haifa Ground, Kanaf four-X-K-F, request taxi for pattern work.',
    flightPhase: 'taxi',
  },
  {
    audioStartTime: 58,
    audioEndTime: 66,
    text: 'Kanaf four-X-K-F, runway two-nine, cleared for takeoff.',
    flightPhase: 'takeoff',
  },
  {
    audioStartTime: 190,
    audioEndTime: 198,
    text: 'Passing Yokneam, two thousand five hundred.',
    flightPhase: 'cruise',
  },
  {
    audioStartTime: Math.round(DURATION / 2),
    audioEndTime: Math.round(DURATION / 2) + 9,
    text: 'Afula, Kanaf four-X-K-F, turning back toward Megiddo.',
    flightPhase: 'cruise',
  },
  {
    audioStartTime: Math.round(DURATION - 290),
    audioEndTime: Math.round(DURATION - 282),
    text: 'Haifa Tower, four-X-K-F, five miles east, inbound to land.',
    flightPhase: 'approach',
  },
  {
    audioStartTime: Math.round(DURATION - 120),
    audioEndTime: Math.round(DURATION - 113),
    text: 'Cleared to land runway two-nine, four-X-K-F.',
    flightPhase: 'landing',
  },
];

const marker = (phase: string, seconds: number): ReplayPhaseMarker => ({
  phase,
  startTimestamp: START + seconds * 1000,
});
const CAPTURE_MARKERS = [
  marker('taxi', 0),
  marker('takeoff', 60),
  marker('departure', 100),
  marker('cruise', 160),
  marker('approach', DURATION - 300),
  marker('landing', DURATION - 130),
  marker('postflight', DURATION - 35),
];

export const CAPTURE_FLIGHT: ReplayFlight & { departureICAO: string; arrivalICAO: string } = {
  id: 'capture-flight-replay',
  audioFileURL: null,
  departureICAO: 'LLHA',
  arrivalICAO: 'LLHA',
};

export type ReplayScene = 'replay' | 'fast';

export interface ReplayLab {
  store: ReplayViewStore;
  recording: RecordingLab;
  /** The preview's switch: reading the track fails while it is on. */
  readError: { current: boolean };
}

export function captureReplayLab(): ReplayLab {
  const readError = { current: false };
  const source: ReplaySource = {
    trackPoints: async () => {
      if (readError.current) throw new Error('database disk image is malformed');
      return CAPTURE_TRACK;
    },
    transcriptSegments: async () => CAPTURE_LINES,
    phaseMarkers: async () => CAPTURE_MARKERS,
  };
  const store = createReplayStore({
    engine: new ReplayEngine(),
    source: async () => source,
    openAudio: async () => null,
  });
  return { store, recording: captureRecordingLab(), readError };
}

/** The preview's switch for a track that cannot be read. */
export function setReadError(lab: ReplayLab, on: boolean): void {
  lab.readError.current = on;
}

/** Brings a loaded replay to what a capture shows: inside the fourth transcript line (the turn at Afula). */
export function enterReplayScene(lab: ReplayLab, scene: ReplayScene): void {
  const replay = lab.store.getState();
  const turn = CAPTURE_LINES[3]!.audioStartTime;
  if (scene === 'replay') {
    replay.seekTo(turn + 3); // the panel open beside the map, 1x
    return;
  }
  // 4x with the audio muted, the panel closed (the current line shows over the map) and the map panned away from the marker.
  replay.seekTo(turn + 1);
  replay.selectSpeed(4);
  replay.toggleTranscriptPanel();
  replay.onUserPan();
}
