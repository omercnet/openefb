// SearchViewModel behaviour (debounce, minimum length, region, failures) and the request token, plus render tests for
// SearchColumn: autofocus, typing to results, selecting, the searching / no-match / failed states.
import { act } from 'react';
import { callHandler, press, render } from '../../../../tests/support/ui';
import type { Airport as AviationAirport } from '../../../data/aviation/types';
import type { Region } from '../../../domain/core';
import { appStore } from '../../state/appStore';
import { SearchColumn } from '../SearchColumn';
import { createFakeAviationDatabase } from '../nearest/fixture';
import { AirportQueriesContext, defaultAirportQueries, type AirportQueries } from '../nearest/sources';
import { regionSlice } from '../../state/region';
import {
  EMPTY_SEARCH,
  createAirportSearch,
  isSearchableQuery,
  resetSearch,
  searchSlice,
  type SearchState,
} from './search';

const fake = createFakeAviationDatabase();

function harness(searchAirports: AirportQueries['aviation']['searchAirports'], region: Region = 'us') {
  const store = searchSlice.make();
  const s = createAirportSearch(store, {
    queries: () => ({ aviation: { ...fake, searchAirports }, israel: null }),
    region: () => region,
  });
  const last = (): SearchState => store.getState();
  return { s, last, icaos: () => last().results.map((a) => a.icao) };
}

beforeEach(() => {
  jest.useFakeTimers();
  resetSearch(); // the default search store outlives a column, so a test must not inherit the last one's search
});
afterEach(() => {
  resetSearch();
  jest.useRealTimers();
});

describe('SearchViewModel', () => {
  test('waits 300 ms after the last keystroke and sends one query (no query storm)', async () => {
    const query = jest.fn(fake.searchAirports);
    const { s, icaos } = harness(query);
    for (const q of ['K', 'KP', 'KPA', 'KPAO']) {
      s.setQuery(q);
      await jest.advanceTimersByTimeAsync(100);
    }
    expect(query).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(200);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('KPAO', 20);
    expect(icaos()).toEqual(['KPAO']);
  });

  test.each([
    ['empty', ''],
    ['one character', 'K'],
    ['whitespace only', '   '],
    ['symbols only', '--/'],
  ])('%s query: no results and no query', async (_label, q) => {
    const query = jest.fn(fake.searchAirports);
    const { s, last } = harness(query);
    s.setQuery('KPAO');
    await jest.advanceTimersByTimeAsync(300);
    expect(last().results).toHaveLength(1);
    s.setQuery(q);
    await jest.advanceTimersByTimeAsync(300);
    expect(query).toHaveBeenCalledTimes(1);
    expect(last()).toMatchObject({ results: [], isSearching: false, failed: false });
  });

  test('a slow earlier response never replaces a later one', async () => {
    const slow = Promise.withResolvers<AviationAirport[]>();
    const query = jest.fn(fake.searchAirports);
    query.mockReturnValueOnce(slow.promise);
    const { s, icaos, last } = harness(query);
    s.setQuery('Palo');
    await jest.advanceTimersByTimeAsync(300);
    expect(last().isSearching).toBe(true);
    s.setQuery('Oakland');
    await jest.advanceTimersByTimeAsync(300);
    expect(icaos()).toEqual(['KOAK']);
    slow.resolve(await fake.searchAirports('Palo')); // the first answer arrives late
    await jest.advanceTimersByTimeAsync(0);
    expect(icaos()).toEqual(['KOAK']);
    expect(last().isSearching).toBe(false);
  });

  test('a rejection clears the results (Swift) and marks the search failed; the next search recovers', async () => {
    const query = jest.fn(fake.searchAirports);
    const { s, last, icaos } = harness(query);
    s.setQuery('KPAO');
    await jest.advanceTimersByTimeAsync(300);
    query.mockRejectedValueOnce(new Error('database is locked'));
    s.setQuery('KSQL');
    await jest.advanceTimersByTimeAsync(300);
    expect(last()).toMatchObject({ results: [], isSearching: false, failed: true });
    s.setQuery('KSQ');
    await jest.advanceTimersByTimeAsync(300);
    expect(icaos()).toEqual(['KSQL']);
    expect(last().failed).toBe(false);
  });

  test('a late rejection of a superseded search changes nothing', async () => {
    const slow = Promise.withResolvers<AviationAirport[]>();
    const query = jest.fn(fake.searchAirports);
    query.mockReturnValueOnce(slow.promise);
    const { s, last, icaos } = harness(query);
    s.setQuery('Palo');
    await jest.advanceTimersByTimeAsync(300);
    s.setQuery('KSQL');
    await jest.advanceTimersByTimeAsync(300);
    slow.reject(new Error('late'));
    await jest.advanceTimersByTimeAsync(0);
    expect(icaos()).toEqual(['KSQL']);
    expect(last().failed).toBe(false);
  });

  test('Israel without the aerodrome database reads as a failed search, not as no match', async () => {
    const { s, last } = harness(fake.searchAirports, 'israel');
    s.setQuery('LLHZ');
    await jest.advanceTimersByTimeAsync(300);
    expect(last()).toMatchObject({ results: [], failed: true });
  });

  test('clear cancels a pending search', async () => {
    const query = jest.fn(fake.searchAirports);
    const { s, last } = harness(query);
    s.setQuery('KPAO');
    s.clear();
    await jest.advanceTimersByTimeAsync(300);
    expect(query).not.toHaveBeenCalled();
    expect(last()).toEqual(EMPTY_SEARCH);
  });
});

/** Advance the fake clock inside act, so the column's state updates are flushed. */
const tick = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));

describe('SearchColumn', () => {
  beforeEach(() => appStore.setState({ stripColumn: 'search', selectedAirportId: null }));
  afterAll(() => appStore.setState({ stripColumn: 'log', selectedAirportId: null }));

  const tree = (
    queries: AirportQueries = defaultAirportQueries,
    onSelect?: (icao: string) => void,
    region = regionSlice.make(),
    search = searchSlice.make(),
  ) => (
    <regionSlice.Provider store={region}>
      <searchSlice.Provider store={search}>
        <AirportQueriesContext.Provider value={queries}>
          <SearchColumn onSelect={onSelect} />
        </AirportQueriesContext.Provider>
      </searchSlice.Provider>
    </regionSlice.Provider>
  );
  const mount = (...args: Parameters<typeof tree>) => render(tree(...args));
  const field = (v: Awaited<ReturnType<typeof render>>) =>
    v.all((n) => n.props?.placeholder === 'ICAO, name or city')[0]!;
  const type = async (v: Awaited<ReturnType<typeof render>>, text: string) => {
    await callHandler(field(v), 'onChangeText', text);
    await tick(300);
  };

  it('matches the reference when empty: title, focused field, no rows', async () => {
    const v = await mount();
    expect(v.byRole('header').map((n) => n.props.children)).toContain('Search');
    expect(field(v).props.autoFocus).toBe(true);
    // Swift .accessibilityLabel("Search airports") on the field itself (a TextInput, implicitly a text field).
    expect(v.byLabel('Search airports')).toEqual([field(v)]);
    expect(field(v).props.accessibilityRole).toBeUndefined();
    expect(v.all((n) => n.props?.testID?.startsWith?.('search-result-'))).toHaveLength(0);
    expect(v.all((n) => n.props?.testID === 'search-no-results')).toHaveLength(0);
  });

  it('typing shows results; selecting one hands its ICAO to onSelect and clears the search', async () => {
    const onSelect = jest.fn();
    const v = await mount(defaultAirportQueries, onSelect);
    await type(v, 'Palo');
    const row = v.byTestId('search-result-KPAO');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe('KPAO, Palo Alto Airport');
    expect(row.props.accessibilityHint).toBe('Shows airport information');
    await press(row);
    expect(onSelect).toHaveBeenCalledWith('KPAO');
    expect(field(v).props.value).toBe('');
    expect(v.all((n) => n.props?.testID?.startsWith?.('search-result-'))).toHaveLength(0);
  });

  it('selecting defaults to opening the airport column', async () => {
    const v = await mount();
    await type(v, 'KSQL');
    await press(v.byTestId('search-result-KSQL'));
    expect(appStore.getState()).toMatchObject({ selectedAirportId: 'KSQL', stripColumn: 'airport' });
  });

  it('says "Searching..." while the query runs, then "No airports match" for an empty answer', async () => {
    const slow = Promise.withResolvers<AviationAirport[]>();
    const v = await mount({ ...defaultAirportQueries, aviation: { ...fake, searchAirports: () => slow.promise } });
    await type(v, 'ZZZZ');
    expect(v.text()).toContain('Searching\u2026');
    expect(v.byLabel('Searching')).toHaveLength(1);
    slow.resolve([]);
    await tick(0);
    expect(v.byTestId('search-no-results')).toBeTruthy();
    expect(v.text()).toContain('No airports match \u201CZZZZ\u201D');
  });

  it('a failed search says so instead of "No airports match"', async () => {
    const v = await mount({
      ...defaultAirportQueries,
      aviation: { ...fake, searchAirports: () => Promise.reject(new Error('locked')) },
    });
    await type(v, 'KPAO');
    expect(v.byTestId('search-failed').props.accessibilityRole).toBe('alert');
    expect(v.all((n) => n.props?.testID === 'search-no-results')).toHaveLength(0);
  });

  it('reads the region from the region slice at search time', async () => {
    const region = regionSlice.make({ region: 'us' });
    const v = await mount(defaultAirportQueries, undefined, region);
    region.setState({ region: 'israel' }); // no Israel database in the default queries
    await type(v, 'KPAO');
    expect(v.byTestId('search-failed')).toBeTruthy();
    region.setState({ region: 'us' });
    await type(v, 'KPA');
    expect(v.byTestId('search-result-KPAO')).toBeTruthy();
  });

  it('the query and results survive closing and reopening the column (Swift: @State on MapContainerView)', async () => {
    const search = searchSlice.make();
    const first = await mount(defaultAirportQueries, undefined, undefined, search);
    await type(first, 'Palo');
    await first.unmount();
    const again = await mount(defaultAirportQueries, undefined, undefined, search);
    expect(field(again).props.value).toBe('Palo');
    expect(again.byTestId('search-result-KPAO')).toBeTruthy();
  });

  it('closing the column before the 300 ms elapse still lands the results in the store', async () => {
    const query = jest.fn(fake.searchAirports);
    const search = searchSlice.make();
    const v = await mount(
      { ...defaultAirportQueries, aviation: { ...fake, searchAirports: query } },
      undefined,
      undefined,
      search,
    );
    await callHandler(field(v), 'onChangeText', 'KPAO');
    await v.unmount();
    await tick(300);
    expect(query).toHaveBeenCalledTimes(1);
    expect(search.getState()).toMatchObject({ query: 'KPAO', isSearching: false });
    expect(search.getState().results.map((a) => a.icao)).toEqual(['KPAO']);
  });

  it.each([
    ['one emoji', '\u{1F600}'],
    ['a Hebrew letter with a vowel mark', '\u05D1\u05B8'],
    ['symbols only', '--/'],
  ])('%s: not sent, and no "No airports match"', async (_label, text) => {
    const query = jest.fn(fake.searchAirports);
    const v = await mount({ ...defaultAirportQueries, aviation: { ...fake, searchAirports: query } });
    await type(v, text);
    expect(query).not.toHaveBeenCalled();
    expect(v.all((n) => n.props?.testID === 'search-no-results')).toHaveLength(0);
  });

  it('" K" is sent (Swift counts the space), and an empty answer shows no "No airports match" (Swift trims there)', async () => {
    const query = jest.fn(async () => []);
    const v = await mount({ ...defaultAirportQueries, aviation: { ...fake, searchAirports: query } });
    await type(v, ' K');
    expect(query).toHaveBeenCalledWith(' K', 20);
    expect(v.all((n) => n.props?.testID === 'search-no-results')).toHaveLength(0);
  });

  it('a queries swap re-runs the search: the old answer is dropped, the new results show', async () => {
    const slow = Promise.withResolvers<AviationAirport[]>();
    const search = searchSlice.make();
    const region = regionSlice.make();
    const old: AirportQueries = { ...defaultAirportQueries, aviation: { ...fake, searchAirports: () => slow.promise } };
    const v = await mount(old, undefined, region, search);
    await type(v, 'KSQL'); // in flight on the old database
    await v.update(tree(defaultAirportQueries, undefined, region, search));
    await tick(300);
    expect(v.byTestId('search-result-KSQL')).toBeTruthy();
    slow.resolve(await fake.searchAirports('KPAO')); // the old database answers late
    await tick(0);
    expect(search.getState().results.map((a) => a.icao)).toEqual(['KSQL']);
  });

  it('a queries swap clears a failure from the old database without a keystroke', async () => {
    const search = searchSlice.make();
    const region = regionSlice.make();
    const closed: AirportQueries = {
      ...defaultAirportQueries,
      aviation: { ...fake, searchAirports: () => Promise.reject(new Error('closed')) },
    };
    const v = await mount(closed, undefined, region, search);
    await type(v, 'KPAO');
    expect(v.byTestId('search-failed')).toBeTruthy();
    await v.update(tree(defaultAirportQueries, undefined, region, search));
    await tick(300);
    expect(search.getState().failed).toBe(false);
    expect(v.byTestId('search-result-KPAO')).toBeTruthy();
  });

  it('a fresh provider object holding the same databases neither drops an in-flight answer nor searches again', async () => {
    const slow = Promise.withResolvers<AviationAirport[]>();
    const query = jest.fn(() => slow.promise);
    const search = searchSlice.make();
    const region = regionSlice.make();
    const aviation = { ...fake, searchAirports: query };
    const v = await mount({ ...defaultAirportQueries, aviation }, undefined, region, search);
    await type(v, 'KPAO');
    await v.update(tree({ ...defaultAirportQueries, aviation }, undefined, region, search)); // inline value, same sources
    await tick(300);
    slow.resolve(await fake.searchAirports('KPAO'));
    await tick(0);
    expect(query).toHaveBeenCalledTimes(1);
    expect(v.byTestId('search-result-KPAO')).toBeTruthy();
  });

  it('resetSearch empties the default search store and cancels its pending search', async () => {
    const query = jest.fn(fake.searchAirports);
    const v = await render(
      <AirportQueriesContext.Provider
        value={{ ...defaultAirportQueries, aviation: { ...fake, searchAirports: query } }}
      >
        <SearchColumn />
      </AirportQueriesContext.Provider>,
    );
    await callHandler(field(v), 'onChangeText', 'KPAO');
    await act(async () => resetSearch());
    await tick(300);
    expect(query).not.toHaveBeenCalled();
    expect(searchSlice.store.getState()).toEqual(EMPTY_SEARCH);
  });
});

describe('isSearchableQuery', () => {
  const cases: [string, boolean][] = [
    ['KP', true],
    ['K', false],
    [' K', true],
    ['\u{1F600}', false],
    ['\u05D1\u05B8', false],
    ['\u05D1\u05B8\u05D2', true],
    ['--/', false],
    ['', false],
  ];

  test.each(cases)('%j -> %s (Intl.Segmenter)', (text, sendable) => {
    expect(isSearchableQuery(text)).toBe(sendable);
  });

  test.each(cases)('%j -> %s (Hermes fallback: no Intl.Segmenter)', (text, sendable) => {
    const segmenter = Object.getOwnPropertyDescriptor(Intl, 'Segmenter')!;
    Reflect.deleteProperty(Intl, 'Segmenter');
    try {
      expect(typeof Intl.Segmenter).toBe('undefined');
      expect(isSearchableQuery(text)).toBe(sendable);
    } finally {
      Object.defineProperty(Intl, 'Segmenter', segmenter);
    }
  });
});
