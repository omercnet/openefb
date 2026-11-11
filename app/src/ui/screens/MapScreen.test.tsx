import { act } from 'react';
import { render } from '../../../tests/support/ui';
import { EMPTY_SEARCH, searchSlice } from '../columns/search/search';
import { appStore } from '../state/appStore';
import { MapScreen } from './MapScreen';

// The real provider waits for native insets; the library's mock reports them at once. The map is a native view.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../map/MapSurface', () => ({ MapSurface: () => null }));

const hasBackButton = (view: Awaited<ReturnType<typeof render>>) =>
  view.all((n) => n.props?.testID === 'column-back-to-log').length > 0;

describe('MapScreen', () => {
  // Reset before each test, not after: the helper unmounts the trees after each test, and an update to a mounted tree needs act.
  beforeEach(() => {
    appStore.setState({ stripColumn: 'log', selectedAirportId: null });
    searchSlice.store.setState(EMPTY_SEARCH, true); // the Search column's state outlives the column
  });

  it.each([
    ['layers', 'layers', null],
    ['nearest', 'nearest', null],
    ['search', 'search', null],
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

  it('seeds before the first paint: no commit shows another column first', async () => {
    const seen: string[] = [];
    const unsubscribe = appStore.subscribe((s) => seen.push(s.stripColumn));
    appStore.setState({ stripColumn: 'log' });
    seen.length = 0;
    await render(<MapScreen screen="layers" />);
    unsubscribe();
    expect(seen).toEqual(['layers']);
  });
});
