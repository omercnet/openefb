import { act } from 'react';
import { DeviceEventEmitter, Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ancestorProp, render, type Rendered } from '../../tests/support/ui';
import { EMPTY_SEARCH, searchSlice } from './columns/search/search';
import { appStore } from './state/appStore';
import { StripColumn } from './StripColumn';

// jest-expo resolves the bundled font files and expo-font reports them loaded, so the strip renders its column.
const metrics = { frame: { x: 0, y: 0, width: 1032, height: 1376 }, insets: { top: 32, left: 0, right: 0, bottom: 20 } };
const logStrip = (view: Rendered) => view.byLabel('Flight log').filter((n) => n.props.accessibilityRole !== 'switch');
const strip = () => (
  <SafeAreaProvider initialMetrics={metrics}>
    <StripColumn width={400} />
  </SafeAreaProvider>
);

describe('StripColumn', () => {
  // Reset before each test, not after: the helper unmounts the trees after each test, and an update to a mounted tree needs act.
  beforeEach(() => {
    appStore.setState({ stripColumn: 'log', selectedAirportId: null });
    searchSlice.store.setState(EMPTY_SEARCH, true); // the Search column's state outlives the column
  });

  it.each([
    ['nearest', 'Nearest'],
    ['layers', 'Layers'],
    ['search', 'Search'],
  ] as const)('shows the %s column the store selects, with the Log back button', async (column, title) => {
    appStore.setState({ stripColumn: column });
    const view = await render(strip());
    expect(view.text()).toContain(title);
    expect(view.byLabel('Back to flight log')).toHaveLength(1);
  });

  it('shows the flight log by default, without a back button', async () => {
    const view = await render(strip());
    expect(logStrip(view).length).toBeGreaterThan(0);
    expect(view.byLabel('Back to flight log')).toHaveLength(0);
  });

  it('shows the airport column for the selected airport', async () => {
    appStore.setState({ stripColumn: 'airport', selectedAirportId: 'KSQL' });
    const view = await render(strip());
    expect(view.text()).toContain('KSQL');
    expect(view.byLabel('Back to flight log')).toHaveLength(1);
  });

  it('keeps the footer under every column', async () => {
    for (const column of ['log', 'airport', 'nearest', 'layers', 'search'] as const) {
      appStore.setState({ stripColumn: column });
      const view = await render(strip());
      expect(view.text()).toContain('GPS');
      await view.unmount();
    }
  });

  it('follows the store: back to the log replaces the open column', async () => {
    appStore.setState({ stripColumn: 'nearest' });
    const view = await render(strip());
    expect(logStrip(view)).toHaveLength(0);
    await act(async () => appStore.getState().setStripColumn('log'));
    expect(logStrip(view).length).toBeGreaterThan(0);
  });

  describe('with the software keyboard', () => {
    afterEach(() => jest.restoreAllMocks());
    const nrst = (view: Rendered) => StyleSheet.flatten(view.byTestId('NRST').props.style);

    it('the footer keeps the home-indicator padding until the keyboard covers it', async () => {
      const view = await render(strip());
      expect(nrst(view)).toMatchObject({ height: 80, paddingBottom: 20 });
      await act(async () => DeviceEventEmitter.emit('keyboardWillShow', {}));
      expect(nrst(view)).toMatchObject({ height: 60, paddingBottom: 0 });
      await act(async () => DeviceEventEmitter.emit('keyboardWillHide', {}));
      expect(nrst(view)).toMatchObject({ height: 80, paddingBottom: 20 });
    });

    it.each(['ios', 'android'] as const)('on %s the column pads for the keyboard so the footer rides above it', async (os) => {
      jest.replaceProperty(Platform, 'OS', os);
      const view = await render(strip());
      expect(ancestorProp(view.byTestId('NRST'), 'behavior')).toBe('padding');
    });
  });
});
