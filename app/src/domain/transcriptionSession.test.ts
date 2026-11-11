// Port of efb-212Tests/ServiceTests/TranscriptionServiceTests.swift (8 cases, same names and values) over the real
// recording database on Node's sqlite and a fake speech engine; then the behaviour the Swift service did not have:
// restarts, give-up rules, races between start, stop and restart, and failing collaborators (docs/port-notes/A3.md).
import { openNodeSqliteDb } from '../../tests/support/nodeSqliteDb';
import { openRecordingDatabase, type RecordingDatabase } from '../data/recording';
import { AppFailure, type AppError } from './errors';
import {
  FakeSpeechEngine,
  segmentMetrics,
  type SpeechResult,
  type SpeechRun,
  type SpeechSink,
  type TranscriptDisplayItem,
} from './ports/speech';
import { FakeClock, flush } from './recording/testSupport';
import type { TranscriptionServiceLike } from './recording/collaborators';
import type { FlightPhaseType } from './recording/types';
import {
  ENDED_RESTART_DELAY_MS,
  ERROR_RESTART_DELAY_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_ERROR_RESTART_DELAY_MS,
  RAPID_END_MS,
  STABLE_AFTER_MS,
  TranscriptionSession,
} from './transcriptionSession';

const FLIGHT = '11111111-1111-4111-8111-111111111111';

let idCounter = 0;
const newId = (): string => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;

const final = (text: string, start = 0, end = 1, confidence: number | null = 0.9): SpeechResult => ({
  text,
  isFinal: true,
  runs: [{ text, confidence, start, end }],
  range: { start, end },
});

const volatile = (text: string): SpeechResult => ({ text, isFinal: false, runs: [], range: null });

interface Fixture {
  rdb: RecordingDatabase;
  engine: FakeSpeechEngine;
  clock: FakeClock;
  session: TranscriptionSession;
  lines: TranscriptDisplayItem[];
  errors: AppError[];
}

async function fixture(): Promise<Fixture> {
  const rdb = await openRecordingDatabase(openNodeSqliteDb());
  const engine = new FakeSpeechEngine();
  const clock = new FakeClock();
  const session = new TranscriptionSession({ engine, store: rdb, clock, newId });
  const lines: TranscriptDisplayItem[] = [];
  const errors: AppError[] = [];
  session.setOnTranscriptUpdate((item) => lines.push(item));
  session.setOnError((error) => errors.push(error));
  return { rdb, engine, clock, session, lines, errors };
}

const stored = async (f: Fixture) => f.rdb.transcriptSegments(FLIGHT);

/** The engine listened for a while, then ended, as a recogniser does after an utterance or a silence. */
async function endNormally(f: Fixture, sink: SpeechSink = f.engine.sink): Promise<void> {
  await f.clock.advance(RAPID_END_MS);
  sink.failure({ kind: 'ended', message: 'recognition ended' });
}

/** Holds the engine's next start open until the returned function is called. */
function holdStart(f: Fixture): () => void {
  const { promise, resolve } = Promise.withResolvers<void>();
  f.engine.startGate = promise;
  return resolve;
}

describe('TranscriptionService Tests', () => {
  test('initialStateNotTranscribing', async () => {
    const f = await fixture();
    expect(f.session.isTranscribing).toBe(false);
  });

  test('vocabularyProcessorIntegrated', async () => {
    const f = await fixture();
    await f.session.startTranscription(FLIGHT);

    f.engine.sink.result(final('november seven three two papa squawk one two zero zero'));
    await flush();

    const [segment] = await stored(f);
    expect(segment?.text).toContain('N732P');
    expect(segment?.text).toContain('1200');
  });

  test('onlyFinalSegmentsStoredToGRDB', async () => {
    const f = await fixture();
    f.session.setCurrentPhaseProvider(() => 'cruise');
    await f.session.startTranscription(FLIGHT);

    // A volatile result is for the screen only.
    f.engine.sink.result(volatile('n732p contact'));
    await flush();
    expect(await stored(f)).toHaveLength(0);

    await f.session.recordFinalSegment('N732P contact tower 123.45', {
      confidence: 0.95,
      audioStartTime: 10,
      audioEndTime: 15,
    });

    const segments = await stored(f);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe('N732P contact tower 123.45');
    expect(segments[0]?.confidence).toBe(0.95);
    expect(segments[0]?.flightPhase).toBe('cruise');
  });

  test('finalSegmentsAreTaggedWithProvidedPhase', async () => {
    const f = await fixture();
    f.engine.startError = new AppFailure({ kind: 'transcriptionUnavailable' }); // Swift: start may throw on hosts without Speech
    f.session.setCurrentPhaseProvider(() => 'approach');

    await f.session.startTranscription(FLIGHT).catch(() => undefined);
    await f.session.recordFinalSegment('Tower, N732P, five mile final', {
      confidence: 0.8,
      audioStartTime: 12,
      audioEndTime: 15,
    });

    const segments = await stored(f);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.flightPhase).toBe('approach');
    expect(segments[0]?.audioStartTime).toBe(12);
    expect(segments[0]?.audioEndTime).toBe(15);
    expect(segments[0]?.confidence).toBe(0.8);

    await f.session.stopTranscription();
  });

  test('phaseProviderIsReadPerSegmentNotAtStart', async () => {
    const f = await fixture();
    let phase: FlightPhaseType = 'preflight';
    f.session.setCurrentPhaseProvider(() => phase);
    await f.session.startTranscription(FLIGHT);

    phase = 'taxi';
    await f.session.recordFinalSegment('ground, taxi to two eight left', {
      confidence: 0.9,
      audioStartTime: 1,
      audioEndTime: 3,
    });
    phase = 'cruise';
    await f.session.recordFinalSegment('level at four thousand five hundred', {
      confidence: 0.9,
      audioStartTime: 600,
      audioEndTime: 603,
    });

    expect((await stored(f)).map((s) => s.flightPhase)).toEqual(['taxi', 'cruise']);
    await f.session.stopTranscription();
  });

  test('missingProviderDefaultsToPreflightNotCruise', async () => {
    const f = await fixture();
    await f.session.startTranscription(FLIGHT);
    await f.session.recordFinalSegment('test', { confidence: 0.5, audioStartTime: 0, audioEndTime: 1 });

    expect((await stored(f))[0]?.flightPhase).toBe('preflight');
    await f.session.stopTranscription();
  });

  // The two Swift cases build AttributedStrings; the engine hands the same attributes over as runs.
  test('metricsUseAttributedConfidenceAndTimeRange', () => {
    const runs: SpeechRun[] = [
      { text: 'cleared ', confidence: 1.0, start: 10, end: 11 },
      { text: 'takeoff', confidence: 0.5, start: 11, end: 12.5 },
    ];

    const metrics = segmentMetrics(runs, null);

    // Length-weighted: 8 chars at 1.0, 7 chars at 0.5 -> (8 + 3.5) / 15
    expect(metrics.confidence).toBeCloseTo(11.5 / 15, 3);
    expect(metrics.audioStartTime).toBe(10);
    expect(metrics.audioEndTime).toBe(12.5);
  });

  test('metricsMarkConfidenceUnknownWhenAbsent', () => {
    const runs: SpeechRun[] = [{ text: 'no attributes here', confidence: null, start: null, end: null }];

    const metrics = segmentMetrics(runs, { start: 4, end: 6 });

    expect(metrics.confidence).toBeNull(); // unknown is null, not a sentinel
    expect(metrics.audioStartTime).toBe(4);
    expect(metrics.audioEndTime).toBe(6);
  });
});

describe('segmentMetrics', () => {
  test('uses the result range only when no run has a time range', () => {
    const runs: SpeechRun[] = [{ text: 'a', confidence: 1, start: 2, end: 3 }];
    expect(segmentMetrics(runs, { start: 0, end: 9 })).toMatchObject({ audioStartTime: 2, audioEndTime: 3 });
  });

  test('is 0 to 0 with no runs and no range', () => {
    expect(segmentMetrics([], null)).toEqual({ confidence: null, audioStartTime: 0, audioEndTime: 0 });
  });

  test('skips runs without text or confidence when averaging', () => {
    const runs: SpeechRun[] = [
      { text: '', confidence: 0.1, start: null, end: null },
      { text: 'ab', confidence: 0.8, start: null, end: null },
      { text: 'cdef', confidence: null, start: null, end: null },
    ];
    expect(segmentMetrics(runs, null).confidence).toBeCloseTo(0.8, 6);
  });

  test('ignores a run with only one end of its range', () => {
    const runs: SpeechRun[] = [{ text: 'a', confidence: 1, start: 5, end: null }];
    expect(segmentMetrics(runs, { start: 1, end: 2 })).toMatchObject({ audioStartTime: 1, audioEndTime: 2 });
  });

  test('counts a character once however many UTF-16 units it takes', () => {
    const runs: SpeechRun[] = [
      { text: '\u{1F6EB}', confidence: 1, start: null, end: null },
      { text: 'ab', confidence: 0.4, start: null, end: null },
    ];
    expect(segmentMetrics(runs, null).confidence).toBeCloseTo((1 + 0.8) / 3, 6);
  });
});

describe('TranscriptionSession', () => {
  test('is a TranscriptionServiceLike the recording coordinator can use', async () => {
    const f = await fixture();
    const service: TranscriptionServiceLike = f.session;
    expect(typeof service.setCurrentPhaseProvider).toBe('function');
  });

  describe('start and stop', () => {
    test('listens with the English locale, the aviation terms and the region terms', async () => {
      const f = await fixture();
      f.session.setRegionVocabulary(['SHARON', 'NESHER']);
      await f.session.startTranscription(FLIGHT);

      expect(f.engine.starts).toHaveLength(1);
      expect(f.engine.starts[0]?.locale).toBe('en-US');
      expect(f.engine.starts[0]?.aviationTerms).toHaveLength(24);
      expect(f.engine.starts[0]?.regionTerms).toEqual(['SHARON', 'NESHER']);
      expect(f.session.isTranscribing).toBe(true);
    });

    test('takes region terms at the next start, not mid-flight', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.session.setRegionVocabulary(['SHARON']);
      expect(f.engine.starts[0]?.regionTerms).toEqual([]);
      await f.session.stopTranscription();
      await f.session.startTranscription(FLIGHT);
      expect(f.engine.starts[1]?.regionTerms).toEqual(['SHARON']);
    });

    test('stop releases the engine and clears the flight', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      await f.session.stopTranscription();

      expect(f.session.isTranscribing).toBe(false);
      expect(f.engine.stopCount).toBe(1);
      await f.session.recordFinalSegment('after stop', { confidence: 1, audioStartTime: 0, audioEndTime: 1 });
      expect(await stored(f)).toHaveLength(0);
    });

    test('a start the engine rejects rejects, stops the engine again and leaves nothing transcribing', async () => {
      const f = await fixture();
      const failure = new AppFailure({ kind: 'microphonePermissionDenied' });
      f.engine.startError = failure;

      await expect(f.session.startTranscription(FLIGHT)).rejects.toBe(failure);

      expect(f.session.isTranscribing).toBe(false);
      expect(f.engine.stopCount).toBe(1);
    });

    test('a second start without a stop releases the first engine before starting the next', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      const firstSink = f.engine.sink;

      await f.session.startTranscription('22222222-2222-4222-8222-222222222222');

      expect(f.engine.stopCount).toBe(1);
      expect(f.engine.starts).toHaveLength(2);
      firstSink.result(final('from the first engine'));
      await flush();
      expect(await stored(f)).toHaveLength(0);
      expect(await f.rdb.transcriptSegments('22222222-2222-4222-8222-222222222222')).toHaveLength(0);
    });

    test('stop is safe when nothing was started', async () => {
      const f = await fixture();
      await expect(f.session.stopTranscription()).resolves.toBeUndefined();
    });

    test('stop does not reject when the engine does', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.engine.stop = () => Promise.reject(new Error('audio session gone'));
      await expect(f.session.stopTranscription()).resolves.toBeUndefined();
      expect(f.session.isTranscribing).toBe(false);
    });
  });

  describe('results', () => {
    test('a volatile result reaches the screen with the vocabulary applied and is not stored', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);

      f.engine.sink.result(volatile('squawk one two zero zero'));
      await flush();

      expect(f.lines).toHaveLength(1);
      expect(f.lines[0]).toMatchObject({ text: 'Squawk 1200', isVolatile: true });
      expect(await stored(f)).toHaveLength(0);
    });

    test('a final result is stored, then shown as a settled line', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);

      f.engine.sink.result(final('runway two seven left', 3, 4.5, 0.7));
      await flush();

      const [segment] = await stored(f);
      expect(segment).toMatchObject({ text: 'Runway 27L', confidence: 0.7, flightID: FLIGHT });
      expect(f.lines).toHaveLength(1);
      expect(f.lines[0]).toMatchObject({ text: 'Runway 27L', isVolatile: false });
      expect(f.lines[0]?.id).not.toBe(segment?.id);
    });

    test('stored times are placed on the timeline that started when startTranscription was called', async () => {
      const f = await fixture();
      const release = holdStart(f);
      const starting = f.session.startTranscription(FLIGHT);
      await f.clock.advance(2000); // the engine took two seconds to get going
      release();
      await starting;

      f.engine.sink.result(final('cleared for takeoff', 1, 2.5));
      await flush();

      const [segment] = await stored(f);
      expect(segment?.audioStartTime).toBe(3);
      expect(segment?.audioEndTime).toBe(4.5);
    });

    test('a final line with no time range at all lands at the start of the engine time', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.engine.sink.result({ text: 'hello', isFinal: true, runs: [], range: null });
      await flush();
      expect((await stored(f))[0]).toMatchObject({ confidence: null, audioStartTime: 0, audioEndTime: 0 });
    });

    test('a result with no flight to belong to (after stop) is dropped', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      const sink = f.engine.sink;
      await f.session.stopTranscription();

      sink.result(final('late'));
      sink.result(volatile('late'));
      await flush();

      expect(await stored(f)).toHaveLength(0);
      expect(f.lines).toHaveLength(0);
    });
  });

  describe('failing collaborators', () => {
    test('a store that rejects loses that segment only; the line still reaches the screen', async () => {
      const f = await fixture();
      const insert = jest.spyOn(f.rdb, 'insertTranscript').mockRejectedValueOnce(new Error('database is locked'));
      await f.session.startTranscription(FLIGHT);

      f.engine.sink.result(final('first'));
      f.engine.sink.result(final('second'));
      await flush();

      expect(insert).toHaveBeenCalledTimes(2);
      expect((await stored(f)).map((s) => s.text)).toEqual(['second']);
      expect(f.lines.map((l) => l.text)).toEqual(['first', 'second']);
    });

    test('a store that throws synchronously is treated the same', async () => {
      const f = await fixture();
      jest.spyOn(f.rdb, 'insertTranscript').mockImplementationOnce(() => {
        throw new Error('closed');
      });
      await f.session.startTranscription(FLIGHT);

      f.engine.sink.result(final('first'));
      await flush();

      expect(f.lines.map((l) => l.text)).toEqual(['first']);
    });

    test('a phase provider that throws tags the segment preflight instead of losing it', async () => {
      const f = await fixture();
      f.session.setCurrentPhaseProvider(() => {
        throw new Error('tracker released');
      });
      await f.session.startTranscription(FLIGHT);
      await f.session.recordFinalSegment('x', { confidence: 1, audioStartTime: 0, audioEndTime: 1 });
      expect((await stored(f))[0]?.flightPhase).toBe('preflight');
    });

    test('a screen callback that throws does not stop transcription', async () => {
      const f = await fixture();
      f.session.setOnTranscriptUpdate(() => {
        throw new Error('view unmounted');
      });
      await f.session.startTranscription(FLIGHT);

      f.engine.sink.result(volatile('a'));
      f.engine.sink.result(final('b'));
      f.engine.sink.result(final('c'));
      await flush();

      expect((await stored(f)).map((s) => s.text)).toEqual(['b', 'c']);
    });

    test('clearing the provider and the callback with null works', async () => {
      const f = await fixture();
      f.session.setCurrentPhaseProvider(() => 'cruise');
      f.session.setCurrentPhaseProvider(null);
      f.session.setOnTranscriptUpdate(null);
      await f.session.startTranscription(FLIGHT);
      f.engine.sink.result(final('x'));
      await flush();
      expect((await stored(f))[0]?.flightPhase).toBe('preflight');
      expect(f.lines).toHaveLength(0);
    });
  });

  describe('when the engine stops by itself', () => {
    test('an engine that ended normally listens again after a short wait, on the same timeline', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      await f.clock.advance(10_000);
      f.engine.sink.failure({ kind: 'ended', message: 'recognition ended' });
      await flush();
      expect(f.engine.starts).toHaveLength(1); // not before the wait

      await f.clock.advance(ENDED_RESTART_DELAY_MS);

      expect(f.engine.stopCount).toBe(1);
      expect(f.engine.starts).toHaveLength(2);
      f.engine.sink.result(final('after the restart', 0, 1));
      await flush();
      // The new engine zeroed at 10.25 s into the flight.
      expect((await stored(f))[0]?.audioStartTime).toBe(10.25);
      expect(f.session.isTranscribing).toBe(true);
    });

    test('keeps the region terms through a restart', async () => {
      const f = await fixture();
      f.session.setRegionVocabulary(['SHARON']);
      await f.session.startTranscription(FLIGHT);
      await endNormally(f);
      await f.clock.advance(ENDED_RESTART_DELAY_MS);
      expect(f.engine.starts[1]?.regionTerms).toEqual(['SHARON']);
    });

    test('events of the engine that was restarted are dropped', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      const first = f.engine.sink;
      await endNormally(f, first);
      await f.clock.advance(ENDED_RESTART_DELAY_MS);

      first.result(final('stale'));
      first.failure({ kind: 'fatal', message: 'stale' });
      await flush();

      expect(await stored(f)).toHaveLength(0);
      expect(f.session.isTranscribing).toBe(true);
      expect(f.errors).toEqual([]);
    });

    test('an error and the end that follows it are one incident: one restart', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.engine.sink.failure({ kind: 'transient', message: 'audio-capture' });
      f.engine.sink.failure({ kind: 'ended', message: 'end' });
      await f.clock.advance(ERROR_RESTART_DELAY_MS);
      expect(f.engine.starts).toHaveLength(2);
    });

    test('waits longer after each consecutive failure, up to a ceiling', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      const waits: number[] = [];
      for (let i = 1; i <= MAX_CONSECUTIVE_FAILURES; i += 1) {
        const before = f.engine.starts.length;
        f.engine.sink.failure({ kind: 'transient', message: 'busy' });
        const expected = Math.min(ERROR_RESTART_DELAY_MS * 2 ** (i - 1), MAX_ERROR_RESTART_DELAY_MS);
        await f.clock.advance(expected - 1);
        expect(f.engine.starts).toHaveLength(before); // not a millisecond early
        await f.clock.advance(1);
        expect(f.engine.starts).toHaveLength(before + 1);
        waits.push(expected);
      }
      expect(waits).toEqual([500, 1000, 2000, 4000, 8000]);
    });

    test('gives up after too many consecutive failures, releases the engine and says so', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i += 1) {
        f.engine.sink.failure({ kind: 'transient', message: 'busy' });
        await f.clock.advance(MAX_ERROR_RESTART_DELAY_MS);
      }
      const startsBefore = f.engine.starts.length;
      const stopsBefore = f.engine.stopCount;

      f.engine.sink.failure({ kind: 'transient', message: 'busy' });
      await flush();

      expect(f.errors).toEqual([{ kind: 'transcriptionUnavailable' }]);
      expect(f.session.isTranscribing).toBe(false);
      expect(f.engine.stopCount).toBe(stopsBefore + 1);
      await f.clock.advance(60_000);
      expect(f.engine.starts).toHaveLength(startsBefore); // no further restart
    });

    test('a result between failures resets the count', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES * 2; i += 1) {
        f.engine.sink.failure({ kind: 'transient', message: 'busy' });
        await f.clock.advance(ERROR_RESTART_DELAY_MS); // always the first-failure wait, or the count did not reset
        expect(f.engine.starts).toHaveLength(i + 2);
        f.engine.sink.result(volatile('radio check'));
      }
      expect(f.errors).toEqual([]);
      expect(f.session.isTranscribing).toBe(true);
    });

    test('an engine that ran for a while before failing starts the count again', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES * 2; i += 1) {
        await f.clock.advance(STABLE_AFTER_MS); // quiet cockpit, healthy engine
        f.engine.sink.failure({ kind: 'transient', message: 'route changed' });
        await f.clock.advance(ERROR_RESTART_DELAY_MS);
      }
      expect(f.errors).toEqual([]);
      expect(f.session.isTranscribing).toBe(true);
    });

    test('an engine that ends normally never counts as failing', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES * 3; i += 1) {
        await endNormally(f);
        await f.clock.advance(ENDED_RESTART_DELAY_MS);
      }
      expect(f.errors).toEqual([]);
      expect(f.engine.starts).toHaveLength(MAX_CONSECUTIVE_FAILURES * 3 + 1);
    });

    test('an engine that ends at once, hearing nothing, is failing: it backs off and then gives up', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      const waits: number[] = [];
      for (let i = 1; i <= MAX_CONSECUTIVE_FAILURES; i += 1) {
        const before = f.engine.starts.length;
        f.engine.sink.failure({ kind: 'ended', message: 'ended at once' });
        const expected = Math.min(ERROR_RESTART_DELAY_MS * 2 ** (i - 1), MAX_ERROR_RESTART_DELAY_MS);
        await f.clock.advance(expected - 1);
        expect(f.engine.starts).toHaveLength(before); // the short ended-wait would have restarted by now
        await f.clock.advance(1);
        expect(f.engine.starts).toHaveLength(before + 1);
        waits.push(expected);
      }
      expect(waits).toEqual([500, 1000, 2000, 4000, 8000]);

      f.engine.sink.failure({ kind: 'ended', message: 'ended at once' });
      await flush();

      expect(f.errors).toEqual([{ kind: 'transcriptionUnavailable' }]);
      expect(f.session.isTranscribing).toBe(false);
    });

    test('what an earlier engine heard does not excuse the next one ending at once', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.engine.sink.result(volatile('roger'));
      await endNormally(f);
      await f.clock.advance(ENDED_RESTART_DELAY_MS);
      expect(f.engine.starts).toHaveLength(2);

      f.engine.sink.failure({ kind: 'ended', message: 'ended at once' }); // the new engine heard nothing

      await f.clock.advance(ENDED_RESTART_DELAY_MS); // the short wait of a normal end would restart by now
      expect(f.engine.starts).toHaveLength(2);
      await f.clock.advance(ERROR_RESTART_DELAY_MS - ENDED_RESTART_DELAY_MS);
      expect(f.engine.starts).toHaveLength(3);
    });

    test('an end that comes after the engine heard something is a normal end, however soon', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES * 2; i += 1) {
        f.engine.sink.result(volatile('roger')); // heard, so the end that follows is not a failure
        f.engine.sink.failure({ kind: 'ended', message: 'utterance done' });
        await f.clock.advance(ENDED_RESTART_DELAY_MS);
        expect(f.engine.starts).toHaveLength(i + 2);
      }
      expect(f.errors).toEqual([]);
    });

    test('an end at least RAPID_END_MS after the engine started is a normal end even when nothing was heard', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES * 2; i += 1) {
        await f.clock.advance(RAPID_END_MS); // a silent cockpit: the recogniser times out
        f.engine.sink.failure({ kind: 'ended', message: 'silence' });
        await f.clock.advance(ENDED_RESTART_DELAY_MS);
        expect(f.engine.starts).toHaveLength(i + 2);
      }
      expect(f.errors).toEqual([]);
    });

    test('a fatal failure gives up at once, with no restart', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);

      f.engine.sink.failure({ kind: 'fatal', message: 'permission withdrawn' });
      await f.clock.advance(60_000);

      expect(f.errors).toEqual([{ kind: 'transcriptionUnavailable' }]);
      expect(f.session.isTranscribing).toBe(false);
      expect(f.engine.starts).toHaveLength(1);
      expect(f.engine.stopCount).toBe(1);
    });

    test('a fatal failure is not lost while a restart is in progress', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      await endNormally(f);
      f.engine.sink.failure({ kind: 'fatal', message: 'recogniser removed' });
      await f.clock.advance(ENDED_RESTART_DELAY_MS);
      expect(f.errors).toEqual([{ kind: 'transcriptionUnavailable' }]);
      expect(f.engine.starts).toHaveLength(1);
    });

    test('a restart the engine rejects is tried again, and counted', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.engine.startErrors = [new Error('audio session busy')];

      await endNormally(f);
      await f.clock.advance(ENDED_RESTART_DELAY_MS); // restart #1 is rejected
      expect(f.engine.starts).toHaveLength(2);
      expect(f.session.isTranscribing).toBe(true);

      await f.clock.advance(ERROR_RESTART_DELAY_MS); // retried after the first-failure wait
      expect(f.engine.starts).toHaveLength(3);
      expect(f.errors).toEqual([]);
      f.engine.sink.result(final('back'));
      await flush();
      expect(await stored(f)).toHaveLength(1);
    });

    test('a restart refused with an AppFailure (permission, no recogniser) gives up at once', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.engine.startErrors = [new AppFailure({ kind: 'microphonePermissionDenied' })];

      await endNormally(f);
      await f.clock.advance(ENDED_RESTART_DELAY_MS);
      await f.clock.advance(60_000);

      expect(f.errors).toEqual([{ kind: 'transcriptionUnavailable' }]);
      expect(f.session.isTranscribing).toBe(false);
      expect(f.engine.starts).toHaveLength(2);
    });

    test('a restart that fails with an audio session error is tried again, not given up on', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.engine.startErrors = [new AppFailure({ kind: 'audioSessionFailed', cause: new Error('engine did not start') })];

      await endNormally(f);
      await f.clock.advance(ENDED_RESTART_DELAY_MS);
      await f.clock.advance(ERROR_RESTART_DELAY_MS);

      expect(f.engine.starts).toHaveLength(3);
      expect(f.errors).toEqual([]);
      expect(f.session.isTranscribing).toBe(true);
    });

    test('a listener that throws does not break giving up', async () => {
      const f = await fixture();
      f.session.setOnError(() => {
        throw new Error('listener bug');
      });
      await f.session.startTranscription(FLIGHT);
      f.engine.sink.failure({ kind: 'fatal', message: '' });
      await flush();
      expect(f.session.isTranscribing).toBe(false);
    });
  });

  describe('races between start, stop and restart', () => {
    test('stop while the engine is starting: the start finishes without transcribing, and the engine is released', async () => {
      const f = await fixture();
      const release = holdStart(f);
      const starting = f.session.startTranscription(FLIGHT);
      await flush();

      const stopping = f.session.stopTranscription();
      release();
      await starting;
      await stopping;

      expect(f.session.isTranscribing).toBe(false);
      expect(f.engine.stopCount).toBe(1);
    });

    test('a start still waiting its turn when stop is called never starts the engine', async () => {
      const f = await fixture();
      const release = holdStart(f);
      const first = f.session.startTranscription(FLIGHT);
      await flush(); // the first start is now inside the engine
      const queued = f.session.startTranscription('22222222-2222-4222-8222-222222222222');
      const stopping = f.session.stopTranscription();
      release();
      await Promise.all([first, queued, stopping]);

      expect(f.engine.starts).toHaveLength(1); // only the first reached the engine
      expect(f.session.isTranscribing).toBe(false);
    });

    test('a start called after a stop is not cancelled by it', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      const stopping = f.session.stopTranscription();
      const starting = f.session.startTranscription('22222222-2222-4222-8222-222222222222');
      await Promise.all([stopping, starting]);

      expect(f.session.isTranscribing).toBe(true);
      expect(f.engine.starts).toHaveLength(2);
    });

    test('stop while a restart is waiting cancels it', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.engine.sink.failure({ kind: 'transient', message: 'busy' });
      await f.session.stopTranscription();

      await f.clock.advance(60_000);

      expect(f.engine.starts).toHaveLength(1);
      expect(f.session.isTranscribing).toBe(false);
    });

    test('stop while a restart is still stopping the old engine: the new engine is never started', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      const { promise: slowStop, resolve: finishStop } = Promise.withResolvers<void>();
      f.engine.stop = () => {
        f.engine.stopCount += 1;
        return slowStop;
      };
      await endNormally(f);
      await f.clock.advance(ENDED_RESTART_DELAY_MS); // the restart now waits for the old engine to stop

      const stopping = f.session.stopTranscription();
      finishStop();
      await stopping;

      expect(f.engine.starts).toHaveLength(1);
      expect(f.session.isTranscribing).toBe(false);
    });

    test('stop while a restart is starting the engine: the restart finishes, the engine is released', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      await endNormally(f);
      const release = holdStart(f); // holds the restart's start open
      await f.clock.advance(ENDED_RESTART_DELAY_MS);
      expect(f.engine.starts).toHaveLength(2);

      const stopping = f.session.stopTranscription();
      release();
      await stopping;

      expect(f.session.isTranscribing).toBe(false);
      // Two stops: the restart stopped the old engine before starting, and the queued stop released the new one.
      expect(f.engine.stopCount).toBe(2);
      f.engine.sink.result(final('too late'));
      await flush();
      expect(await stored(f)).toHaveLength(0);
    });

    test('a new flight started during a restart wait takes over cleanly', async () => {
      const f = await fixture();
      await f.session.startTranscription(FLIGHT);
      f.engine.sink.failure({ kind: 'transient', message: 'busy' });
      await f.session.startTranscription('22222222-2222-4222-8222-222222222222'); // the old run's restart is now stale

      await f.clock.advance(60_000);

      expect(f.engine.starts).toHaveLength(2); // the stale restart did not start a third
      expect(f.session.isTranscribing).toBe(true);
    });
  });
});
