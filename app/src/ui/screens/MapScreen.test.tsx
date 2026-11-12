import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { appStore } from '../state/appStore';
import { MapScreen } from './MapScreen';

// The real provider waits for native insets; the library's mock reports them at once. The map is a native view.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../map/MapSurface', () => ({ MapSurface: () => null }));
// scenarioFeed reads the surface's status holder, which imports the native MapLibre module.
jest.mock('../../adapters/glyphInstall', () => ({
  useLocalGlyphs: () => ({ status: 'ready', url: 'file:///g/{fontstack}/{range}.pbf' }),
}));
jest.mock('../map/mapStatus', () => ({ getCurrentMapStatus: () => null }));
// The launch-argument reader needs the native SettingsManager.
jest.mock('react-native/Libraries/Settings/Settings', () => ({ __esModule: true, default: { get: () => undefined } }));
// The aviation database is a native asset; the screen only opens it in the background.
jest.mock('../../adapters/aviationDb', () => ({ openAviationDatabase: () => new Promise(() => undefined) }));

const hasBackButton = (view: Awaited<ReturnType<typeof render>>) =>
  view.all((n) => n.props?.testID === 'column-back-to-log').length > 0;

describe('MapScreen', () => {
  // Reset before each test, not after: the helper unmounts the trees after each test, and an update to a mounted tree needs act.
  beforeEach(() => appStore.setState({ stripColumn: 'log', selectedAirportId: null }));

  it.each([
    ['layers', 'layers', null],
    ['airport', 'airport', 'KSQL'],
    ['map', 'log', null],
    ['night', 'log', null],
  ] as const)('the %s route opens the strip with the %s column', async (screen, column, airport) => {
    appStore.setState({ stripColumn: 'search', selectedAirportId: 'KPAO' });
    await render(<MapScreen screen={screen} />);
    expect(appStore.getState().stripColumn).toBe(column);
    expect(appStore.getState().selectedAirportId).toBe(airport);
  });

  it('without a route screen the strip follows the app store as it is', async () => {
    appStore.setState({ stripColumn: 'layers' });
    const view = await render(<MapScreen />);
    expect(appStore.getState().stripColumn).toBe('layers');
    expect(hasBackButton(view)).toBe(true);
  });

  it('after seeding, the strip follows the store: the Log back button returns to the flight log', async () => {
    const view = await render(<MapScreen screen="layers" />);
    expect(hasBackButton(view)).toBe(true);
    await act(async () => appStore.getState().setStripColumn('log'));
    expect(hasBackButton(view)).toBe(false);
    expect(view.byLabel('Flight log').length).toBeGreaterThan(0);
  });

  it('seeds the store once with the route column (store initialisation; the first-paint ordering is the layout effect, not observable here)', async () => {
    const seen: string[] = [];
    const unsubscribe = appStore.subscribe((s) => seen.push(s.stripColumn));
    appStore.setState({ stripColumn: 'log' });
    seen.length = 0;
    await render(<MapScreen screen="layers" />);
    unsubscribe();
    expect(seen).toEqual(['layers']);
  });
});
