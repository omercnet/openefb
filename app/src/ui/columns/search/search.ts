// SearchViewModel.swift: debounced airport search (300 ms, at least 2 characters), in the region's database: Israel
// searches the curated aerodromes by ICAO, English or Hebrew name, everywhere else the aviation database. The Swift view
// model is @State on MapContainerView, so it outlives the column: here the state is the `searchSlice` store and the
// controller is kept per store, so closing the column neither drops the query and results nor cancels a pending search;
// only picking a result clears them (SearchColumnView). JS-only: each search carries a request token per store, so a slow
// earlier response never replaces a later one, and a failure is marked (`failed`) instead of reading as "no match".
import { useContext, useEffect } from 'react';
import type { StoreApi } from 'zustand';
import type { Airport, Region } from '../../../domain/core';
import { regionSlice } from '../../state/region';
import { createStoreContext } from '../../state/storeContext';
import { israelAirport } from '../nearest/israelAerodromeAdapter';
import { AirportQueriesContext, defaultAirportQueries, sameQueries, type AirportQueries } from '../nearest/sources';

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_LIMIT = 20;
export const MINIMUM_QUERY_LENGTH = 2;

export interface SearchState {
  query: string;
  results: Airport[];
  isSearching: boolean;
  /** The last search failed (results were cleared, as in the Swift; the column says so instead of "no match"). */
  failed: boolean;
}

export const EMPTY_SEARCH: SearchState = { query: '', results: [], isSearching: false, failed: false };

/** The search the Search column shows; one per app (MapContainerView's searchViewModel). */
export const searchSlice = createStoreContext<SearchState>(EMPTY_SEARCH);

/** Swift `String.count` (grapheme clusters); without Intl.Segmenter (Hermes), code points minus combining marks. */
function characterCount(text: string): number {
  if (typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter().segment(text)].length;
  return [...text.replace(/\p{M}/gu, '')].length;
}

/**
 * Whether a query is sent: Swift's `query.count >= 2`, plus a JS-only safety guard that never sends a query without a
 * letter or digit. In the US that changes nothing (the FTS query answers nothing for punctuation); in Israel the Swift
 * sends it to a LIKE search and would list the names that contain the punctuation (" /" finds names with a slash).
 * The column's "No airports match" uses the same test on the trimmed query (Swift trims there), so it never shows for a
 * query that was not sent.
 */
export const isSearchableQuery = (query: string): boolean =>
  characterCount(query) >= MINIMUM_QUERY_LENGTH && /[\p{L}\p{N}]/u.test(query);

export interface AirportSearch {
  /** The text field changed: store it and search (SwiftUI onChange(of: query)). */
  setQuery(query: string): void;
  /** Debounced search of the current query; the Search key calls it too. */
  search(): void;
  /** Cancel pending work (later responses are dropped) and empty the search (a result was picked). */
  clear(): void;
}

export interface SearchSources {
  queries: () => Pick<AirportQueries, 'aviation' | 'israel'>;
  /** Read at search time, so a region switch takes effect at once. */
  region: () => Region;
}

export function createAirportSearch(store: StoreApi<SearchState>, sources: SearchSources): AirportSearch {
  let token = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (patch: Partial<SearchState>) => store.setState(patch);
  const cancel = () => {
    token += 1;
    clearTimeout(timer);
  };

  const runSearch = async (query: string): Promise<Airport[]> => {
    const { aviation, israel } = sources.queries();
    if (sources.region() === 'israel') {
      if (!israel) throw new Error('Israel aerodrome data is not available');
      return (await israel.searchAerodromes(query, SEARCH_LIMIT)).map(israelAirport);
    }
    return aviation.searchAirports(query, SEARCH_LIMIT);
  };

  const search = () => {
    cancel();
    const query = store.getState().query;
    if (!isSearchableQuery(query)) {
      set({ results: [], isSearching: false, failed: false });
      return;
    }
    const mine = token;
    timer = setTimeout(() => {
      set({ isSearching: true });
      runSearch(query).then(
        (results) => {
          if (mine === token) set({ results, isSearching: false, failed: false });
        },
        () => {
          // Swift: silent failure, results clear.
          if (mine === token) set({ results: [], isSearching: false, failed: true });
        },
      );
    }, SEARCH_DEBOUNCE_MS);
  };

  return {
    setQuery(query) {
      if (query === store.getState().query) return;
      set({ query });
      search();
    },
    search,
    clear() {
      cancel();
      store.setState(EMPTY_SEARCH, true);
    },
  };
}

type Sources = { queries: Pick<AirportQueries, 'aviation' | 'israel'>; region: StoreApi<{ region: Region }> };

interface Controller {
  search: AirportSearch;
  /**
   * The sources the mounted column last saw, read by a search that fires after the column closed. Other databases
   * (`sameQueries` false) re-run the current query on them: the token drops an answer from the old ones, and a failure
   * they caused is cleared at once. A fresh object around the same databases changes nothing.
   */
  use(sources: Sources): void;
}

const controllers = new WeakMap<StoreApi<SearchState>, Controller>();

/** One controller per search store, so the debounce and the request token outlive the column. */
function controllerFor(store: StoreApi<SearchState>): Controller {
  let controller = controllers.get(store);
  if (!controller) {
    let current: Sources = { queries: defaultAirportQueries, region: regionSlice.store };
    controller = {
      search: createAirportSearch(store, {
        queries: () => current.queries,
        region: () => current.region.getState().region,
      }),
      use: (sources) => {
        const swapped = !sameQueries(sources.queries, current.queries);
        current = sources;
        if (!swapped) return;
        store.setState({ failed: false });
        controller!.search.search();
      },
    };
    controllers.set(store, controller);
  }
  return controller;
}

/**
 * Empty a search store and cancel its pending search (the default store outlives every column; tests reset it).
 */
export function resetSearch(store: StoreApi<SearchState> = searchSlice.store): void {
  const controller = controllers.get(store);
  if (controller) controller.search.clear();
  else store.setState(EMPTY_SEARCH, true);
}

/** The Search column's view model: the search slice plus its actions, over the injected queries and the region. */
export function useAirportSearch() {
  const store = searchSlice.useStoreApi();
  const queries = useContext(AirportQueriesContext);
  const region = regionSlice.useStoreApi();
  const { search, use } = controllerFor(store);
  useEffect(() => use({ queries, region }), [use, queries, region]);
  const state = searchSlice.useData((s) => s);
  return { ...state, setQuery: search.setQuery, submit: search.search, clear: search.clear };
}
