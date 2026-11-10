// DebriefRecord helpers from DebriefTypes.swift (fromFlightDebrief, decodedPhaseObservations, decodedImprovements,
// FlightMetadata.description).
import type { DebriefRecord, FlightDebrief, FlightMetadata, PhaseObservation } from './types';

/** JSON.stringify with object keys sorted, like Swift's JSONEncoder .sortedKeys. */
function sortedJSON(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return v;
  });
}

export function fromFlightDebrief(
  debrief: FlightDebrief,
  flightID: string,
  options: {
    id: string;
    generatedAt: number;
    promptTokensEstimate?: number | null;
    responseTokensEstimate?: number | null;
  },
): DebriefRecord {
  return {
    id: options.id,
    flightID,
    narrativeSummary: debrief.narrativeSummary,
    phaseObservationsJSON: sortedJSON(debrief.phaseObservations),
    improvementsJSON: sortedJSON(debrief.improvements),
    overallRating: debrief.overallRating,
    generatedAt: options.generatedAt,
    promptTokensEstimate: options.promptTokensEstimate ?? null,
    responseTokensEstimate: options.responseTokensEstimate ?? null,
  };
}

export function decodedPhaseObservations(record: Pick<DebriefRecord, 'phaseObservationsJSON'>): PhaseObservation[] {
  try {
    const parsed: unknown = JSON.parse(record.phaseObservationsJSON);
    return Array.isArray(parsed) ? (parsed as PhaseObservation[]) : [];
  } catch {
    return [];
  }
}

export function decodedImprovements(record: Pick<DebriefRecord, 'improvementsJSON'>): string[] {
  try {
    const parsed: unknown = JSON.parse(record.improvementsJSON);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Swift used DateFormatter(.medium date, .short time) in the device locale; the formatter is injectable. */
export type DateFormatFn = (epochMs: number) => string;

export const defaultDateFormat: DateFormatFn = (epochMs) =>
  new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(epochMs));

export function describeMetadata(metadata: FlightMetadata, formatDate: DateFormatFn = defaultDateFormat): string {
  const dateStr = formatDate(metadata.date);
  const aircraft = metadata.aircraftType ?? 'Unknown';
  const dep = metadata.departureICAO ?? 'Unknown';
  const arr = metadata.arrivalICAO ?? 'Unknown';
  const seconds = Math.trunc(metadata.durationSeconds);
  const hours = Math.trunc(seconds / 3600);
  const minutes = Math.trunc((seconds % 3600) / 60);
  return `Date: ${dateStr}, Aircraft: ${aircraft}, From: ${dep} To: ${arr}, Duration: ${hours}h${minutes}m`;
}
