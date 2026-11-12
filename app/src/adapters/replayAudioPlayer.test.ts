import { createAudioPlayer } from 'expo-audio';

import * as fakeFs from '../../tests/support/fakeExpoFileSystem';
import { ReplayEngine } from '../domain/replay/replayEngine';
import type { ReplayAudioPlayer, ReplayStore, TickScheduler } from '../domain/replay/types';
import { createReplayAudioPlayer } from './replayAudioPlayer';

jest.mock('expo-file-system', () => jest.requireActual('../../tests/support/fakeExpoFileSystem'));
jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn() }));

const SUPPORT = 'file:///var/mobile/Containers/Data/Application/APP/Library/Application%20Support';
const STORED = 'efb-212/recordings/A1B2C3D4-0000-4000-8000-000000000001.m4a';
const URI = `${SUPPORT}/${STORED}`;

/** The slice of expo-audio's AudioPlayer the adapter drives, with its documented behaviour. */
interface FakePlayer {
  currentTime: number;
  playbackRate: number;
  volume: number;
  playing: boolean;
  play: jest.Mock;
  pause: jest.Mock;
  remove: jest.Mock;
  seekTo: jest.Mock;
  setPlaybackRate: jest.Mock;
}

function makePlayer(): FakePlayer {
  const player: FakePlayer = {
    currentTime: 0,
    playbackRate: 1,
    volume: 1,
    playing: false,
    play: jest.fn(() => {
      player.playing = true;
    }),
    pause: jest.fn(() => {
      player.playing = false;
    }),
    remove: jest.fn(),
    seekTo: jest.fn((seconds: number) => {
      player.currentTime = seconds;
      return Promise.resolve();
    }),
    setPlaybackRate: jest.fn((rate: number) => {
      player.playbackRate = Math.min(rate, 2);
    }),
  };
  return player;
}

const create = jest.mocked(createAudioPlayer);
let player: FakePlayer;

/** The adapter's player for a flight whose audio file exists. */
function adapter(): ReplayAudioPlayer {
  fakeFs.addFile(URI);
  const created = createReplayAudioPlayer(STORED, { appSupportUri: SUPPORT });
  if (!created) throw new Error('expected a player');
  return created;
}

beforeEach(() => {
  fakeFs.reset();
  player = makePlayer();
  create.mockReset();
  create.mockReturnValue(player as never);
});

afterEach(() => jest.restoreAllMocks());

describe('createReplayAudioPlayer', () => {
  test.each([
    ['no stored path', undefined],
    ['a null path', null],
    ['an empty path', ''],
  ])('returns null for %s', (_name, stored) => {
    expect(createReplayAudioPlayer(stored, { appSupportUri: SUPPORT })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  test('returns null when the file is not there (the flight replays without audio)', () => {
    expect(createReplayAudioPlayer(STORED, { appSupportUri: SUPPORT })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  test('plays a relative path from under Application Support', () => {
    fakeFs.addFile(URI);
    expect(createReplayAudioPlayer(STORED, { appSupportUri: SUPPORT })).not.toBeNull();
    expect(create).toHaveBeenCalledWith({ uri: URI });
  });

  test('plays an absolute path as it is (a recording that was outside Application Support when saved)', () => {
    const absolute = 'file:///var/mobile/Containers/Data/Application/APP/Documents/ExpoAudio/flight-X.m4a';
    fakeFs.addFile(absolute);
    expect(createReplayAudioPlayer(absolute, { appSupportUri: SUPPORT })).not.toBeNull();
    expect(create).toHaveBeenCalledWith({ uri: absolute });
  });

  test('defaults to the platform Application Support directory', () => {
    fakeFs.addFile(URI);
    expect(createReplayAudioPlayer(STORED)).not.toBeNull();
    expect(create).toHaveBeenCalledWith({ uri: URI });
  });

  test('returns null when the player cannot be created (Swift failed the whole load; the track still replays here)', () => {
    fakeFs.addFile(URI);
    create.mockImplementation(() => {
      throw new Error('unsupported format');
    });
    expect(createReplayAudioPlayer(STORED, { appSupportUri: SUPPORT })).toBeNull();
  });

  test('returns null when the platform refuses the existence probe', () => {
    jest.spyOn(fakeFs.File.prototype, 'exists', 'get').mockImplementation(() => {
      throw new Error('url contains invalid characters');
    });
    expect(createReplayAudioPlayer(STORED, { appSupportUri: SUPPORT })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('the player', () => {
  test('seeks when currentTime is assigned and reads the position the player has reached', () => {
    const replay = adapter();
    replay.currentTime = 12.5;
    expect(player.seekTo).toHaveBeenCalledWith(12.5);
    player.currentTime = 40;
    expect(replay.currentTime).toBe(40);
  });

  test('drops a failed seek instead of leaving an unhandled rejection', async () => {
    const failed = Promise.reject(new Error('player released'));
    const handled = jest.spyOn(failed, 'catch');
    player.seekTo.mockReturnValue(failed);

    adapter().currentTime = 3;

    expect(handled).toHaveBeenCalledTimes(1);
    await failed.catch(() => undefined);
  });

  test.each([
    ['currentTime', 0],
    ['playbackRate', 1],
    ['volume', 0],
    ['playing', false],
  ] as const)('reads of %s that throw give %j instead of throwing into the engine timer', (property, fallback) => {
    const replay = adapter();
    Object.defineProperty(player, property, {
      get() {
        throw new Error('player released by the system');
      },
    });
    const read = {
      currentTime: () => replay.currentTime,
      playbackRate: () => replay.rate,
      volume: () => replay.volume,
      playing: () => replay.isPlaying,
    }[property];
    expect(read()).toBe(fallback);
  });

  test('sets the rate through setPlaybackRate and reads it back', () => {
    const replay = adapter();
    replay.rate = 1.5;
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(replay.rate).toBe(1.5);
  });

  test('sets and reads the volume', () => {
    const replay = adapter();
    replay.volume = 0;
    expect(player.volume).toBe(0);
    expect(replay.volume).toBe(0);
  });

  test('plays, pauses and reports whether it is playing', () => {
    const replay = adapter();
    expect(replay.isPlaying).toBe(false);
    replay.play();
    expect(replay.isPlaying).toBe(true);
    replay.pause();
    expect(replay.isPlaying).toBe(false);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['play', (replay: ReplayAudioPlayer) => replay.play(), 'play'],
    ['pause', (replay: ReplayAudioPlayer) => replay.pause(), 'pause'],
    [
      'a seek',
      (replay: ReplayAudioPlayer) => {
        replay.currentTime = 1;
      },
      'seekTo',
    ],
    [
      'a rate change',
      (replay: ReplayAudioPlayer) => {
        replay.rate = 2;
      },
      'setPlaybackRate',
    ],
  ] as const)('does not throw into the engine when the native %s throws', (_name, act, method) => {
    const replay = adapter();
    player[method].mockImplementation(() => {
      throw new Error('audio session failed');
    });
    expect(() => act(replay)).not.toThrow();
  });

  test('does not throw into the engine when the native volume setter throws', () => {
    const replay = adapter();
    Object.defineProperty(player, 'volume', {
      set() {
        throw new Error('audio session failed');
      },
    });
    expect(() => {
      replay.volume = 0.5;
    }).not.toThrow();
  });

  describe('stop', () => {
    test('pauses and releases the native player', () => {
      const replay = adapter();
      replay.play();
      replay.stop();
      expect(player.pause).toHaveBeenCalledTimes(1);
      expect(player.remove).toHaveBeenCalledTimes(1);
      expect(replay.isPlaying).toBe(false);
    });

    test('makes every later call a no-op, so a late engine call cannot reach a released player', () => {
      const replay = adapter();
      replay.stop();
      player.play.mockClear();
      player.pause.mockClear();
      // The native player still holds values; a stopped adapter must not report them.
      Object.assign(player, { currentTime: 30, playbackRate: 1.5, volume: 0.7, playing: true });

      replay.play();
      replay.pause();
      replay.currentTime = 5;
      replay.rate = 2;
      replay.volume = 0.2;

      expect(player.play).not.toHaveBeenCalled();
      expect(player.pause).not.toHaveBeenCalled();
      expect(player.seekTo).not.toHaveBeenCalled();
      expect(player.setPlaybackRate).not.toHaveBeenCalled();
      expect(player.volume).toBe(0.7);
      expect([replay.currentTime, replay.rate, replay.volume, replay.isPlaying]).toEqual([0, 1, 0, false]);
    });

    test('releases once however often it is called', () => {
      const replay = adapter();
      replay.stop();
      replay.stop();
      expect(player.remove).toHaveBeenCalledTimes(1);
    });

    test('still releases when pausing throws, and never throws itself', () => {
      const replay = adapter();
      player.pause.mockImplementation(() => {
        throw new Error('already gone');
      });
      player.remove.mockImplementation(() => {
        throw new Error('already gone too');
      });
      expect(() => replay.stop()).not.toThrow();
      expect(player.remove).toHaveBeenCalledTimes(1);
    });
  });
});

describe('with ReplayEngine', () => {
  const noTimer: TickScheduler = { every: () => () => undefined };
  const store: ReplayStore = {
    trackPoints: async () =>
      [0, 1, 2].map((i) => ({
        timestamp: 1_000_000 + i * 1000,
        latitude: 37 + i * 0.01,
        longitude: -122,
        altitudeFeet: 3000,
        groundSpeedKnots: 100,
        courseDegrees: 90,
      })),
    transcriptSegments: async () => [],
    phaseMarkers: async () => [],
  };

  async function loaded(): Promise<ReplayEngine> {
    const engine = new ReplayEngine(noTimer);
    await engine.loadFlight('flight-1', store, adapter());
    return engine;
  }

  test('play starts the audio from the start of the flight', async () => {
    const engine = await loaded();
    engine.play();
    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  test('2x plays at twice the rate and 4x keeps 2x but mutes (the player maximum is 2.0)', async () => {
    const engine = await loaded();
    engine.setSpeed(2);
    expect([player.playbackRate, player.volume]).toEqual([2, 1]);
    engine.setSpeed(4);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(2);
    expect(player.volume).toBe(0);
  });

  test('cleanup releases the native player', async () => {
    const engine = await loaded();
    engine.play();
    engine.cleanup();
    expect(player.remove).toHaveBeenCalledTimes(1);
  });
});
