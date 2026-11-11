// ReplayAudioPlayer on expo-audio: the AVAudioPlayer the Swift ReplayEngine created itself. The engine takes the player
// as an argument (ReplayEngine.loadFlight in domain/replay), so the Swift existence check and player creation live here;
// createReplayAudioPlayer returns null when there is no audio file. Differences: docs/port-notes/A7.md.
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';

import type { ReplayAudioPlayer } from '../domain/replay/types';
import { applicationSupportDirectory, resolveAudioUri } from './recordingFiles';

/**
 * expo-audio seeks asynchronously, so assigning currentTime starts a seek and reads return the position the player
 * has reached. After stop() every call does nothing: stop() releases the native player, and the engine may touch its
 * player once more while it tears down.
 */
class ExpoReplayAudioPlayer implements ReplayAudioPlayer {
  private released = false;

  constructor(private readonly player: AudioPlayer) {}

  /** AVAudioPlayer calls never threw, so the engine does not expect it: a failing native call is dropped. */
  private run(action: (player: AudioPlayer) => void): void {
    if (this.released) return;
    try {
      action(this.player);
    } catch {
      // The replay keeps running without sound.
    }
  }

  /** The engine reads these inside its timer tick, where a throw would go uncaught: a failing read gives `fallback`. */
  private read<T>(property: (player: AudioPlayer) => T, fallback: T): T {
    if (this.released) return fallback;
    try {
      return property(this.player);
    } catch {
      return fallback;
    }
  }

  get currentTime(): number {
    return this.read((player) => player.currentTime, 0);
  }

  set currentTime(seconds: number) {
    // A rejected seek (player released meanwhile, bad position) must not surface as an unhandled rejection.
    this.run((player) => player.seekTo(seconds).catch(() => undefined));
  }

  // expo-audio applies the rate when playback starts and clamps it to 2.0, AVAudioPlayer's maximum.
  get rate(): number {
    return this.read((player) => player.playbackRate, 1);
  }

  set rate(rate: number) {
    this.run((player) => player.setPlaybackRate(rate));
  }

  get volume(): number {
    return this.read((player) => player.volume, 0);
  }

  set volume(volume: number) {
    this.run((player) => {
      player.volume = volume;
    });
  }

  get isPlaying(): boolean {
    return this.read((player) => player.playing, false);
  }

  play(): void {
    this.run((player) => player.play());
  }

  pause(): void {
    this.run((player) => player.pause());
  }

  stop(): void {
    if (this.released) return;
    this.pause();
    this.run((player) => player.remove());
    this.released = true;
  }
}

export interface ReplayAudioOptions {
  /** Application Support directory URI that a relative path is resolved against; defaults to the platform one. */
  appSupportUri?: string;
}

/**
 * The player for a flight's audio, or null when the flight has none: no stored path, or no file at it (Swift
 * ReplayViewModel resolved the path under Application Support and checked fileExists; AVAudioPlayer was then created
 * by ReplayEngine). `storedPath` is FlightRecord.audioFileURL.
 */
export function createReplayAudioPlayer(
  storedPath: string | null | undefined,
  options: ReplayAudioOptions = {},
): ReplayAudioPlayer | null {
  if (!storedPath) return null;
  const root = options.appSupportUri ?? applicationSupportDirectory().uri;
  const uri = resolveAudioUri(root, storedPath);
  try {
    if (!new File(uri).exists) return null;
    return new ExpoReplayAudioPlayer(createAudioPlayer({ uri }));
  } catch {
    // Swift: `try AVAudioPlayer(contentsOf:)` threw and failed the whole load. Here the track still replays, silently.
    return null;
  }
}
