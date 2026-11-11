import { errorDescription } from '../core/errorInfo';
import { describeError } from '../describeError';
import type { AppError } from '../errors';
import type { PartialFlightDebrief } from '../ports/debriefEngine';
import type { FlightDebrief } from './types';

// The rules of efb-212/Views/Flights/DebriefView.swift that are not drawing.

export type DebriefPane = 'completed' | 'streaming' | 'error' | 'initial';

/**
 * What DebriefView shows: the finished debrief, the stream so far, the error, or the first pane with its Generate button. Between
 * pressing Generate and the first part arriving the first pane is still there, as in Swift.
 */
export function debriefPane(state: {
  completed: FlightDebrief | null;
  isGenerating: boolean;
  partial: PartialFlightDebrief | null;
  engineError: unknown;
  promptError: AppError | null;
}): DebriefPane {
  if (state.completed !== null) return 'completed';
  if (state.isGenerating && state.partial !== null) return 'streaming';
  if (state.engineError != null || state.promptError !== null) return 'error';
  return 'initial';
}

/** The text of the error pane: the engine's error, else the one from building the prompt (`engine.error ?? promptError`). */
export function debriefErrorText(engineError: unknown, promptError: AppError | null): string {
  if (engineError != null) return describeError(engineError);
  return promptError === null ? '' : errorDescription(promptError);
}

/** The five stars: filled up to the rating. A rating outside 1 to 5 fills none or all of them. */
export const ratingStars = (rating: number): boolean[] => [1, 2, 3, 4, 5].map((star) => star <= rating);

export const ratingText = (rating: number): { text: string; spoken: string } => ({
  text: `Rating: ${rating}/5`,
  spoken: `Rating: ${rating} out of 5`,
});

/** The verdict of one phase: glyph plus text, so it never relies on colour alone. */
export const executionBadge = (executedWell: boolean): { text: string; ok: boolean } => ({
  text: executedWell ? 'Well executed' : 'Needs work',
  ok: executedWell,
});
