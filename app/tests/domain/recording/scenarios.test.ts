// Plan 5.3 level (a), recording slice: play the tools/flight-sim scenario samples through the ported
// RecordingCoordinator with a fake clock and compare with the Swift goldens (app/tests/goldens/*.json, PR #24).
//
// What L4 affects in the goldens: summary.samples, summary.fixesDelivered, summary.failedToDeliver and
// summary.recordedTrackPoints. The alert, leg, off-route, altitude-caution and debrief parts of the goldens belong to the
// Israel alert and route-following tickets and are asserted there. Delivery mirrors efb-212Tests/Simulation/ScenarioRun.swift:
// at each stride step t the first fix with t <= fix.t < t + 1 is delivered, so GPS loss gaps produce no track point.
import fs from 'node:fs';
import path from 'node:path';
import type { TrackRecorderLike, TrackRecorderSummary } from '../../../src/domain/recording/collaborators';
import { FlightPhaseDetector } from '../../../src/domain/recording/flightPhaseDetector';
import { RecordingCoordinator } from '../../../src/domain/recording/recordingCoordinator';
import {
  FakeClock,
  FakeRecordingStore,
  MockAudioRecorder,
  MockTranscriptionService,
} from '../../../src/domain/recording/testSupport';
import type { FlightPhaseType, PhaseMarker, TrackPoint } from '../../../src/domain/recording/types';
import { VerticalSpeedEstimator } from '../../../src/domain/recording/verticalSpeedEstimator';

interface Fix {
  t: number;
  lat: number;
  lon: number;
  alt: number; // feet
  gs: number; // knots
  crs: number;
  hAcc: number;
  vAcc: number;
}

interface Golden {
  strideSeconds: number;
  durationSeconds: number;
  summary: { samples: number; fixesDelivered: number; failedToDeliver: number; recordedTrackPoints: number };
}

const root = path.resolve(__dirname, '../../../..');
const scenariosDir = path.join(root, 'tools/flight-sim/scenarios');
const goldensDir = path.resolve(__dirname, '../../goldens');
const names = fs
  .readdirSync(goldensDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace(/\.json$/, ''))
  .sort();

/** Stand-in for the A1 TrackRecorder: one track point per fix, vertical speed estimate, phase detection. */
class ScenarioTrackRecorder implements TrackRecorderLike {
  private readonly vse = new VerticalSpeedEstimator();
  private readonly detector = new FlightPhaseDetector();
  private points = 0;
  constructor(private readonly flightID: string) {}

  get currentPhase(): FlightPhaseType {
    return this.detector.currentPhase;
  }
  setFailureHandlers(): void {}
  async startTracking(): Promise<void> {}
  async stopTracking(): Promise<TrackRecorderSummary> {
    return { trackPointCount: this.points, phaseMarkers: this.detector.phaseMarkers };
  }

  ingest(fix: Fix, timestamp: number): void {
    const vsi = this.vse.update(fix.alt, timestamp, fix.vAcc);
    const point: TrackPoint = {
      id: `tp-${this.points}`,
      flightID: this.flightID,
      timestamp,
      latitude: fix.lat,
      longitude: fix.lon,
      altitudeFeet: fix.alt,
      groundSpeedKnots: fix.gs,
      verticalSpeedFPM: vsi,
      courseDegrees: fix.crs,
    };
    this.detector.process(point, fix.vAcc >= 0);
    this.points += 1;
  }
}

describe('scenario goldens: recording slice', () => {
  test('there is a golden for every scenario file', () => {
    const scenarioFiles = fs
      .readdirSync(scenariosDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
    expect(names).toEqual(scenarioFiles);
  });

  test.each(names)('%s', async (name) => {
    const scenario = JSON.parse(fs.readFileSync(path.join(scenariosDir, `${name}.json`), 'utf8')) as { fixes: Fix[] };
    const golden = JSON.parse(fs.readFileSync(path.join(goldensDir, `${name}.json`), 'utf8')) as Golden;
    const stride = golden.strideSeconds;
    const fixes = scenario.fixes;
    const duration = fixes[fixes.length - 1]!.t;

    const clock = new FakeClock();
    const audio = new MockAudioRecorder();
    let tracker!: ScenarioTrackRecorder;
    const coordinator = new RecordingCoordinator({
      recordingStore: new FakeRecordingStore(),
      audioRecorder: audio,
      transcriptionService: new MockTranscriptionService(),
      makeTrackRecorder: (flightID) => (tracker = new ScenarioTrackRecorder(flightID)),
      audioFileURL: (id) => `/rec/${id}.m4a`,
      clock,
    });

    await coordinator.startRecording();

    let samples = 0;
    let delivered = 0;
    let next = 0;
    for (let t = 0; t <= duration; t += stride) {
      while (next < fixes.length && fixes[next]!.t < t - 1e-6) next += 1;
      if (next < fixes.length && fixes[next]!.t < t + 1) {
        tracker.ingest(fixes[next]!, clock.now());
        delivered += 1;
      }
      samples += 1;
      await clock.advance(stride * 1000);
    }

    const summary = await coordinator.stopRecording();

    expect(golden.durationSeconds).toBe(duration);
    expect(samples).toBe(golden.summary.samples);
    expect(delivered).toBe(golden.summary.fixesDelivered);
    expect(golden.summary.failedToDeliver).toBe(0);
    expect(summary?.trackPointCount).toBe(golden.summary.recordedTrackPoints);

    // Phase markers are well formed: time ordered, each closed marker ends where the next begins.
    const phases: PhaseMarker[] = summary?.phases ?? [];
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i]!.startTimestamp).toBeGreaterThanOrEqual(phases[i - 1]!.startTimestamp);
      expect(phases[i - 1]!.endTimestamp).toBe(phases[i]!.startTimestamp);
    }
    expect(coordinator.state.recordingStatus).toEqual({ kind: 'idle' });
  });
});
