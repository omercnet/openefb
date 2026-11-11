// NearestAirportViewModel.updateNearest as a refresher over the `nearest` store, and the hook that runs it on each ownship
// or region change (MapContainerView's onChange(ownshipPosition / region)). JS-only: queries are async, so each refresh
// carries a request token and only the latest one may write; a failure keeps the previous list and sets `error`.
import { useContext, useEffect, useMemo } from 'react';
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
import { AirportQueriesContext, type AirportQueries, type NotamClosureLookup } from './sources';
import { useRegion } from '../../state/region';
import { nearest, type NearestData } from './store';

export interface NearestRefresher {
  /** Requery unless ownship moved less than REQUERY_DISTANCE_NM since the last query for the same region. */
  update(position: Coordinate, region: Region): Promise<void>;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createNearestRefresher(store: StoreApi<NearestData>, queries: AirportQueries): NearestRefresher {
  /** The last query that succeeded, and the last one sent (in flight or done): both gate the move threshold. */
  let succeeded: { position: Coordinate; region: Region } | null = null;
  let requested: { position: Coordinate; region: Region } | null = null;
  let token = 0;
  // Israel (IL-4): the curated aerodromes behind the current entries, for re-flagging when a NOTAM feed arrives.
  let israelAerodromes = new Map<string, IsraelAerodrome>();
  let notams: NotamClosureLookup | null = null;
  let notamFetchedAt: number | null = null;
  let notamInFlight = false;

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
    const settle = (lookup: NotamClosureLookup | null) => {
      notamInFlight = false;
      if (!lookup) return;
      notams = lookup;
      store.setState({ entries: flagged(store.getState().entries) });
    };
    // A failed fetch leaves the list unflagged, not broken (Swift: `try? await notamFetcher()`).
    fetchClosures().then(settle, () => settle(null));
  };

  const queryIsrael = async (position: Coordinate) => {
    if (!queries.israel) throw new Error('Israel aerodrome data is not available');
    const aerodromes = (await queries.israel.nearestAerodromes(position, CANDIDATE_COUNT)).filter(
      (a) => !NOT_LANDABLE_USES.has(a.use),
    );
    const ranked = rankLandable(aerodromes.map(israelAirport), position, MINIMUM_RUNWAY_LENGTH_FEET, LIST_COUNT);
    return { ranked, aerodromes: new Map(aerodromes.map((a) => [a.code, a])) };
  };

  return {
    async update(position, region) {
      if (requested && requested.region === region && distanceNm(position, requested.position) < REQUERY_DISTANCE_NM) {
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
        if (region === 'israel') refreshNotamsIfNeeded();
      } catch (error) {
        if (mine !== token) return;
        // Keep stale data rather than clearing it; the next fix retries from the last good query.
        requested = succeeded;
        store.setState({ loading: false, error: message(error) });
      }
    },
  };
}

const refreshers = new WeakMap<StoreApi<NearestData>, { queries: AirportQueries; refresher: NearestRefresher }>();

/** One refresher per store and query set, so every mounted caller shares the move threshold and the request token. */
function refresherFor(store: StoreApi<NearestData>, queries: AirportQueries): NearestRefresher {
  const known = refreshers.get(store);
  if (known && known.queries === queries) return known.refresher;
  const refresher = createNearestRefresher(store, queries);
  refreshers.set(store, { queries, refresher });
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
  const refresher = useMemo(() => refresherFor(store, queries), [store, queries]);
  useEffect(() => {
    if (ownship && hasAirportData(region)) void refresher.update(ownship, region);
  }, [refresher, ownship, region]);
  return {
    entries: nearest.useData((s) => s.entries),
    loading: nearest.useData((s) => s.loading),
    error: nearest.useData((s) => s.error),
    region,
  };
}
