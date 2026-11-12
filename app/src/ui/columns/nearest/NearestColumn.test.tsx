// Render tests for NearestColumn: the reference rows and their accessibility, Direct and row taps, the empty, loading,
// error and no-data states, long and Hebrew names, and the refresh hook driving the list.
import { Text } from 'react-native';
import { act, type ReactElement } from 'react';
import { callHandler, press, render, type Rendered } from '../../../../tests/support/ui';
import { makeAirport, type Airport } from '../../../domain/core';
import { appStore } from '../../state/appStore';
import { regionSlice } from '../../state/region';
import { NearestColumn } from '../NearestColumn';
import { FIXTURE_OWNSHIP, createFakeAviationDatabase } from './fixture';
import { AirportQueriesContext, defaultAirportQueries, type AirportQueries } from './sources';
import { nearest, useNearestEntry, type NearestData } from './store';
import { rwy } from './__fixtures__/swiftAirports';

const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } } });

/** The tags the pilot sees (the visible box's children; the measuring copy is a sibling). */
const visibleTags = (v: Rendered, icao: string) =>
  v.all((n) => n.parent?.props?.testID === `nearest-tags-${icao}` && typeof n.props?.children === 'string');

/** Deliver the layout events: the width the row gives the tags, and each tag's width in the hidden measuring copy. */
async function measureTags(v: Rendered, icao: string, available: number, widths: Record<string, number>) {
  await callHandler(v.byTestId(`nearest-tags-${icao}`), 'onLayout', layout(available));
  for (const [text, width] of Object.entries(widths)) {
    await callHandler(v.byTestId(`nearest-tags-${icao}-measure-${text}`), 'onLayout', layout(width));
  }
}

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
    await measureTags(v, 'KNUQ', 160, { PVT: 38 });
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

  it('no position yet: waits for the first fix instead of claiming nothing is in range', async () => {
    const v = await mount(base({ entries: [], ownship: null })).view;
    expect(v.text()).toContain('Waiting for position');
    expect(v.text()).not.toContain('No landable airport');
  });

  it('empty list: says no landable airport is in range, and why', async () => {
    const none: AirportQueries = {
      ...defaultAirportQueries,
      aviation: { ...defaultAirportQueries.aviation, nearestAirports: async () => [] },
    };
    const v = await mount(base({ entries: [], ownship: { lat: 37.4876, lon: -122.2289 } }), undefined, none).view;
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
    await measureTags(v, 'KRHV', 160, { MIL: 38 });
    expect(v.byLabel('Military field, emergency use only')).toHaveLength(1);
  });

  it('the ident and the caution tags keep their natural width: no line limit, no squeezing (Swift .fixedSize())', async () => {
    const entries = [
      {
        airport: field('LLRS', 'Rishon'),
        distance: 1,
        bearing: 10,
        israel: { requiresPPR: true, closureNotamIDs: ['C1/26'], isReviewed: false },
      },
    ];
    const v = await mount(base({ entries, ownship: null })).view;
    const [ident] = v.all((n) => n.props?.children === 'LLRS');
    expect(ident?.props.numberOfLines).toBeUndefined();
    // In a row of its own the ident is measured on the horizontal axis, where flexShrink 0 means it is never squeezed.
    expect(ident?.parent?.props.style).toEqual(expect.objectContaining({ flexDirection: 'row' }));
    expect(ident?.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ flexShrink: 0 })]));
    await measureTags(v, 'LLRS', 150, { PPR: 40, 'NOTAM CLSD': 300 }); // wider than the column
    for (const [text, width] of [
      ['PPR', 40],
      ['NOTAM CLSD', 300],
    ] as const) {
      const [tag] = visibleTags(v, 'LLRS').filter((n) => n.props.children === text);
      expect(tag?.props.numberOfLines).toBeUndefined();
      // minWidth = the unconstrained width measured off screen: the badge overflows rather than wraps ('NOTAM / CLSD').
      expect(tag?.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ minWidth: width })]));
    }
  });

  it('tags show only once measured, then side by side when they fit, else one per line (ViewThatFits)', async () => {
    const israel = { requiresPPR: true, closureNotamIDs: ['C1/26'], isReviewed: false };
    const entries = [{ airport: field('LLEK', 'Tel Nof', 'military'), distance: 1, bearing: 10, israel }];
    const { store, view } = mount(base({ entries, ownship: null }));
    const v = await view;
    const box = () => v.byTestId('nearest-tags-LLEK');
    // First frame: nothing visible, a hidden copy (no width cap, out of the accessibility tree) being measured.
    expect(visibleTags(v, 'LLEK')).toHaveLength(0);
    const hidden = v.byTestId('nearest-tags-LLEK-measure');
    expect(hidden.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(hidden.props.accessibilityElementsHidden).toBe(true);
    expect(v.byLabel('Military field, emergency use only')).toHaveLength(0);
    await callHandler(box(), 'onLayout', layout(186));
    expect(visibleTags(v, 'LLEK')).toHaveLength(0); // the tags are not measured yet
    // MIL 40 + PPR 40 + NOTAM CLSD 90 + two 8 pt gaps = 186 pt.
    await measureTags(v, 'LLEK', 186, { MIL: 40, PPR: 40, 'NOTAM CLSD': 90 });
    expect(visibleTags(v, 'LLEK').map((n) => n.props.children)).toEqual(['MIL', 'PPR', 'NOTAM CLSD']);
    expect(box().props.style).toEqual(expect.objectContaining({ flexDirection: 'row' }));
    expect(v.byLabel('Military field, emergency use only')).toHaveLength(1);
    await callHandler(box(), 'onLayout', layout(185));
    expect(box().props.style).toEqual(expect.objectContaining({ flexDirection: 'column' }));
    await callHandler(box(), 'onLayout', layout(200)); // wider again (rotation): back to one line
    expect(box().props.style).toEqual(expect.objectContaining({ flexDirection: 'row' }));
    // A new tag set: hidden again until the new tag is measured, never painted in a guessed layout.
    const pvt = {
      ...entries[0]!,
      airport: field('LLEK', 'Tel Nof', 'private'),
      israel: { ...israel, requiresPPR: false },
    };
    await act(async () => store.setState({ entries: [pvt] }));
    expect(visibleTags(v, 'LLEK')).toHaveLength(0);
    await measureTags(v, 'LLEK', 200, { PVT: 38 });
    expect(visibleTags(v, 'LLEK').map((n) => n.props.children)).toEqual(['PVT', 'NOTAM CLSD']);
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

  it('swapping the queries while a slow query is in flight keeps the new list', async () => {
    const slow = Promise.withResolvers<Awaited<ReturnType<AirportQueries['aviation']['nearestAirports']>>>();
    const fake = createFakeAviationDatabase();
    const first: AirportQueries = {
      ...defaultAirportQueries,
      aviation: { ...fake, nearestAirports: () => slow.promise },
    };
    const second: AirportQueries = {
      ...defaultAirportQueries,
      aviation: { ...fake, nearestAirports: async (c, n) => (await fake.nearestAirports(c, n)).slice(1) },
    };
    const store = nearest.make(base({ entries: [], ownship: FIXTURE_OWNSHIP }));
    const tree = (queries: AirportQueries) => (
      <nearest.Provider store={store}>
        <AirportQueriesContext.Provider value={queries}>
          <NearestColumn />
        </AirportQueriesContext.Provider>
      </nearest.Provider>
    );
    const v = await render(tree(first));
    await v.update(tree(second));
    expect(store.getState().entries[0]?.airport.icao).toBe('KSQL');
    slow.resolve(await fake.nearestAirports(FIXTURE_OWNSHIP, 40));
    await v.update(tree(second));
    expect(store.getState().entries[0]?.airport.icao).toBe('KSQL');
  });

  it('re-rendering with a fresh provider object holding the same databases does not requery', async () => {
    const fake = createFakeAviationDatabase();
    const nearestAirports = jest.fn(fake.nearestAirports);
    const aviation = { ...fake, nearestAirports };
    const store = nearest.make(base({ entries: [], ownship: FIXTURE_OWNSHIP }));
    const tree = () => (
      <nearest.Provider store={store}>
        <AirportQueriesContext.Provider value={{ ...defaultAirportQueries, aviation }}>
          <NearestColumn />
        </AirportQueriesContext.Provider>
      </nearest.Provider>
    );
    const v = await render(tree());
    await v.update(tree());
    await v.update(tree());
    expect(nearestAirports).toHaveBeenCalledTimes(1);
    expect(store.getState().entries).toHaveLength(10);
  });

  it("a region change clears the other region's airports even with no position, then the new region fills it", async () => {
    const region = regionSlice.make({ region: 'us' });
    const store = nearest.make(base({ entries: [], ownship: FIXTURE_OWNSHIP }));
    const tree = (
      <regionSlice.Provider store={region}>
        <nearest.Provider store={store}>
          <AirportQueriesContext.Provider value={defaultAirportQueries}>
            <NearestColumn />
          </AirportQueriesContext.Provider>
        </nearest.Provider>
      </regionSlice.Provider>
    );
    const v = await render(tree);
    await act(async () => undefined);
    expect(store.getState().entries.length).toBeGreaterThan(0);
    await act(async () => store.setState({ ownship: null })); // no fix: the hook cannot requery
    await act(async () => region.setState({ region: 'israel' }));
    expect(store.getState().entries).toEqual([]);
    expect(v.text()).not.toContain('KSQL');
  });
});
