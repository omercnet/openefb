import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { createFakeNetworkStatus } from '../../adapters/network';
import { FakeLocationSource } from '../../domain/ports/location';
import type { RemoteNotice } from '../../services/remoteConfig';
import { UPDATE_BANNER_ID } from '../../services/remoteConfigStore';
import { layers } from '../columns/layers/store';
import { nearest } from '../columns/nearest/store';
import { EMPTY_FLIGHT_LOG, flightLog } from '../flightLog/store';
import { appStore } from '../state/appStore';
import { gps } from '../state/gps';
import { regionSlice } from '../state/region';
import { applyCaptureSeeds } from '../capture/seeds';
import { resetLiveSlices } from './resetSlices';
import { LiveApp } from './LiveApp';
import type { AppRuntime } from './runtime';

// The map is a native view and the screen is covered by its own tests; here it only marks that it is mounted.
jest.mock('../screens/MapScreen', () => ({ MapScreen: () => null }));

function fakeRemoteConfig(over: Record<string, unknown> = {}) {
  let version = 0;
  const listeners = new Set<() => void>();
  const dismissed = new Set<string>();
  const store = {
    updateRequest: null as { kind: 'required' | 'recommended'; message: string } | null,
    notices: (): RemoteNotice[] => [],
    isBannerDismissed: (id: string) => dismissed.has(id),
    dismissBanner: (id: string) => {
      dismissed.add(id);
      version += 1;
      for (const l of listeners) l();
    },
    subscribe: (l: () => void) => (listeners.add(l), () => listeners.delete(l)),
    getVersion: () => version,
    refreshIfDue: jest.fn(async () => undefined),
    ...over,
  };
  return store;
}

function runtime(over: Partial<AppRuntime['started']> = {}) {
  const network = createFakeNetworkStatus(false);
  const location = new FakeLocationSource();
  const remote = fakeRemoteConfig();
  const rt = {
    started: {
      userDb: {},
      userDbInMemory: false,
      region: 'us',
      aviation: null,
      databaseError: null,
      israel: null,
      remoteConfig: remote,
      ...over,
    },
    weather: {},
    tfr: {},
    advisories: {},
    location,
    network,
  } as unknown as AppRuntime;
  return { rt, network, location, remote };
}

beforeEach(() => {
  appStore.setState({ databaseError: null });
  flightLog.store.setState(EMPTY_FLIGHT_LOG);
  gps.store.setState({ status: { kind: 'lost', ageSeconds: null }, failure: null });
});

describe('LiveApp (ContentView)', () => {
  afterEach(() => jest.useRealTimers());

  it('shows no banner when everything opened', async () => {
    const { rt } = runtime();
    const view = await render(<LiveApp runtime={rt} />);
    expect(view.all((n) => n.props.testID === 'databaseUnavailableBanner')).toHaveLength(0);
    expect(view.all((n) => n.props.testID === 'remoteConfigBanner')).toHaveLength(0);
  });

  it('shows the red banner when the aviation database failed to open', async () => {
    const { rt } = runtime({ databaseError: { kind: 'databaseCorrupted' } });
    const view = await render(<LiveApp runtime={rt} />);
    expect(view.byTestId('databaseUnavailableBanner')).toBeTruthy();
    expect(appStore.getState().databaseError).toEqual({ kind: 'databaseCorrupted' });
  });

  it('shows a required update first and the notices after, and a dismissed one goes away', async () => {
    const { rt, remote } = runtime();
    remote.updateRequest = { kind: 'required', message: 'Please update Kanaf' };
    const view = await render(<LiveApp runtime={rt} />);
    expect(view.text()).toContain('Please update Kanaf');
    expect(view.text()).toContain('Open the App Store');
    await act(async () => remote.dismissBanner(UPDATE_BANNER_ID));
    expect(view.text()).not.toContain('Please update Kanaf');
  });

  it('checks the remote config at launch, with no recording', async () => {
    const { rt, remote } = runtime();
    await render(<LiveApp runtime={rt} />);
    expect(remote.refreshIfDue).toHaveBeenCalledWith(false);
  });

  it('connects the services: the saved region, a fix and the network reach the slices', async () => {
    const { rt, network, location } = runtime({ region: 'israel' });
    await render(<LiveApp runtime={rt} />);
    expect(regionSlice.store.getState().region).toBe('israel');
    await act(async () => network.set(true));
    expect(flightLog.store.getState().isOffline).toBe(true);
    await act(async () =>
      location.emitFix({
        lat: 32,
        lon: 34.8,
        altitudeM: 50,
        horizontalAccuracyM: 5,
        verticalAccuracyM: 5,
        speedMps: 0,
        courseDeg: 0,
        timestampMs: Date.now(),
      }),
    );
    expect(nearest.store.getState().ownship).toEqual({ lat: 32, lon: 34.8 });
    expect(gps.store.getState().status).toEqual({ kind: 'ok' });
  });

  it('starts from launch state even if a capture route left fixtures in the slices', async () => {
    const { rt, remote } = runtime({ region: 'israel' });
    flightLog.store.setState({
      recording: { status: { kind: 'recording' }, elapsedSeconds: 6, levelDBFS: -20, microphoneDenied: false },
    });
    resetLiveSlices('israel');
    expect(flightLog.store.getState().region).toBe('israel'); // from the first render, not after an effect
    await render(<LiveApp runtime={rt} />);
    expect(flightLog.store.getState().recording).toBeNull();
    expect(flightLog.store.getState().region).toBe('israel');
    expect(remote.refreshIfDue).toHaveBeenCalledWith(false);
  });

  it('drops a notice when its deadline passes while the app is open', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000_000);
    const { rt, remote } = runtime();
    let now = 1_000_000;
    remote.notices = () =>
      now < 1_000_000 + 90_000
        ? [
            {
              id: 'n',
              severity: 'info',
              regions: new Set(),
              untilMs: null,
              text: { english: 'Soon gone', hebrew: null },
            },
          ]
        : [];
    const view = await render(<LiveApp runtime={rt} />);
    expect(view.text()).toContain('Soon gone');
    now += 120_000;
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(view.text()).not.toContain('Soon gone');
  });

  it('the reset clears the strip column, the selected airport and the display mode too', () => {
    appStore.setState({ stripColumn: 'airport', selectedAirportId: 'KSQL' });
    applyCaptureSeeds(); // a capture route's fixtures, display mode 'day'
    resetLiveSlices('us');
    expect(appStore.getState()).toMatchObject({ stripColumn: 'log', selectedAirportId: null });
    expect(layers.store.getState().displayMode).toBe('auto');
  });

  it("a remount keeps the pilot's Layers choices; only capture fixtures bring the reset back", () => {
    resetLiveSlices('us');
    layers.store.setState({ displayMode: 'night', sectionalOpacity: 0.3 });
    resetLiveSlices('us'); // the root route remounted
    expect(layers.store.getState()).toMatchObject({ displayMode: 'night', sectionalOpacity: 0.3 });
    applyCaptureSeeds();
    resetLiveSlices('us');
    expect(layers.store.getState().displayMode).toBe('auto');
  });
});
