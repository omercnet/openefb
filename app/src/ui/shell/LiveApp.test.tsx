import { act } from 'react';
import { haptic } from '../haptics';
import { press, render } from '../../../tests/support/ui';
import { createFakeNetworkStatus } from '../../adapters/network';
import { FakePreferences } from '../../domain/ports/preferences';
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
import { openNodeSqliteDb } from '../../../tests/support/nodeSqliteDb';
import { migrate } from '../../data/migrate';
import { FakeMicrophonePermission } from '../../domain/ports/microphonePermission';
import { MockAudioRecorder, MockTranscriptionService } from '../../domain/recording/testSupport';
import { createRecordingRuntime } from './recordingRuntime';
import { LiveApp } from './LiveApp';
import type { AppRuntime } from './runtime';

// The map is a native view and the screen is covered by its own tests; here it only marks that it is mounted.
jest.mock('../sheets/israelPlan/IsraelFlightPlanSheet', () => ({
  IsraelFlightPlanSheet: () => null,
}));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('./LiveFlight', () => ({ LiveFlight: () => null }));
jest.mock('../screens/LogScreen', () => ({ LogScreen: () => null }));
jest.mock('../map/ChartPdfView', () => ({ ChartPdfView: () => null }));
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
    telemetry: { signal: () => undefined },
    weather: {},
    advisories: {},
    layerSettings: { displayMode: 'day', mapMode: 'northUp', sectionalOpacity: 0.7, airportDiagrams: true },
    location,
    network,
    haptics: { warning: jest.fn(), success: jest.fn(), light: jest.fn() },
    israelNotam: { fetchFeed: async () => Promise.reject(new Error('offline')) },
    tfr: { currentTFRs: async () => ({ tfrs: [], fetchedAt: 0 }) },
    profiles: { load: async () => undefined, activeIds: () => ({ aircraftProfileID: null, pilotProfileID: null }) },
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

  describe('haptics and alerts', () => {
    it('installs the haptics for the views while the app is live, and takes them away after', async () => {
      const { rt } = runtime();
      const view = await render(<LiveApp runtime={rt} />);
      haptic.light();
      expect(rt.haptics.light).toHaveBeenCalledTimes(1);
      await view.unmount();
      haptic.light();
      expect(rt.haptics.light).toHaveBeenCalledTimes(1);
    });

    it('shows the Israel alerts banner and the suspended notice from the alerts runtime', async () => {
      const { rt } = runtime({ region: 'israel' });
      await render(<LiveApp runtime={rt} />);
      // No fix yet in Israel: the position-based alerts are not running, and the strip says so.
      await act(async () => new Promise((r) => setTimeout(r, 20)));
      expect(flightLog.store.getState().israelAlertsSuspended).toBe(true);
    });
  });

  describe('recording services', () => {
    const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
    const withProfiles = (rt: AppRuntime) =>
      Object.assign(rt, {
        profiles: { load: async () => undefined, activeIds: () => ({ aircraftProfileID: null, pilotProfileID: null }) },
      });
    const services = async () => {
      const userDb = openNodeSqliteDb();
      await migrate(userDb);
      return createRecordingRuntime({
        userDb,
        openRecordingDb: async () => openNodeSqliteDb(),
        aviation: null,
        location: new FakeLocationSource(),
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
    };

    it('puts the recorder on the strip and runs crash recovery once the profiles are known', async () => {
      const { rt } = runtime();
      withProfiles(rt);
      let built: Awaited<ReturnType<typeof services>> | null = null;
      const recover = jest.fn(async () => []);
      await render(
        <LiveApp
          runtime={rt}
          startRecording={async () => {
            built = await services();
            built.recoverOrphans = recover as never;
            return built;
          }}
        />,
      );
      await settle();
      expect(flightLog.store.getState().recording?.status).toEqual({ kind: 'idle' });
      expect(flightLog.store.getState().recordingUnavailable).toBe(false);
      expect(recover).toHaveBeenCalledWith({ aircraftProfileID: null, pilotProfileID: null });
    });

    it('leaving the screen does not tear the recording services down: they belong to the process', async () => {
      const { rt } = runtime();
      withProfiles(rt);
      const shared = await services();
      const dispose = jest.spyOn(shared, 'dispose');
      const start = async () => shared;
      const first = await render(<LiveApp runtime={rt} startRecording={start} />);
      await settle();
      await first.unmount();
      expect(dispose).not.toHaveBeenCalled();
      await render(<LiveApp runtime={rt} startRecording={start} />);
      await settle();
      expect(flightLog.store.getState().recording?.status).toEqual({ kind: 'idle' });
      expect(dispose).not.toHaveBeenCalled();
    });

    it('crash recovery waits for a launch where the profiles load: nothing is saved with no aircraft or pilot', async () => {
      const { rt } = runtime();
      withProfiles(rt);
      Object.assign(rt.profiles, { load: async () => Promise.reject(new Error('no profiles')) });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const recover = jest.fn(async () => []);
      await render(
        <LiveApp
          runtime={rt}
          startRecording={async () => {
            const built = await services();
            built.recoverOrphans = recover as never;
            return built;
          }}
        />,
      );
      await settle();
      expect(recover).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Crash recovery postponed'), expect.anything());
      warn.mockRestore();
    });

    it('the profiles load even when the recording database cannot open', async () => {
      const { rt } = runtime();
      const load = jest.fn(async () => undefined);
      Object.assign(rt, { profiles: { load, activeIds: () => ({ aircraftProfileID: null, pilotProfileID: null }) } });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await render(
        <LiveApp
          runtime={rt}
          startRecording={async () => {
            throw new Error('cannot open');
          }}
        />,
      );
      await settle();
      expect(load).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('an unavailable recording database hides the record control', async () => {
      const { rt } = runtime();
      withProfiles(rt);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await render(
        <LiveApp
          runtime={rt}
          startRecording={async () => {
            throw new Error('cannot open');
          }}
        />,
      );
      await settle();
      expect(flightLog.store.getState()).toMatchObject({ recording: null, recordingUnavailable: true });
      warn.mockRestore();
    });
  });

  describe('planner', () => {
    const plannerRuntime = (region: 'us' | 'israel') => {
      const { rt } = runtime({ region });
      Object.assign(rt, {
        preferences: new FakePreferences(),
        profiles: {
          aircraft: { getState: () => ({ profiles: [{ id: 'a1' }] }) },
          pilot: { getState: () => ({ profiles: [] }) },
          load: async () => undefined,
          activeIds: () => ({ aircraftProfileID: null, pilotProfileID: null }),
        },
        telemetry: { signal: jest.fn() },
      });
      return rt;
    };
    const has = (view: Awaited<ReturnType<typeof render>>, id: string) =>
      view.all((n) => n.props?.testID === id).length > 0;
    const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

    it('Plan a flight opens the Israel planner over the Log in the Israel region, and Back closes it', async () => {
      const view = await render(<LiveApp runtime={plannerRuntime('israel')} />);
      await act(async () => appStore.setState({ selectedScreen: 'log', overlay: { kind: 'planner' } }));
      await settle();
      expect(has(view, 'live-israel-planner')).toBe(true);
      await press(view.byTestId('planner-back'));
      expect(appStore.getState().overlay).toBeNull();
    });

    it('the US planner is not mounted here (U4c): no Israel planner outside Israel', async () => {
      const view = await render(<LiveApp runtime={plannerRuntime('us')} />);
      await act(async () => appStore.setState({ selectedScreen: 'log', overlay: { kind: 'planner' } }));
      await settle();
      expect(has(view, 'live-israel-planner')).toBe(false);
    });
  });
});
