// Port of efb-212/Services/Recording/FlightRecoveryService.swift: launch-time recovery of recordings the app never
// finished (crash or kill). A flight with recorded data or an audio file but no FlightRecord gets one, marked recovered.
// An orphan whose data cannot be read is skipped and retried next launch; a flight with no track, transcript or audio is
// left alone. Nothing is ever deleted.
//
// Differences from Swift: file access (listing, existence, duration, creation date) is an injected interface instead of
// FileManager/AVAudioFile; SwiftData fetches become the flight repository.

import type { FlightRecord } from '../../data/models';
import type { Repository } from '../../data/repositories/table';
import type { FlightPersistenceService } from './flightPersistence';
import type { FlightRecordingSummary } from './recordingCoordinator';
import type { PhaseMarker, TrackPoint } from './types';

export interface RecoveryAudioFiles {
  /** File names (not paths) in the recordings directory, e.g. "<uuid>.m4a". */
  listFileNames(): Promise<string[]>;
  /** Full path for a flight's audio file. */
  pathFor(flightID: string): string;
  exists(path: string): Promise<boolean>;
  /** Seconds; 0 when it cannot be opened (a crash can leave the file truncated). */
  durationSeconds(path: string): Promise<number>;
  /** Epoch ms, or null when unknown. */
  creationDate(path: string): Promise<number | null>;
}

export interface RecoveryRecordingStore {
  flightIDsWithRecordedData(): Promise<string[]>;
  trackPoints(flightID: string): Promise<TrackPoint[]>;
  transcriptSegments(flightID: string): Promise<{ timestamp: number }[]>;
  phaseMarkers(flightID: string): Promise<PhaseMarker[]>;
}

export interface FlightRecoveryDeps {
  recordingStore: RecoveryRecordingStore;
  persistence: Pick<FlightPersistenceService, 'store'>;
  flights: Pick<Repository<FlightRecord>, 'list'>;
  audio: RecoveryAudioFiles;
  now?: () => number;
}

const UUID_M4A = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.m4a$/;

export class FlightRecoveryService {
  constructor(private readonly deps: FlightRecoveryDeps) {}

  /**
   * Recover every orphaned recording. Returns the flight ids that got a FlightRecord.
   * activeFlightID: a recording in progress right now; never touched.
   */
  async recoverOrphans(
    options: { activeFlightID?: string | null; aircraftProfileID?: string | null; pilotProfileID?: string | null } = {},
  ): Promise<string[]> {
    let existing: Set<string>;
    try {
      existing = new Set((await this.deps.flights.list()).map((f) => f.id.toLowerCase()));
    } catch {
      // Without the list of known flights we cannot tell orphans from saved flights.
      return [];
    }

    // Keyed by lower-case id (dedup against the data layer); the value is the id as spelled in the audio file name,
    // so a case-sensitive file lookup still finds the file.
    const candidates = new Map<string, string | null>();
    try {
      (await this.deps.recordingStore.flightIDsWithRecordedData()).forEach((id) =>
        candidates.set(id.toLowerCase(), null),
      );
    } catch {
      // Swift logs and continues with the audio-derived candidates.
    }
    for (const id of await this.audioFlightIDs()) {
      const key = id.toLowerCase();
      if (candidates.get(key) == null) candidates.set(key, id);
    }
    existing.forEach((id) => candidates.delete(id));
    if (options.activeFlightID) candidates.delete(options.activeFlightID.toLowerCase());

    const recovered: string[] = [];
    for (const flightID of [...candidates.keys()].sort()) {
      try {
        const summary = await this.summaryFor(flightID, candidates.get(flightID) ?? flightID);
        if (!summary) continue;
        const result = await this.deps.persistence.store(
          summary,
          options.aircraftProfileID ?? null,
          options.pilotProfileID ?? null,
          'recovered',
        );
        if (result === 'saved' || result === 'savedTrackUnreadable') recovered.push(flightID);
        // saveFailed or discardedEmpty: retried at next launch.
      } catch {
        // One unreadable candidate must not block the rest; it is retried at the next launch.
      }
    }
    return recovered;
  }

  /** Flight ids of `<uuid>.m4a` files in the recordings directory, as spelled in the file name. */
  private async audioFlightIDs(): Promise<string[]> {
    let names: string[] = [];
    try {
      names = await this.deps.audio.listFileNames();
    } catch {
      names = []; // Swift: try? ... ?? []
    }
    return names.flatMap((n) => {
      const m = UUID_M4A.exec(n);
      return m ? [m[1]!] : [];
    });
  }

  /** null when there is nothing to recover or the data cannot be read right now (retried next launch). */
  private async summaryFor(flightID: string, audioID: string): Promise<FlightRecordingSummary | null> {
    let track: TrackPoint[];
    let transcripts: { timestamp: number }[];
    let phases: PhaseMarker[];
    try {
      track = await this.deps.recordingStore.trackPoints(flightID);
      transcripts = await this.deps.recordingStore.transcriptSegments(flightID);
      phases = await this.deps.recordingStore.phaseMarkers(flightID);
    } catch {
      return null;
    }

    const audioPath = this.deps.audio.pathFor(audioID);
    const hasAudio = await this.deps.audio.exists(audioPath);
    if (track.length === 0 && transcripts.length === 0 && !hasAudio) return null;

    const audioSeconds = hasAudio ? await this.deps.audio.durationSeconds(audioPath) : 0;
    const audioCreated = hasAudio ? await this.deps.audio.creationDate(audioPath) : null;

    const now = this.deps.now ?? Date.now;
    const start = track[0]?.timestamp ?? transcripts[0]?.timestamp ?? audioCreated ?? now();
    const end =
      track[track.length - 1]?.timestamp ??
      transcripts[transcripts.length - 1]?.timestamp ??
      start + audioSeconds * 1000;

    return {
      flightID,
      startDate: start,
      endDate: Math.max(end, start),
      trackPointCount: track.length,
      transcriptSegmentCount: transcripts.length,
      departureICAO: null,
      arrivalICAO: null,
      phases,
      audioFileURL: hasAudio ? audioPath : null,
    };
  }
}
