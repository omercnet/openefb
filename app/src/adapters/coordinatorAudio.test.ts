import { openNodeSqliteDb } from '../../tests/support/nodeSqliteDb';
import { uuidv4 } from '../data/ids';
import { openRecordingDatabase } from '../data/recording';
import { AppFailure, type AppError } from '../domain/errors';
import { FakeAudioRecorder, interruptionGapText, type InterruptionGapReason } from '../domain/ports/audioRecorder';
import { FakeSpeechEngine } from '../domain/ports/speech';
import { RecordingCoordinator } from '../domain/recording/recordingCoordinator';
import { FakeClock, FakeTrackRecorder, flush } from '../domain/recording/testSupport';
import { TranscriptionSession } from '../domain/transcriptionSession';
import { asCoordinatorAudio, describeGapReason } from './coordinatorAudio';

const reasons: InterruptionGapReason[] = [
  { kind: 'phoneCall' },
  { kind: 'siri' },
  { kind: 'headphoneDisconnect' },
  { kind: 'other', detail: 'route changed' },
  { kind: 'other', detail: 'quote " and \\ backslash' },
];

describe('describeGapReason', () => {
  test.each(reasons)('%j prints what the coordinator wraps as the Swift gap text', (reason) => {
    expect(`[INTERRUPTION: ${describeGapReason(reason)}]`).toBe(interruptionGapText(reason));
  });

  test('is the Swift enum interpolation: bare case names, and other("detail")', () => {
    expect(describeGapReason({ kind: 'phoneCall' })).toBe('phoneCall');
    expect(describeGapReason({ kind: 'other', detail: 'x' })).toBe('other("x")');
  });
});

describe('asCoordinatorAudio', () => {
  test('start and stop go to the recorder with their arguments and results', async () => {
    const recorder = new FakeAudioRecorder();
    recorder.stopUri = 'file:///support/efb-212/recordings/F1.m4a';
    const audio = asCoordinatorAudio(recorder);

    await audio.startRecording('F1', 'high', 'file:///out.m4a');

    expect(recorder.startCalls).toEqual([{ flightId: 'F1', profile: 'high', outputUri: 'file:///out.m4a' }]);
    expect(await audio.stopRecording()).toBe('file:///support/efb-212/recordings/F1.m4a');
    expect(recorder.stopCallCount).toBe(1);
  });

  test('stop passes a null result through (nothing was recorded)', async () => {
    const recorder = new FakeAudioRecorder();
    recorder.stopUri = null;
    expect(await asCoordinatorAudio(recorder).stopRecording()).toBeNull();
  });

  test('a start the recorder rejects rejects with the same error', async () => {
    const recorder = new FakeAudioRecorder();
    const failure = new AppFailure({ kind: 'microphonePermissionDenied' });
    recorder.startError = failure;
    await expect(asCoordinatorAudio(recorder).startRecording('F1', 'standard', 'file:///x.m4a')).rejects.toBe(failure);
  });

  test('audioLevel reads the recorder every time it is read', () => {
    const recorder = new FakeAudioRecorder();
    const audio = asCoordinatorAudio(recorder);
    expect(audio.audioLevel).toBe(-160);
    recorder.level = -42;
    expect(audio.audioLevel).toBe(-42);
  });

  test('the gap hook receives the reason as printed text', () => {
    const recorder = new FakeAudioRecorder();
    const seen: string[] = [];
    asCoordinatorAudio(recorder).setOnInterruptionGap?.((reason) => seen.push(reason));

    recorder.emitInterruptionGap({ kind: 'phoneCall' });
    recorder.emitInterruptionGap({ kind: 'other', detail: 'x' });

    expect(seen).toEqual(['phoneCall', 'other("x")']);
  });

  test('the error hook receives the recorder error as it is', () => {
    const recorder = new FakeAudioRecorder();
    const seen: unknown[] = [];
    asCoordinatorAudio(recorder).setOnRecordingError?.((error) => seen.push(error));
    const error: AppError = { kind: 'recordingFailed', cause: new Error('disk full') };

    recorder.emitRecordingError(error);

    expect(seen).toEqual([error]);
    expect(seen[0]).toBe(error);
  });

  test('a later registration replaces the earlier one, as the coordinator re-registers on every start', () => {
    const recorder = new FakeAudioRecorder();
    const audio = asCoordinatorAudio(recorder);
    const first: string[] = [];
    const second: string[] = [];
    audio.setOnInterruptionGap?.((r) => first.push(r));
    audio.setOnInterruptionGap?.((r) => second.push(r));

    recorder.emitInterruptionGap({ kind: 'siri' });

    expect(first).toEqual([]);
    expect(second).toEqual(['siri']);
  });
});

describe('with RecordingCoordinator, TranscriptionSession and the recording database', () => {
  async function flight() {
    const rdb = await openRecordingDatabase(openNodeSqliteDb());
    const recorder = new FakeAudioRecorder();
    const engine = new FakeSpeechEngine();
    const clock = new FakeClock();
    const transcription = new TranscriptionSession({ engine, store: rdb, clock });
    const tracker = new FakeTrackRecorder();
    const coordinator = new RecordingCoordinator({
      recordingStore: {
        transcriptSegmentCount: async (id) => (await rdb.transcriptSegments(id)).length,
        insertTranscript: (segment) => rdb.insertTranscript({ ...segment, id: uuidv4(), timestamp: clock.now() }),
      },
      audioRecorder: asCoordinatorAudio(recorder),
      transcriptionService: transcription,
      makeTrackRecorder: () => tracker,
      audioFileURL: (id) => `file:///support/efb-212/recordings/${id}.m4a`,
      clock,
      newId: () => '11111111-1111-4111-8111-111111111111',
    });
    return { rdb, recorder, engine, transcription, tracker, coordinator, clock };
  }
  const FLIGHT = '11111111-1111-4111-8111-111111111111';

  test('starting a recording starts the recorder and the speech engine for the same flight', async () => {
    const f = await flight();
    await f.coordinator.startRecording();

    expect(f.recorder.startCalls.map((c) => c.flightId)).toEqual([FLIGHT]);
    expect(f.engine.starts).toHaveLength(1);
    expect(f.transcription.isTranscribing).toBe(true);
  });

  test('final segments are tagged with the live flight phase the coordinator wired in', async () => {
    const f = await flight();
    await f.coordinator.startRecording();
    f.tracker.currentPhase = 'cruise';

    f.engine.sink.result({
      text: 'level at four thousand five hundred',
      isFinal: true,
      runs: [{ text: 'level at four thousand five hundred', confidence: 0.9, start: 1, end: 4 }],
      range: { start: 1, end: 4 },
    });
    await flush();

    const [segment] = await f.rdb.transcriptSegments(FLIGHT);
    expect(segment).toMatchObject({ text: 'level at 4,500', flightPhase: 'cruise' });
  });

  test('an interruption gap becomes the Swift [INTERRUPTION: phoneCall] row, in the current phase', async () => {
    const f = await flight();
    await f.coordinator.startRecording();
    f.tracker.currentPhase = 'approach';

    f.recorder.emitInterruptionGap({ kind: 'phoneCall' });
    f.recorder.emitInterruptionGap({ kind: 'other', detail: 'x' });
    await flush();

    const rows = await f.rdb.transcriptSegments(FLIGHT);
    expect(rows.map((r) => r.text)).toEqual(['[INTERRUPTION: phoneCall]', '[INTERRUPTION: other("x")]']);
    expect(rows.map((r) => r.text)).toEqual(
      expect.arrayContaining([
        interruptionGapText({ kind: 'phoneCall' }),
        interruptionGapText({ kind: 'other', detail: 'x' }),
      ]),
    );
    expect(rows.every((r) => r.flightPhase === 'approach')).toBe(true);
  });

  test('a recorder failure stops the speech engine and surfaces the error', async () => {
    const f = await flight();
    await f.coordinator.startRecording();

    f.recorder.emitRecordingError({ kind: 'recordingFailed', cause: new Error('disk full') });
    await flush();

    expect(f.coordinator.state.lastError).toMatchObject({ kind: 'recordingFailed' });
    expect(f.transcription.isTranscribing).toBe(false);
    expect(f.engine.stopCount).toBe(1);
  });

  test('stopping the recording stops the recorder and the speech engine', async () => {
    const f = await flight();
    await f.coordinator.startRecording();

    const summary = await f.coordinator.stopRecording();

    expect(summary?.flightID).toBe(FLIGHT);
    expect(f.recorder.stopCallCount).toBe(1);
    expect(f.transcription.isTranscribing).toBe(false);
    expect(f.engine.stopCount).toBe(1);
  });

  test('a speech engine that cannot start does not stop the recording', async () => {
    const f = await flight();
    f.engine.startError = new AppFailure({ kind: 'transcriptionUnavailable' });

    await f.coordinator.startRecording();

    expect(f.coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
    expect(f.recorder.recording).toBe(true);
    expect(f.transcription.isTranscribing).toBe(false);
  });
});
