// Port of efb-212/Services/Debrief/DebriefEngine.swift: the lifecycle of one on-device AI debrief (check availability,
// prewarm a session, generate with streamed partials, save, discard). The model itself is a DebriefModel port (iOS:
// Apple FoundationModels behind the local KanafDebrief module). Differences and JS-only guards: docs/port-notes/A6.md.

import { uuidv4, type IdGenerator } from '../data/ids';
import type { RecordingDatabase } from '../data/recording';
import { errorDescription } from './core/errorInfo';
import { decodedImprovements, decodedPhaseObservations, fromFlightDebrief } from './debrief/debriefRecord';
import type { FlightDebrief } from './debrief/types';
import { AppFailure } from './errors';
import { DebriefError, type DebriefModel, type DebriefSession, type PartialFlightDebrief } from './ports/debriefModel';

/** Swift `DebriefEngine.AvailabilityStatus`. */
export type AvailabilityStatus = { kind: 'unknown' } | { kind: 'available' } | { kind: 'unavailable'; reason: string };

// Swift strings use U+203A (single right-pointing angle quotation mark) in "Settings > Apple Intelligence & Siri".
const SETTINGS_PATH = 'Settings \u203A Apple Intelligence & Siri';

/**
 * Maps the platform's description of why the model is unavailable to a message for the pilot (Swift
 * `AvailabilityStatus.reasonMessage(for:)`). It matches on the case name or on a phrase, in this order.
 */
export function availabilityReasonMessage(reasonDescription: string): string {
  if (reasonDescription.includes('deviceNotEligible') || reasonDescription.includes('not eligible')) {
    return 'This iPad does not support Apple Intelligence.';
  }
  if (reasonDescription.includes('appleIntelligenceNotEnabled') || reasonDescription.includes('not enabled')) {
    return `Apple Intelligence is not enabled. Turn it on in ${SETTINGS_PATH}.`;
  }
  if (reasonDescription.includes('modelNotReady') || reasonDescription.includes('not ready')) {
    return 'Apple Intelligence is still downloading its model. Try again later.';
  }
  return 'Debrief is unavailable right now.';
}

/** Swift `DebriefEngine.systemPrompt`: the instructions every debrief session starts with. */
export const DEBRIEF_SYSTEM_PROMPT =
  "You are an experienced flight instructor reviewing a student pilot's VFR flight. " +
  'Provide constructive, specific feedback based on the flight data. ' +
  'Focus on safety, decision-making, and technique. ' +
  'Be encouraging but honest about areas for improvement.';

/** The slice of RecordingDatabase the engine uses (Swift passed the whole database per call). */
export type DebriefStore = Pick<RecordingDatabase, 'insertDebrief' | 'debrief'>;

export interface DebriefEngineDeps {
  model: DebriefModel;
  /** Receives "Debrief.generated" after a debrief is generated (Swift `Telemetry.signal`). Best effort. */
  telemetry?: { signal(name: string): void };
  /** epoch ms; defaults to Date.now. */
  now?: () => number;
  newId?: IdGenerator;
}

/**
 * What the Swift view showed for `error.localizedDescription`: an AppFailure the way the app words that error, any other
 * error by its message.
 */
export function debriefErrorMessage(error: Error): string {
  return error instanceof AppFailure ? errorDescription(error.error) : error.message;
}

/**
 * Lifecycle: checkAvailability, prewarm (when the flight screen appears), generateDebrief, discard (when it goes away).
 * The model holds about 1.2 GB on iOS, so a session lives only between prewarm or generate and discard.
 *
 * State is observable through subscribe() (Swift @Observable). Work that outlives a discard(), a newer generation or a
 * newer load is dropped by an epoch check, so a late result can never overwrite what the pilot is looking at.
 */
export class DebriefEngine {
  /** Streaming partial debrief for progressive rendering. */
  partialDebrief: PartialFlightDebrief | null = null;
  /** The finished debrief, from a generation or loaded from the database. */
  completedDebrief: FlightDebrief | null = null;
  isGenerating = false;
  /** From the last attempt, if it failed. */
  error: Error | null = null;
  availabilityStatus: AvailabilityStatus = { kind: 'unknown' };

  private readonly model: DebriefModel;
  private readonly telemetry: DebriefEngineDeps['telemetry'];
  private readonly now: () => number;
  private readonly newId: IdGenerator;
  private session: DebriefSession | null = null;
  /** Bumps on discard() and when a generation starts: work begun under an older value is stale. */
  private epoch = 0;
  private readonly listeners = new Set<() => void>();

  constructor(deps: DebriefEngineDeps) {
    this.model = deps.model;
    this.telemetry = deps.telemetry;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? uuidv4;
  }

  /** False when the platform does not offer the debrief at all (Android): hide the feature. */
  get offered(): boolean {
    return this.model.offered;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Reads the model's availability (Swift: SystemLanguageModel.default.availability). */
  checkAvailability(): void {
    try {
      const availability = this.model.availability();
      this.availabilityStatus =
        availability.kind === 'available'
          ? { kind: 'available' }
          : { kind: 'unavailable', reason: availabilityReasonMessage(availability.reason) };
    } catch {
      // Swift's call cannot throw; a bridge that does reads as an unavailable model.
      this.availabilityStatus = { kind: 'unavailable', reason: availabilityReasonMessage('') };
    }
    this.notify();
  }

  /** Opens the session early so the first debrief starts sooner. Does nothing unless the model is available. */
  prewarm(): void {
    if (this.availabilityStatus.kind !== 'available' || this.session) return;
    try {
      this.session = this.model.openSession(DEBRIEF_SYSTEM_PROMPT);
    } catch {
      // generateDebrief opens one again and reports the failure if it persists.
    }
  }

  /**
   * Generates a debrief from `prompt` (the token-budgeted summary FlightSummaryBuilder builds), streaming partials into
   * `partialDebrief`, then saves it for the flight. A call while one is already generating is ignored.
   */
  async generateDebrief(prompt: string, store: DebriefStore, flightID: string): Promise<void> {
    if (this.isGenerating) return;
    if (!this.session) {
      try {
        this.session = this.model.openSession(DEBRIEF_SYSTEM_PROMPT);
      } catch (cause) {
        this.error = new AppFailure({ kind: 'debriefFailed', cause: new DebriefError('sessionUnavailable', cause) });
        this.notify();
        return;
      }
    }
    const session = this.session;
    const epoch = (this.epoch += 1);
    this.isGenerating = true;
    this.error = null;
    this.partialDebrief = null;
    this.completedDebrief = null;
    this.notify();

    try {
      const debrief = await session.generate(prompt, (partial) => {
        if (epoch !== this.epoch) return;
        this.partialDebrief = partial;
        this.notify();
      });
      if (epoch === this.epoch) {
        this.completedDebrief = debrief;
        this.notify();
      }
      // Saved even if the screen was left meanwhile: Swift saved whatever finished.
      await store.insertDebrief(
        fromFlightDebrief(debrief, flightID, {
          id: this.newId(),
          generatedAt: this.now(),
          promptTokensEstimate: null,
          responseTokensEstimate: null,
        }),
      );
      try {
        this.telemetry?.signal('Debrief.generated');
      } catch {
        // Counting is never worth a failed debrief.
      }
    } catch (error) {
      if (epoch === this.epoch) this.error = error instanceof Error ? error : new Error(String(error));
    } finally {
      if (epoch === this.epoch) {
        this.isGenerating = false;
        this.notify();
      }
    }
  }

  /** Shows the debrief already saved for the flight, if any (no generation). */
  async loadExistingDebrief(store: DebriefStore, flightID: string): Promise<void> {
    const epoch = this.epoch;
    try {
      const record = await store.debrief(flightID);
      // A generation that started meanwhile owns the screen: its streaming debrief must not be covered by an older one.
      if (epoch !== this.epoch || this.isGenerating || !record) return;
      this.completedDebrief = {
        narrativeSummary: record.narrativeSummary,
        phaseObservations: decodedPhaseObservations(record),
        improvements: decodedImprovements(record),
        overallRating: record.overallRating,
      };
      this.notify();
    } catch (error) {
      if (epoch === this.epoch) {
        this.error = error instanceof Error ? error : new Error(String(error));
        this.notify();
      }
    }
  }

  /**
   * Releases the session (and with it a generation in progress) and clears the debrief state, keeping availability.
   * Swift let a running generation finish on its own; here it is cancelled, which is why isGenerating is reset here.
   */
  discard(): void {
    this.epoch += 1;
    const session = this.session;
    this.session = null;
    try {
      session?.close();
    } catch {
      // Closing is best effort; the session is dropped either way.
    }
    this.partialDebrief = null;
    this.completedDebrief = null;
    this.error = null;
    this.isGenerating = false;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A view that threw while updating must not stop the engine or the other views.
      }
    }
  }
}
