import { act } from 'react';
import { press, render } from '../../../tests/support/ui';
import type { FlightRecord } from '../../data/models';
import { createStore } from 'zustand';
import type { RecordingViewStore } from '../state/recordingStore';
import { DebriefScreen } from '../flights/DebriefScreen';
import { FlightDetailScreen } from '../flights/FlightDetailScreen';
import { ReplayScreen } from '../replay/ReplayScreen';
import { LiveFlight } from './LiveFlight';
import type { FlightScreenStores } from './flightScreens';

jest.mock('../flights/FlightDetailScreen', () => ({
  FlightDetailScreen: jest.fn(() => null),
}));
jest.mock('../flights/DebriefScreen', () => ({ DebriefScreen: jest.fn(() => null) }));
jest.mock('../replay/ReplayScreen', () => ({ ReplayScreen: jest.fn(() => null) }));

const detail = jest.mocked(FlightDetailScreen);
const debrief = jest.mocked(DebriefScreen);
const replay = jest.mocked(ReplayScreen);

const flight = { id: 'f1' } as FlightRecord;
const recording = createStore(() => ({ status: { kind: 'idle' } })) as unknown as RecordingViewStore;
const stores = (withDebrief = true): FlightScreenStores => ({
  detail: {} as never,
  debrief: withDebrief ? ({} as never) : null,
  replay: {} as never,
  dispose: jest.fn(),
});
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

beforeEach(() => {
  detail.mockClear();
  debrief.mockClear();
  replay.mockClear();
});

describe('LiveFlight', () => {
  it('shows nothing until the flight is read, then its detail', async () => {
    const built = stores();
    await render(
      <LiveFlight
        flightId="f1"
        load={async () => flight}
        build={() => built}
        recording={recording}
        databaseOpened
        onClose={jest.fn()}
      />,
    );
    await settle();
    expect(detail).toHaveBeenCalled();
    expect(detail.mock.calls.at(-1)![0].flight).toBe(flight);
    expect(detail.mock.calls.at(-1)![0].databaseOpened).toBe(true);
  });

  it('opens the replay and the debrief from the detail, and Back returns to it', async () => {
    await render(
      <LiveFlight
        flightId="f1"
        load={async () => flight}
        build={() => stores()}
        recording={recording}
        databaseOpened
        onClose={jest.fn()}
      />,
    );
    await settle();
    const nav = () => detail.mock.calls.at(-1)![0].navigation;
    await act(async () => nav().onOpenReplay());
    expect(replay).toHaveBeenCalled();
    await act(async () => replay.mock.calls.at(-1)![0].onBack!());
    await act(async () => nav().onOpenDebrief());
    expect(debrief).toHaveBeenCalled();
    detail.mockClear();
    await act(async () => debrief.mock.calls.at(-1)![0].onBack!());
    expect(detail).toHaveBeenCalled();
  });

  it('a flight that is gone closes the screen', async () => {
    const onClose = jest.fn();
    await render(
      <LiveFlight
        flightId="f1"
        load={async () => null}
        build={() => stores()}
        recording={recording}
        databaseOpened
        onClose={onClose}
      />,
    );
    await settle();
    expect(onClose).toHaveBeenCalled();
    expect(detail).not.toHaveBeenCalled();
  });

  it('a read that fails is not a deleted flight: it says so, logs the flight, and Try again reads it again', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onClose = jest.fn();
    let finishRead: () => void = () => undefined;
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('disk I/O error'))
      .mockImplementationOnce(() => new Promise<FlightRecord>((resolve) => (finishRead = () => resolve(flight))));
    const view = await render(
      <LiveFlight
        flightId="f1"
        load={load}
        build={() => stores()}
        recording={recording}
        databaseOpened
        onClose={onClose}
      />,
    );
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(view.text()).toContain('disk I/O error');
    expect(view.byTestId('flight-load-failed').props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('f1'));
    await press(view.byTestId('flight-load-retry'));
    expect(view.byTestId('flight-load-retrying')).toBeTruthy(); // not a blank screen while the read is pending
    finishRead();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(detail).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('frees the model and the stores when the screen goes away', async () => {
    const built = stores();
    const view = await render(
      <LiveFlight
        flightId="f1"
        load={async () => flight}
        build={() => built}
        recording={recording}
        databaseOpened
        onClose={jest.fn()}
      />,
    );
    await settle();
    await view.unmount();
    expect(built.dispose).toHaveBeenCalled();
  });
});
