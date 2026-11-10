// Fakes for the recording tests: a manual clock and mocks mirroring efb-212Tests/Mocks.
import type {
  AudioQualityProfile,
  AudioRecorderLike,
  Clock,
  RecordingStore,
  TrackRecorderLike,
  TrackRecorderSummary,
  TranscriptSegmentInsert,
  TranscriptionServiceLike,
} from './collaborators';
import type { FlightPhaseType } from './types';

/** Manual clock: sleep() resolves only when advance() moves time past its due time. */
export class FakeClock implements Clock {
  private t: number;
  private sleepers: { due: number; resolve: () => void }[] = [];

  constructor(start = 1_700_000_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.sleepers.push({ due: this.t + ms, resolve }));
  }

  /** Advance time in small steps so loops that re-arm their sleep are observed at each tick. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    await flush();
    for (;;) {
      const next = this.sleepers.filter((s) => s.due <= end).sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      this.sleepers = this.sleepers.filter((s) => s !== next);
      this.t = Math.max(this.t, next.due);
      next.resolve();
      await flush();
    }
    this.t = end;
  }
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

export class MockAudioRecorder implements AudioRecorderLike {
  startRecordingCalled = false;
  stopRecordingCalled = false;
  startRecordingCallCount = 0;
  stopRecordingCallCount = 0;
  _audioLevel = -160;
  startRecordingError: Error | null = null;
  stopRecordingURL: string | null = '/tmp/test.m4a';

  async startRecording(_flightID: string, _profile: AudioQualityProfile, _outputURL: string): Promise<void> {
    this.startRecordingCalled = true;
    this.startRecordingCallCount += 1;
    if (this.startRecordingError) throw this.startRecordingError;
  }

  async stopRecording(): Promise<string | null> {
    this.stopRecordingCalled = true;
    this.stopRecordingCallCount += 1;
    return this.stopRecordingURL;
  }

  get audioLevel(): number {
    return this._audioLevel;
  }
}

export class MockTranscriptionService implements TranscriptionServiceLike {
  startTranscriptionCalled = false;
  stopTranscriptionCalled = false;
  stopTranscriptionCallCount = 0;
  startTranscriptionError: Error | null = null;

  async startTranscription(_flightID: string): Promise<void> {
    this.startTranscriptionCalled = true;
    if (this.startTranscriptionError) throw this.startTranscriptionError;
  }

  async stopTranscription(): Promise<void> {
    this.stopTranscriptionCalled = true;
    this.stopTranscriptionCallCount += 1;
  }
}

export class FakeTrackRecorder implements TrackRecorderLike {
  currentPhase: FlightPhaseType = 'preflight';
  summary: TrackRecorderSummary = { trackPointCount: 0, phaseMarkers: [] };
  async startTracking(): Promise<void> {}
  async stopTracking(): Promise<TrackRecorderSummary> {
    return this.summary;
  }
  setFailureHandlers(): void {}
}

export class FakeRecordingStore implements RecordingStore {
  segments: TranscriptSegmentInsert[] = [];
  async transcriptSegmentCount(flightID: string): Promise<number> {
    return this.segments.filter((s) => s.flightID === flightID).length;
  }
  async insertTranscript(segment: TranscriptSegmentInsert): Promise<void> {
    this.segments.push(segment);
  }
}
