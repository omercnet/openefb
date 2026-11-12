import type { EventSubscription } from 'expo';

import { AppFailure } from '../domain/errors';
import type { SpeechEngineConfig, SpeechFailure, SpeechResult, SpeechSink } from '../domain/ports/speech';
import { FakeClock, flush } from '../domain/recording/testSupport';
import { TranscriptionSession } from '../domain/transcriptionSession';
import type { TranscriptSegment } from '../data/recording';
import {
  createSpeechAnalyzerEngine,
  isSpeechAnalyzerAvailable,
  prepareSpeechAssets,
  type KanafSpeechModule,
  type NativeFailureEvent,
  type NativeResultEvent,
  type NativeStartStatus,
} from './speechAnalyzer';

/** The KanafSpeech native module as the adapter sees it, driven by the test. */
class FakeKanafSpeech implements KanafSpeechModule {
  status: NativeStartStatus = 'started';
  startError: unknown = null;
  stopError: unknown = null;
  available = true;
  starts: { locale: string; contextualStrings: string[] }[] = [];
  stops = 0;
  prepared: string[] = [];
  /** Emitted from inside start(), as a native module that is already listening may do. */
  emitDuringStart: NativeResultEvent | null = null;
  private results = new Set<(event: NativeResultEvent) => void>();
  private failures = new Set<(event: NativeFailureEvent) => void>();

  addListener(event: 'onResult', listener: (event: NativeResultEvent) => void): EventSubscription;
  addListener(event: 'onFailure', listener: (event: NativeFailureEvent) => void): EventSubscription;
  addListener(event: string, listener: never): EventSubscription {
    const set = (event === 'onResult' ? this.results : this.failures) as Set<unknown>;
    set.add(listener);
    return { remove: () => void set.delete(listener) };
  }

  get listenerCount(): number {
    return this.results.size + this.failures.size;
  }

  emitResult(event: NativeResultEvent): void {
    [...this.results].forEach((listener) => listener(event));
  }

  emitFailure(event: NativeFailureEvent): void {
    [...this.failures].forEach((listener) => listener(event));
  }

  async start(options: { locale: string; contextualStrings: string[] }): Promise<NativeStartStatus> {
    this.starts.push(options);
    if (this.emitDuringStart) this.emitResult(this.emitDuringStart);
    if (this.startError !== null) throw this.startError;
    return this.status;
  }

  async stop(): Promise<void> {
    this.stops += 1;
    if (this.stopError !== null) throw this.stopError;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async prepare(locale: string): Promise<void> {
    this.prepared.push(locale);
  }
}

const config: SpeechEngineConfig = { locale: 'en-US', aviationTerms: ['squawk', 'niner'], regionTerms: ['SHARON'] };

function sinkLog(): { sink: SpeechSink; results: SpeechResult[]; failures: SpeechFailure[] } {
  const results: SpeechResult[] = [];
  const failures: SpeechFailure[] = [];
  return { sink: { result: (r) => results.push(r), failure: (f) => failures.push(f) }, results, failures };
}

describe('createSpeechAnalyzerEngine', () => {
  describe('start', () => {
    test('starts the native session for the locale with the region terms only (Swift gave SpeechAnalyzer no radio terms)', async () => {
      const native = new FakeKanafSpeech();
      await createSpeechAnalyzerEngine(native).start(config, sinkLog().sink);
      expect(native.starts).toEqual([{ locale: 'en-US', contextualStrings: ['SHARON'] }]);
    });

    test('listens before the native session starts, so an early result is not lost', async () => {
      const native = new FakeKanafSpeech();
      native.emitDuringStart = { text: 'early', isFinal: false };
      const log = sinkLog();
      await createSpeechAnalyzerEngine(native).start(config, log.sink);
      expect(log.results.map((r) => r.text)).toEqual(['early']);
    });

    test.each([
      ['permissionDenied', 'microphonePermissionDenied'],
      ['unavailable', 'transcriptionUnavailable'],
      ['unsupportedLocale', 'transcriptionUnavailable'],
      ['assetsMissing', 'transcriptionUnavailable'],
    ] as const)('a native status of %s rejects with %s and leaves nothing listening', async (status, kind) => {
      const native = new FakeKanafSpeech();
      native.status = status;

      const started = createSpeechAnalyzerEngine(native).start(config, sinkLog().sink);

      await expect(started).rejects.toMatchObject({ error: { kind } });
      expect(native.listenerCount).toBe(0);
      expect(native.stops).toBe(1);
    });

    test('a native exception rejects with an audio session failure that keeps the cause', async () => {
      const native = new FakeKanafSpeech();
      const cause = new Error('AVAudioEngine did not start');
      native.startError = cause;

      const started = createSpeechAnalyzerEngine(native).start(config, sinkLog().sink);

      await expect(started).rejects.toBeInstanceOf(AppFailure);
      await expect(started).rejects.toMatchObject({ error: { kind: 'audioSessionFailed', cause } });
      expect(native.listenerCount).toBe(0);
      expect(native.stops).toBe(1);
    });

    test('a failed start still rejects when the cleanup stop fails too', async () => {
      const native = new FakeKanafSpeech();
      native.status = 'unavailable';
      native.stopError = new Error('no session');
      await expect(createSpeechAnalyzerEngine(native).start(config, sinkLog().sink)).rejects.toMatchObject({
        error: { kind: 'transcriptionUnavailable' },
      });
    });

    test('without the native module the engine is unavailable', async () => {
      await expect(createSpeechAnalyzerEngine(null).start(config, sinkLog().sink)).rejects.toMatchObject({
        error: { kind: 'transcriptionUnavailable' },
      });
    });

    test('a start without a stop drops the earlier listeners', async () => {
      const native = new FakeKanafSpeech();
      const engine = createSpeechAnalyzerEngine(native);
      const first = sinkLog();
      const second = sinkLog();
      await engine.start(config, first.sink);
      await engine.start(config, second.sink);

      native.emitResult({ text: 'once', isFinal: false });

      expect(native.listenerCount).toBe(2);
      expect(first.results).toHaveLength(0);
      expect(second.results).toHaveLength(1);
    });
  });

  describe('events', () => {
    test('a final result carries its runs and range', async () => {
      const native = new FakeKanafSpeech();
      const log = sinkLog();
      await createSpeechAnalyzerEngine(native).start(config, log.sink);

      native.emitResult({
        text: 'cleared takeoff',
        isFinal: true,
        runs: [
          { text: 'cleared ', confidence: 1, start: 10, end: 11 },
          { text: 'takeoff', confidence: 0.5, start: 11, end: 12.5 },
        ],
        rangeStart: 10,
        rangeEnd: 12.5,
      });

      expect(log.results).toEqual([
        {
          text: 'cleared takeoff',
          isFinal: true,
          runs: [
            { text: 'cleared ', confidence: 1, start: 10, end: 11 },
            { text: 'takeoff', confidence: 0.5, start: 11, end: 12.5 },
          ],
          range: { start: 10, end: 12.5 },
        },
      ]);
    });

    test('a volatile result has no runs and no range', async () => {
      const native = new FakeKanafSpeech();
      const log = sinkLog();
      await createSpeechAnalyzerEngine(native).start(config, log.sink);
      native.emitResult({ text: 'tower', isFinal: false });
      expect(log.results).toEqual([{ text: 'tower', isFinal: false, runs: [], range: null }]);
    });

    test('missing and non-finite numbers become null, and half a range is no range', async () => {
      const native = new FakeKanafSpeech();
      const log = sinkLog();
      await createSpeechAnalyzerEngine(native).start(config, log.sink);

      native.emitResult({
        text: 'x',
        isFinal: true,
        runs: [
          { text: 'a' },
          { text: 'b', confidence: Number.NaN, start: Number.POSITIVE_INFINITY, end: 3 },
          { text: 'c', confidence: 0.4, start: 1, end: Number.NEGATIVE_INFINITY },
        ],
        rangeStart: 4,
      });

      expect(log.results[0]?.runs).toEqual([
        { text: 'a', confidence: null, start: null, end: null },
        { text: 'b', confidence: null, start: null, end: 3 },
        { text: 'c', confidence: 0.4, start: 1, end: null },
      ]);
      expect(log.results[0]?.range).toBeNull();
    });

    test('a native failure is transient: the session retries with backoff before giving up', async () => {
      const native = new FakeKanafSpeech();
      const log = sinkLog();
      await createSpeechAnalyzerEngine(native).start(config, log.sink);

      native.emitFailure({ message: 'The audio engine could not restart: no input' });
      native.emitFailure({ message: 'SpeechAnalyzer analysis failed: assets unavailable' });

      expect(log.failures).toEqual([
        { kind: 'transient', message: 'The audio engine could not restart: no input' },
        { kind: 'transient', message: 'SpeechAnalyzer analysis failed: assets unavailable' },
      ]);
    });
  });

  describe('stop', () => {
    test('stops the native session and stops delivering events', async () => {
      const native = new FakeKanafSpeech();
      const log = sinkLog();
      const engine = createSpeechAnalyzerEngine(native);
      await engine.start(config, log.sink);

      await engine.stop();
      native.emitResult({ text: 'late', isFinal: false });

      expect(native.stops).toBe(1);
      expect(native.listenerCount).toBe(0);
      expect(log.results).toHaveLength(0);
    });

    test('does not reject when the native stop does', async () => {
      const native = new FakeKanafSpeech();
      native.stopError = new Error('session already gone');
      await expect(createSpeechAnalyzerEngine(native).stop()).resolves.toBeUndefined();
    });

    test('is safe without the native module', async () => {
      await expect(createSpeechAnalyzerEngine(null).stop()).resolves.toBeUndefined();
    });
  });
});

describe('prepareSpeechAssets and isSpeechAnalyzerAvailable', () => {
  test('prepare asks the native side to install the English assets', async () => {
    const native = new FakeKanafSpeech();
    await prepareSpeechAssets(native);
    expect(native.prepared).toEqual(['en-US']);
  });

  test('prepare is unavailable without the native module', async () => {
    await expect(prepareSpeechAssets(null)).rejects.toMatchObject({ error: { kind: 'transcriptionUnavailable' } });
  });

  test('availability follows the native answer, and is false when it fails or is missing', async () => {
    const native = new FakeKanafSpeech();
    expect(await isSpeechAnalyzerAvailable(native)).toBe(true);
    native.available = false;
    expect(await isSpeechAnalyzerAvailable(native)).toBe(false);
    native.isAvailable = () => Promise.reject(new Error('bridge down'));
    expect(await isSpeechAnalyzerAvailable(native)).toBe(false);
    expect(await isSpeechAnalyzerAvailable(null)).toBe(false);
  });
});

describe('with TranscriptionSession', () => {
  test('a native final result is stored with its length-weighted confidence and engine times', async () => {
    const native = new FakeKanafSpeech();
    const rows: TranscriptSegment[] = [];
    const clock = new FakeClock();
    const session = new TranscriptionSession({
      engine: createSpeechAnalyzerEngine(native),
      store: { insertTranscript: async (segment) => void rows.push(segment) },
      clock,
    });
    session.setCurrentPhaseProvider(() => 'approach');
    await session.startTranscription('flight-1');

    native.emitResult({
      text: 'november seven three two papa cleared takeoff',
      isFinal: true,
      runs: [
        { text: 'cleared ', confidence: 1, start: 10, end: 11 },
        { text: 'takeoff', confidence: 0.5, start: 11, end: 12.5 },
      ],
      rangeStart: 10,
      rangeEnd: 12.5,
    });
    await flush();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toBe('N732Pcleared takeoff'); // Swift's vocabulary swallows the space after an N-number
    expect(rows[0]?.confidence).toBeCloseTo(11.5 / 15, 6);
    expect(rows[0]?.audioStartTime).toBe(10);
    expect(rows[0]?.audioEndTime).toBe(12.5);
    expect(rows[0]?.flightPhase).toBe('approach');
  });
});
