// The two usage counts of RecordingCoordinator.swift ("Recording.started" and "Recording.stopped" with the length bucket), which L4
// left out as plumbing (docs/port-notes/L4.md) and A5 adds. The Swift suites do not test them, so these are new.
import { FakeTelemetryStorage, FakeTelemetryTransport } from '../ports/telemetry';
import { Telemetry } from '../telemetry/telemetry';
import { RecordingCoordinator, type RecordingCoordinatorDeps } from './recordingCoordinator';
import {
  FakeClock,
  FakeRecordingStore,
  FakeTrackRecorder,
  MockAudioRecorder,
  MockTranscriptionService,
} from './testSupport';

type Signal = [event: string, params?: unknown];

function make(over: Partial<RecordingCoordinatorDeps> = {}) {
  const signals: Signal[] = [];
  const clock = new FakeClock();
  let n = 0;
  const coordinator = new RecordingCoordinator({
    recordingStore: new FakeRecordingStore(),
    audioRecorder: new MockAudioRecorder(),
    transcriptionService: new MockTranscriptionService(),
    makeTrackRecorder: () => new FakeTrackRecorder(),
    audioFileURL: (id) => `/rec/${id}.m4a`,
    clock,
    newId: () => `flight-${++n}`,
    telemetry: { signal: ((...args: Signal) => void signals.push(args)) as never },
    ...over,
  });
  return { coordinator, clock, signals };
}

const MINUTE = 60_000;

describe('Recording telemetry', () => {
  describe('Recording.started', () => {
    test('is counted once the recording is running', async () => {
      const { coordinator, signals } = make();
      const seen: unknown[] = [];
      const withStatus = make({
        telemetry: { signal: (() => seen.push(withStatus.coordinator.state.recordingStatus)) as never },
      });
      await withStatus.coordinator.startRecording();
      expect(seen).toEqual([{ kind: 'recording' }]);

      await coordinator.startRecording();
      expect(signals).toEqual([['Recording.started']]);
    });

    test('is counted after audio and transcription had their turn, whatever they did', async () => {
      const audio = new MockAudioRecorder();
      audio.startRecordingError = new Error('no microphone'); // Swift continues without audio
      const { coordinator, signals } = make({ audioRecorder: audio });
      await coordinator.startRecording();
      expect(signals).toEqual([['Recording.started']]);
    });

    test('is not counted for a start that is refused because a recording is running', async () => {
      const { coordinator, signals } = make();
      await coordinator.startRecording();
      await expect(coordinator.startRecording()).rejects.toThrow();
      expect(signals).toEqual([['Recording.started']]);
    });

    test('is not counted for a start whose tracking failed', async () => {
      class FailingTracker extends FakeTrackRecorder {
        override async startTracking(): Promise<void> {
          throw new Error('no GPS');
        }
      }
      const { coordinator, signals } = make({ makeTrackRecorder: () => new FailingTracker() });
      await expect(coordinator.startRecording()).rejects.toThrow();
      expect(signals).toEqual([]);
    });
  });

  describe('Recording.stopped', () => {
    test.each([
      ['no time at all', 0, '0-15'],
      ['five minutes', 5 * MINUTE, '0-15'],
      ['just under fifteen minutes', 15 * MINUTE - 1000, '0-15'],
      ['fifteen minutes', 15 * MINUTE, '15-60'],
      ['forty minutes', 40 * MINUTE, '15-60'],
      ['an hour', 60 * MINUTE, '60+'],
      ['two and a half hours', 150 * MINUTE, '60+'],
    ])('is counted with the length bucket after %s', async (_name, elapsedMs, bucket) => {
      const { coordinator, clock, signals } = make();
      await coordinator.startRecording();
      await clock.advance(elapsedMs);
      await coordinator.stopRecording();
      expect(signals).toEqual([['Recording.started'], ['Recording.stopped', { durationMinutes: bucket }]]);
    });

    test('is counted when the summary is ready, after the recording is idle again', async () => {
      const seen: unknown[] = [];
      const holder: { coordinator?: RecordingCoordinator } = {};
      const made = make({
        telemetry: {
          signal: ((event: string) => {
            if (event === 'Recording.stopped') seen.push(holder.coordinator?.state.recordingStatus);
          }) as never,
        },
      });
      holder.coordinator = made.coordinator;
      await made.coordinator.startRecording();
      await made.coordinator.stopRecording();
      expect(seen).toEqual([{ kind: 'idle' }]);
    });

    test('is not counted when nothing was recording', async () => {
      const { coordinator, signals } = make();
      expect(await coordinator.stopRecording()).toBeNull();
      expect(signals).toEqual([]);
    });

    test('is counted once per recording', async () => {
      const { coordinator, signals } = make();
      await coordinator.startRecording();
      await coordinator.stopRecording();
      await coordinator.stopRecording();
      await coordinator.startRecording();
      await coordinator.stopRecording();
      expect(signals.map(([event]) => event)).toEqual([
        'Recording.started',
        'Recording.stopped',
        'Recording.started',
        'Recording.stopped',
      ]);
    });
  });

  describe('a telemetry that throws', () => {
    const throwing = {
      signal: (() => {
        throw new Error('telemetry down');
      }) as never,
    };

    test('changes nothing about starting and stopping', async () => {
      const { coordinator } = make({ telemetry: throwing });
      await expect(coordinator.startRecording()).resolves.toBe('flight-1');
      expect(coordinator.state.recordingStatus).toEqual({ kind: 'recording' });
      const summary = await coordinator.stopRecording();
      expect(summary?.flightID).toBe('flight-1');
      expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
    });
  });

  test('a coordinator with no telemetry records as before', async () => {
    const { coordinator } = make({ telemetry: undefined });
    await coordinator.startRecording();
    expect((await coordinator.stopRecording())?.flightID).toBe('flight-1');
  });

  test('with the real counters: a recording counts as one start and one stop with its length', async () => {
    const storage = new FakeTelemetryStorage();
    const transport = new FakeTelemetryTransport();
    const telemetry = new Telemetry({
      storage,
      transport,
      context: () => ({ app: '1.2.0', platform: 'ios', update: 'embedded', region: 'israel' }),
    });
    const { coordinator, clock } = make({ telemetry });
    await coordinator.startRecording();
    await clock.advance(20 * MINUTE);
    await coordinator.stopRecording();
    await telemetry.flush();

    expect(transport.batches[0]?.map(({ event, params, count }) => ({ event, params, count }))).toEqual([
      { event: 'Recording.started', params: undefined, count: 1 },
      { event: 'Recording.stopped', params: { durationMinutes: '15-60' }, count: 1 },
    ]);
  });
});
