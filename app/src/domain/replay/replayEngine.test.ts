// Port of efb-212Tests/ServiceTests/ReplayEngineTests.swift (20 cases, same names and data).
// The Swift temp GRDB database becomes an in-memory ReplayStore with the same 10 points, 3 segments, 3 markers.
import { ReplayEngine } from './replayEngine';
import type {
  ReplayAudioPlayer,
  ReplayPhaseMarker,
  ReplayStore,
  ReplayTrackPoint,
  ReplayTranscriptSegment,
  TickScheduler,
} from './types';

const baseTime = 1_000_000 * 1000;

function makeTestStore(): ReplayStore {
  const points: ReplayTrackPoint[] = Array.from({ length: 10 }, (_, i) => ({
    timestamp: baseTime + i * 1000,
    latitude: 37.0 + i * 0.1,
    longitude: -122.0 + i * 0.1,
    altitudeFeet: 3000 + i * 100,
    groundSpeedKnots: 100 + i * 5,
    courseDegrees: i * 10,
  }));
  const segments: ReplayTranscriptSegment[] = [
    { audioStartTime: 1.0, audioEndTime: 3.0 },
    { audioStartTime: 4.0, audioEndTime: 6.0 },
    { audioStartTime: 7.0, audioEndTime: 8.5 },
  ];
  const markers: ReplayPhaseMarker[] = [
    { phase: 'taxi', startTimestamp: baseTime },
    { phase: 'takeoff', startTimestamp: baseTime + 3000 },
    { phase: 'cruise', startTimestamp: baseTime + 6000 },
  ];
  return {
    trackPoints: async () => points,
    transcriptSegments: async () => segments,
    phaseMarkers: async () => markers,
  };
}

const emptyStore: ReplayStore = {
  trackPoints: async () => [],
  transcriptSegments: async () => [],
  phaseMarkers: async () => [],
};

const noTimer: TickScheduler = { every: () => () => undefined };

async function loaded(): Promise<ReplayEngine> {
  const engine = new ReplayEngine(noTimer);
  await engine.loadFlight('flight-1', makeTestStore(), null);
  return engine;
}

describe('ReplayEngine Tests', () => {
  test('loadFlight populates trackPoints, transcriptSegments, phaseMarkers with correct counts', async () => {
    const engine = await loaded();
    expect(engine.trackPointCount).toBe(10);
    expect(engine.transcriptSegmentCount).toBe(3);
    expect(engine.phaseMarkerCount).toBe(3);
  });

  test('totalDuration computes correctly as difference between first and last track point timestamps', async () => {
    const engine = await loaded();
    expect(engine.totalDuration).toBe(9.0);
  });

  test('loadFlight with empty trackPoints sets totalDuration to 0', async () => {
    const engine = new ReplayEngine(noTimer);
    await engine.loadFlight('flight-1', emptyStore, null);
    expect(engine.totalDuration).toBe(0);
    expect(engine.trackPointCount).toBe(0);
  });

  test('interpolatedPosition at t=0 returns first track point coordinate', async () => {
    const r = (await loaded()).interpolatedPosition(0);
    expect(Math.abs(r.coordinate.lat - 37.0)).toBeLessThan(0.001);
    expect(Math.abs(r.coordinate.lon - -122.0)).toBeLessThan(0.001);
    expect(Math.abs(r.altitude - 3000.0)).toBeLessThan(0.1);
    expect(Math.abs(r.speed - 100.0)).toBeLessThan(0.1);
  });

  test('interpolatedPosition at halfway between two 1-second-apart points returns midpoint lat/lon', async () => {
    const r = (await loaded()).interpolatedPosition(0.5);
    expect(Math.abs(r.coordinate.lat - 37.05)).toBeLessThan(0.001);
    expect(Math.abs(r.coordinate.lon - -121.95)).toBeLessThan(0.001);
    expect(Math.abs(r.altitude - 3050.0)).toBeLessThan(0.1);
    expect(Math.abs(r.speed - 102.5)).toBeLessThan(0.1);
  });

  test('interpolatedPosition at totalDuration returns last track point coordinate', async () => {
    const engine = await loaded();
    const r = engine.interpolatedPosition(engine.totalDuration);
    expect(Math.abs(r.coordinate.lat - 37.9)).toBeLessThan(0.001);
    expect(Math.abs(r.coordinate.lon - -121.1)).toBeLessThan(0.001);
    expect(Math.abs(r.altitude - 3900.0)).toBeLessThan(0.1);
    expect(Math.abs(r.speed - 145.0)).toBeLessThan(0.1);
  });

  test.each([
    ['1x', 1.0, 0.05],
    ['2x', 2.0, 0.1],
    ['4x', 4.0, 0.2],
    ['8x', 8.0, 0.4],
  ])('tick at %s speed advances currentPosition by the tick interval times speed', async (_label, speed, step) => {
    const engine = await loaded();
    engine.setSpeed(speed);
    const startPos = engine.currentPosition;
    engine.testTick();
    expect(Math.abs(engine.currentPosition - (startPos + step))).toBeLessThan(0.001);
  });

  test('seekTo clamps to 0...totalDuration range', async () => {
    const engine = await loaded();
    engine.seekTo(-5.0);
    expect(engine.currentPosition).toBe(0);
    engine.seekTo(999.0);
    expect(engine.currentPosition).toBe(engine.totalDuration);
  });

  test('seekTo(0) sets currentPosition to 0 and updates derived state to first track point', async () => {
    const engine = await loaded();
    engine.seekTo(5.0);
    engine.seekTo(0);
    expect(engine.currentPosition).toBe(0);
    expect(Math.abs(engine.currentCoordinate.lat - 37.0)).toBeLessThan(0.001);
    expect(Math.abs(engine.currentAltitude - 3000.0)).toBeLessThan(0.1);
  });

  test('seekTo(totalDuration) sets currentPosition to totalDuration and updates to last track point', async () => {
    const engine = await loaded();
    engine.seekTo(engine.totalDuration);
    expect(engine.currentPosition).toBe(engine.totalDuration);
    expect(Math.abs(engine.currentCoordinate.lat - 37.9)).toBeLessThan(0.001);
    expect(Math.abs(engine.currentAltitude - 3900.0)).toBeLessThan(0.1);
  });

  test('currentTranscriptIndex returns correct index when position within segment range', async () => {
    const engine = await loaded();
    engine.seekTo(2.0);
    expect(engine.currentTranscriptIndex).toBe(0);
    engine.seekTo(5.0);
    expect(engine.currentTranscriptIndex).toBe(1);
    engine.seekTo(7.5);
    expect(engine.currentTranscriptIndex).toBe(2);
  });

  test('currentTranscriptIndex returns nil when position is between transcript segments', async () => {
    const engine = await loaded();
    engine.seekTo(3.5);
    expect(engine.currentTranscriptIndex).toBeNull();
    engine.seekTo(0.5);
    expect(engine.currentTranscriptIndex).toBeNull();
  });

  test('phaseMarkerFractions computes correct fractional positions along timeline', async () => {
    const fractions = (await loaded()).phaseMarkerFractions;
    expect(fractions).toHaveLength(3);
    expect(fractions[0]!.phase).toBe('taxi');
    expect(Math.abs(fractions[0]!.fraction - 0.0)).toBeLessThan(0.01);
    expect(fractions[1]!.phase).toBe('takeoff');
    expect(Math.abs(fractions[1]!.fraction - 0.333)).toBeLessThan(0.01);
    expect(fractions[2]!.phase).toBe('cruise');
    expect(Math.abs(fractions[2]!.fraction - 0.667)).toBeLessThan(0.01);
  });

  test('pause sets isPlaying to false', async () => {
    const engine = await loaded();
    engine.pause();
    expect(engine.isPlaying).toBe(false);
  });

  test('play followed by pause does not advance position further', async () => {
    const engine = await loaded();
    engine.play();
    engine.testTick();
    engine.testTick();
    engine.pause();
    const posAfterPause = engine.currentPosition;
    expect(engine.isPlaying).toBe(false);
    expect(engine.currentPosition).toBe(posAfterPause);
  });

  test('setSpeed to 4.0 or 8.0 sets audioMuted to true', () => {
    const engine = new ReplayEngine(noTimer);
    engine.setSpeed(4.0);
    expect(engine.audioMuted).toBe(true);
    engine.setSpeed(8.0);
    expect(engine.audioMuted).toBe(true);
  });

  test('setSpeed to 1.0 or 2.0 sets audioMuted to false', () => {
    const engine = new ReplayEngine(noTimer);
    engine.setSpeed(1.0);
    expect(engine.audioMuted).toBe(false);
    engine.setSpeed(2.0);
    expect(engine.audioMuted).toBe(false);
  });
});

// Not in Swift: the timer, audio and drift paths the Swift tests could not reach (no audio file in tests).
describe('ReplayEngine timer and audio', () => {
  class FakeScheduler implements TickScheduler {
    callback: (() => void) | null = null;
    cancelled = 0;
    every(_ms: number, callback: () => void): () => void {
      this.callback = callback;
      return () => {
        this.cancelled += 1;
        this.callback = null;
      };
    }
  }

  function fakePlayer(): ReplayAudioPlayer & { plays: number } {
    return {
      currentTime: 0,
      rate: 1,
      volume: 1,
      isPlaying: true,
      plays: 0,
      play() {
        this.plays += 1;
      },
      pause() {},
      stop() {},
    };
  }

  test('timer ticks advance only while playing and stop at the end', async () => {
    const scheduler = new FakeScheduler();
    const engine = new ReplayEngine(scheduler);
    await engine.loadFlight('f', makeTestStore(), null);
    engine.setSpeed(8);
    engine.play();
    for (let i = 0; i < 100; i++) scheduler.callback?.();
    expect(engine.currentPosition).toBe(9);
    expect(engine.isPlaying).toBe(false);
    expect(scheduler.cancelled).toBe(1);
  });

  test('audio follows seek, mutes at 4x and is corrected when drift exceeds 0.2 s', async () => {
    const scheduler = new FakeScheduler();
    const engine = new ReplayEngine(scheduler);
    const player = fakePlayer();
    await engine.loadFlight('f', makeTestStore(), player);
    engine.seekTo(2);
    expect(player.currentTime).toBe(2);
    engine.setSpeed(4);
    expect(player.rate).toBe(2.0);
    expect(player.volume).toBe(0);
    engine.setSpeed(1);
    engine.play();
    expect(player.plays).toBe(1);
    player.currentTime = 0; // drift of 2 s
    for (let i = 0; i < 100; i++) scheduler.callback?.();
    expect(player.currentTime).toBeCloseTo(engine.currentPosition, 5);
  });
});

describe('ReplayEngine loadFlight atomicity', () => {
  test('a failed load keeps the previous flight', async () => {
    const engine = new ReplayEngine(noTimer);
    await engine.loadFlight('a', makeTestStore(), null);
    const failing: ReplayStore = { ...makeTestStore(), phaseMarkers: async () => Promise.reject(new Error('boom')) };
    await expect(engine.loadFlight('b', failing, null)).rejects.toThrow('boom');
    expect(engine.trackPointCount).toBe(10);
    expect(engine.totalDuration).toBe(9);
  });
});
