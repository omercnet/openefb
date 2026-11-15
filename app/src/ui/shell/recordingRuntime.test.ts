import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { migrate } from '../../data/migrate';
import { flightRecordRepository } from '../../data/repositories';
import { FakeLocationSource, makeFix } from '../../domain/ports/location';
import { FakeMicrophonePermission } from '../../domain/ports/microphonePermission';
import { MockAudioRecorder, MockTranscriptionService } from '../../domain/recording/testSupport';
import { createRecordingRuntime, routeLegsOf, type RecordingFilesLike } from './recordingRuntime';

const files = (existing: string[] = []): RecordingFilesLike => ({
  appSupportRoot: 'file:///support',
  pathFor: (id) => `file:///support/Recordings/${id}.m4a`,
  removeFile: async () => undefined,
  listFileNames: async () => existing,
  exists: async () => true,
  durationSeconds: async () => 60,
  creationDate: async () => null,
});

async function setup(over: { legs?: never[] } = {}) {
  const userDb = await openNodeSqliteDb();
  await migrate(userDb);
  const location = new FakeLocationSource();
  const audio = new MockAudioRecorder();
  const transcription = new MockTranscriptionService();
  const signals: string[] = [];
  const runtime = await createRecordingRuntime({
    userDb,
    openRecordingDb: async () => openNodeSqliteDb(),
    aviation: null,
    location,
    audio,
    makeTranscription: () => transcription,
    microphone: new FakeMicrophonePermission('granted'),
    files: files(),
    telemetry: { signal: ((event: string) => void signals.push(event)) as never },
    activeProfileIds: () => ({ aircraftProfileID: null, pilotProfileID: null }),
    activeRouteLegs: () => over.legs ?? [],
  });
  return { runtime, userDb, location, audio, transcription, signals };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('recording runtime', () => {
  it('a manual flight: start, track, stop, and it is saved as a flight record', async () => {
    const { runtime, userDb, location, audio, transcription, signals } = await setup();
    expect(await runtime.store.getState().startRecording()).toBe('started');
    expect(audio.startRecordingCalled).toBe(true);
    expect(transcription.startTranscriptionCalled).toBe(true);
    expect(runtime.store.getState().status.kind).toBe('recording');
    location.emitFix(makeFix({ timestampMs: 1_000, speedMps: 40 }));
    location.emitFix(makeFix({ timestampMs: 2_000, speedMps: 41 }));
    await settle();
    await runtime.store.getState().confirmStop();
    expect(runtime.store.getState().lastPersistenceResult).toBe('saved');
    const flights = await flightRecordRepository(userDb).list();
    expect(flights).toHaveLength(1);
    expect(signals).toEqual(['Recording.started', 'Recording.stopped']);
    runtime.dispose();
  });

  it('a recording with no track is discarded, not saved', async () => {
    const { runtime, userDb } = await setup();
    await runtime.store.getState().startRecording();
    await runtime.store.getState().confirmStop();
    expect(runtime.store.getState().lastPersistenceResult).toBe('discardedEmpty');
    expect(await flightRecordRepository(userDb).list()).toHaveLength(0);
    runtime.dispose();
  });

  it('the plan being flown is stored with the flight', async () => {
    const legs = [{ fromCode: 'AAA', toCode: 'BBB' }] as never[];
    const { runtime, location } = await setup({ legs });
    await runtime.store.getState().startRecording();
    location.emitFix(makeFix({ timestampMs: 1_000 }));
    await settle();
    const flightId = runtime.store.getState().activeFlightId!;
    await runtime.store.getState().confirmStop();
    expect(await runtime.database.routeLegs(flightId)).toEqual([{ from: 'AAA', to: 'BBB' }]);
    runtime.dispose();
  });

  it('recovery leaves the recording in progress alone', async () => {
    const { runtime, location } = await setup();
    await runtime.store.getState().startRecording();
    location.emitFix(makeFix({ timestampMs: 1_000 }));
    await settle();
    expect(await runtime.recoverOrphans({ aircraftProfileID: null, pilotProfileID: null })).toEqual([]);
    await runtime.store.getState().confirmStop();
    runtime.dispose();
  });

  it('recovery also leaves an auto-started recording alone (the store never saw its flight id)', async () => {
    const { runtime, location } = await setup();
    await runtime.coordinator.startRecording(); // what the auto-start monitor does: not through the store
    expect(runtime.store.getState().activeFlightId).toBeNull();
    location.emitFix(makeFix({ timestampMs: 1_000 }));
    await settle();
    const serial = runtime.store.getState().persistenceSerial;
    expect(await runtime.recoverOrphans({ aircraftProfileID: null, pilotProfileID: null })).toEqual([]);
    expect(runtime.store.getState().persistenceSerial).toBe(serial);
    await runtime.store.getState().confirmStop();
    runtime.dispose();
  });

  it('route legs keep the from and to codes', () => {
    expect(routeLegsOf([{ fromCode: 'A', toCode: 'B' }] as never)).toEqual([{ from: 'A', to: 'B' }]);
  });
});
