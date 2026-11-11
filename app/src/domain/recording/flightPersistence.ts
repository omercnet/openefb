// Port of efb-212/Services/Recording/FlightPersistenceService.swift: turns a stopped recording into user data,
// one FlightRecord (History, Replay, Debrief) and one draft LogbookEntry (isConfirmed false). The FlightRecord id equals
// the recording-database flight id.
//
// Empty-recording policy: a recording with NO track points is discarded (rows and audio deleted). A track READ error is
// not an empty track: the flight and its audio are kept and the record is marked damaged.
//
// Differences from Swift (app/docs/port-notes/L4.md): SwiftData ModelContext becomes the data-layer repositories, file
// deletion and the Application Support root are injected, and the airport lookup is an injected async interface.

import { newFlightRecord, newLogbookEntry } from '../../data/defaults';
import { RECOVERED_NOTE, TRACK_UNREADABLE_NOTE } from '../../data/models';
import type { FlightRecord, LogbookEntry } from '../../data/models';
import type { Repository } from '../../data/repositories/table';
import type { TrackPoint } from './types';
import type { FlightRecordingSummary } from './recordingCoordinator';

export type FlightPersistenceResult = 'saved' | 'discardedEmpty' | 'savedTrackUnreadable' | 'saveFailed';

/** Why a FlightRecord is being created. */
export type PersistenceOrigin = 'stopped' | 'recovered';

export type AirportKind = 'airport' | 'heliport' | 'seaplane' | 'ultralight';

export interface NearbyAirport {
  icao: string;
  name: string;
  type: AirportKind;
}

/** The slice of the aviation database the lookup needs (DatabaseServiceProtocol.nearestAirports). */
export interface AirportLookup {
  nearestAirports(center: { lat: number; lon: number }, count: number): Promise<NearbyAirport[]>;
}

/** The slice of RecordingDatabase persistence uses. */
export interface PersistenceRecordingStore {
  trackPoints(flightID: string): Promise<TrackPoint[]>;
  deleteFlightData(flightID: string): Promise<void>;
}

export interface FlightPersistenceDeps {
  recordingStore: PersistenceRecordingStore;
  flights: Repository<FlightRecord>;
  logbook: Repository<LogbookEntry>;
  /** null = aviation database unavailable: departure and arrival stay empty. */
  airports: AirportLookup | null;
  /** Deletes a file; failures are ignored by the caller (Swift try?). */
  removeFile(path: string): Promise<void>;
  /** Application Support directory (no trailing slash needed); null when unknown. */
  appSupportRoot?: string | null;
  now?: () => number;
  newId?: () => string;
}

/**
 * FlightRecord stores audio relative to Application Support (Replay re-roots it). Paths outside it are kept as-is so
 * nothing is silently lost.
 */
export function relativeToApplicationSupport(path: string, appSupportRoot: string | null): string {
  if (!appSupportRoot) return path;
  const root = appSupportRoot.replace(/\/+$/, '') + '/';
  return path.startsWith(root) ? path.slice(root.length) : path;
}

export class FlightPersistenceService {
  constructor(private readonly deps: FlightPersistenceDeps) {}

  async persist(
    summary: FlightRecordingSummary,
    aircraftProfileID: string | null,
    pilotProfileID: string | null,
  ): Promise<FlightPersistenceResult> {
    return this.store(summary, aircraftProfileID, pilotProfileID, 'stopped');
  }

  /**
   * Create the FlightRecord and draft logbook entry. Never deletes anything when the track cannot be read.
   */
  async store(
    summary: FlightRecordingSummary,
    aircraftProfileID: string | null,
    pilotProfileID: string | null,
    origin: PersistenceOrigin,
  ): Promise<FlightPersistenceResult> {
    // The database is the truth for the track, not the coordinator's counter.
    let track: TrackPoint[] = [];
    let trackUnreadable = false;
    try {
      track = await this.deps.recordingStore.trackPoints(summary.flightID);
    } catch {
      track = [];
      trackUnreadable = true;
    }

    // Recovery keeps flights with audio or transcript but no track; only a normal stop discards.
    if (!trackUnreadable && track.length === 0 && origin === 'stopped') {
      await this.discard(summary);
      return 'discardedEmpty';
    }

    const first = track[0];
    const last = track[track.length - 1];
    const departure = first ? await this.nearestAirport(first.latitude, first.longitude) : null;
    const arrival = last ? await this.nearestAirport(last.latitude, last.longitude) : null;

    const factory = { now: this.deps.now, newId: this.deps.newId };
    const note = trackUnreadable ? TRACK_UNREADABLE_NOTE : origin === 'recovered' ? RECOVERED_NOTE : null;
    const flight = newFlightRecord({
      ...factory,
      id: summary.flightID,
      startDate: summary.startDate,
      endDate: summary.endDate,
      durationSeconds: (summary.endDate - summary.startDate) / 1000,
      departureICAO: departure?.icao ?? null,
      departureName: departure?.name ?? null,
      arrivalICAO: arrival?.icao ?? null,
      arrivalName: arrival?.name ?? null,
      trackPointCount: trackUnreadable ? summary.trackPointCount : track.length,
      transcriptSegmentCount: summary.transcriptSegmentCount,
      audioFileURL:
        summary.audioFileURL === null
          ? null
          : relativeToApplicationSupport(summary.audioFileURL, this.deps.appSupportRoot ?? null),
      aircraftProfileID,
      pilotProfileID,
      notes: note,
    });

    // LogbookViewModel.createFromRecording (ticket U7): aircraftType is filled later in the logbook edit view.
    // TODO(U7): call the logbook module once it exists.
    const entry = newLogbookEntry({
      ...factory,
      flightID: summary.flightID,
      date: summary.startDate,
      departureICAO: departure?.icao ?? null,
      departureName: departure?.name ?? null,
      arrivalICAO: arrival?.icao ?? null,
      arrivalName: arrival?.name ?? null,
      durationSeconds: (summary.endDate - summary.startDate) / 1000,
      aircraftProfileID,
      aircraftType: null,
      pilotProfileID,
      isConfirmed: false,
    });

    // Saved explicitly: a kill right after stop must not lose the History row while track and audio stay. On failure the
    // recording data is untouched, so launch-time recovery rebuilds the record.
    try {
      await this.deps.flights.insert(flight);
      await this.deps.logbook.insert(entry);
    } catch {
      return 'saveFailed';
    }
    return trackUnreadable ? 'savedTrackUnreadable' : 'saved';
  }

  /** Nearest real airport of the 8 closest: a heliport or seaplane base is a poor departure for a logbook. */
  private async nearestAirport(lat: number, lon: number): Promise<NearbyAirport | null> {
    const lookup = this.deps.airports;
    if (!lookup) return null;
    let nearby: NearbyAirport[] = [];
    try {
      nearby = await lookup.nearestAirports({ lat, lon }, 8);
    } catch {
      nearby = []; // Swift: try? ... ?? []
    }
    return nearby.find((a) => a.type === 'airport') ?? nearby[0] ?? null;
  }

  /** Delete a recording with no track. Only reached after the track was READ successfully and was empty. */
  private async discard(summary: FlightRecordingSummary): Promise<void> {
    try {
      await this.deps.recordingStore.deleteFlightData(summary.flightID);
    } catch {
      // Swift: try?
    }
    if (summary.audioFileURL !== null) {
      try {
        await this.deps.removeFile(summary.audioFileURL);
      } catch {
        // Swift: try?
      }
    }
  }
}
