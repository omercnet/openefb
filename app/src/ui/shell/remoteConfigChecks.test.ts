import type { RecordingStatus } from '../../domain/recording/recordingCoordinator';
import { EMPTY_FLIGHT_LOG, flightLog, type FlightLogData } from '../flightLog/store';
import { startRemoteConfigChecks } from './remoteConfigChecks';

function setup() {
  const refreshIfDue = jest.fn(async (_recordingActive: boolean) => undefined);
  const store = flightLog.make(EMPTY_FLIGHT_LOG);
  let active: ((isActive: boolean) => void) | null = null;
  const stop = startRemoteConfigChecks({
    store: { refreshIfDue },
    flightLog: store,
    appActive: { subscribe: (l) => ((active = l), () => undefined) },
  });
  const recording = (status: RecordingStatus | null) =>
    store.setState({
      recording: status ? { status, elapsedSeconds: 0, levelDBFS: -160, microphoneDenied: false } : null,
    } as Partial<FlightLogData>);
  return { refreshIfDue, recording, becomeActive: () => active!(true), becomeInactive: () => active!(false), stop };
}

describe('remote config checks (ContentView.checkRemoteConfig)', () => {
  it('checks at launch, not recording', () => {
    const { refreshIfDue, stop } = setup();
    expect(refreshIfDue).toHaveBeenCalledWith(false);
    stop();
  });

  it('checks again whenever the app becomes active, not when it leaves', () => {
    const { refreshIfDue, becomeActive, becomeInactive, stop } = setup();
    becomeInactive();
    expect(refreshIfDue).toHaveBeenCalledTimes(1);
    becomeActive();
    expect(refreshIfDue).toHaveBeenCalledTimes(2);
    stop();
  });

  it('a check skipped while recording is retried when the recording ends', () => {
    const { refreshIfDue, recording, becomeActive, stop } = setup();
    recording({ kind: 'recording' });
    becomeActive();
    expect(refreshIfDue).toHaveBeenLastCalledWith(true);
    recording(null);
    expect(refreshIfDue).toHaveBeenLastCalledWith(false);
    expect(refreshIfDue).toHaveBeenCalledTimes(3);
    stop();
  });

  it('stopping detaches the recording watch', () => {
    const { refreshIfDue, recording, stop } = setup();
    recording({ kind: 'recording' });
    stop();
    recording(null);
    expect(refreshIfDue).toHaveBeenCalledTimes(1);
  });
});
