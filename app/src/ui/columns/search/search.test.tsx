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
import { EMPTY_SEARCH, createAirportSearch, type SearchState } from './search';

const fake = createFakeAviationDatabase();

function harness(searchAirports: AirportQueries['aviation']['searchAirports'], region: Region = 'us') {
  const states: SearchState[] = [];
  const s = createAirportSearch({
    queries: () => ({ aviation: { ...fake, searchAirports }, israel: null }),
    region: () => region,
    onChange: (next) => states.push(next),
  });
  const last = () => states[states.length - 1] ?? EMPTY_SEARCH;
  return { s, last, icaos: () => last().results.map((a) => a.icao) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

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

  const mount = (
    queries: AirportQueries = defaultAirportQueries,
    onSelect?: (icao: string) => void,
    region = regionSlice.make(),
  ) =>
    render(
      <regionSlice.Provider store={region}>
        <AirportQueriesContext.Provider value={queries}>
          <SearchColumn onSelect={onSelect} />
        </AirportQueriesContext.Provider>
      </regionSlice.Provider>,
    );
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
    expect(v.byRole('search').map((n) => n.props.accessibilityLabel)).toEqual(['Search airports']);
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

  it('unmounting cancels the pending search', async () => {
    const query = jest.fn(fake.searchAirports);
    const v = await mount({ ...defaultAirportQueries, aviation: { ...fake, searchAirports: query } });
    await callHandler(field(v), 'onChangeText', 'KPAO');
    await v.unmount();
    await tick(300);
    expect(query).not.toHaveBeenCalled();
  });
});
