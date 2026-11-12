// The replay screen's view model (ViewModels/ReplayViewModel.swift) over a real ReplayEngine (L8) with an in-memory track, a
// manual tick scheduler and a fake audio player. Swift has no test of the view model; the cases follow its source, and the
// guards that have no Swift counterpart (a load that finishes after another one, after cleanup) say so.
import { flush } from '../../domain/recording/testSupport';
import { ReplayEngine } from '../../domain/replay/replayEngine';
import type { ReplayAudioPlayer, ReplayPhaseMarker, ReplayTrackPoint, TickScheduler } from '../../domain/replay/types';
import { createReplayStore, type ReplayFlight, type ReplaySource, type TranscriptLine } from './replayStore';

const baseTime = 1_700_000_000_000;

const points: ReplayTrackPoint[] = Array.from({ length: 10 }, (_, i) => ({
  timestamp: baseTime + i * 1000,
  latitude: 32.8 - i * 0.01,
  longitude: 35.04 + i * 0.01,
  altitudeFeet: 1000 + i * 100,
  groundSpeedKnots: 90 + i * 2,
  courseDegrees: 100 + i * 10,
}));

const lines: TranscriptLine[] = [
  { audioStartTime: 1, audioEndTime: 3, text: 'Haifa tower, Kanaf 12 ready', flightPhase: 'taxi' },
  { audioStartTime: 4, audioEndTime: 6, text: 'Cleared for takeoff', flightPhase: 'takeoff' },
  { audioStartTime: 7, audioEndTime: 8.5, text: 'Contact Haifa approach', flightPhase: 'cruise' },
];

const markers: ReplayPhaseMarker[] = [
  { phase: 'taxi', startTimestamp: baseTime },
  { phase: 'takeoff', startTimestamp: baseTime + 3000 },
  { phase: 'cruise', startTimestamp: baseTime + 6000 },
];

/** Runs the engine's 20 Hz timer by hand. */
class ManualScheduler implements TickScheduler {
  private callbacks = new Set<() => void>();
  get active(): number {
    return this.callbacks.size;
  }
  every(_ms: number, callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
  /** One second of playback at 1x is 20 ticks. */
  tick(count: number): void {
    for (let i = 0; i < count; i++) [...this.callbacks].forEach((callback) => callback());
  }
}

class FakeAudio implements ReplayAudioPlayer {
  currentTime = 0;
  rate = 1;
  volume = 1;
  isPlaying = false;
  prepared = 0;
  stopped = 0;
  prepare() {
    this.prepared += 1;
  }
  play() {
    this.isPlaying = true;
  }
  pause() {
    this.isPlaying = false;
  }
  stop() {
    this.isPlaying = false;
    this.stopped += 1;
  }
}

const flight: ReplayFlight = { id: 'flight-1', audioFileURL: null };

function makeSource(over: Partial<ReplaySource> = {}): ReplaySource {
  return {
    trackPoints: async () => points,
    transcriptSegments: async () => lines,
    phaseMarkers: async () => markers,
    ...over,
  };
}

function setup(
  over: {
    source?: ReplaySource | null;
    /** Overrides `source`: what the recording database opens to, per call. */
    openSource?: () => Promise<ReplaySource | null>;
    openAudio?: (path: string) => Promise<ReplayAudioPlayer | null>;
  } = {},
) {
  const scheduler = new ManualScheduler();
  const engine = new ReplayEngine(scheduler, () => baseTime);
  const source = over.source === undefined ? makeSource() : over.source;
  const openAudio = jest.fn(over.openAudio ?? (async () => null));
  const store = createReplayStore({ engine, source: over.openSource ?? (async () => source), openAudio });
  return { store, engine, scheduler, openAudio };
}

describe('a new replay', () => {
  it('is loading, with the transcript panel closed and the map following the marker', () => {
    const { store } = setup();
    expect(store.getState()).toMatchObject({
      isLoading: true,
      loadError: null,
      isTranscriptPanelExpanded: false,
      autoFollow: true,
      showSpeedPicker: false,
      isPlaying: false,
      speed: 1,
      position: 0,
      transcriptIndex: null,
    });
  });
});

describe('loadFlight', () => {
  it('reads the track, transcript and phase markers into the state, at the first point', async () => {
    const { store } = setup();
    await store.getState().loadFlight(flight);
    const state = store.getState();
    expect(state).toMatchObject({ isLoading: false, loadError: null, totalDuration: 9, position: 0 });
    expect(state.trackPoints).toHaveLength(10);
    expect(state.segments).toEqual(lines);
    expect(state.phaseMarkers).toEqual([
      { phase: 'taxi', fraction: 0 },
      { phase: 'takeoff', fraction: 3 / 9 },
      { phase: 'cruise', fraction: 6 / 9 },
    ]);
    expect(state.coordinate).toEqual({ lat: 32.8, lon: 35.04 });
    expect(state.altitude).toBe(1000);
    expect(state.groundSpeed).toBe(90);
    expect(state.heading).toBe(100);
  });

  it('is loading while the data is read', async () => {
    const gate = Promise.withResolvers<ReplayTrackPoint[]>();
    const { store } = setup({ source: makeSource({ trackPoints: () => gate.promise }) });
    const loading = store.getState().loadFlight(flight);
    expect(store.getState().isLoading).toBe(true);
    gate.resolve(points);
    await loading;
    expect(store.getState().isLoading).toBe(false);
  });

  it('opens the transcript panel only when the flight has transcript segments', async () => {
    const withTranscript = setup();
    await withTranscript.store.getState().loadFlight(flight);
    expect(withTranscript.store.getState().isTranscriptPanelExpanded).toBe(true);

    const without = setup({ source: makeSource({ transcriptSegments: async () => [] }) });
    await without.store.getState().loadFlight(flight);
    expect(without.store.getState().isTranscriptPanelExpanded).toBe(false);
  });

  it('closes the panel again when a reload finds no transcript', async () => {
    const s = setup();
    await s.store.getState().loadFlight(flight);
    expect(s.store.getState().isTranscriptPanelExpanded).toBe(true);
    const empty = createReplayStore({
      engine: s.engine,
      source: async () => makeSource({ transcriptSegments: async () => [] }),
      openAudio: async () => null,
    });
    await empty.getState().loadFlight(flight);
    expect(empty.getState().isTranscriptPanelExpanded).toBe(false);
  });

  describe('audio', () => {
    it('is not asked for when the flight has no audio file (none, or an empty path)', async () => {
      for (const audioFileURL of [null, '']) {
        const { store, openAudio } = setup();
        await store.getState().loadFlight({ id: 'flight-1', audioFileURL });
        expect(openAudio).not.toHaveBeenCalled();
      }
    });

    it('is the player for the flight audio path, driven by the engine', async () => {
      const audio = new FakeAudio();
      const { store, engine, openAudio } = setup({ openAudio: async () => audio });
      await store.getState().loadFlight({ id: 'flight-1', audioFileURL: 'recordings/flight-1.m4a' });
      expect(openAudio).toHaveBeenCalledWith('recordings/flight-1.m4a');
      expect(audio.prepared).toBe(1);
      store.getState().togglePlayPause();
      expect(audio.isPlaying).toBe(true);
      engine.cleanup();
    });

    it('a file that is not there still replays the track', async () => {
      const { store } = setup({ openAudio: async () => null });
      await store.getState().loadFlight({ id: 'flight-1', audioFileURL: 'recordings/gone.m4a' });
      expect(store.getState()).toMatchObject({ isLoading: false, loadError: null });
      expect(store.getState().trackPoints).toHaveLength(10);
    });

    it('a player that cannot be opened still replays the track (JS-only guard: Swift only checks that the file exists)', async () => {
      const { store } = setup({
        openAudio: async () => {
          throw new Error('unsupported format');
        },
      });
      await store.getState().loadFlight({ id: 'flight-1', audioFileURL: 'recordings/flight-1.m4a' });
      expect(store.getState()).toMatchObject({ isLoading: false, loadError: null });
    });
  });

  describe('failures', () => {
    it('a recording database that cannot be opened says so', async () => {
      const { store } = setup({ source: null });
      await store.getState().loadFlight(flight);
      expect(store.getState()).toMatchObject({
        isLoading: false,
        loadError: 'The recording database could not be opened. Reinstall Kanaf.',
      });
    });

    it('a track that cannot be read says so, with the reason', async () => {
      const { store } = setup({
        source: makeSource({
          trackPoints: async () => {
            throw new Error('disk I/O error');
          },
        }),
      });
      await store.getState().loadFlight(flight);
      expect(store.getState()).toMatchObject({
        isLoading: false,
        loadError: 'Track data could not be read: disk I/O error',
      });
    });

    it('a database that fails to open (a rejection, not a missing one) reads the same way', async () => {
      const engine = new ReplayEngine(new ManualScheduler(), () => baseTime);
      const store = createReplayStore({
        engine,
        source: () => Promise.reject(new Error('file is not a database')),
        openAudio: async () => null,
      });
      await store.getState().loadFlight(flight);
      expect(store.getState().loadError).toBe('Track data could not be read: file is not a database');
    });

    it('Retry reads again: the error goes and the flight loads', async () => {
      let failing = true;
      const { store } = setup({
        source: makeSource({
          trackPoints: async () => {
            if (failing) throw new Error('disk I/O error');
            return points;
          },
        }),
      });
      await store.getState().loadFlight(flight);
      expect(store.getState().loadError).not.toBeNull();

      failing = false;
      const retry = store.getState().loadFlight(flight);
      expect(store.getState()).toMatchObject({ isLoading: true, loadError: null });
      await retry;
      expect(store.getState()).toMatchObject({ isLoading: false, loadError: null, totalDuration: 9 });
    });
  });

  it('only a failed read is a read error: a listener that throws once the flight is loaded is not reported as one', async () => {
    const { store } = setup();
    let loaded = false;
    store.subscribe((state) => {
      if (!state.isLoading && !loaded) {
        loaded = true;
        throw new Error('a screen failed to render');
      }
    });
    await expect(store.getState().loadFlight(flight)).rejects.toThrow('a screen failed to render');
    expect(store.getState()).toMatchObject({ isLoading: false, loadError: null });
    expect(store.getState().trackPoints).toHaveLength(10);
  });

  describe('overlapping loads (JS-only: Swift reads synchronously)', () => {
    const shortFlight = makeSource({
      trackPoints: async () => points.slice(0, 4),
      transcriptSegments: async () => [lines[0]!],
    });

    it('a load still waiting for the database does not overwrite a newer one, in the store or in the engine', async () => {
      const gate = Promise.withResolvers<ReplaySource>();
      let opens = 0;
      const { store, engine } = setup({
        openSource: () => (++opens === 1 ? gate.promise : Promise.resolve(shortFlight)),
      });
      const first = store.getState().loadFlight(flight);
      await store.getState().loadFlight(flight); // the newer one: 4 points
      gate.resolve(makeSource()); // the first one gets its database late, with 10 points
      await first;
      expect(store.getState().trackPoints).toHaveLength(4);
      expect(engine.trackPointCount).toBe(4);
      expect(store.getState().isLoading).toBe(false);
    });

    it('a load superseded while reading releases the player it had opened (the engine never attached it)', async () => {
      const slow = Promise.withResolvers<ReplayTrackPoint[]>();
      let reads = 0;
      const first = new FakeAudio();
      const { store } = setup({
        openSource: async () => (++reads === 1 ? makeSource({ trackPoints: () => slow.promise }) : shortFlight),
        openAudio: async () => (reads === 1 ? first : new FakeAudio()),
      });
      const withAudio = { id: 'flight-1', audioFileURL: 'recordings/flight-1.m4a' };
      const loading = store.getState().loadFlight(withAudio);
      await flush(); // opened its audio, now reading the track
      await store.getState().loadFlight(withAudio);
      slow.resolve(points);
      await loading;
      expect(first.stopped).toBeGreaterThanOrEqual(1);
    });

    it('a load that lost to a newer one does not open its flight audio', async () => {
      const gate = Promise.withResolvers<ReplaySource>();
      let opens = 0;
      const { store, openAudio } = setup({
        openSource: () => (++opens === 1 ? gate.promise : Promise.resolve(shortFlight)),
        openAudio: async () => new FakeAudio(),
      });
      const withAudio = { id: 'flight-1', audioFileURL: 'recordings/flight-1.m4a' };
      const first = store.getState().loadFlight(withAudio);
      await store.getState().loadFlight(withAudio);
      gate.resolve(makeSource());
      await first;
      expect(openAudio).toHaveBeenCalledTimes(1);
    });

    it('a load whose audio opens after a newer one has finished releases that player and keeps the newer flight', async () => {
      const gate = Promise.withResolvers<ReplayAudioPlayer>();
      const late = new FakeAudio();
      let opens = 0;
      const { store, engine } = setup({
        openSource: async () => (++opens === 1 ? makeSource() : shortFlight),
        openAudio: () => gate.promise,
      });
      const first = store.getState().loadFlight({ id: 'flight-1', audioFileURL: 'recordings/flight-1.m4a' });
      await flush(); // the first load is now waiting for its audio
      await store.getState().loadFlight({ id: 'flight-1', audioFileURL: null }); // the newer one: 4 points, no audio
      gate.resolve(late);
      await first;
      expect(late.stopped).toBe(1);
      expect(late.prepared).toBe(0);
      expect(engine.trackPointCount).toBe(4);
      expect(store.getState().trackPoints).toHaveLength(4);
    });

    it('a load still reading its track does not overwrite a newer one (track, transcript and panel)', async () => {
      const slow = Promise.withResolvers<ReplayTrackPoint[]>();
      let reads = 0;
      const { store } = setup({
        openSource: async () => (++reads === 1 ? makeSource({ trackPoints: () => slow.promise }) : shortFlight),
      });
      const first = store.getState().loadFlight(flight);
      await flush(); // the first load is now waiting for its track
      await store.getState().loadFlight(flight); // the newer one: 4 points, one line
      expect(store.getState().trackPoints).toHaveLength(4);
      slow.resolve(points);
      await first;
      expect(store.getState().trackPoints).toHaveLength(4);
      expect(store.getState().totalDuration).toBe(3);
      expect(store.getState().segments).toEqual([lines[0]]);
      expect(store.getState().isLoading).toBe(false);
    });

    it('a load that fails after a newer one succeeded does not show its error', async () => {
      const slow = Promise.withResolvers<ReplayTrackPoint[]>();
      let reads = 0;
      const { store } = setup({
        openSource: async () => (++reads === 1 ? makeSource({ trackPoints: () => slow.promise }) : shortFlight),
      });
      const first = store.getState().loadFlight(flight);
      await flush();
      await store.getState().loadFlight(flight);
      slow.reject(new Error('disk I/O error'));
      await first;
      expect(store.getState()).toMatchObject({ isLoading: false, loadError: null });
      expect(store.getState().trackPoints).toHaveLength(4);
    });

    it('a load that finishes after cleanup changes nothing (the screen is gone)', async () => {
      const slow = Promise.withResolvers<ReplayTrackPoint[]>();
      const { store, engine } = setup({ source: makeSource({ trackPoints: () => slow.promise }) });
      const loading = store.getState().loadFlight(flight);
      store.getState().cleanup();
      slow.resolve(points);
      await loading;
      expect(store.getState().isLoading).toBe(true);
      expect(store.getState().trackPoints).toHaveLength(0);
      expect(engine.trackPointCount).toBe(0);
    });
  });
});

describe('playback', () => {
  it('plays and pauses from the button', async () => {
    const { store, scheduler } = setup();
    await store.getState().loadFlight(flight);
    store.getState().togglePlayPause();
    expect(store.getState().isPlaying).toBe(true);
    expect(scheduler.active).toBe(1);

    store.getState().togglePlayPause();
    expect(store.getState().isPlaying).toBe(false);
    expect(scheduler.active).toBe(0);
  });

  it('follows the engine while it plays: position, marker, readouts and the transcript line', async () => {
    const { store, scheduler } = setup();
    await store.getState().loadFlight(flight);
    store.getState().togglePlayPause();

    scheduler.tick(20); // one second at 1x
    expect(store.getState().position).toBeCloseTo(1, 5);
    expect(store.getState().coordinate.lat).toBeCloseTo(32.79, 5);
    expect(store.getState().altitude).toBeCloseTo(1100, 3);
    expect(store.getState().groundSpeed).toBeCloseTo(92, 3);
    expect(store.getState().transcriptIndex).toBe(0);

    scheduler.tick(61); // 4.05 s: inside the second segment (4 to 6 s)
    expect(store.getState().transcriptIndex).toBe(1);
    scheduler.tick(40); // 6.05 s: between segments
    expect(store.getState().transcriptIndex).toBeNull();
  });

  it('stops by itself at the end of the track', async () => {
    const { store, scheduler } = setup();
    await store.getState().loadFlight(flight);
    store.getState().togglePlayPause();
    scheduler.tick(20 * 12);
    expect(store.getState()).toMatchObject({ isPlaying: false, position: 9 });
    expect(scheduler.active).toBe(0);
  });

  it('seeking moves the marker and the transcript line without playing', async () => {
    const { store } = setup();
    await store.getState().loadFlight(flight);
    store.getState().seekTo(5);
    expect(store.getState()).toMatchObject({ position: 5, transcriptIndex: 1, isPlaying: false });
    expect(store.getState().coordinate.lat).toBeCloseTo(32.75, 5);
    store.getState().seekTo(500);
    expect(store.getState().position).toBe(9);
    store.getState().seekTo(-3);
    expect(store.getState().position).toBe(0);
  });

  it('a speed choice sets the speed and closes the picker; above 2x the audio is muted', async () => {
    const { store } = setup();
    await store.getState().loadFlight(flight);
    store.getState().toggleSpeedPicker();
    expect(store.getState().showSpeedPicker).toBe(true);

    store.getState().selectSpeed(4);
    expect(store.getState()).toMatchObject({ speed: 4, audioMuted: true, showSpeedPicker: false });

    store.getState().selectSpeed(2);
    expect(store.getState()).toMatchObject({ speed: 2, audioMuted: false });
  });

  it('plays faster at a higher speed', async () => {
    const { store, scheduler } = setup();
    await store.getState().loadFlight(flight);
    store.getState().selectSpeed(8);
    store.getState().togglePlayPause();
    scheduler.tick(20);
    expect(store.getState().position).toBeCloseTo(8, 5);
  });

  it('the picker closes when opened twice', async () => {
    const { store } = setup();
    store.getState().toggleSpeedPicker();
    store.getState().toggleSpeedPicker();
    expect(store.getState().showSpeedPicker).toBe(false);
  });
});

describe('the map', () => {
  it('stops following the marker when the pilot pans, and follows again on re-centre', () => {
    const { store } = setup();
    store.getState().onUserPan();
    expect(store.getState().autoFollow).toBe(false);
    store.getState().recenter();
    expect(store.getState().autoFollow).toBe(true);
  });
});

describe('the transcript panel', () => {
  it('opens and closes from its button', async () => {
    const { store } = setup();
    await store.getState().loadFlight(flight);
    store.getState().toggleTranscriptPanel();
    expect(store.getState().isTranscriptPanelExpanded).toBe(false);
    store.getState().toggleTranscriptPanel();
    expect(store.getState().isTranscriptPanelExpanded).toBe(true);
  });
});

describe('cleanup', () => {
  it('stops the playback, the timer and the audio', async () => {
    const audio = new FakeAudio();
    const { store, scheduler } = setup({ openAudio: async () => audio });
    await store.getState().loadFlight({ id: 'flight-1', audioFileURL: 'recordings/flight-1.m4a' });
    store.getState().togglePlayPause();
    expect(audio.isPlaying).toBe(true);

    store.getState().cleanup();
    expect(store.getState().isPlaying).toBe(false);
    expect(scheduler.active).toBe(0);
    expect(audio.stopped).toBe(1);
  });

  it('leaves the store usable: coming back to the screen loads the flight again', async () => {
    const { store, scheduler } = setup();
    await store.getState().loadFlight(flight);
    store.getState().cleanup();
    await store.getState().loadFlight(flight);
    expect(store.getState()).toMatchObject({ isLoading: false, loadError: null, totalDuration: 9, position: 0 });
    store.getState().togglePlayPause();
    scheduler.tick(20);
    expect(store.getState().position).toBeCloseTo(1, 5);
  });
});
