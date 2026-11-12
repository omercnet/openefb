// Reads the debrief the native module returns as JSON text. Swift decoded the model's GeneratedContent with
// FlightDebrief(content), which throws when the shape is wrong; this does the same check here, and a lenient read for the
// partial snapshots that stream in before the debrief is complete.
import type { FlightDebrief, PhaseObservation } from './debrief/types';
import { DebriefError, type PartialFlightDebrief } from './ports/debriefModel';
import { isRecord } from './typeGuards';

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The parsed value, or undefined when the text is not JSON. */
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Swift `@Guide(.range(1...5))` limits what the model may write; a whole number from 1 to 5. */
const isRating = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;

function strictObservation(value: unknown): PhaseObservation | null {
  if (!isRecord(value)) return null;
  const { phase, observations, executedWell } = value;
  if (typeof phase !== 'string' || !isStringArray(observations) || typeof executedWell !== 'boolean') return null;
  return { phase, observations, executedWell };
}

/**
 * The final debrief. Every field must be there and the right type, and the rating a whole number from 1 to 5; fields
 * the model added are dropped. Throws DebriefError('malformedResponse') otherwise.
 */
export function parseFlightDebrief(text: string): FlightDebrief {
  const value = parse(text);
  if (isRecord(value)) {
    const { narrativeSummary, phaseObservations, improvements, overallRating } = value;
    if (
      typeof narrativeSummary === 'string' &&
      Array.isArray(phaseObservations) &&
      isStringArray(improvements) &&
      isRating(overallRating)
    ) {
      const observations = phaseObservations.map(strictObservation);
      if (observations.every((observation): observation is PhaseObservation => observation !== null)) {
        return { narrativeSummary, phaseObservations: observations, improvements, overallRating };
      }
    }
  }
  throw new DebriefError('malformedResponse');
}

function partialObservation(value: Record<string, unknown>): Partial<PhaseObservation> {
  const observation: Partial<PhaseObservation> = {};
  if (typeof value.phase === 'string') observation.phase = value.phase;
  if (Array.isArray(value.observations)) {
    observation.observations = value.observations.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value.executedWell === 'boolean') observation.executedWell = value.executedWell;
  return observation;
}

/**
 * What has streamed in so far: known fields of the right type are kept, anything else is skipped. Null when the text is
 * not a JSON object, so the caller skips that snapshot.
 */
export function parsePartialFlightDebrief(text: string): PartialFlightDebrief | null {
  const value = parse(text);
  if (!isRecord(value)) return null;
  const partial: PartialFlightDebrief = {};
  if (typeof value.narrativeSummary === 'string') partial.narrativeSummary = value.narrativeSummary;
  if (Array.isArray(value.phaseObservations)) {
    partial.phaseObservations = value.phaseObservations.filter(isRecord).map(partialObservation);
  }
  if (Array.isArray(value.improvements)) {
    partial.improvements = value.improvements.filter((item): item is string => typeof item === 'string');
  }
  if (isRating(value.overallRating)) partial.overallRating = value.overallRating;
  return partial;
}
