import { act, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';
import { press, render, type Rendered } from '../../../tests/support/ui';
import { makeAirport } from '../../domain/core';
import type { GpsStatus } from '../../domain/location/gpsStatus';
import { nearest, type NearestAirportEntry } from '../columns/nearest/store';
import { appStore } from '../state/appStore';
import { gps } from '../state/gps';
import { regionSlice } from '../state/region';
import { Day } from '../tokens';
import { FlightLogFooter } from './FlightLogFooter';
import { footer, type FooterData } from './footerStore';

const KPAO: NearestAirportEntry = {
  airport: makeAirport({
    icao: 'KPAO',
    name: 'Palo Alto',
    latitude: 37.46,
    longitude: -122.11,
    elevation: 4,
    type: 'airport',
    ownership: 'public',
  }),
  distance: 2.0,
  bearing: 116,
};

async function renderFooter(
  opts: {
    status?: GpsStatus;
    entries?: NearestAirportEntry[];
    footerState?: Partial<FooterData>;
    ownship?: { lat: number; lon: number } | null;
    width?: number;
    compact?: boolean;
  } = {},
) {
  const gpsStore = gps.make({ status: opts.status ?? { kind: 'ok' }, failure: null });
  const nearestStore = nearest.make({
    ...nearest.store.getState(),
    entries: opts.entries ?? [KPAO],
    ownship: opts.ownship ?? null,
  });
  const footerStore = footer.make({ ...footer.store.getState(), ...opts.footerState });
  const wrap = (children: ReactNode) => (
    <gps.Provider store={gpsStore}>
      <nearest.Provider store={nearestStore}>
        <regionSlice.Provider store={regionSlice.make({ region: 'us' })}>
          <footer.Provider store={footerStore}>{children}</footer.Provider>
        </regionSlice.Provider>
      </nearest.Provider>
    </gps.Provider>
  );
  const view = await render(
    wrap(<FlightLogFooter width={opts.width ?? 400} bottomInset={20} compact={opts.compact} />),
  );
  return { view, footerStore, nearestStore };
}

const nrst = (view: Awaited<ReturnType<typeof renderFooter>>['view']) =>
  view.all((n) => String(n.props.accessibilityLabel ?? '').startsWith('Nearest airport KPAO'))[0];
const style = (n: TestInstance) => StyleSheet.flatten(n.props.style) ?? {};

describe('FlightLogFooter', () => {
  beforeEach(() => appStore.setState({ stripColumn: 'log' }));
  afterAll(() => appStore.setState({ stripColumn: 'log' }));

  describe('GPS cell', () => {
    const cases: [string, GpsStatus, string, string, string, string][] = [
      ['ok', { kind: 'ok' }, 'GPS 3D', Day.ok, Day.ink, 'GPS OK'],
      [
        'degraded',
        { kind: 'degraded', reason: { kind: 'noAltitude' } },
        'GPS DEGR',
        Day.caution,
        Day.caution,
        'GPS degraded, no altitude',
      ],
      [
        'lost',
        { kind: 'lost', ageSeconds: 14 },
        'GPS LOST 14 S',
        Day.warning,
        Day.warning,
        'GPS lost, last fix 14 seconds ago',
      ],
    ];
    it.each(cases)('%s: text, dot tint, text tint and spoken status', async (_n, status, text, dot, ink, spoken) => {
      const { view } = await renderFooter({ status });
      const cell = view.byTestId('GPS status');
      expect(cell.props.accessibilityLabel).toBe(spoken);
      const label = cell.queryAll((n) => n.type === 'Text')[0];
      expect(label.children.join('')).toBe(text);
      expect(style(label).color).toBe(ink);
      expect(cell.queryAll((n) => style(n).borderRadius === 5)[0].props.style.backgroundColor).toBe(dot);
    });
  });

  describe('NRST cell', () => {
    it('shows the nearest airport with distance and bearing', async () => {
      const { view } = await renderFooter();
      const nrst = view.byTestId('NRST');
      expect(nrst.props.accessibilityLabel).toBe('Nearest airport KPAO, 2.0 nautical miles, bearing 116 degrees');
      expect(view.text()).toContain('NRST KPAO 2.0 NM 116\u00B0');
    });

    it('says NONE without an entry, NO GPS when there never was a fix', async () => {
      const none = await renderFooter({ entries: [] });
      expect(none.view.text()).toContain('NRST NONE');
      expect(none.view.text()).not.toContain('NM');
      expect(none.view.byTestId('NRST').props.accessibilityLabel).toBe('Nearest airports. No landable airport yet.');
      const noGps = await renderFooter({ entries: [], status: { kind: 'lost', ageSeconds: null } });
      expect(noGps.view.text()).toContain('NRST NO GPS');
    });

    it('opens the nearest column, and a second tap returns to the log', async () => {
      const { view } = await renderFooter();
      await press(view.byTestId('NRST'));
      expect(appStore.getState().stripColumn).toBe('nearest');
      await press(view.byTestId('NRST'));
      expect(appStore.getState().stripColumn).toBe('log');
    });
  });

  describe('compact (the full-width footer of the iPhone layout)', () => {
    const gpsLabel = (view: Rendered) => view.byTestId('gps-status-text');

    it('caps GPS at 76 pt and gives NRST the rest of a 402 pt window', async () => {
      const { view } = await renderFooter({ width: 402, compact: true });
      expect(style(view.byTestId('GPS status')).width).toBe(76);
      expect(style(view.byTestId('NRST')).width).toBe(402 - 3 * 60 - 4 - 76);
    });

    it.each([
      ['ok', { kind: 'ok' }, 'GPS\n3D', 15],
      ['degraded', { kind: 'degraded', reason: { kind: 'noAltitude' } }, 'GPS\nDEGR', 15],
      ['lost', { kind: 'lost', ageSeconds: null }, 'GPS\nLOST', 15],
      // Does not fit two lines even at the 0.7 floor: SwiftUI's tail truncation on the second line.
      ['lost with an age', { kind: 'lost', ageSeconds: 14 }, 'GPS\nLOST 1\u2026', 10.5],
    ] as [string, GpsStatus, string, number][])('%s wraps onto two lines', async (_n, status, text, size) => {
      const { view } = await renderFooter({ width: 402, compact: true, status });
      const label = gpsLabel(view);
      expect(label.children.join('')).toBe(text);
      expect(label.props.numberOfLines).toBe(text.split('\n').length);
      expect(style(label).fontSize).toBeCloseTo(size, 6);
    });

    it('keeps the regular footer on one line', async () => {
      const { view } = await renderFooter({ status: { kind: 'lost', ageSeconds: 14 } });
      expect(gpsLabel(view).children.join('')).toBe('GPS LOST 14 S');
      expect(gpsLabel(view).props.numberOfLines).toBe(1);
    });
  });

  it('lays out no negative width in a window narrower than the five cells', async () => {
    const view = await render(<FlightLogFooter width={104} bottomInset={0} />);
    const widths = view.all((n) => typeof style(n).width === 'number').map((n) => style(n).width as number);
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((w) => w >= 0)).toBe(true);
  });

  it('the NRST label speaks the entry extras the store does not carry: PPR and a NOTAM closure', async () => {
    const israel = { requiresPPR: true, closureNotamIDs: ['A1/26'] } as NearestAirportEntry['israel'];
    const { view } = await renderFooter({ entries: [{ ...KPAO, israel }] });
    const label = nrst(view).props.accessibilityLabel as string;
    expect(label).toContain('prior permission required');
    expect(label).toContain('NOTAM');
    const plain = await renderFooter({ entries: [KPAO] });
    expect(nrst(plain.view).props.accessibilityLabel).not.toContain('permission');
  });

  it('refreshes the nearest list from ownship while the Nearest column is closed (the cell is always mounted)', async () => {
    const { view, nearestStore } = await renderFooter({ entries: [], ownship: { lat: 37.4876, lon: -122.2289 } });
    await act(async () => undefined); // let the refresher's query settle
    expect(nearestStore.getState().entries.length).toBeGreaterThan(0);
    expect(view.text()).not.toContain('NONE');
  });

  it('LAYERS toggles the strip between the layers column and the log', async () => {
    const { view } = await renderFooter();
    const layersCell = () => view.byLabel('Map layers')[0];
    expect(layersCell().props.accessibilityValue).toEqual({ text: 'Closed' });
    await press(layersCell());
    expect(appStore.getState().stripColumn).toBe('layers');
    expect(layersCell().props.accessibilityValue).toEqual({ text: 'Open' });
    await press(layersCell());
    expect(appStore.getState().stripColumn).toBe('log');
    appStore.setState({ stripColumn: 'airport' });
    await press(layersCell());
    expect(appStore.getState().stripColumn).toBe('layers');
  });

  it('quick zoom taps add up until the camera reports, then start from the reported zoom', async () => {
    const zoomTo = jest.fn();
    const { view, footerStore } = await renderFooter({ footerState: { zoom: 10, zoomTo } });
    await press(view.byLabel('Zoom in')[0]);
    await press(view.byLabel('Zoom in')[0]);
    expect(zoomTo.mock.calls).toEqual([[11], [12]]);
    await act(async () => footerStore.setState({ zoom: 7 })); // the pilot pinched to 7
    await press(view.byLabel('Zoom out')[0]);
    expect(zoomTo).toHaveBeenLastCalledWith(6);
  });

  it('a zoomTo that throws resets the stepper and does not escape the tap', async () => {
    const zoomTo = jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('map not ready');
      })
      .mockImplementation(() => {});
    const { view } = await renderFooter({ footerState: { zoom: 10, zoomTo } });
    await press(view.byLabel('Zoom in')[0]); // asked for 11, never reached
    await press(view.byLabel('Zoom in')[0]);
    expect(zoomTo.mock.calls).toEqual([[11], [11]]);
  });

  it('a zoomTo that rejects resets the stepper', async () => {
    const zoomTo = jest.fn().mockRejectedValueOnce(new Error('camera busy')).mockResolvedValue(undefined);
    const { view } = await renderFooter({ footerState: { zoom: 10, zoomTo } });
    await press(view.byLabel('Zoom out')[0]);
    await press(view.byLabel('Zoom out')[0]);
    expect(zoomTo.mock.calls).toEqual([[9], [9]]);
  });

  it('after a pan ZOOM + becomes RECENTER', async () => {
    const recenter = jest.fn();
    const { view } = await renderFooter({ footerState: { following: false, recenter } });
    expect(view.byLabel('Zoom in')).toHaveLength(0);
    await press(view.byLabel('Recenter on aircraft')[0]);
    expect(recenter).toHaveBeenCalledTimes(1);
  });

  it('a recenter that throws does not escape the tap', async () => {
    const recenter = jest.fn(() => {
      throw new Error('no ownship');
    });
    const { view } = await renderFooter({ footerState: { following: false, recenter } });
    await expect(press(view.byLabel('Recenter on aircraft')[0])).resolves.toBeUndefined();
    expect(recenter).toHaveBeenCalledTimes(1);
  });

  it('a long GPS status shrinks to fit the cell (down to 0.7), GPS 3D stays at 15pt', async () => {
    const size = async (status: GpsStatus) => {
      const { view } = await renderFooter({ status });
      const label = view.byTestId('GPS status').queryAll((n) => n.type === 'Text')[0];
      return style(label).fontSize;
    };
    expect(await size({ kind: 'ok' })).toBe(15);
    // 108pt cell: 78pt for the text; 13 Plex glyphs at 15pt need 117pt.
    expect(await size({ kind: 'lost', ageSeconds: 14 })).toBeCloseTo(15 * 0.7);
    expect(await size({ kind: 'degraded', reason: { kind: 'noAltitude' } })).toBe(15); // 8 glyphs: 72pt
    expect(await size({ kind: 'lost', ageSeconds: 5 })).toBeCloseTo((15 * 78) / 108); // 12 glyphs: 108pt
  });
});
