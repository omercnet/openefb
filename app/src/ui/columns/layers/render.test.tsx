import { StyleSheet } from 'react-native';
import type { StoreApi } from 'zustand';
import { callHandler, press, render } from '../../../../tests/support/ui';
import type { Region } from '../../../domain/core/region';
import { panels, type PanelsData } from '../../state/panels';
import { regionSlice } from '../../state/region';
import { Day } from '../../tokens';
import { LayersColumn } from '../LayersColumn';
import { layers, type LayersData } from './store';

async function renderLayers(patch: Partial<LayersData> = {}, region: Region = 'us') {
  const store = layers.make({ ...layers.store.getState(), ...patch });
  const panelStore: StoreApi<PanelsData> = panels.make();
  const view = await render(
    <regionSlice.Provider store={regionSlice.make({ region })}>
      <layers.Provider store={store}>
        <panels.Provider store={panelStore}>
          <LayersColumn />
        </panels.Provider>
      </layers.Provider>
    </regionSlice.Provider>,
  );
  const toggle = (id: string) => view.byTestId(id);
  return { view, store, panelStore, toggle };
}

describe('LayersColumn', () => {
  it('shows the reference fixture: titles, captions, statuses and data ages', async () => {
    const { view } = await renderLayers();
    const text = view.text();
    for (const s of [
      'Layers',
      'Display',
      'Orientation',
      'Panels',
      'Strip with next and flown waypoints',
      'Sectional',
      'Opacity',
      '70%',
      'Offline: not downloaded',
      'Sectional cycle: valid to 24 Dec 2026',
      'Data layers',
      'Age <1 min',
      'Age 48 min',
      'Advisory. Verify against the FAA diagram.',
    ]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain('CVFR chart'); // US region
    expect(text).not.toContain('Loading');
  });

  it('toggles are switches whose checked state follows the fixture', async () => {
    const { view } = await renderLayers();
    const states = Object.fromEntries(
      view.byRole('switch').map((n) => [n.props.accessibilityLabel, n.props.accessibilityState?.checked]),
    );
    expect(states).toEqual({
      'Flight log': true,
      Instruments: true,
      'Predictions (preview)': false,
      'VFR sectional chart': true,
      Airports: false,
      Airspace: false,
      TFRs: true,
      'AIRMET/SIGMET': false,
      Weather: true,
      Navaids: false,
      'Airport diagrams': true,
    });
  });

  it('a layer switch writes the new visibility, and the row follows', async () => {
    const { store, toggle } = await renderLayers();
    await callHandler(toggle('Airports'), 'onValueChange', true);
    expect(store.getState().visibleLayers).toContain('airports');
    expect(toggle('Airports').props.accessibilityState).toEqual({ checked: true });
    await callHandler(toggle('TFRs'), 'onValueChange', false);
    expect(store.getState().visibleLayers).not.toContain('tfrs');
    await callHandler(toggle('Airport diagrams'), 'onValueChange', false);
    expect(store.getState().airportDiagrams).toBe(false);
  });

  it('hides the TFR age with the layer and the sectional controls with the sectional', async () => {
    const { view, toggle } = await renderLayers();
    await callHandler(toggle('TFRs'), 'onValueChange', false);
    expect(view.text()).not.toContain('<1 min');
    await callHandler(toggle('VFR sectional chart'), 'onValueChange', false);
    expect(view.text()).not.toContain('Opacity');
    expect(view.text()).toContain('Offline: not downloaded'); // shown whether or not the sectional is on
  });

  it('panel switches write the shared panels slice', async () => {
    const { panelStore, toggle } = await renderLayers();
    const predictions = toggle('toggle-predictions');
    expect(predictions.props.accessibilityHint).toBe(
      'Airspace ahead in the next 10 minutes, from track, speed and climb',
    );
    await callHandler(predictions, 'onValueChange', true);
    expect(panelStore.getState().showsPredictions).toBe(true);
    await callHandler(toggle('toggle-flight-log'), 'onValueChange', false);
    expect(panelStore.getState().showsFlightLog).toBe(false);
    expect(toggle('toggle-flight-log').props.accessibilityState).toEqual({ checked: false });
  });

  it('segmented controls mark the selection and write the tapped option', async () => {
    const { view, store } = await renderLayers();
    const segment = (title: string) =>
      view
        .all((n) => n.props.accessibilityState?.selected !== undefined)
        .find((n) => n.queryAll((c) => c.type === 'Text' && c.children.join('') === title).length > 0)!;
    expect(segment('Day').props.accessibilityState).toEqual({ selected: true });
    expect(segment('Night').props.accessibilityState).toEqual({ selected: false });
    expect(segment('North up').props.accessibilityState).toEqual({ selected: true });
    await press(segment('Night'));
    expect(store.getState().displayMode).toBe('night');
    expect(segment('Night').props.accessibilityState).toEqual({ selected: true });
    expect(segment('Day').props.accessibilityState).toEqual({ selected: false });
    await press(segment('Track up'));
    expect(store.getState().mapMode).toBe('trackUp');
    const selectedText = segment('Night').queryAll((c) => c.type === 'Text')[0];
    expect(StyleSheet.flatten(selectedText.props.style).color).toBe(Day.ink);
    expect(segment('Day').props.accessibilityLabel).toBe('Display mode, Day');
    expect(segment('Day').props.accessibilityRole).toBe('button');
    expect(segment('Track up').props.accessibilityLabel).toBe('Map orientation, Track up');
    expect(segment('Track up').props.accessibilityState).toEqual({ selected: true });
  });

  it('the opacity slider speaks and writes its value', async () => {
    const { view, store } = await renderLayers();
    const slider = view.byLabel('Sectional chart opacity')[0];
    expect(slider.props.accessibilityRole).toBe('adjustable');
    expect(slider.props.accessibilityValue).toEqual({ text: '70 percent' });
    await callHandler(slider, 'onAccessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(store.getState().sectionalOpacity).toBeCloseTo(0.8);
    expect(view.byLabel('Sectional chart opacity')[0].props.accessibilityValue).toEqual({ text: '80 percent' });
    expect(view.text()).toContain('80%');
  });

  it('a failed TFR fetch says so and offers Retry; a pending one says Loading', async () => {
    const retryTfrs = jest.fn();
    const failed = await renderLayers({ tfrFetchedAt: null, tfrLoadFailed: true, retryTfrs });
    expect(failed.view.text()).toContain('Not loaded');
    await press(failed.view.byLabel('Retry TFRs')[0]);
    expect(retryTfrs).toHaveBeenCalledTimes(1);
    const loading = await renderLayers({ tfrFetchedAt: null, tfrLoadFailed: false });
    expect(loading.view.text()).toContain('Loading\u2026');
  });

  it('old data is flagged on the badge', async () => {
    const now = layers.store.getState().now;
    const { view } = await renderLayers({ oldestWeatherObservation: now - 80 * 60_000 });
    expect(view.text()).toContain('OLD 1h 20m');
  });

  it('a sectional cycle in its last week shows the cycle badge; a fresh one hides it', async () => {
    const now = layers.store.getState().now;
    const fresh = await renderLayers();
    expect(fresh.view.byLabel('Chart cycle age')).toHaveLength(0);
    const ending = await renderLayers({ chartExpiration: now + 3 * 86_400_000 });
    expect(ending.view.byLabel('Chart cycle age')[0].props.accessibilityValue).toEqual({ text: 'EXPIRES 3d' });
  });

  it('Israel: no FAA layers, the CVFR chart section and the NOTAM feed status', async () => {
    const { view, store, toggle } = await renderLayers(
      {
        visibleLayers: ['cvfrRoutes', 'cvfrClosures'],
      },
      'israel',
    );
    const text = view.text();
    expect(text).toContain('CVFR chart');
    expect(text).toContain('No NOTAM feed: closures not shown');
    expect(text).toContain('Advisory. Verify against the CAAI diagram.');
    const sectional = view.byTestId('unavailable-VFR sectional chart');
    expect(sectional.props.accessibilityLabel).toBe('VFR sectional chart, unavailable');
    expect(sectional.props.accessibilityValue).toEqual({ text: 'Not available in Israel yet' });
    for (const label of ['Airports', 'Airspace', 'TFRs', 'AIRMET/SIGMET', 'Navaids']) {
      expect(view.byTestId(`unavailable-${label}`)).toBeTruthy();
    }
    await callHandler(toggle('Reporting points'), 'onValueChange', true);
    expect(store.getState().visibleLayers).toEqual(['cvfrRoutes', 'cvfrClosures', 'cvfrPoints']);
  });

  it('Israel closures: age and count while fresh, hidden when too old', async () => {
    const now = layers.store.getState().now;
    const loaded = await renderLayers(
      {
        visibleLayers: ['cvfrClosures'],
        closureStatus: { kind: 'loaded', generatedAt: now - 10 * 60_000, level: 'fresh', closed: 1 },
      },
      'israel',
    );
    expect(loaded.view.text()).toContain('1 segment closed');
    const old = await renderLayers(
      {
        visibleLayers: ['cvfrClosures'],
        closureStatus: { kind: 'loaded', generatedAt: now - 10 * 60_000, level: 'expired', closed: 3 },
      },
      'israel',
    );
    expect(old.view.text()).toContain('Too old: closures hidden');
  });
});
