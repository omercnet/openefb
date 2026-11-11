// Plain-object shapes used by the recording logic. Field names follow the Swift records
// (TrackPointRecord, PhaseMarkerRecord in efb-212/Data/RecordingDatabase.swift); times are epoch ms,
// ids are UUID strings.
// TODO(D): replace with the data-layer record types once the D ticket lands them on main.

export type FlightPhaseType =
  'preflight' | 'taxi' | 'takeoff' | 'departure' | 'cruise' | 'approach' | 'landing' | 'postflight';

export interface TrackPoint {
  id: string;
  flightID: string;
  timestamp: number; // epoch ms
  latitude: number; // degrees
  longitude: number; // degrees
  altitudeFeet: number; // feet MSL
  groundSpeedKnots: number; // knots
  verticalSpeedFPM: number; // feet per minute
  courseDegrees: number; // degrees true
}

export interface PhaseMarker {
  id: string;
  flightID: string;
  phase: FlightPhaseType;
  startTimestamp: number; // epoch ms
  endTimestamp: number | null;
  latitude: number;
  longitude: number;
}

/** RFC 4122 v4 id from Math.random; enough for local record ids, injectable for tests. */
export function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
