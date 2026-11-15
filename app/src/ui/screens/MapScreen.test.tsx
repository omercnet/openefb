import { act, useEffect } from 'react';
import { View } from 'react-native';
import { render } from '../../../tests/support/ui';
import { createFakeNetworkStatus } from '../../adapters/network';
import { FakeLocationSource, makeFix } from '../../domain/ports/location';
import { AirportQueriesContext } from '../columns/nearest/sources';
import { FIXTURE_AIRPORTS } from '../columns/nearest/fixture';
import { layers } from '../columns/layers/store';
import { nearest } from '../columns/nearest/store';
import { footer } from '../flightLog/footerStore';
import { EMPTY_FLIGHT_LOG, flightLog } from '../flightLog/store';
import { appStore } from '../state/appStore';
import { RuntimeContext } from '../state/runtimeContext';
import { airportQueriesFor } from '../shell/airportQueries';
import { startLiveData } from '../shell/liveData';
import type { AppRuntime } from '../shell/runtime';
import { MapScreen } from './MapScreen';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
let lastSurface: {
  region: string;
  initialView: { center: { lat: number } };
  onViewChange: (c: unknown) => void;
  night: boolean;
  sectional: boolean;
  sectionalOpacity?: number;
  sources: Record<string, { features: unknown[] }>;
} | null = null;
jest.mock('../map/MapSurface', () => ({
  MapSurface: (props: NonNullable<typeof lastSurface>) => <MockSurface {...props} />,
}));
const MockSurface = (props: NonNullable<typeof lastSurface>) => {
  useEffect(() => {
    lastSurface = props;
  });
  return <View testID="map-surface" />;
};
jest.mock('../../adapters/glyphInstall', () => ({
  useLocalGlyphs: () => ({ status: 'ready', url: 'file:///g/{fontstack}/{range}.pbf' }),
}));
let briefingProps: {
  presented: boolean;
  onShow: (h: { source: unknown; bounds: unknown }) => void;
  onDismiss: () => void;
} | null = null;
jest.mock('../shell/LiveBriefing', () => ({
  LiveBriefing: (props: NonNullable<typeof briefingProps>) => {
    briefingProps = props;
    return null;
  },
}));
jest.mock('../map/mapStatus', () => ({ getCurrentMapStatus: () => null }));

const KPAO = FIXTURE_AIRPORTS.find((a) => a.icao === 'KPAO')!;

const offlineSnapshot = { packs: [], storageUsedBytes: 0, lastError: null };

function fakeRuntime(
  over: { aviation?: Partial<AppRuntime['started']['aviation'] & object> | null; region?: 'us' | 'israel' } = {},
) {
  const queries = { nearestAirports: jest.fn(async () => [KPAO] as never[]), searchAirports: jest.fn(async () => []) };
  const db = {
    airportsNear: async () => [],
    toweredAirportsNear: async () => [],
    airspacesNear: async () => [],
    navaidsNear: async () => [],
    ...queries,
  };
  const location = new FakeLocationSource();
  const network = createFakeNetworkStatus(false);
  const runtime = {
    started: {
      userDb: {},
      userDbInMemory: false,
      region: over.region ?? 'us',
      aviation: over.aviation === null ? null : db,
      databaseError: null,
      israel: null,
      remoteConfig: null,
    },
    weather: { fetchWeatherForStations: async () => [] },
    tfr: { currentTFRs: async () => ({ tfrs: [], fetchedAt: Date.now() }) },
    advisories: { currentAdvisories: async () => ({ advisories: [], fetchedAt: Date.now() }) },
    offline: {
      status: () => 'notDownloaded',
      subscribe: () => () => undefined,
      getSnapshot: () => offlineSnapshot,
      refresh: async () => undefined,
    },
    layerSettings: { displayMode: 'day', mapMode: 'northUp', sectionalOpacity: 0.7 },
    location,
    network,
  } as unknown as AppRuntime;
  return { runtime, queries, location, network };
}

const mountLive = async (runtime: AppRuntime) =>
  render(
    <RuntimeContext.Provider value={runtime}>
      <AirportQueriesContext.Provider value={airportQueriesFor(runtime)}>
        <MapScreen />
      </AirportQueriesContext.Provider>
    </RuntimeContext.Provider>,
  );

beforeEach(() => {
  appStore.setState({ stripColumn: 'log', selectedAirportId: null });
  flightLog.store.setState(EMPTY_FLIGHT_LOG);
  nearest.store.setState({ entries: [], ownship: null, loading: false, error: null });
});

describe('live MapScreen (MapContainerView)', () => {
  it('mounts the map and the strip with no sample data: an empty log, no nearest airports', async () => {
    const { runtime } = fakeRuntime();
    const view = await mountLive(runtime);
    expect(view.byTestId('map-surface')).toBeTruthy();
    expect(view.text()).not.toContain('KSQL');
    expect(nearest.store.getState().entries).toEqual([]);
  });

  it('the NRST list refreshes from the fix while the Log column is open (one hook at the map screen)', async () => {
    const { runtime, queries, location } = fakeRuntime();
    const stop = startLiveData({ location, network: runtime.network, region: 'us' });
    await mountLive(runtime);
    await act(async () => location.emitFix(makeFix({ lat: 37.5, lon: -122.2, timestampMs: Date.now() })));
    await act(async () => undefined);
    expect(queries.nearestAirports).toHaveBeenCalled();
    expect(nearest.store.getState().entries.map((e) => e.airport.icao)).toEqual(['KPAO']);
    stop();
  });

  it('the footer follows the camera: the zoom it reports, and ZOOM + / RECENTER actions', async () => {
    const { runtime } = fakeRuntime();
    await mountLive(runtime);
    await act(async () =>
      lastSurface!.onViewChange({
        center: { lat: 37, lon: -122 },
        zoom: 12.5,
        bearing: 0,
        northEast: { lat: 37.1, lon: -121.9 },
        southWest: { lat: 36.9, lon: -122.1 },
        userInteraction: false,
      }),
    );
    expect(footer.store.getState().zoom).toBe(12.5);
    expect(footer.store.getState().following).toBe(true);
    await act(async () =>
      lastSurface!.onViewChange({
        center: { lat: 38, lon: -121 },
        zoom: 12.5,
        bearing: 0,
        northEast: { lat: 38.1, lon: -120.9 },
        southWest: { lat: 37.9, lon: -121.1 },
        userInteraction: true,
      }),
    );
    expect(footer.store.getState().following).toBe(false);
    expect(typeof footer.store.getState().zoomTo).toBe('function');
  });

  it('with the aviation database closed the map still mounts', async () => {
    const { runtime } = fakeRuntime({ aviation: null });
    const view = await mountLive(runtime);
    expect(view.byTestId('map-surface')).toBeTruthy();
  });

  it('the Layers column drives the map: display mode, sectional opacity and switch', async () => {
    const { runtime } = fakeRuntime();
    layers.store.setState({ displayMode: 'day', sectionalOpacity: 0.7 });
    await mountLive(runtime);
    expect(lastSurface!.night).toBe(false);
    await act(async () => layers.store.setState({ displayMode: 'night', sectionalOpacity: 0.4 }));
    expect(lastSurface!.night).toBe(true);
    expect(lastSurface!.sectionalOpacity).toBe(0.4);
    await act(async () => layers.store.setState({ visibleLayers: ['ownship'] }));
    expect(lastSurface!.sectional).toBe(false);
  });

  it('opens on the restored region, not the default: Israel home view, layers and controller', async () => {
    const { runtime } = fakeRuntime({ region: 'israel' });
    await mountLive(runtime);
    expect(lastSurface!.region).toBe('israel');
    expect(lastSurface!.initialView.center.lat).toBeLessThan(34); // Israel, not the US centre
  });

  it('the briefing sheet follows the app store, and Done closes it', async () => {
    const { runtime } = fakeRuntime();
    await mountLive(runtime);
    expect(briefingProps!.presented).toBe(false);
    await act(async () => appStore.getState().setPresentingBriefing(true));
    expect(briefingProps!.presented).toBe(true);
    await act(async () => briefingProps!.onDismiss());
    expect(appStore.getState().isPresentingBriefing).toBe(false);
  });

  it('Show on map draws the highlight on the Israel chart sources', async () => {
    const { runtime } = fakeRuntime({ region: 'israel' });
    (runtime.started as { israel: unknown }).israel = {
      reportingPoints: async () => [],
      routeSegments: async () => [],
      airspacesOfKind: async () => [],
      runwaysIn: async () => [],
      aerodromesIn: async () => [],
    };
    await mountLive(runtime);
    await act(async () => undefined);
    await act(async () =>
      briefingProps!.onShow({
        source: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { color: '#FF3B30' } }] },
        bounds: { south: 32, west: 34.8, north: 32.2, east: 35 },
      }),
    );
    expect(lastSurface!.sources['il-brief-highlight']?.features).toHaveLength(1);
  });
});
