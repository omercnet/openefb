// Ports of ServiceTests/FlightPersistenceTests (3), CharacterizationTests/FlightPersistenceStopPathCharacterizationTests
// (8) and ServiceTests/FlightRecoveryTests (5), over the real data layer (node sqlite) with an in-memory file system.
// Not ported (SwiftData plumbing): the `ctx.hasChanges == false` assertions; repository writes are immediate here.
import { migrate } from '../../data/migrate';
import {
  newDebriefRecord,
  newPhaseMarker,
  newTrackPoint,
  newTranscriptSegment,
  openRecordingDatabase,
} from '../../data/recording';
import type { RecordingDatabase } from '../../data/recording';
import type { Db } from '../../data/db';
import { newFlightRecord } from '../../data/defaults';
import { flightRecordRepository, logbookRepository } from '../../data/repositories';
import { healthWarning, isRecovered, isTrackUnreadable } from '../../data/models';
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import {
  FlightPersistenceService,
  relativeToApplicationSupport,
  type AirportKind,
  type NearbyAirport,
} from './flightPersistence';
import { FlightRecoveryService, type RecoveryAudioFiles } from './flightRecovery';
import type { FlightRecordingSummary } from './recordingCoordinator';

const start = 1_700_000_000_000;
let n = 0;
const uuid = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

class FakeFiles implements RecoveryAudioFiles {
  files = new Map<string, { created: number | null; seconds: number }>();
  constructor(readonly dir = '/app/efb-212/recordings') {}
  pathFor(id: string): string {
    return `${this.dir}/${id}.m4a`;
  }
  add(id: string): string {
    const p = this.pathFor(id);
    this.files.set(p, { created: null, seconds: 0 });
    return p;
  }
  async listFileNames(): Promise<string[]> {
    return [...this.files.keys()].map((p) => p.slice(this.dir.length + 1));
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async durationSeconds(p: string): Promise<number> {
    return this.files.get(p)?.seconds ?? 0;
  }
  async creationDate(p: string): Promise<number | null> {
    return this.files.get(p)?.created ?? null;
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
}

interface Fixture {
  rdb: Db;
  recording: RecordingDatabase;
  mainDb: Db;
  flightsRepo: ReturnType<typeof flightRecordRepository>;
  logbookRepo: ReturnType<typeof logbookRepository>;
  files: FakeFiles;
  service: (airports?: NearbyAirport[] | null) => FlightPersistenceService;
}

async function makeFixture(): Promise<Fixture> {
  const rdb = openNodeSqliteDb();
  const recording = await openRecordingDatabase(rdb);
  const mainDb = openNodeSqliteDb();
  await migrate(mainDb);
  const files = new FakeFiles();
  const flightsRepo = flightRecordRepository(mainDb);
  const logbookRepo = logbookRepository(mainDb);
  const service = (airports: NearbyAirport[] | null = null): FlightPersistenceService =>
    new FlightPersistenceService({
      recordingStore: recording,
      db: mainDb,
      airports: airports === null ? null : { nearestAirports: async () => airports },
      removeFile: (p) => files.remove(p),
      appSupportRoot: '/app',
      now: () => start,
      newId: uuid,
    });
  return { rdb, recording, mainDb, flightsRepo, logbookRepo, files, service };
}

function summary(
  flightID: string,
  durationSeconds: number,
  points: number,
  audio: string | null = null,
): FlightRecordingSummary {
  return {
    flightID,
    startDate: start,
    endDate: start + durationSeconds * 1000,
    trackPointCount: points,
    transcriptSegmentCount: 0,
    departureICAO: null,
    arrivalICAO: null,
    phases: [],
    audioFileURL: audio,
  };
}

const airport = (icao: string, type: AirportKind): NearbyAirport => ({ icao, name: icao, type });
const kpao = airport('KPAO', 'airport');

async function insertTrack(f: Fixture, flightID: string, count: number, spacingSeconds = 10): Promise<void> {
  for (let i = 0; i < count; i++) {
    await f.recording.insertTrackPoint(
      newTrackPoint({
        flightID,
        timestamp: start + i * spacingSeconds * 1000,
        latitude: 37.4611,
        longitude: -122.115,
        altitudeFeet: 1000,
        groundSpeedKnots: 90,
        verticalSpeedFPM: 0,
        courseDegrees: 90,
      }),
    );
  }
}

describe('FlightPersistence Tests', () => {
  test('stopWithTrackCreatesOneFlightRecordAndOneDraftLogbookEntry', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 5, 24);
    const aircraft = uuid();
    const pilot = uuid();

    const result = await f.service([kpao]).persist(summary(flightID, 120, 5), aircraft, pilot);

    expect(result).toBe('saved');
    const flights = await f.flightsRepo.list();
    expect(flights).toHaveLength(1);
    const flight = flights[0]!;
    expect(flight.id).toBe(flightID);
    expect(flight.startDate).toBe(start);
    expect(flight.durationSeconds).toBe(120);
    expect(flight.trackPointCount).toBe(5);
    expect(flight.departureICAO).toBe('KPAO');
    expect(flight.arrivalICAO).toBe('KPAO');
    expect(flight.aircraftProfileID).toBe(aircraft);
    expect(flight.pilotProfileID).toBe(pilot);

    const entries = await f.logbookRepo.list();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.flightID).toBe(flightID);
    expect(entry.date).toBe(start);
    expect(entry.departureICAO).toBe('KPAO');
    expect(entry.durationSeconds).toBe(120);
    expect(entry.isConfirmed).toBe(false);
  });

  test('stopWithNoTrackPointsDiscardsEverything', async () => {
    const f = await makeFixture();
    const result = await f.service([kpao]).persist(summary(uuid(), 5, 0), null, null);
    expect(result).toBe('discardedEmpty');
    expect(await f.flightsRepo.list()).toHaveLength(0);
    expect(await f.logbookRepo.list()).toHaveLength(0);
  });

  test('unavailableAirportDatabaseStillSavesWithoutAirports', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 1);
    const result = await f.service(null).persist(summary(flightID, 60, 1), null, null);
    expect(result).toBe('saved');
    const flight = (await f.flightsRepo.list())[0]!;
    expect(flight.departureICAO).toBeNull();
    expect(await f.logbookRepo.list()).toHaveLength(1);
  });
});

describe('Characterization: FlightPersistence stop path', () => {
  test('unreadableTrackTableKeepsTheFlightItsAudioAndItsDataAndMarksItDamaged', async () => {
    const f = await makeFixture();
    const audio = f.files.add('audio-1');
    const flightID = uuid();
    await insertTrack(f, flightID, 3);
    await f.recording.insertTranscript(
      newTranscriptSegment({
        flightID,
        timestamp: start,
        text: 'Palo Alto tower',
        confidence: 0.9,
        audioStartTime: 0,
        audioEndTime: 1,
        flightPhase: 'taxi',
      }),
    );
    await f.rdb.run('DROP TABLE track_points');

    const result = await f.service(null).persist(summary(flightID, 600, 3, audio), null, null);

    // A READ error is not an empty flight: nothing is deleted, the flight is marked damaged.
    expect(result).toBe('savedTrackUnreadable');
    const flight = (await f.flightsRepo.list())[0]!;
    expect(flight.id).toBe(flightID);
    expect(isTrackUnreadable(flight)).toBe(true);
    expect(healthWarning(flight)).toBe('Track damaged');
    expect(flight.trackPointCount).toBe(3); // the coordinator's count; the table cannot be read
    expect(await f.logbookRepo.list()).toHaveLength(1);
    expect(f.files.files.has(audio)).toBe(true);
    expect(await f.recording.transcriptSegments(flightID)).toHaveLength(1);
  });

  test('emptyFlightDiscardRemovesAudioTranscriptPhasesAndDebrief', async () => {
    const f = await makeFixture();
    const audio = f.files.add('audio-2');
    const flightID = uuid();
    await f.recording.insertTranscript(
      newTranscriptSegment({
        flightID,
        timestamp: start,
        text: 'ground, ready to taxi',
        confidence: 0.8,
        audioStartTime: 0,
        audioEndTime: 2,
        flightPhase: 'preflight',
      }),
    );
    await f.recording.insertPhaseMarker(
      newPhaseMarker({ flightID, phase: 'taxi', startTimestamp: start, latitude: 37.4611, longitude: -122.115 }),
    );
    await f.recording.insertDebrief(
      newDebriefRecord({
        flightID,
        narrativeSummary: 'Short ground run.',
        phaseObservationsJSON: '[]',
        improvementsJSON: '[]',
        overallRating: 3,
      }),
    );

    const result = await f.service(null).persist(summary(flightID, 30, 0, audio), null, null);

    expect(result).toBe('discardedEmpty');
    expect(f.files.files.has(audio)).toBe(false);
    expect(await f.recording.transcriptSegments(flightID)).toHaveLength(0);
    expect(await f.recording.phaseMarkers(flightID)).toHaveLength(0);
    expect(await f.recording.debrief(flightID)).toBeNull(); // discarding also removes the debrief row
  });

  test('savedTrackPointCountComesFromDatabaseRowsNotSummary', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 5);
    const result = await f.service(null).persist(summary(flightID, 1830, 99), null, null);
    expect(result).toBe('saved');
    const flight = (await f.flightsRepo.list())[0]!;
    expect(flight.trackPointCount).toBe(5); // database rows, not the summary's 99
    expect(flight.durationSeconds).toBe(1830);
  });

  test('departurePrefersLaterRealAirportOverNearerHeliportAndSeaplaneBase', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 2);
    const result = await f
      .service([airport('15CA', 'heliport'), airport('S00', 'seaplane'), airport('KPAO', 'airport')])
      .persist(summary(flightID, 60, 2), null, null);
    expect(result).toBe('saved');
    const flight = (await f.flightsRepo.list())[0]!;
    expect(flight.departureICAO).toBe('KPAO');
    expect(flight.arrivalICAO).toBe('KPAO');
  });

  test('onlyHeliportsNearbyUsesTheFirstHeliport', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 2);
    await f
      .service([airport('15CA', 'heliport'), airport('16CA', 'heliport')])
      .persist(summary(flightID, 60, 2), null, null);
    const flight = (await f.flightsRepo.list())[0]!;
    expect(flight.departureICAO).toBe('15CA');
    expect(flight.arrivalICAO).toBe('15CA');
  });

  test('audioPathInsideApplicationSupportIsStoredRelative', () => {
    expect(relativeToApplicationSupport('/app/efb-212/recordings/ABC.m4a', '/app')).toBe('efb-212/recordings/ABC.m4a');
  });

  test('a file:// URI inside Application Support is stored relative', () => {
    expect(relativeToApplicationSupport('file:///app/efb-212/recordings/ABC.m4a', '/app')).toBe(
      'efb-212/recordings/ABC.m4a',
    );
    expect(relativeToApplicationSupport('/app/efb-212/recordings/ABC.m4a', 'file:///app/')).toBe(
      'efb-212/recordings/ABC.m4a',
    );
    expect(relativeToApplicationSupport('file:///tmp/x.m4a', '/app')).toBe('file:///tmp/x.m4a');
  });

  test('audioPathOutsideApplicationSupportIsStoredAbsolute', () => {
    expect(relativeToApplicationSupport('/tmp/x.m4a', '/app')).toBe('/tmp/x.m4a');
  });

  test('persistSavesTheContextExplicitly', async () => {
    // Swift asserts ctx.hasChanges == false; here the equivalent is that both rows are already in the stores.
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 2);
    expect(await f.service(null).persist(summary(flightID, 60, 2), null, null)).toBe('saved');
    expect(await f.flightsRepo.get(flightID)).not.toBeNull();
    expect(await f.logbookRepo.byFlightId(flightID)).toHaveLength(1);
  });

  // Not in Swift: the saveFailed outcome (the insert is rejected).
  test('a rejected insert reports saveFailed and leaves the recording data untouched', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 2);
    await f.flightsRepo.insert(newFlightRecord({ id: flightID, now: () => start }));
    expect(await f.service(null).persist(summary(flightID, 60, 2), null, null)).toBe('saveFailed');
    expect(await f.recording.trackPoints(flightID)).toHaveLength(2);
  });
});

describe('FlightPersistence transaction', () => {
  // Not in Swift: Swift saved both rows in one context save; here one db transaction gives the same atomicity.
  test('a failing logbook insert rolls the flight row back', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 2);
    await f.mainDb.run('DROP TABLE logbook_entry');

    expect(await f.service(null).persist(summary(flightID, 60, 2), null, null)).toBe('saveFailed');
    expect(await f.flightsRepo.list()).toHaveLength(0);
    expect(await f.recording.trackPoints(flightID)).toHaveLength(2); // recording data untouched
  });
});

describe('FlightRecovery Tests', () => {
  async function recovery(f: Fixture): Promise<FlightRecoveryService> {
    return new FlightRecoveryService({
      recordingStore: f.recording,
      persistence: f.service(null),
      flights: f.flightsRepo,
      audio: f.files,
      now: () => start,
    });
  }

  test('orphanedTrackAndAudioBecomeARecoveredFlightAndDraftLogbookEntry', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 4);
    await f.recording.insertTranscript(
      newTranscriptSegment({
        flightID,
        timestamp: start,
        text: 'Palo Alto traffic',
        confidence: 0.9,
        audioStartTime: 0,
        audioEndTime: 1,
        flightPhase: 'taxi',
      }),
    );
    const audio = f.files.add(flightID);

    const recovered = await (await recovery(f)).recoverOrphans();

    expect(recovered).toEqual([flightID]);
    const flight = (await f.flightsRepo.list())[0]!;
    expect(flight.id).toBe(flightID);
    expect(isRecovered(flight)).toBe(true);
    expect(healthWarning(flight)).toBe('Recovered');
    expect(flight.trackPointCount).toBe(4);
    expect(flight.transcriptSegmentCount).toBe(1);
    expect(flight.startDate).toBe(start);
    expect(flight.durationSeconds).toBe(30); // first to last fix
    expect(flight.audioFileURL?.endsWith(`${flightID}.m4a`)).toBe(true);
    expect(await f.logbookRepo.list()).toHaveLength(1);
    // Nothing was deleted.
    expect(f.files.files.has(audio)).toBe(true);
    expect(await f.recording.trackPoints(flightID)).toHaveLength(4);
  });

  test('recoveryRunsOnceAndSkipsFlightsThatAlreadyHaveARecord', async () => {
    const f = await makeFixture();
    const orphan = uuid();
    const saved = uuid();
    await insertTrack(f, orphan, 2);
    await insertTrack(f, saved, 2);
    await f.flightsRepo.insert(newFlightRecord({ id: saved, now: () => start }));

    const service = await recovery(f);
    expect(await service.recoverOrphans()).toEqual([orphan]);
    expect(await service.recoverOrphans()).toEqual([]);
    const flights = await f.flightsRepo.list();
    expect(new Set(flights.map((x) => x.id))).toEqual(new Set([orphan, saved]));
    expect(flights).toHaveLength(2);
    expect(isRecovered(flights.find((x) => x.id === saved)!)).toBe(false);
  });

  test('aRecordingInProgressIsNeverRecovered', async () => {
    const f = await makeFixture();
    const active = uuid();
    await insertTrack(f, active, 3);
    expect(await (await recovery(f)).recoverOrphans({ activeFlightID: active })).toEqual([]);
    expect(await f.flightsRepo.list()).toHaveLength(0);
  });

  test('audioWithNoTrackIsStillRecoveredNotDeleted', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    const audio = f.files.add(flightID);
    expect(await (await recovery(f)).recoverOrphans()).toEqual([flightID]);
    const flight = (await f.flightsRepo.list())[0]!;
    expect(flight.trackPointCount).toBe(0);
    expect(isRecovered(flight)).toBe(true);
    expect(f.files.files.has(audio)).toBe(true);
  });

  test('an uppercase audio file name is found by a case-preserving file lookup', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    const upper = flightID.toUpperCase();
    f.files.add(upper); // stored under the upper-case spelling
    const service = new FlightRecoveryService({
      recordingStore: f.recording,
      persistence: f.service(null),
      flights: f.flightsRepo,
      audio: f.files, // pathFor preserves the id's case, exists is case-sensitive
      now: () => start,
    });
    expect(await service.recoverOrphans()).toEqual([flightID]);
    expect((await f.flightsRepo.list())[0]!.audioFileURL?.endsWith(`${upper}.m4a`)).toBe(true);
  });

  test('a failing audio read for one orphan does not block the others', async () => {
    const f = await makeFixture();
    const bad = uuid();
    const good = uuid();
    await insertTrack(f, bad, 2);
    await insertTrack(f, good, 2);
    const audio: RecoveryAudioFiles = {
      listFileNames: () => f.files.listFileNames(),
      pathFor: (id) => f.files.pathFor(id),
      exists: async (p) => {
        if (p.includes(bad)) throw new Error('io error');
        return false;
      },
      durationSeconds: async () => 0,
      creationDate: async () => null,
    };
    const service = new FlightRecoveryService({
      recordingStore: f.recording,
      persistence: f.service(null),
      flights: f.flightsRepo,
      audio,
      now: () => start,
    });
    const recovered = await service.recoverOrphans();
    expect(recovered).toEqual([good]);
    expect(await f.flightsRepo.get(bad)).toBeNull(); // left for the next launch
  });

  test('anOrphanWhoseTrackCannotBeReadIsLeftUntouchedForTheNextLaunch', async () => {
    const f = await makeFixture();
    const flightID = uuid();
    await insertTrack(f, flightID, 2);
    const audio = f.files.add(flightID);
    await f.rdb.run('ALTER TABLE track_points RENAME TO track_points_hidden');

    // The read error must not turn into a deletion or a half-built record.
    expect(await (await recovery(f)).recoverOrphans()).toEqual([]);
    expect(await f.flightsRepo.list()).toHaveLength(0);
    expect(f.files.files.has(audio)).toBe(true);
  });
});
