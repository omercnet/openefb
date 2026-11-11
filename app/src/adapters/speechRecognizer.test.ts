import type { EventSubscription } from 'expo';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionOptions,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

import type { TranscriptSegment } from '../data/recording';
import { AppFailure } from '../domain/errors';
import type { SpeechEngineConfig, SpeechFailure, SpeechResult, SpeechSink } from '../domain/ports/speech';
import { FakeClock, flush } from '../domain/recording/testSupport';
import { ENDED_RESTART_DELAY_MS, TranscriptionSession } from '../domain/transcriptionSession';
import { Platform } from 'react-native';

import { createRecognizerEngine, MIN_ON_DEVICE_API_LEVEL, type SpeechRecognitionModule } from './speechRecognizer';

// The real module is imported for its default; its native half does not exist under Jest.
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => true),
    getPermissionsAsync: jest.fn(async () => ({ granted: false })),
    requestPermissionsAsync: jest.fn(async () => ({ granted: false })),
  },
}));

/** expo-speech-recognition's module as the adapter sees it, driven by the test. */
class FakeRecognizer implements SpeechRecognitionModule {
  granted = true;
  grantOnRequest = true;
  available = true;
  onDevice = true;
  startError: unknown = null;
  abortError: unknown = null;
  permissionChecks = 0;
  permissionRequests = 0;
  starts: ExpoSpeechRecognitionOptions[] = [];
  aborts = 0;
  private resultListeners = new Set<(event: ExpoSpeechRecognitionResultEvent) => void>();
  private errorListeners = new Set<(event: ExpoSpeechRecognitionErrorEvent) => void>();
  private endListeners = new Set<() => void>();

  addListener(event: 'result', listener: (event: ExpoSpeechRecognitionResultEvent) => void): EventSubscription;
  addListener(event: 'error', listener: (event: ExpoSpeechRecognitionErrorEvent) => void): EventSubscription;
  addListener(event: 'end', listener: () => void): EventSubscription;
  addListener(event: string, listener: never): EventSubscription {
    const set = (
      event === 'result' ? this.resultListeners : event === 'error' ? this.errorListeners : this.endListeners
    ) as Set<unknown>;
    set.add(listener);
    return { remove: () => void set.delete(listener) };
  }

  get listenerCount(): number {
    return this.resultListeners.size + this.errorListeners.size + this.endListeners.size;
  }

  result(isFinal: boolean, transcript: string, confidence = -1): void {
    this.resultEvent({ isFinal, results: [{ transcript, confidence, segments: [] }] });
  }

  resultEvent(event: ExpoSpeechRecognitionResultEvent): void {
    [...this.resultListeners].forEach((listener) => listener(event));
  }

  error(error: string, message = ''): void {
    [...this.errorListeners].forEach((listener) =>
      listener({ error, message } as unknown as ExpoSpeechRecognitionErrorEvent),
    );
  }

  end(): void {
    [...this.endListeners].forEach((listener) => listener());
  }

  async getPermissionsAsync(): Promise<{ granted: boolean }> {
    this.permissionChecks += 1;
    return { granted: this.granted };
  }

  async requestPermissionsAsync(): Promise<{ granted: boolean }> {
    this.permissionRequests += 1;
    return { granted: this.grantOnRequest };
  }

  isRecognitionAvailable(): boolean {
    return this.available;
  }

  supportsOnDeviceRecognition(): boolean {
    return this.onDevice;
  }

  start(options: ExpoSpeechRecognitionOptions): void {
    this.starts.push(options);
    if (this.startError !== null) throw this.startError;
  }

  abort(): void {
    this.aborts += 1;
    if (this.abortError !== null) throw this.abortError;
  }
}

const config: SpeechEngineConfig = { locale: 'en-US', aviationTerms: ['squawk', 'niner'], regionTerms: ['SHARON'] };

function sinkLog(): { sink: SpeechSink; results: SpeechResult[]; failures: SpeechFailure[] } {
  const results: SpeechResult[] = [];
  const failures: SpeechFailure[] = [];
  return { sink: { result: (r) => results.push(r), failure: (f) => failures.push(f) }, results, failures };
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe('createRecognizerEngine', () => {
  describe('start', () => {
    test('listens continuously, on the device, in English, with partial results, punctuation and all the terms', async () => {
      const recognizer = new FakeRecognizer();
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, sinkLog().sink);
      expect(recognizer.starts).toEqual([
        {
          lang: 'en-US',
          interimResults: true,
          continuous: true,
          requiresOnDeviceRecognition: true,
          addsPunctuation: true,
          contextualStrings: ['squawk', 'niner', 'SHARON'],
        },
      ]);
    });

    test('does not ask for the microphone when it is already granted', async () => {
      const recognizer = new FakeRecognizer();
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, sinkLog().sink);
      expect(recognizer.permissionRequests).toBe(0);
    });

    test('asks for the microphone when it is not granted, then starts', async () => {
      const recognizer = new FakeRecognizer();
      recognizer.granted = false;
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, sinkLog().sink);
      expect(recognizer.permissionRequests).toBe(1);
      expect(recognizer.starts).toHaveLength(1);
    });

    test('a refused microphone rejects with microphonePermissionDenied and starts nothing', async () => {
      const recognizer = new FakeRecognizer();
      recognizer.granted = false;
      recognizer.grantOnRequest = false;

      const started = createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, sinkLog().sink);

      await expect(started).rejects.toMatchObject({ error: { kind: 'microphonePermissionDenied' } });
      expect(recognizer.starts).toHaveLength(0);
      expect(recognizer.listenerCount).toBe(0);
    });

    test('a granted microphone is remembered across restarts', async () => {
      const recognizer = new FakeRecognizer();
      const engine = createRecognizerEngine({ module: recognizer, apiLevel: 33 });
      await engine.start(config, sinkLog().sink);
      await engine.start(config, sinkLog().sink);
      expect(recognizer.permissionChecks).toBe(1);
    });

    test('a refused microphone is asked about again at the next start', async () => {
      const recognizer = new FakeRecognizer();
      recognizer.granted = false;
      recognizer.grantOnRequest = false;
      const engine = createRecognizerEngine({ module: recognizer, apiLevel: 33 });
      await engine.start(config, sinkLog().sink).catch(() => undefined);
      recognizer.grantOnRequest = true;
      await engine.start(config, sinkLog().sink);
      expect(recognizer.starts).toHaveLength(1);
    });

    test.each([
      ['no recogniser at all', { available: false }],
      ['no on-device recogniser (it would use the cloud service)', { onDevice: false }],
    ])('with %s the engine is unavailable and starts nothing', async (_name, change) => {
      const recognizer = Object.assign(new FakeRecognizer(), change);

      const started = createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, sinkLog().sink);

      await expect(started).rejects.toMatchObject({ error: { kind: 'transcriptionUnavailable' } });
      expect(recognizer.starts).toHaveLength(0);
      expect(recognizer.listenerCount).toBe(0);
    });

    test('a recogniser that throws on start rejects with an audio session failure and leaves nothing listening', async () => {
      const recognizer = new FakeRecognizer();
      const cause = new Error('bind to recognition service failed');
      recognizer.startError = cause;

      const started = createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, sinkLog().sink);

      await expect(started).rejects.toBeInstanceOf(AppFailure);
      await expect(started).rejects.toMatchObject({ error: { kind: 'audioSessionFailed', cause } });
      expect(recognizer.listenerCount).toBe(0);
    });

    test('a start without a stop drops the earlier listeners', async () => {
      const recognizer = new FakeRecognizer();
      const engine = createRecognizerEngine({ module: recognizer, apiLevel: 33 });
      const first = sinkLog();
      const second = sinkLog();
      await engine.start(config, first.sink);
      await engine.start(config, second.sink);

      recognizer.end();

      expect(recognizer.listenerCount).toBe(3);
      expect(first.failures).toHaveLength(0);
      expect(second.failures).toHaveLength(1);
    });

    test.each([
      ['Android 12', 32],
      ['Android 11', 30],
      ['an iOS version string', '26.0'],
      ['a version string that would pass a numeric comparison', '40.0'],
    ])('on %s it is unavailable, because the recogniser would not be bound to the device', async (_name, apiLevel) => {
      const recognizer = new FakeRecognizer();

      const started = createRecognizerEngine({ module: recognizer, apiLevel }).start(config, sinkLog().sink);

      await expect(started).rejects.toMatchObject({ error: { kind: 'transcriptionUnavailable' } });
      expect(recognizer.starts).toHaveLength(0);
      expect(recognizer.permissionChecks).toBe(0); // no microphone prompt for something that cannot work
      expect(recognizer.listenerCount).toBe(0);
    });

    test('Android 13 is the first API level that qualifies', async () => {
      expect(MIN_ON_DEVICE_API_LEVEL).toBe(33);
      const recognizer = new FakeRecognizer();
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, sinkLog().sink);
      expect(recognizer.starts).toHaveLength(1);
    });

    test('availability is checked before the microphone is asked for', async () => {
      const recognizer = new FakeRecognizer();
      recognizer.granted = false;
      recognizer.onDevice = false;
      await createRecognizerEngine({ module: recognizer, apiLevel: 34 })
        .start(config, sinkLog().sink)
        .catch(() => undefined);
      expect(recognizer.permissionChecks).toBe(0);
      expect(recognizer.permissionRequests).toBe(0);
    });

    test('takes the API level from the platform when none is given', async () => {
      jest.spyOn(Platform, 'Version', 'get').mockReturnValue(32);
      // Android 12: unavailable before the default module is asked about the microphone.
      await expect(createRecognizerEngine().start(config, sinkLog().sink)).rejects.toMatchObject({
        error: { kind: 'transcriptionUnavailable' },
      });
      expect(ExpoSpeechRecognitionModule.getPermissionsAsync).not.toHaveBeenCalled();
    });

    test('uses the expo-speech-recognition module and the platform API level unless they are given', async () => {
      jest.spyOn(Platform, 'Version', 'get').mockReturnValue(34);
      // The mocked module refuses the microphone, which only the default module can be asked.
      await expect(createRecognizerEngine().start(config, sinkLog().sink)).rejects.toMatchObject({
        error: { kind: 'microphonePermissionDenied' },
      });
      expect(ExpoSpeechRecognitionModule.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('results', () => {
    test('a partial result is a volatile line', async () => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, log.sink);

      recognizer.result(false, 'tower');

      expect(log.results).toEqual([{ text: 'tower', isFinal: false, runs: [], range: null }]);
    });

    test('a final result spans from the first partial of its utterance to the final, in seconds from the start', async () => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      let now = 1_000_000;
      await createRecognizerEngine({ module: recognizer, apiLevel: 33, now: () => now }).start(config, log.sink);

      now += 1500;
      recognizer.result(false, 'cleared');
      now += 1750;
      recognizer.result(true, 'cleared for takeoff', 0.82);

      expect(log.results[1]).toEqual({
        text: 'cleared for takeoff',
        isFinal: true,
        runs: [{ text: 'cleared for takeoff', confidence: 0.82, start: 1.5, end: 3.25 }],
        range: { start: 1.5, end: 3.25 },
      });
    });

    test('the next utterance starts at its own first partial', async () => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      let now = 0;
      await createRecognizerEngine({ module: recognizer, apiLevel: 33, now: () => now }).start(config, log.sink);
      now = 1000;
      recognizer.result(true, 'one');
      now = 10_000;
      recognizer.result(false, 'two');
      now = 11_000;
      recognizer.result(true, 'two');

      expect(log.results[2]?.range).toEqual({ start: 10, end: 11 });
    });

    test('a final result with no partial before it starts and ends together', async () => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      let now = 0;
      await createRecognizerEngine({ module: recognizer, apiLevel: 33, now: () => now }).start(config, log.sink);
      now = 2000;
      recognizer.result(true, 'roger');
      expect(log.results[0]?.range).toEqual({ start: 2, end: 2 });
    });

    test.each([
      [0.5, 0.5],
      [0, 0],
      [1, 1],
      [-1, null],
      [1.5, null],
      [Number.NaN, null],
    ])('confidence %s is reported as %s', async (confidence, expected) => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, log.sink);
      recognizer.result(true, 'x', confidence);
      expect(log.results[0]?.runs[0]?.confidence).toBe(expected);
    });

    test('a result with no alternatives or only blank text is ignored', async () => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, log.sink);

      recognizer.resultEvent({ isFinal: true, results: [] });
      recognizer.result(true, '   ');
      recognizer.result(false, '');

      expect(log.results).toHaveLength(0);
    });
  });

  describe('failures', () => {
    test.each([
      ['not-allowed', 'fatal'],
      ['service-not-allowed', 'fatal'],
      ['language-not-supported', 'fatal'],
      ['bad-grammar', 'fatal'],
      ['no-speech', 'ended'],
      ['speech-timeout', 'ended'],
      ['audio-capture', 'transient'],
      ['interrupted', 'transient'],
      ['busy', 'transient'],
      ['client', 'transient'],
      ['network', 'transient'],
      ['too-many-requests', 'transient'],
      ['unknown', 'transient'],
      ['a-code-from-a-newer-version', 'transient'],
    ])('the error %s is %s', async (code, kind) => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, log.sink);

      recognizer.error(code, 'detail');

      expect(log.failures).toEqual([{ kind, message: `${code}: detail` }]);
    });

    test('our own abort is not a failure', async () => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, log.sink);
      recognizer.error('aborted');
      expect(log.failures).toHaveLength(0);
    });

    test('the end of a recogniser session is reported as ended', async () => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      await createRecognizerEngine({ module: recognizer, apiLevel: 33 }).start(config, log.sink);
      recognizer.end();
      expect(log.failures).toEqual([{ kind: 'ended', message: 'recognition ended' }]);
    });
  });

  describe('stop', () => {
    test('aborts the recogniser and stops delivering events', async () => {
      const recognizer = new FakeRecognizer();
      const log = sinkLog();
      const engine = createRecognizerEngine({ module: recognizer, apiLevel: 33 });
      await engine.start(config, log.sink);

      await engine.stop();
      recognizer.result(true, 'late');
      recognizer.end();

      expect(recognizer.aborts).toBe(1);
      expect(recognizer.listenerCount).toBe(0);
      expect(log.results).toHaveLength(0);
      expect(log.failures).toHaveLength(0);
    });

    test('does not reject when the abort throws', async () => {
      const recognizer = new FakeRecognizer();
      recognizer.abortError = new Error('not running');
      await expect(createRecognizerEngine({ module: recognizer, apiLevel: 33 }).stop()).resolves.toBeUndefined();
    });
  });
});

describe('with TranscriptionSession', () => {
  test('an utterance after a restart is placed by wall-clock time since the flight started', async () => {
    const recognizer = new FakeRecognizer();
    const rows: TranscriptSegment[] = [];
    const clock = new FakeClock();
    const session = new TranscriptionSession({
      engine: createRecognizerEngine({ module: recognizer, apiLevel: 33, now: () => clock.now() }),
      store: { insertTranscript: async (segment) => void rows.push(segment) },
      clock,
    });
    await session.startTranscription('flight-1');

    await clock.advance(5000);
    recognizer.end(); // the first recogniser session ran out
    await clock.advance(ENDED_RESTART_DELAY_MS);
    expect(recognizer.starts).toHaveLength(2);

    await clock.advance(1000);
    recognizer.result(false, 'tower');
    await clock.advance(1500);
    recognizer.result(true, 'tower runway two seven left', 0.9);
    await flush();

    // The second session began 5.25 s into the flight; the utterance ran from 1.0 s to 2.5 s of it.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.audioStartTime).toBe(6.25);
    expect(rows[0]?.audioEndTime).toBe(7.75);
    expect(rows[0]?.text).toBe('tower Runway 27L');
  });
});
