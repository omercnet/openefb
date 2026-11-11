// Port of efb-212/Services/Replay/ReplayEngine.swift: playback coordinator for track replay.
// currentPosition (seconds from recording start) is the single source of truth; map position, audio and
// transcript highlighting derive from it. Speeds 1x/2x/4x/8x with linear GPS interpolation (REPLAY-01/02).
//
// Differences from Swift (app/docs/port-notes/L8.md): data comes from an injected ReplayStore and audio from an
// injected ReplayAudioPlayer (the file-exists check and AVAudioPlayer creation move to the adapter), the 20 Hz Timer is an
// injected TickScheduler, coordinates are { lat, lon }, and observers use subscribe() instead of @Observable.

import {
  intervalScheduler,
  type InterpolatedPosition,
  type PhaseMarkerFraction,
  type ReplayAudioPlayer,
  type ReplayPhaseMarker,
  type ReplayStore,
  type ReplayTrackPoint,
  type ReplayTranscriptSegment,
  type TickScheduler,
} from './types';

const TICK_SECONDS = 0.05;

export class ReplayEngine {
  /** Current playback position in seconds from recording start (THE source of truth). */
  currentPosition = 0;
  isPlaying = false;
  /** Playback speed multiplier: 1x, 2x, 4x, 8x. */
  playbackSpeed = 1;
  /** Audio muted at 4x/8x because the player's maximum rate is 2.0. */
  audioMuted = false;
  currentCoordinate = { lat: 0, lon: 0 };
  /** Feet MSL. */
  currentAltitude = 0;
  /** Knots. */
  currentSpeed = 0;
  /** Degrees true. */
  currentHeading = 0;
  /** Index of the active transcript segment, null between segments. */
  currentTranscriptIndex: number | null = null;
  totalDuration = 0;
  phaseMarkerFractions: PhaseMarkerFraction[] = [];

  trackPoints: ReplayTrackPoint[] = [];
  transcriptSegments: ReplayTranscriptSegment[] = [];
  private phaseMarkers: ReplayPhaseMarker[] = [];
  private audioPlayer: ReplayAudioPlayer | null = null;
  private cancelTimer: (() => void) | null = null;
  private recordingStartTime: number;
  private tickCount = 0;
  private loadCounter = 0;
  private listeners = new Set<() => void>();

  constructor(
    private readonly scheduler: TickScheduler = intervalScheduler,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.recordingStartTime = now();
  }

  get trackPointCount(): number {
    return this.trackPoints.length;
  }
  get transcriptSegmentCount(): number {
    return this.transcriptSegments.length;
  }
  get phaseMarkerCount(): number {
    return this.phaseMarkers.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  /** Load flight data from the recording store. Optionally attach an audio player for synchronized playback. */
  async loadFlight(flightID: string, store: ReplayStore, audio: ReplayAudioPlayer | null = null): Promise<void> {
    // Read everything first, then assign, so a failed or superseded load leaves the previous flight intact.
    const loadId = ++this.loadCounter;
    const [trackPoints, transcriptSegments, phaseMarkers] = await Promise.all([
      store.trackPoints(flightID),
      store.transcriptSegments(flightID),
      store.phaseMarkers(flightID),
    ]);
    if (loadId !== this.loadCounter) return; // a newer loadFlight started meanwhile

    this.trackPoints = trackPoints;
    this.transcriptSegments = transcriptSegments;
    this.phaseMarkers = phaseMarkers;

    this.recordingStartTime = this.trackPoints[0]?.timestamp ?? this.now();

    const first = this.trackPoints[0];
    const last = this.trackPoints[this.trackPoints.length - 1];
    this.totalDuration = first && last ? (last.timestamp - first.timestamp) / 1000 : 0;

    this.computePhaseMarkerFractions();

    if (audio) {
      audio.prepare?.();
      this.audioPlayer = audio;
    }

    this.currentPosition = 0;
    this.updateDerivedState();
  }

  /** Start playback at the current position and speed. */
  play(): void {
    this.isPlaying = true;

    this.syncAudioToPosition();
    if (!this.audioMuted) this.audioPlayer?.play();

    this.cancelTimer?.();
    this.cancelTimer = this.scheduler.every(TICK_SECONDS * 1000, () => this.tick());
    this.notify();
  }

  pause(): void {
    this.isPlaying = false;
    this.audioPlayer?.pause();
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.notify();
  }

  /** Seek to a position, clamped to 0...totalDuration. */
  seekTo(position: number): void {
    this.currentPosition = Math.min(Math.max(position, 0), this.totalDuration);
    this.syncAudioToPosition();
    this.updateDerivedState();
  }

  /** Set playback speed. Mutes audio at 4x/8x (the player's maximum rate is 2.0). */
  setSpeed(speed: number): void {
    this.playbackSpeed = speed;
    if (speed <= 2.0) {
      this.audioMuted = false;
      if (this.audioPlayer) {
        this.audioPlayer.rate = speed;
        this.audioPlayer.volume = 1.0;
      }
    } else {
      this.audioMuted = true;
      // Keep audio at 2x so it stays roughly in sync, but muted.
      if (this.audioPlayer) {
        this.audioPlayer.rate = 2.0;
        this.audioPlayer.volume = 0;
      }
    }
    this.notify();
  }

  /** Linear interpolation of the track at a time offset (seconds). Heading is interpolated linearly too (no wrap handling). */
  interpolatedPosition(time: number): InterpolatedPosition {
    const pts = this.trackPoints;
    const at = (p: ReplayTrackPoint): InterpolatedPosition => ({
      coordinate: { lat: p.latitude, lon: p.longitude },
      heading: p.courseDegrees,
      altitude: p.altitudeFeet,
      speed: p.groundSpeedKnots,
    });

    if (pts.length === 0) return { coordinate: { lat: 0, lon: 0 }, heading: 0, altitude: 0, speed: 0 };
    if (pts.length === 1) return at(pts[0]!);

    const targetTime = this.recordingStartTime + time * 1000;
    if (targetTime <= pts[0]!.timestamp) return at(pts[0]!);
    if (targetTime >= pts[pts.length - 1]!.timestamp) return at(pts[pts.length - 1]!);

    // Binary search for the bracketing points.
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (pts[mid]!.timestamp <= targetTime) lo = mid;
      else hi = mid;
    }

    const p1 = pts[lo]!;
    const p2 = pts[hi]!;
    const interval = (p2.timestamp - p1.timestamp) / 1000;
    const fraction = interval > 0 ? (targetTime - p1.timestamp) / 1000 / interval : 0;
    const lerp = (a: number, b: number): number => a + (b - a) * fraction;

    return {
      coordinate: { lat: lerp(p1.latitude, p2.latitude), lon: lerp(p1.longitude, p2.longitude) },
      heading: lerp(p1.courseDegrees, p2.courseDegrees),
      altitude: lerp(p1.altitudeFeet, p2.altitudeFeet),
      speed: lerp(p1.groundSpeedKnots, p2.groundSpeedKnots),
    };
  }

  /** Advance one tick without the isPlaying guard (Swift testTick; used by tests). */
  testTick(): void {
    this.currentPosition += TICK_SECONDS * this.playbackSpeed;
    if (this.currentPosition >= this.totalDuration) this.currentPosition = this.totalDuration;
    this.updateDerivedState();
  }

  /** Cancel the timer, stop audio, release resources. */
  cleanup(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.audioPlayer?.stop();
    this.audioPlayer = null;
    this.isPlaying = false;
    this.notify();
  }

  // MARK: Private

  /** One tick (0.05 s * playbackSpeed). */
  private tick(): void {
    if (!this.isPlaying) return;

    this.currentPosition += TICK_SECONDS * this.playbackSpeed;
    if (this.currentPosition >= this.totalDuration) {
      this.currentPosition = this.totalDuration;
      this.pause();
    }

    this.updateDerivedState();

    // Drift correction every ~5 seconds (100 ticks).
    this.tickCount += 1;
    const player = this.audioPlayer;
    if (this.tickCount % 100 === 0 && player && player.isPlaying && !this.audioMuted) {
      if (Math.abs(this.currentPosition - player.currentTime) > 0.2) {
        player.currentTime = this.currentPosition;
      }
    }
  }

  private updateDerivedState(): void {
    const r = this.interpolatedPosition(this.currentPosition);
    this.currentCoordinate = r.coordinate;
    this.currentHeading = r.heading;
    this.currentAltitude = r.altitude;
    this.currentSpeed = r.speed;

    const idx = this.transcriptSegments.findIndex(
      (s) => this.currentPosition >= s.audioStartTime && this.currentPosition < s.audioEndTime,
    );
    this.currentTranscriptIndex = idx >= 0 ? idx : null;
    this.notify();
  }

  private syncAudioToPosition(): void {
    if (this.audioPlayer) this.audioPlayer.currentTime = this.currentPosition;
  }

  private computePhaseMarkerFractions(): void {
    if (!(this.totalDuration > 0)) {
      this.phaseMarkerFractions = [];
      return;
    }
    this.phaseMarkerFractions = this.phaseMarkers.map((m) => {
      const offset = (m.startTimestamp - this.recordingStartTime) / 1000;
      const fraction = offset / this.totalDuration;
      return { phase: m.phase, fraction: Math.max(0, Math.min(1, fraction)) };
    });
  }
}
