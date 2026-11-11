// Plain-object ports of the GRDB records in efb-212/Data/RecordingDatabase.swift and
// efb-212/Services/Debrief/DebriefTypes.swift. Times are epoch ms; ids are lower-case UUID text.
import { systemClock, uuidv4, type Clock, type IdGenerator } from '../ids';

export interface TrackPoint {
  id: string;
  flightID: string;
  timestamp: number;
  latitude: number; // degrees
  longitude: number; // degrees
  altitudeFeet: number; // feet MSL
  groundSpeedKnots: number;
  verticalSpeedFPM: number;
  courseDegrees: number; // degrees true
}

export interface TranscriptSegment {
  id: string;
  flightID: string;
  timestamp: number;
  text: string;
  /** 0.0-1.0; null when the speech engine reported none. */
  confidence: number | null;
  audioStartTime: number; // seconds
  audioEndTime: number; // seconds
  flightPhase: string;
}

export interface PhaseMarker {
  id: string;
  flightID: string;
  phase: string;
  startTimestamp: number;
  endTimestamp: number | null;
  latitude: number;
  longitude: number;
}

export interface DebriefRecord {
  id: string;
  flightID: string;
  narrativeSummary: string;
  phaseObservationsJSON: string;
  improvementsJSON: string;
  overallRating: number; // 1-5
  generatedAt: number;
  promptTokensEstimate: number | null;
  responseTokensEstimate: number | null;
}

export interface RecordFactory {
  now?: Clock;
  newId?: IdGenerator;
}

// Defaults mirror the Swift initialisers: id = UUID(), timestamp = Date(), optional tokens nil.
export function newTrackPoint(
  o: Omit<TrackPoint, 'id' | 'timestamp'> & Partial<Pick<TrackPoint, 'id' | 'timestamp'>> & RecordFactory,
): TrackPoint {
  const { now = systemClock, newId = uuidv4, ...rest } = o;
  return { id: newId(), timestamp: now(), ...rest };
}
export function newTranscriptSegment(
  o: Omit<TranscriptSegment, 'id' | 'timestamp'> & Partial<Pick<TranscriptSegment, 'id' | 'timestamp'>> & RecordFactory,
): TranscriptSegment {
  const { now = systemClock, newId = uuidv4, ...rest } = o;
  return { id: newId(), timestamp: now(), ...rest };
}
export function newPhaseMarker(
  o: Omit<PhaseMarker, 'id' | 'startTimestamp' | 'endTimestamp'> &
    Partial<Pick<PhaseMarker, 'id' | 'startTimestamp' | 'endTimestamp'>> &
    RecordFactory,
): PhaseMarker {
  const { now = systemClock, newId = uuidv4, ...rest } = o;
  return { id: newId(), startTimestamp: now(), endTimestamp: null, ...rest };
}
export function newDebriefRecord(
  o: Omit<DebriefRecord, 'id' | 'generatedAt' | 'promptTokensEstimate' | 'responseTokensEstimate'> &
    Partial<Pick<DebriefRecord, 'id' | 'generatedAt' | 'promptTokensEstimate' | 'responseTokensEstimate'>> &
    RecordFactory,
): DebriefRecord {
  const { now = systemClock, newId = uuidv4, ...rest } = o;
  return { id: newId(), generatedAt: now(), promptTokensEstimate: null, responseTokensEstimate: null, ...rest };
}
