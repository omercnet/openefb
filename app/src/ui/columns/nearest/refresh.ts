// NearestAirportViewModel.updateNearest as a refresher over the `nearest` store, and the hook that runs it on each ownship
// or region change (MapContainerView's onChange(ownshipPosition / region)). JS-only: queries are async, so each refresh
// carries a request token and only the latest one may write; a failure keeps the previous list and sets `error`.
import { useContext, useEffect } from 'react';
import type { StoreApi } from 'zustand';
import { distanceNm, hasAirportData, type Coordinate, type Region } from '../../../domain/core';
import type { IsraelAerodrome } from '../../../data/aviation/israelTypes';
import { NOT_LANDABLE_USES, israelAirport, israelFlags } from './israelAerodromeAdapter';
import {
  CANDIDATE_COUNT,
  LIST_COUNT,
  MINIMUM_RUNWAY_LENGTH_FEET,
  NOTAM_REFRESH_INTERVAL_MS,
  REQUERY_DISTANCE_NM,
  rankLandable,
  type NearestAirportEntry,
} from './logic';
import { AirportQueriesContext, sameQueries, type AirportQueries, type NotamClosureLookup } from './sources';
import { useRegion } from '../../state/region';
import { nearest, type NearestData } from './store';

export interface NearestRefresher {
  /** Requery unless ownship moved less than REQUERY_DISTANCE_NM since the last query for the same region. */
  update(position: Coordinate, region: Region): Promise<void>;
  /**
   * Switch to other queries (I1 swapping the databases). Other sources (`sameQueries` false) drop every answer still in
   * flight and forget the move threshold and the NOTAM feed, so the next `update` requeries; a fresh object around the
   * same sources is a no-op (an inline provider value must not requery on every render).
   */
  setQueries(next: AirportQueries): void;
  /**
   * The region the column now serves. Entries that were queried for another region are dropped at once (also with no
   * position yet, and for a region without airport data): they must never read as this region's nearest airports. A
   * failed refresh of the SAME region keeps its list.
   */
  setRegion(region: Region): void;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createNearestRefresher(store: StoreApi<NearestData>, initial: AirportQueries): NearestRefresher {
  let queries = initial;
  /** The last query that succeeded, and the last one sent (in flight or done): both gate the move threshold. */
  let succeeded: { position: Coordinate; region: Region } | null = null;
  let requested: { position: Coordinate; region: Region } | null = null;
  /** The region the published entries belong to; null for entries nobody queried (the store's seed). */
  let entriesRegion: Region | null = null;
  let token = 0;
  // Israel (IL-4): the curated aerodromes behind the current entries, for re-flagging when a NOTAM feed arrives.
  let israelAerodromes = new Map<string, IsraelAerodrome>();
  let notams: NotamClosureLookup | null = null;
  let notamFetchedAt: number | null = null;
  let notamInFlight = false;
  /** Bumped with the queries, so a NOTAM answer from the previous feed is dropped. */
  let notamGeneration = 0;

  const flagged = (entries: NearestAirportEntry[]): NearestAirportEntry[] =>
    entries.map((entry) => {
      const aerodrome = israelAerodromes.get(entry.airport.icao);
      if (!aerodrome) return entry;
      const closures = notams ? notams(aerodrome.code, queries.now()) : [];
      return { ...entry, israel: israelFlags(aerodrome, closures) };
    });

  /** Fetch the NOTAM feed (when there is one) at most every NOTAM_REFRESH_INTERVAL_MS and re-flag the list on arrival. */
  const refreshNotamsIfNeeded = () => {
    const fetchClosures = queries.fetchNotamClosures;
    if (!fetchClosures || notamInFlight) return;
    const now = queries.now();
    if (notamFetchedAt !== null && now - notamFetchedAt < NOTAM_REFRESH_INTERVAL_MS) return;
    notamFetchedAt = now;
    notamInFlight = true;
    const generation = notamGeneration;
    const settle = (lookup: NotamClosureLookup | null) => {
      if (generation !== notamGeneration) return;
      notamInFlight = false;
      if (!lookup) return;
      notams = lookup;
      store.setState({ entries: flagged(store.getState().entries) });
    };
    // A failed fetch leaves the list unflagged, not broken (Swift: `try? await notamFetcher()`), whether it rejects or throws
    // before returning a promise: either way the in-flight flag is released.
    let pending: Promise<NotamClosureLookup>;
    try {
      pending = fetchClosures();
    } catch {
      settle(null);
      return;
    }
    pending.then(settle, () => settle(null));
  };

  const queryIsrael = async (position: Coordinate) => {
    if (!queries.israel) throw new Error('Israel aerodrome data is not available');
    const aerodromes = (await queries.israel.nearestAerodromes(position, CANDIDATE_COUNT)).filter(
      (a) => !NOT_LANDABLE_USES.has(a.use),
    );
    const ranked = rankLandable(aerodromes.map(israelAirport), position, MINIMUM_RUNWAY_LENGTH_FEET, LIST_COUNT);
    return { ranked, aerodromes: new Map(aerodromes.map((a) => [a.code, a])) };
  };

  const dropOtherRegion = (region: Region) => {
    const staleEntries = entriesRegion !== null && entriesRegion !== region;
    const staleRequest = requested !== null && requested.region !== region;
    if (!staleEntries && !staleRequest) return;
    token += 1; // an answer still in flight for the old region must not repopulate the list
    requested = null;
    if (staleEntries) {
      entriesRegion = null;
      succeeded = null;
      store.setState({ entries: [], loading: false, error: null });
    } else store.setState({ loading: false });
  };

  return {
    setRegion: dropOtherRegion,
    async update(position, region) {
      dropOtherRegion(region);
      if (requested && requested.region === region && distanceNm(position, requested.position) < REQUERY_DISTANCE_NM) {
        // Too close to requery the airports, but the NOTAM feed has its own clock: it still refreshes (and re-flags the list).
        if (region === 'israel') refreshNotamsIfNeeded();
        return;
      }
      const mine = ++token;
      requested = { position, region };
      store.setState({ loading: true });
      try {
        if (region === 'israel') {
          const { ranked, aerodromes } = await queryIsrael(position);
          if (mine !== token) return;
          israelAerodromes = aerodromes;
          store.setState({ entries: flagged(ranked), loading: false, error: null });
        } else {
          const candidates = await queries.aviation.nearestAirports(position, CANDIDATE_COUNT);
          if (mine !== token) return;
          const entries = rankLandable(candidates, position, MINIMUM_RUNWAY_LENGTH_FEET, LIST_COUNT);
          store.setState({ entries, loading: false, error: null });
        }
        succeeded = { position, region };
        entriesRegion = region;
        if (region === 'israel') refreshNotamsIfNeeded();
      } catch (error) {
        if (mine !== token) return;
        // Keep stale data rather than clearing it; the next fix retries from the last good query.
        requested = succeeded;
        // Entries that did not come from this region (another region's list, or the store's seed) are not "the last good
        // list" for it: clear them and forget the success so the next fix requeries.
        if (entriesRegion !== region) {
          succeeded = null;
          requested = null;
          entriesRegion = null;
          store.setState({ entries: [], loading: false, error: message(error) });
        } else store.setState({ loading: false, error: message(error) });
      }
    },
    setQueries(next) {
      if (sameQueries(next, queries)) return;
      queries = next;
      token += 1;
      requested = null;
      succeeded = null;
      notams = null;
      notamFetchedAt = null;
      notamInFlight = false;
      notamGeneration += 1;
      store.setState({ loading: false });
    },
  };
}

const refreshers = new WeakMap<StoreApi<NearestData>, NearestRefresher>();

/**
 * One refresher per store, whatever the queries: every mounted caller shares the move threshold and the request token,
 * and a query swap goes through `setQueries`, so an answer from the old queries can never overwrite the new list.
 */
export function refresherFor(store: StoreApi<NearestData>, queries: AirportQueries): NearestRefresher {
  let refresher = refreshers.get(store);
  if (!refresher) {
    refresher = createNearestRefresher(store, queries);
    refreshers.set(store, refresher);
  }
  return refresher;
}

/**
 * The nearest landable airports, refreshed from the injected queries whenever ownship or the region changes (regions
 * without airport data are not queried, as in MapContainerView).
 */
export function useNearestAirports() {
  const store = nearest.useStoreApi();
  const queries = useContext(AirportQueriesContext);
  const ownship = nearest.useData((s) => s.ownship);
  const region = useRegion();
  useEffect(() => {
    const refresher = refresherFor(store, queries);
    refresher.setQueries(queries);
    refresher.setRegion(region);
    if (ownship && hasAirportData(region)) void refresher.update(ownship, region);
  }, [store, queries, ownship, region]);
  return {
    entries: nearest.useData((s) => s.entries),
    loading: nearest.useData((s) => s.loading),
    error: nearest.useData((s) => s.error),
    region,
  };
}
