import { act } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { press, render, type Rendered } from '../../../tests/support/ui';
import { EMPTY_SEARCH, searchSlice } from '../columns/search/search';
import { appStore } from '../state/appStore';
import { panels } from '../state/panels';
import { MapScreen } from './MapScreen';

// The real provider waits for native insets; the library's mock reports them at once. The map is a native view: a
// stand-in marks where it is mounted (called at render time, after this module has run).
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../map/MapSurface', () => ({ MapSurface: () => mockMapSurface() }));
const mockMapSurface = () => <View testID="map-surface" />;
// scenarioFeed reads the surface's status holder, which imports the native MapLibre module.
jest.mock('../../adapters/glyphInstall', () => ({
  useLocalGlyphs: () => ({ status: 'ready', url: 'file:///g/{fontstack}/{range}.pbf' }),
}));
jest.mock('../map/mapStatus', () => ({ getCurrentMapStatus: () => null }));
// The launch-argument reader needs the native SettingsManager.
jest.mock('react-native/Libraries/Settings/Settings', () => ({ __esModule: true, default: { get: () => undefined } }));
// The aviation database is a native asset; the screen only opens it in the background.
jest.mock('../../adapters/aviationDb', () => ({ openAviationDatabase: () => new Promise(() => undefined) }));

/** Resize the window, as a rotation or a Split View change does (useWindowDimensions follows it). */
const setWindow = (width: number, height: number) =>
  act(async () => {
    const size = { width, height, scale: 3, fontScale: 1 };
    Dimensions.set({ window: size, screen: size });
  });
const IPHONE = [402, 874] as const; // iPhone 17 Pro portrait, points
const IPAD = [1032, 1376] as const; // 13" iPad Pro portrait, the references' device

const has = (view: Rendered, testID: string) => view.all((n) => n.props?.testID === testID).length > 0;
const width = (view: Rendered, testID: string) => StyleSheet.flatten(view.byTestId(testID).props.style)?.width;

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

describe('MapScreen layouts (U5)', () => {
  const panelsDefault = panels.store.getState();
  beforeEach(async () => {
    appStore.setState({ stripColumn: 'log', selectedAirportId: null });
    panels.store.setState(panelsDefault, true);
    await setWindow(...IPAD);
  });
  afterAll(async () => {
    panels.store.setState(panelsDefault, true);
    await setWindow(...IPAD);
  });

  it('a regular window: the 400 pt strip beside the chart, no rail', async () => {
    const view = await render(<MapScreen />);
    expect(has(view, 'compact-map-layout')).toBe(false);
    expect(has(view, 'flight-log-above-now')).toBe(true);
    expect(has(view, 'map-surface')).toBe(true);
  });

  it('an iPhone: header, the 104 pt rail beside the chart, NOW and the full-width footer under it', async () => {
    await setWindow(...IPHONE);
    const view = await render(<MapScreen />);
    expect(has(view, 'compact-map-layout')).toBe(true);
    expect(has(view, 'flight-log-above-now')).toBe(false);
    expect(width(view, 'flight-log-rail')).toBe(104);
    expect(has(view, 'map-surface')).toBe(true);
    expect(has(view, 'flight-log-now')).toBe(true);
    expect(width(view, 'GPS status')).toBe(76);
    expect(width(view, 'NRST')).toBe(402 - 3 * 60 - 4 - 76);
    // Glyph-only record control in the header.
    expect(view.text()).not.toContain('00:00:06');
    expect(view.text()).toContain('DIRECT KOAK');
  });

  it('follows a resize across the threshold', async () => {
    const view = await render(<MapScreen />);
    expect(has(view, 'compact-map-layout')).toBe(false);
    await setWindow(...IPHONE);
    expect(has(view, 'compact-map-layout')).toBe(true);
    await setWindow(...IPAD);
    expect(has(view, 'compact-map-layout')).toBe(false);
  });

  it('an opened column covers the area above NOW; NOW and the footer stay, the covered views leave the a11y tree', async () => {
    await setWindow(...IPHONE);
    const view = await render(<MapScreen />);
    await press(view.byTestId('NRST'));
    expect(appStore.getState().stripColumn).toBe('nearest');
    expect(has(view, 'compact-column')).toBe(true);
    expect(has(view, 'column-back-to-log')).toBe(true);
    expect(has(view, 'flight-log-now')).toBe(true);
    expect(has(view, 'NRST')).toBe(true);
    expect(has(view, 'map-surface')).toBe(true);
    const covered = view.all((n) => n.props?.importantForAccessibility === 'no-hide-descendants');
    expect(covered.some((n) => n.queryAll((c) => c.props?.testID === 'flight-log-rail').length > 0)).toBe(true);
    await press(view.byTestId('column-back-to-log'));
    expect(has(view, 'compact-column')).toBe(false);
  });

  it('flight log hidden on a regular window: the compact layout at full width, no rail, the time-to in the header', async () => {
    panels.store.setState({ showsFlightLog: false });
    const view = await render(<MapScreen />);
    expect(has(view, 'compact-map-layout')).toBe(true);
    expect(has(view, 'flight-log-rail')).toBe(false);
    expect(view.text()).toContain('DIRECT KOAK \u00B7 9:12');
    // Not a compact window: the record control keeps its elapsed time.
    expect(view.text()).toContain('00:00:06');
    expect(width(view, 'GPS status')).toBe(76);
  });

  it('instruments hidden: no NOW cell, Clear moves to the header', async () => {
    await setWindow(...IPHONE);
    panels.store.setState({ showsInstruments: false });
    const view = await render(<MapScreen />);
    expect(has(view, 'flight-log-now')).toBe(false);
    expect(view.byTestId('clear-direct-to').props.accessibilityLabel).toBe('Clear DIRECT KOAK');
  });
});
