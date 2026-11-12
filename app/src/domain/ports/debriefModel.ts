// Port for the on-device language model behind the AI debrief. Replaces the Apple FoundationModels calls in
// Services/Debrief/DebriefEngine.swift (SystemLanguageModel.availability, LanguageModelSession, streamResponse). iOS
// implements it over the local KanafDebrief module; Android does not offer the debrief in v1 (owner decision Q8).
import type { FlightDebrief, PhaseObservation } from '../debrief/types';

/**
 * What the platform says about the model. `reason` is the platform's own description (Swift
 * `String(describing: reason)`, for example "deviceNotEligible"); DebriefEngine turns it into a message for the pilot.
 */
export type ModelAvailability = { kind: 'available' } | { kind: 'unavailable'; reason: string };

/** A debrief still being generated: any field may be missing or cut off (Swift `FlightDebrief.PartiallyGenerated`). */
export interface PartialFlightDebrief {
  narrativeSummary?: string;
  phaseObservations?: Partial<PhaseObservation>[];
  improvements?: string[];
  overallRating?: number;
}

/** Swift `DebriefError` plus `malformedResponse`, which only the JavaScript bridge can have. Messages are the Swift ones. */
export type DebriefErrorKind = 'sessionUnavailable' | 'emptyResponse' | 'generationFailed' | 'malformedResponse';

export class DebriefError extends Error {
  constructor(
    readonly kind: DebriefErrorKind,
    cause?: unknown,
  ) {
    super(DebriefError.describe(kind, cause), cause === undefined ? undefined : { cause });
    this.name = 'DebriefError';
  }

  private static describe(kind: DebriefErrorKind, cause: unknown): string {
    switch (kind) {
      case 'sessionUnavailable':
        return 'Apple Intelligence did not start a session. Check Settings \u203A Apple Intelligence & Siri.';
      case 'emptyResponse':
        return 'The debrief came back empty. Try again.';
      case 'generationFailed':
        return `Debrief failed: ${cause instanceof Error ? cause.message : String(cause)}`;
      case 'malformedResponse':
        return 'The debrief came back in a form the app could not read. Try again.';
    }
  }
}

export interface DebriefSession {
  /**
   * Generates a debrief for `prompt`. `onPartial` receives each snapshot as it streams in, for progressive rendering.
   * Rejects when generation fails, comes back empty or is cancelled by `close()`.
   */
  generate(prompt: string, onPartial: (partial: PartialFlightDebrief) => void): Promise<FlightDebrief>;
  /** Cancels a generation in progress and releases the model's memory (about 1.2 GB on iOS). Safe to call twice. */
  close(): void;
}

export interface DebriefModel {
  /**
   * False when the platform does not offer the debrief at all (Android, Q8): screens hide the feature instead of showing
   * an unavailable message.
   */
  readonly offered: boolean;
  availability(): ModelAvailability;
  /** Creates a session. Cheap: the model loads at the first generate. Throws when the platform cannot start one. */
  openSession(instructions: string): DebriefSession;
}

/** The model for platforms that do not offer the debrief: never available, cannot open a session. */
export function unavailableDebriefModel(reason: string): DebriefModel {
  return {
    offered: false,
    availability: () => ({ kind: 'unavailable', reason }),
    openSession: () => {
      throw new DebriefError('sessionUnavailable');
    },
  };
}

/** A generation a FakeDebriefModel session is holding open until the test settles it. */
export interface PendingGeneration {
  prompt: string;
  onPartial: (partial: PartialFlightDebrief) => void;
  resolve(debrief: FlightDebrief): void;
  reject(error: unknown): void;
}

/** Test double: records every call and lets a test stream partials and settle each generation by hand. */
export class FakeDebriefModel implements DebriefModel {
  offered = true;
  current: ModelAvailability = { kind: 'available' };
  /** When set, availability() throws it. */
  availabilityError: unknown = null;
  /** When set, openSession() throws it. */
  openError: unknown = null;
  readonly sessions: FakeDebriefSession[] = [];

  availability(): ModelAvailability {
    if (this.availabilityError !== null) throw this.availabilityError;
    return this.current;
  }

  openSession(instructions: string): FakeDebriefSession {
    if (this.openError !== null) throw this.openError;
    const session = new FakeDebriefSession(instructions);
    this.sessions.push(session);
    return session;
  }
}

export class FakeDebriefSession implements DebriefSession {
  readonly generations: PendingGeneration[] = [];
  closeCount = 0;
  /** When set, close() throws it (after recording the call). */
  closeError: unknown = null;

  constructor(readonly instructions: string) {}

  generate(prompt: string, onPartial: (partial: PartialFlightDebrief) => void): Promise<FlightDebrief> {
    const { promise, resolve, reject } = Promise.withResolvers<FlightDebrief>();
    this.generations.push({ prompt, onPartial, resolve, reject });
    return promise;
  }

  close(): void {
    this.closeCount += 1;
    if (this.closeError !== null) throw this.closeError;
  }

  /** The generation started most recently. */
  get latest(): PendingGeneration {
    const latest = this.generations[this.generations.length - 1];
    if (!latest) throw new Error('nothing was generated');
    return latest;
  }
}
