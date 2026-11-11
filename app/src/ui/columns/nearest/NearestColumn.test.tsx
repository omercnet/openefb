// Render tests for NearestColumn: the reference rows and their accessibility, Direct and row taps, the empty, loading,
// error and no-data states, long and Hebrew names, and the refresh hook driving the list.
import type { ReactElement } from 'react';
import { Text } from 'react-native';
import { press, render } from '../../../../tests/support/ui';
import { makeAirport, type Airport } from '../../../domain/core';
import { appStore } from '../../state/appStore';
import { NearestColumn } from '../NearestColumn';
import { FIXTURE_OWNSHIP, createFakeAviationDatabase } from './fixture';
import { AirportQueriesContext, defaultAirportQueries, type AirportQueries } from './sources';
import { nearest, useNearestEntry, type NearestData } from './store';
import { rwy } from './__fixtures__/swiftAirports';

const base = (patch: Partial<NearestData> = {}): NearestData => ({ ...nearest.store.getState(), ...patch });

function mount(
  data: NearestData,
  element: ReactElement = <NearestColumn />,
  queries: AirportQueries = defaultAirportQueries,
) {
  const store = nearest.make(data);
  const view = render(
    <nearest.Provider store={store}>
      <AirportQueriesContext.Provider value={queries}>{element}</AirportQueriesContext.Provider>
    </nearest.Provider>,
  );
  return { store, view };
}

const field = (icao: string, name: string, ownership: Airport['ownership'] = 'public') =>
  makeAirport({
    icao,
    name,
    latitude: 32,
    longitude: 34.8,
    elevation: 0,
    type: 'airport',
    ownership,
    runways: [rwy('10/28', 3000, 75, 'asphalt', 32, 34.8)],
  });

describe('NearestColumn', () => {
  beforeEach(() => appStore.setState({ stripColumn: 'nearest', selectedAirportId: null }));
  afterAll(() => appStore.setState({ stripColumn: 'log', selectedAirportId: null }));

  it('shows the reference rows: ident, name, runway, PVT tag, distance and bearing, Direct', async () => {
    const { view } = mount(base());
    const v = await view;
    const text = v.text();
    expect(text).toContain('Nearest');
    for (const piece of [
      'KPAO',
      'Palo Alto Airport',
      "13/31  2,441'\u00A0ASPH", // length and surface never split across lines (iOS pushes orphans down)
      '2.0 NM',
      '116\u00B0',
      'KNUQ',
      "14L/32R  9,197'\u00A0CONC",
      'PVT',
      'KLVK',
      '20.6 NM',
      '050\u00B0',
    ]) {
      expect(text).toContain(piece);
    }
    expect(v.byRole('header').map((n) => n.props.children)).toContain('Nearest');
    const rows = v.all((n) => typeof n.props?.testID === 'string' && n.props.testID.startsWith('nearest-row-'));
    expect(rows.map((n) => n.props.testID)).toEqual(
      ['KPAO', 'KSQL', 'KNUQ', 'KHWD', 'KSJC', 'KSFO', 'KOAK', 'KHAF', 'KRHV', 'KLVK'].map((i) => `nearest-row-${i}`),
    );
    const knuq = v.byTestId('nearest-row-KNUQ');
    expect(knuq.props.accessibilityRole).toBe('button');
    expect(knuq.props.accessibilityLabel).toBe("KNUQ, Moffett Federal Airfield, 14L/32R  9,197' CONC, Private use");
    expect(knuq.props.accessibilityHint).toBe('Shows airport information');
    expect(v.byLabel('2.0 NM, 116\u00B0')).toHaveLength(1);
    const direct = v.byTestId('Direct KPAO');
    expect(direct.props.accessibilityRole).toBe('button');
    expect(direct.props.accessibilityLabel).toBe('Direct to KPAO');
    expect(v.byLabel('Private use')).toHaveLength(1);
  });

  it('Direct starts Direct-To to that airport and returns the strip to the log', async () => {
    const directTo = jest.fn();
    const { view } = mount(base({ directTo }));
    const v = await view;
    await press(v.byTestId('Direct KSQL'));
    expect(directTo).toHaveBeenCalledTimes(1);
    expect(directTo.mock.calls[0][0].icao).toBe('KSQL');
    expect(appStore.getState().stripColumn).toBe('log');
  });

  it('an onDirectTo prop overrides the store action', async () => {
    const storeAction = jest.fn();
    const prop = jest.fn();
    const { view } = mount(base({ directTo: storeAction }), <NearestColumn onDirectTo={prop} />);
    await press((await view).byTestId('Direct KHWD'));
    expect(prop.mock.calls[0][0].icao).toBe('KHWD');
    expect(storeAction).not.toHaveBeenCalled();
  });

  it('tapping the row body opens the airport column for that airport', async () => {
    const { view } = mount(base());
    await press((await view).byTestId('nearest-row-KOAK'));
    expect(appStore.getState()).toMatchObject({ selectedAirportId: 'KOAK', stripColumn: 'airport' });
  });

  it('empty list: says no landable airport is in range, and why', async () => {
    const v = await mount(base({ entries: [], ownship: null })).view;
    expect(v.text()).toContain('No landable airport in range');
    expect(v.text()).toContain('runways under 1500 ft are not listed');
    expect(v.all((n) => n.props?.testID?.startsWith?.('Direct '))).toHaveLength(0);
  });

  it('loading with no list yet shows a spinner, not "no airport in range"', async () => {
    const v = await mount(base({ entries: [], loading: true, ownship: null })).view;
    expect(v.byLabel('Finding nearest airports')).toHaveLength(1);
    expect(v.text()).not.toContain('No landable airport');
  });

  it('a failure with no list says the data is unavailable', async () => {
    const v = await mount(base({ entries: [], error: 'database is locked', ownship: null })).view;
    expect(v.text()).toContain('Nearest airports unavailable');
    expect(v.text()).toContain('The list updates at the next position fix.');
    expect(v.text()).not.toContain('database is locked'); // raw error text stays out of the UI
    expect(v.text()).not.toContain('No landable airport');
  });

  it('a failure with a list keeps the list and says it is stale', async () => {
    const v = await mount(base({ error: 'database is locked', ownship: null })).view;
    expect(v.byRole('alert').map((n) => n.props.children)).toEqual(['Could not refresh: showing the last list']);
    expect(v.byTestId('Direct KPAO')).toBeTruthy();
  });

  it('long and Hebrew names stay on one tail-truncated line; Israeli PPR and NOTAM tags are listed', async () => {
    const hebrew =
      '\u05E8\u05D0\u05E9\u05D5\u05DF \u05DC\u05E6\u05D9\u05D5\u05DF \u05E9\u05D3\u05D4 \u05EA\u05E2\u05D5\u05E4\u05D4 \u05D0\u05E8\u05D5\u05DA';
    const long = 'Reid-Hillview Airport of Santa Clara County With A Much Longer Name Than Fits';
    const entries = [
      {
        airport: field('LLRS', hebrew),
        distance: 1,
        bearing: 10,
        israel: { requiresPPR: true, closureNotamIDs: ['C1/26'], isReviewed: false },
      },
      { airport: field('KRHV', long, 'military'), distance: 2, bearing: 20 },
    ];
    const v = await mount(base({ entries, ownship: null })).view;
    for (const name of [hebrew, long]) {
      const [node] = v.all((n) => n.props?.children === name);
      expect(node?.props.numberOfLines).toBe(1);
      expect(node?.props.ellipsizeMode).toBe('tail');
    }
    expect(v.byTestId('nearest-row-LLRS').props.accessibilityLabel).toBe(
      `LLRS, ${hebrew}, 10/28  3,000' ASPH, Prior permission required, A NOTAM names this field closed`,
    );
    expect(v.text()).toContain('NOTAM CLSD');
    expect(v.byLabel('Military field, emergency use only')).toHaveLength(1);
  });

  it('a field without runway data says so', async () => {
    const bare = makeAirport({ ...field('XNOR', 'No Runways'), runways: [] });
    const v = await mount(base({ entries: [{ airport: bare, distance: 1, bearing: 1 }], ownship: null })).view;
    expect(v.text()).toContain('no runway data');
  });

  it('refreshes from the injected queries when mounted with an ownship, and the footer entry follows', async () => {
    const queries: AirportQueries = {
      ...defaultAirportQueries,
      aviation: createFakeAviationDatabase(),
    };
    const Footer = () => <Text testID="footer">{useNearestEntry()?.airport.icao ?? 'none'}</Text>;
    const { store, view } = mount(
      base({ entries: [], ownship: FIXTURE_OWNSHIP }),
      <>
        <NearestColumn />
        <Footer />
      </>,
      queries,
    );
    const v = await view;
    expect(store.getState().entries).toHaveLength(10);
    expect(v.byTestId('Direct KPAO')).toBeTruthy();
    expect(v.byTestId('footer').props.children).toBe('KPAO');
  });
});
