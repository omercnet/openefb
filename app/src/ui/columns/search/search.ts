// SearchViewModel.swift: debounced airport search (300 ms, at least 2 characters), in the region's database: Israel
// searches the curated aerodromes by ICAO, English or Hebrew name, everywhere else the aviation database. JS-only: each
// search carries a request token, so a slow earlier response never replaces a later one, and a failure is marked
// (`failed`) instead of reading as "no airports match".
import { useContext, useEffect, useMemo, useState } from 'react';
import type { Airport, Region } from '../../../domain/core';
import { israelAirport } from '../nearest/israelAerodromeAdapter';
import { AirportQueriesContext, type AirportQueries } from '../nearest/sources';
import { regionSlice } from '../../state/region';

export const SEARCH_DEBOUNCE_MS = 300;
export const SEARCH_LIMIT = 20;
/** Swift `query.count < 2`: characters, untrimmed (grapheme clusters approximated as code points minus combining marks). */
export const MINIMUM_QUERY_LENGTH = 2;

export interface SearchState {
  query: string;
  results: Airport[];
  isSearching: boolean;
  /** The last search failed (results were cleared, as in the Swift; the column says so instead of "no match"). */
  failed: boolean;
}

export const EMPTY_SEARCH: SearchState = { query: '', results: [], isSearching: false, failed: false };

export interface AirportSearch {
  /** The text field changed: store it and search (SwiftUI onChange(of: query)). */
  setQuery(query: string): void;
  /** Debounced search of the current query; the Search key calls it too. */
  search(): void;
  /** Cancel pending work (later responses are dropped) and empty the search; also run on unmount. */
  clear(): void;
}

/** JS-only guard: a query with no letter or digit (spaces, punctuation) can match nothing, so it is never sent. */
const SEARCHABLE = /[\p{L}\p{N}]/u;

export function createAirportSearch(deps: {
  queries: () => Pick<AirportQueries, 'aviation' | 'israel'>;
  /** Read at search time, so a region switch takes effect at once. */
  region: () => Region;
  onChange: (state: SearchState) => void;
}): AirportSearch {
  let state = EMPTY_SEARCH;
  let token = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const set = (patch: Partial<SearchState>) => {
    state = { ...state, ...patch };
    deps.onChange(state);
  };
  const cancel = () => {
    token += 1;
    clearTimeout(timer);
  };

  const runSearch = async (query: string): Promise<Airport[]> => {
    const { aviation, israel } = deps.queries();
    if (deps.region() === 'israel') {
      if (!israel) throw new Error('Israel aerodrome data is not available');
      return (await israel.searchAerodromes(query, SEARCH_LIMIT)).map(israelAirport);
    }
    return aviation.searchAirports(query, SEARCH_LIMIT);
  };

  const search = () => {
    cancel();
    const query = state.query;
    if ([...query.replace(/\p{M}/gu, '')].length < MINIMUM_QUERY_LENGTH || !SEARCHABLE.test(query)) {
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
      if (query === state.query) return;
      set({ query });
      search();
    },
    search,
    clear() {
      cancel();
      set(EMPTY_SEARCH);
    },
  };
}

/**
 * The Search column's view model: state plus actions, over the injected queries and the current region. New queries (I1
 * swapping the databases) start a fresh, empty search.
 */
export function useAirportSearch() {
  const [state, setState] = useState<SearchState>(EMPTY_SEARCH);
  const queries = useContext(AirportQueriesContext);
  const regionStore = regionSlice.useStoreApi();
  const search = useMemo(
    () =>
      createAirportSearch({ queries: () => queries, region: () => regionStore.getState().region, onChange: setState }),
    [queries, regionStore],
  );
  useEffect(() => () => search.clear(), [search]);
  return { ...state, setQuery: search.setQuery, submit: search.search, clear: search.clear };
}
