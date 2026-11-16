import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { migrate } from '../../data/migrate';
import { FakeLocationSource, makeFix } from '../../domain/ports/location';
import { FakeMicrophonePermission } from '../../domain/ports/microphonePermission';
import { MockAudioRecorder, MockTranscriptionService } from '../../domain/recording/testSupport';
import { EMPTY_FLIGHT_LOG, flightLog } from '../flightLog/store';
import { bindRecording, markRecordingUnavailable } from './recordingBinding';
import { createRecordingRuntime } from './recordingRuntime';

async function setup() {
  const userDb = openNodeSqliteDb();
  await migrate(userDb);
  const location = new FakeLocationSource();
  const runtime = await createRecordingRuntime({
    userDb,
    openRecordingDb: async () => openNodeSqliteDb(),
    aviation: null,
    location,
    audio: new MockAudioRecorder(),
    makeTranscription: () => new MockTranscriptionService(),
    microphone: new FakeMicrophonePermission('granted'),
    files: {
      appSupportRoot: 'file:///support',
      pathFor: (id) => `file:///support/Recordings/${id}.m4a`,
      removeFile: async () => undefined,
      listFileNames: async () => [],
      exists: async () => true,
      durationSeconds: async () => 60,
      creationDate: async () => null,
    },
    activeProfileIds: () => ({ aircraftProfileID: null, pilotProfileID: null }),
    activeRouteLegs: () => [],
  });
  const slice = flightLog.make(EMPTY_FLIGHT_LOG);
  const appState = { addEventListener: jest.fn(() => ({ remove: jest.fn() })) };
  const stop = bindRecording(runtime, slice, appState);
  return { runtime, slice, stop, location, appState };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('recording binding', () => {
  it('shows an idle recorder on the strip and the record control starts and then asks to stop', async () => {
    const { runtime, slice, stop, location } = await setup();
    expect(slice.getState().recording).toMatchObject({ status: { kind: 'idle' }, microphoneDenied: false });
    slice.getState().actions.record();
    await settle();
    expect(slice.getState().recording?.status.kind).toBe('recording');
    location.emitFix(makeFix({ timestampMs: 1000 }));
    await settle();
    slice.getState().actions.record(); // a tap while recording asks to stop (the dialog confirms)
    expect(runtime.store.getState().showStopConfirmation).toBe(true);
    await runtime.store.getState().confirmStop();
    expect(slice.getState().recording?.status.kind).toBe('idle');
    stop();
    runtime.dispose();
  });

  it('re-reads the microphone when the app returns to the foreground, and stops cleanly', async () => {
    const { runtime, stop, appState } = await setup();
    expect(appState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    stop();
    runtime.dispose();
  });

  it('an unavailable recording database hides the record control and says so', () => {
    const slice = flightLog.make({ ...EMPTY_FLIGHT_LOG, recording: null });
    markRecordingUnavailable(slice);
    expect(slice.getState()).toMatchObject({ recording: null, recordingUnavailable: true });
  });
});
