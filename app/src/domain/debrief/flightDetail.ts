import { healthWarning, type FlightRecord } from '../../data/models';
import type { DebriefAvailability } from '../ports/debriefEngine';
import { formatDurationHM } from '../logbook/logbook';
import type { RecordingStatus } from '../recording/recordingCoordinator';
import { capitalized } from '../replay/replayView';
import type { FlightMetadata } from './types';

// The rules of efb-212/Views/Flights/FlightDetailView.swift that are not drawing: what each section shows for a flight.

/** Flights shorter than this, with no transcript, give the debrief nothing to work with. Seconds. */
export const MINIMUM_DEBRIEF_DURATION_SECONDS = 60;

/**
 * Why a debrief is not offered, or null when it is. A debrief needs either a transcript or a flight of at least
 * `MINIMUM_DEBRIEF_DURATION_SECONDS`.
 */
export function debriefIneligibleReason(durationSeconds: number, transcriptSegmentCount: number): string | null {
  if (transcriptSegmentCount !== 0 || durationSeconds >= MINIMUM_DEBRIEF_DURATION_SECONDS) return null;
  return 'Too short for a debrief: this flight is under a minute and has no transcript.';
}

export interface AirportLine {
  code: string;
  name: string | null;
}

export interface FlightInfo {
  date: string;
  from: AirportLine;
  to: AirportLine;
  duration: string;
  /** The flight's note, as a caution, when it carries a health warning (recovered, or the track could not be read). */
  warning: string | null;
}

/** DateFormatter with .medium dates and .short times, in the device's locale (the options are for the tests). */
export function formatFlightDate(epochMs: number, options: { locale?: string; timeZone?: string } = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: options.timeZone,
  }).format(new Date(epochMs));
}

type FlightFields = Pick<
  FlightRecord,
  'startDate' | 'departureICAO' | 'arrivalICAO' | 'departureName' | 'arrivalName' | 'durationSeconds' | 'notes'
>;

/** The Flight Info section: the date, both airports (--- when not found), the duration, and a health warning. */
export function flightInfo(flight: FlightFields, options: { locale?: string; timeZone?: string } = {}): FlightInfo {
  return {
    date: formatFlightDate(flight.startDate, options),
    from: { code: flight.departureICAO ?? '---', name: flight.departureName },
    to: { code: flight.arrivalICAO ?? '---', name: flight.arrivalName },
    duration: formatDurationHM(flight.durationSeconds),
    warning: flight.notes !== null && healthWarning(flight) !== null ? flight.notes : null,
  };
}

/** The Recording Data section. */
export function recordingStats(
  flight: Pick<FlightRecord, 'trackPointCount' | 'transcriptSegmentCount' | 'audioQuality'>,
): [label: string, value: string][] {
  return [
    ['Track Points', String(flight.trackPointCount)],
    ['Transcript Segments', String(flight.transcriptSegmentCount)],
    ['Audio Quality', capitalized(flight.audioQuality)],
  ];
}

export type ReplaySection =
  { kind: 'recordingActive'; text: string } | { kind: 'available' } | { kind: 'noTrack'; text: string };

/** The Track Replay section: off while a recording runs, a button for a flight with a track, else a note. */
export function replaySection(status: RecordingStatus, trackPointCount: number): ReplaySection {
  if (status.kind !== 'idle') return { kind: 'recordingActive', text: 'End the recording to replay a flight' };
  if (trackPointCount > 0) return { kind: 'available' };
  return { kind: 'noTrack', text: 'No track data available for replay' };
}

/** FlightDetailView.buildMetadata: the aircraft and the pilot are not looked up (Swift leaves them nil). */
export function buildMetadata(
  flight: Pick<FlightRecord, 'departureICAO' | 'arrivalICAO' | 'startDate' | 'durationSeconds'>,
): FlightMetadata {
  return {
    aircraftType: null,
    pilotName: null,
    departureICAO: flight.departureICAO,
    arrivalICAO: flight.arrivalICAO,
    date: flight.startDate,
    durationSeconds: flight.durationSeconds,
  };
}

export type AiDebriefState =
  | { kind: 'checking' }
  | { kind: 'unavailable'; reason: string; canOpenSettings: boolean }
  | { kind: 'ineligible'; reason: string }
  | { kind: 'noDatabase' }
  | { kind: 'open'; title: 'Generate Debrief' | 'View Debrief'; hasDebrief: boolean };

/** What the AI Debrief section shows: checking, why the model cannot run, why the flight is too short, or the button. */
export function aiDebriefState(
  availability: DebriefAvailability,
  flight: { hasDebrief: boolean; durationSeconds: number; transcriptSegmentCount: number; databaseOpened: boolean },
): AiDebriefState {
  switch (availability.kind) {
    case 'unknown':
      return { kind: 'checking' };
    case 'unavailable':
      return {
        kind: 'unavailable',
        reason: availability.reason,
        canOpenSettings: availability.reason.includes('not enabled'),
      };
    case 'available': {
      const reason = flight.hasDebrief
        ? null
        : debriefIneligibleReason(flight.durationSeconds, flight.transcriptSegmentCount);
      if (reason !== null) return { kind: 'ineligible', reason };
      if (!flight.databaseOpened) return { kind: 'noDatabase' };
      return {
        kind: 'open',
        title: flight.hasDebrief ? 'View Debrief' : 'Generate Debrief',
        hasDebrief: flight.hasDebrief,
      };
    }
  }
}

export type DetailSection = 'info' | 'stats' | 'replay' | 'cvfr' | 'aiDebrief';

/**
 * The sections of Flight Details, in order. The CVFR section is there for a flight that has one. The AI debrief is not shown on
 * Android (owner decision Q8: there is no on-device model there), nor where the app has no debrief engine.
 */
export function flightDetailSections(args: {
  platform: string;
  hasCvfr: boolean;
  hasDebriefEngine: boolean;
}): DetailSection[] {
  const sections: DetailSection[] = ['info', 'stats', 'replay'];
  if (args.hasCvfr) sections.push('cvfr');
  if (args.platform !== 'android' && args.hasDebriefEngine) sections.push('aiDebrief');
  return sections;
}
