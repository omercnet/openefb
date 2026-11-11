// Port of the service half of efb-212/Services/Recording/TranscriptionService.swift: the flight context, the aviation
// vocabulary, phase tagging, storage of final segments and the live callback, over a SpeechEngine that does the
// recognition. Beyond Swift (docs/port-notes/A3.md): the engine is restarted when it ends by itself, because the
// Android recogniser stops after every utterance and a route change or interruption can stop the iOS one.
import { uuidv4, type IdGenerator } from '../data/ids';
import { newTranscriptSegment, type TranscriptSegment } from '../data/recording';
import { AppFailure, type AppError } from './errors';
import { AVIATION_CONTEXTUAL_STRINGS, processAviationVocabulary } from './aviationVocabulary';
import {
  segmentMetrics,
  TRANSCRIPTION_LOCALE,
  type SpeechEngine,
  type SpeechFailure,
  type SpeechResult,
  type TranscriptDisplayItem,
  type TranscriptSegmentMetrics,
  type TranscriptionErrorListener,
} from './ports/speech';
import { systemClock, type Clock, type TranscriptionServiceLike } from './recording/collaborators';
import type { FlightPhaseType } from './recording/types';

/** Wait before listening again after an engine ended normally, so a silent cockpit does not spin the recogniser. */
export const ENDED_RESTART_DELAY_MS = 250;
/** Wait after the first failure; it doubles with each consecutive failure up to the maximum. */
export const ERROR_RESTART_DELAY_MS = 500;
export const MAX_ERROR_RESTART_DELAY_MS = 8_000;
/** Consecutive failures (no result in between) after which transcription gives up. */
export const MAX_CONSECUTIVE_FAILURES = 5;
/** An engine that ran this long before failing was healthy: earlier failures no longer count against it. */
export const STABLE_AFTER_MS = 30_000;
/** An engine that ends this soon after starting, having heard nothing, is failing, not finishing an utterance. */
export const RAPID_END_MS = 1_000;

export interface TranscriptionSessionDeps {
  engine: SpeechEngine;
  /** The recording database (or any store taking its segment rows). */
  store: { insertTranscript(segment: TranscriptSegment): Promise<void> };
  clock?: Clock;
  newId?: IdGenerator;
}

/** One startTranscription..stopTranscription span. */
interface Run {
  /** epoch ms when startTranscription began; engine times are placed on a timeline that starts here. */
  origin: number;
  /** Seconds from origin to the engine's time zero (it zeroes at every start). */
  offsetSeconds: number;
  /** Bumps with every engine start; events of an earlier start are dropped. */
  generation: number;
  /** Failures since the engine last produced a result. */
  failures: number;
  /** A restart is waiting or running; further failures meanwhile are the same incident. */
  restarting: boolean;
  /** epoch ms when the engine last finished starting. */
  startedAt: number;
  /** The engine has produced a result since it last finished starting. */
  heard: boolean;
}

export class TranscriptionSession implements TranscriptionServiceLike {
  private readonly engine: SpeechEngine;
  private readonly store: TranscriptionSessionDeps['store'];
  private readonly clock: Clock;
  private readonly newId: IdGenerator;

  private flightID: string | null = null;
  private run: Run | null = null;
  private transcribing = false;
  private regionTerms: readonly string[] = [];
  private phaseProvider: (() => FlightPhaseType) | null = null;
  private onUpdate: ((item: TranscriptDisplayItem) => void) | null = null;
  private onError: TranscriptionErrorListener | null = null;
  /** Bumps on every stop; a start that was called before a stop never starts the engine. */
  private epoch = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(deps: TranscriptionSessionDeps) {
    this.engine = deps.engine;
    this.store = deps.store;
    this.clock = deps.clock ?? systemClock;
    this.newId = deps.newId ?? uuidv4;
  }

  get isTranscribing(): boolean {
    return this.transcribing;
  }

  /** Called with every volatile and final line (Swift onTranscriptUpdate). */
  setOnTranscriptUpdate(callback: ((item: TranscriptDisplayItem) => void) | null): void {
    this.onUpdate = callback;
  }

  /** Called when transcription gives up after the engine failed for good. */
  setOnError(listener: TranscriptionErrorListener | null): void {
    this.onError = listener;
  }

  /** Reads the live flight phase for every final segment; without one segments are tagged preflight. */
  setCurrentPhaseProvider(provider: (() => FlightPhaseType) | null): void {
    this.phaseProvider = provider;
  }

  /** Region terms for recognition (Swift setRegionVocabulary); takes effect at the next start. */
  setRegionVocabulary(terms: readonly string[]): void {
    this.regionTerms = [...terms];
  }

  startTranscription(flightID: string): Promise<void> {
    const epoch = this.epoch;
    return this.serialized(async () => {
      if (epoch !== this.epoch) return; // stopped before this start got its turn
      await this.releaseEngine(); // a second start without a stop: never two engines (JS-only guard)
      // Swift sets the flight first and keeps it when the engine cannot start; its phase tests depend on that.
      this.flightID = flightID;
      const origin = this.clock.now();
      const run: Run = {
        origin,
        offsetSeconds: 0,
        generation: 0,
        failures: 0,
        restarting: false,
        startedAt: origin,
        heard: false,
      };
      this.run = run;
      try {
        await this.startEngine(run);
      } catch (error) {
        if (this.run === run) this.run = null;
        await this.stopEngineQuietly();
        throw error;
      }
      if (epoch !== this.epoch) return; // stopped while the engine started; the queued stop releases it
      this.transcribing = true;
    });
  }

  stopTranscription(): Promise<void> {
    this.epoch += 1;
    // Takes effect at once: results, failures and pending restarts of the run being stopped are dropped from here on.
    this.run = null;
    this.transcribing = false;
    this.flightID = null;
    return this.serialized(() => this.stopEngineQuietly());
  }

  /**
   * Stores a final segment tagged with the live phase and tells the UI. Both engines end up here (Swift
   * recordFinalSegment). Never rejects: a store failure is dropped, as Swift logged it and carried on.
   */
  async recordFinalSegment(text: string, metrics: TranscriptSegmentMetrics): Promise<void> {
    const flightID = this.flightID;
    if (flightID === null) return;
    const segment = newTranscriptSegment({
      flightID,
      text,
      confidence: metrics.confidence,
      audioStartTime: metrics.audioStartTime,
      audioEndTime: metrics.audioEndTime,
      flightPhase: this.currentPhase(),
      now: () => this.clock.now(),
      newId: this.newId,
    });
    try {
      await this.store.insertTranscript(segment);
    } catch {
      // Swift: "Failed to store transcript"; the line still reaches the UI.
    }
    this.notify({ id: this.newId(), text, timestamp: this.clock.now(), isVolatile: false });
  }

  private currentPhase(): FlightPhaseType {
    try {
      return this.phaseProvider?.() ?? 'preflight';
    } catch {
      return 'preflight'; // a failing provider must not lose the segment
    }
  }

  private notify(item: TranscriptDisplayItem): void {
    try {
      this.onUpdate?.(item);
    } catch {
      // A throwing UI callback must not stop transcription.
    }
  }

  /** Runs operations on the engine one at a time, in call order. */
  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async stopEngineQuietly(): Promise<void> {
    try {
      await this.engine.stop();
    } catch {
      // Stopping is best effort; the engine contract says it does not reject.
    }
  }

  private async releaseEngine(): Promise<void> {
    if (this.run === null && !this.transcribing) return;
    this.run = null;
    this.transcribing = false;
    await this.stopEngineQuietly();
  }

  private async startEngine(run: Run): Promise<void> {
    run.generation += 1;
    const generation = run.generation;
    const live = (): boolean => this.run === run && run.generation === generation;
    // Results that arrive while the engine is still starting use the earliest estimate of its time zero.
    run.offsetSeconds = (this.clock.now() - run.origin) / 1000;
    await this.engine.start(
      { locale: TRANSCRIPTION_LOCALE, aviationTerms: AVIATION_CONTEXTUAL_STRINGS, regionTerms: this.regionTerms },
      {
        result: (result) => {
          if (live()) this.handleResult(run, result);
        },
        failure: (failure) => {
          if (live()) this.handleFailure(run, failure);
        },
      },
    );
    const ready = this.clock.now();
    run.offsetSeconds = (ready - run.origin) / 1000;
    run.startedAt = ready;
    run.heard = false;
  }

  private handleResult(run: Run, result: SpeechResult): void {
    run.failures = 0;
    run.heard = true;
    const text = processAviationVocabulary(result.text);
    if (!result.isFinal) {
      this.notify({ id: this.newId(), text, timestamp: this.clock.now(), isVolatile: true });
      return;
    }
    const metrics = segmentMetrics(result.runs, result.range);
    void this.recordFinalSegment(text, {
      confidence: metrics.confidence,
      audioStartTime: metrics.audioStartTime + run.offsetSeconds,
      audioEndTime: metrics.audioEndTime + run.offsetSeconds,
    });
  }

  private handleFailure(run: Run, failure: SpeechFailure): void {
    if (failure.kind === 'fatal') {
      this.giveUp(run);
      return;
    }
    if (run.restarting) return; // an error and the end that follows it are one incident
    const now = this.clock.now();
    if (now - run.startedAt >= STABLE_AFTER_MS) run.failures = 0;
    // An engine that ends at once without hearing anything would otherwise be restarted every ENDED_RESTART_DELAY_MS.
    const rapidEnd = failure.kind === 'ended' && !run.heard && now - run.startedAt < RAPID_END_MS;
    if (failure.kind === 'transient' || rapidEnd) run.failures += 1;
    if (run.failures > MAX_CONSECUTIVE_FAILURES) {
      this.giveUp(run);
      return;
    }
    const delay =
      failure.kind === 'ended' && !rapidEnd
        ? ENDED_RESTART_DELAY_MS
        : Math.min(ERROR_RESTART_DELAY_MS * 2 ** (run.failures - 1), MAX_ERROR_RESTART_DELAY_MS);
    run.restarting = true;
    void this.restart(run, delay);
  }

  /** Listens again after `delay`, unless transcription was stopped or replaced meanwhile. */
  private async restart(run: Run, delay: number): Promise<void> {
    await this.clock.sleep(delay);
    const failure = await this.serialized(async (): Promise<SpeechFailure | null> => {
      if (this.run !== run) return null;
      await this.stopEngineQuietly();
      if (this.run !== run) return null;
      try {
        await this.startEngine(run);
        return null;
      } catch (error) {
        // Without permission or a recogniser another start cannot help; anything else is tried again.
        const kind = error instanceof AppFailure ? error.error.kind : null;
        const fatal = kind === 'microphonePermissionDenied' || kind === 'transcriptionUnavailable';
        return { kind: fatal ? 'fatal' : 'transient', message: error instanceof Error ? error.message : String(error) };
      } finally {
        // Cleared as the engine finishes starting, so a failure it reports right after is not taken for the old one.
        run.restarting = false;
      }
    });
    if (failure !== null && this.run === run) this.handleFailure(run, failure);
  }

  /** The engine cannot continue: release it, stop transcribing and say so. */
  private giveUp(run: Run): void {
    if (this.run !== run) return;
    this.run = null;
    this.transcribing = false;
    void this.serialized(() => this.stopEngineQuietly());
    const error: AppError = { kind: 'transcriptionUnavailable' };
    try {
      this.onError?.(error);
    } catch {
      // The listener's failure is not transcription's problem.
    }
  }
}
