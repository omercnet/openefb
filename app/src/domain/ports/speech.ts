// Port for speech recognition engines under TranscriptionSession: iOS SpeechAnalyzer and the Android SpeechRecognizer
// implement SpeechEngine, the session owns everything else the Swift TranscriptionService did (vocabulary, phase tags,
// storage, UI callback). Replaces the engine half of Services/Recording/TranscriptionService.swift.
import { AppFailure, type AppError } from '../errors';

/** Swift hard-coded `Locale(identifier: "en-US")`. */
export const TRANSCRIPTION_LOCALE = 'en-US';

/** One attributed run of a result: Swift read `transcriptionConfidence` and `audioTimeRange` from each AttributedString run. */
export interface SpeechRun {
  text: string;
  /** 0 to 1; null when the engine scored nothing for this run. */
  confidence: number | null;
  /** Seconds on the engine's own timeline; null when the run has no valid time range. */
  start: number | null;
  end: number | null;
}

export interface SpeechResult {
  /** Recogniser output, before the aviation vocabulary is applied. */
  text: string;
  /** Final results are stored, volatile ones only shown. */
  isFinal: boolean;
  /** Final results: the runs the metrics are read from. */
  runs: readonly SpeechRun[];
  /** The result's overall range in seconds (Swift `result.range`); null when invalid or indefinite. */
  range: { start: number; end: number } | null;
}

/** Confidence and audio time range of a final result (Swift TranscriptSegmentMetrics). Seconds from the audio start. */
export interface TranscriptSegmentMetrics {
  /** null when the engine gave none (never a sentinel). */
  confidence: number | null;
  audioStartTime: number;
  audioEndTime: number;
}

/**
 * Swift `TranscriptionService.metrics(from:resultRange:)`. Confidence is the character-length-weighted mean of the runs
 * that carry one, or null if none do. The time range spans the runs' own ranges and falls back to the result's range.
 * Lengths count code points where Swift counted Characters (the same for English text).
 */
export function segmentMetrics(runs: readonly SpeechRun[], range: SpeechResult['range']): TranscriptSegmentMetrics {
  let weighted = 0;
  let weight = 0;
  let start: number | undefined;
  let end: number | undefined;
  for (const run of runs) {
    const length = Array.from(run.text).length;
    if (run.confidence !== null && length > 0) {
      weighted += run.confidence * length;
      weight += length;
    }
    if (run.start !== null && run.end !== null) {
      start = Math.min(start ?? run.start, run.start);
      end = Math.max(end ?? run.end, run.end);
    }
  }
  if ((start === undefined || end === undefined) && range !== null) {
    start = range.start;
    end = range.end;
  }
  return {
    confidence: weight > 0 ? weighted / weight : null,
    audioStartTime: start ?? 0,
    audioEndTime: end ?? 0,
  };
}

/**
 * Why an engine stopped listening on its own.
 * - ended: it finished normally (a recogniser session ran out after an utterance or silence); listen again.
 * - transient: it failed in a way another start may fix (audio route change, busy recogniser); listen again, with
 *   growing waits, and give up after repeated failures.
 * - fatal: it cannot work (permission withdrawn, language unsupported); stop transcribing.
 */
export interface SpeechFailure {
  kind: 'ended' | 'transient' | 'fatal';
  message: string;
}

export interface SpeechSink {
  result(result: SpeechResult): void;
  failure(failure: SpeechFailure): void;
}

export interface SpeechEngineConfig {
  locale: string;
  /** Radio terms (Swift aviationContextualStrings). Swift gave them to SFSpeechRecognizer only. */
  aviationTerms: readonly string[];
  /** Region terms (Israel reporting points, Hebrew and English) that bias recognition; empty for the US. */
  regionTerms: readonly string[];
}

export interface SpeechEngine {
  /**
   * Starts listening and returns once it is. Events go to `sink`; times are seconds from this call. Rejects with an
   * AppFailure (transcriptionUnavailable, microphonePermissionDenied) when it cannot, leaving nothing running.
   */
  start(config: SpeechEngineConfig, sink: SpeechSink): Promise<void>;
  /** Stops listening and releases the microphone. Safe when not started; never rejects. */
  stop(): Promise<void>;
}

/** Swift TranscriptDisplayItem: a line for the live transcript panel. */
export interface TranscriptDisplayItem {
  id: string;
  text: string;
  /** epoch ms */
  timestamp: number;
  isVolatile: boolean;
}

/** What the session reports when transcription stops by itself. */
export type TranscriptionErrorListener = (error: AppError) => void;

/** The engine for platforms that have none (web, tests of callers): every start fails like a missing recogniser. */
export const unavailableSpeechEngine: SpeechEngine = {
  start: () => Promise.reject(new AppFailure({ kind: 'transcriptionUnavailable' })),
  stop: () => Promise.resolve(),
};

/** Test double: records calls, and lets a test feed the sink of any start it made, including stale ones. */
export class FakeSpeechEngine implements SpeechEngine {
  starts: SpeechEngineConfig[] = [];
  sinks: SpeechSink[] = [];
  stopCount = 0;
  /** When set, start() rejects with it. */
  startError: unknown = null;
  /** When set, start() waits for it before finishing, to hold a start open. */
  startGate: Promise<void> | null = null;
  /** Rejects the next start() calls with these, one each, before startError applies. */
  startErrors: unknown[] = [];

  async start(config: SpeechEngineConfig, sink: SpeechSink): Promise<void> {
    this.starts.push(config);
    this.sinks.push(sink);
    if (this.startGate) await this.startGate;
    const queued = this.startErrors.shift();
    if (queued !== undefined) throw queued;
    if (this.startError !== null) throw this.startError;
  }

  stop(): Promise<void> {
    this.stopCount += 1;
    return Promise.resolve();
  }

  /** The sink of the most recent start. */
  get sink(): SpeechSink {
    const latest = this.sinks[this.sinks.length - 1];
    if (!latest) throw new Error('the engine was never started');
    return latest;
  }
}
