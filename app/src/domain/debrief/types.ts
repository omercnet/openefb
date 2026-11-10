// Port of efb-212/Services/Debrief/DebriefTypes.swift minus the Apple Foundation Models @Generable plumbing
// (the on-device model call is an adapter concern). Times are epoch ms.
// TODO(D): record shapes below are structural subsets of the recording records; use the data-layer types once on main.

/** Per-phase observation within a flight debrief. */
export interface PhaseObservation {
  phase: string;
  observations: string[];
  executedWell: boolean;
}

/** Structured output of the debrief generator (Swift: the @Generable FlightDebrief). */
export interface FlightDebrief {
  narrativeSummary: string;
  phaseObservations: PhaseObservation[];
  improvements: string[];
  /** 1 to 5. */
  overallRating: number;
}

/** Persisted debrief result (debrief_results row). Observations and improvements are JSON text. */
export interface DebriefRecord {
  id: string;
  flightID: string;
  narrativeSummary: string;
  phaseObservationsJSON: string;
  improvementsJSON: string;
  overallRating: number;
  generatedAt: number;
  promptTokensEstimate: number | null;
  responseTokensEstimate: number | null;
}

export interface FlightMetadata {
  aircraftType: string | null;
  pilotName: string | null;
  departureICAO: string | null;
  arrivalICAO: string | null;
  date: number; // epoch ms
  durationSeconds: number;
}

export interface DebriefTrackPoint {
  timestamp: number;
  latitude: number;
  longitude: number;
  altitudeFeet: number;
  groundSpeedKnots: number;
}

export interface DebriefTranscriptSegment {
  text: string;
  /** null = unknown confidence. */
  confidence: number | null;
  flightPhase: string;
}

export interface DebriefPhaseMarker {
  phase: string;
  startTimestamp: number;
  endTimestamp: number | null;
}
