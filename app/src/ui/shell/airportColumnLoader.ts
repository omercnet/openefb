// Feeds the airport column (AirportColumnView's load plus WeatherViewModel.loadWeather / refreshWeather): when an airport
// is selected, its record comes from the aviation database (the curated aerodromes in Israel) and its METAR and TAF from
// the weather service. Charts and the NOTAM list are I1b (the airport sheet); until then the column says so.
import type { StoreApi } from 'zustand';
import type { IsraelAviationDatabase } from '../../data/aviation/israelDatabase';
import type { AviationDatabase } from '../../data/aviation/aviationDatabase';
import { weatherStation, type Airport, type Region } from '../../domain/core';
import { describeError } from '../../domain/describeError';
import type { WeatherServiceLike } from '../../services/weatherService';
import type { AirportColumnData, AirportColumnState } from '../columns/airport/store';
import type { AirportWeather } from '../columns/airport/logic';
import { israelAirport } from '../columns/nearest/israelAerodromeAdapter';
import type { AppState } from '../state/appStore';

export interface AirportColumnLoaderDeps {
  app: StoreApi<AppState>;
  column: StoreApi<AirportColumnState>;
  aviation: Pick<AviationDatabase, 'airport'> | null;
  israel: Pick<IsraelAviationDatabase, 'aerodrome'> | null;
  weather: Pick<WeatherServiceLike, 'fetchMETAR' | 'fetchTAF' | 'cachedWeather'> & {
    clearCache(stationID: string): void;
  };
  region: () => Region;
  /** Epoch ms. */
  clock: () => number;
  directTo: (airport: Airport) => void;
}

/** The ages and the chart cycle are judged against this clock; a minute tick is enough. */
const NOW_TICK_MS = 60_000;

const CHARTS_PENDING = { state: 'failed', message: 'Airport charts are not available in this build yet.' } as const;

const EMPTY_WEATHER: AirportWeather = {
  metar: null,
  isLoading: true,
  errorMessage: null,
  metarPublished: true,
  tafPublished: true,
  taf: null,
  tafFetchedAt: null,
  tafFailed: false,
};

export function startAirportColumnLoader(deps: AirportColumnLoaderDeps): () => void {
  const { app, column, weather } = deps;
  const requested = new Set<string>();
  const patchColumn = (icao: string, change: (data: AirportColumnData) => AirportColumnData) => {
    const state = column.getState();
    const current = state.columns[icao];
    if (!current) return;
    column.setState({ columns: { ...state.columns, [icao]: change(current) } });
  };

  /** WeatherViewModel.loadWeather for one station. */
  async function loadWeather(icao: string): Promise<void> {
    const region = deps.region();
    const station = weatherStation(region, icao);
    const metarPublished = region === 'israel' ? (station?.hasMetar ?? false) : true;
    const tafPublished = region === 'israel' ? (station?.hasTaf ?? false) : true;
    patchColumn(icao, (d) => ({
      ...d,
      weather: { ...d.weather, isLoading: true, errorMessage: null, tafFailed: false, metarPublished, tafPublished },
    }));

    let metar = null as AirportWeather['metar'];
    let errorMessage: string | null = null;
    if (metarPublished) {
      try {
        metar = await weather.fetchMETAR(icao);
      } catch (error) {
        errorMessage = describeError(error);
        metar = weather.cachedWeather(icao); // keep cached weather; the error says the refresh failed
      }
    }
    let taf: string | null | undefined;
    let tafFetchedAt: number | null | undefined;
    let tafFailed = false;
    if (tafPublished) {
      try {
        taf = await weather.fetchTAF(icao);
        tafFetchedAt = deps.clock();
      } catch {
        tafFailed = true; // METAR is primary: no banner, the previous TAF stays with its true age
      }
    } else {
      taf = null;
      tafFetchedAt = null;
    }
    patchColumn(icao, (d) => ({
      ...d,
      weather: {
        ...d.weather,
        metar,
        isLoading: false,
        errorMessage,
        taf: taf === undefined ? d.weather.taf : taf,
        tafFetchedAt: tafFetchedAt === undefined ? d.weather.tafFetchedAt : tafFetchedAt,
        tafFailed,
      },
    }));
  }

  async function lookup(icao: string): Promise<{ airport: Airport | null; elevationPublished: boolean }> {
    try {
      if (deps.region() === 'israel') {
        const aerodrome = (await deps.israel?.aerodrome(icao)) ?? null;
        return aerodrome
          ? { airport: israelAirport(aerodrome), elevationPublished: aerodrome.elevationFeet != null }
          : { airport: null, elevationPublished: true };
      }
      return { airport: (await deps.aviation?.airport(icao)) ?? null, elevationPublished: true };
    } catch {
      return { airport: null, elevationPublished: true };
    }
  }

  async function load(icao: string): Promise<void> {
    column.setState({
      columns: {
        ...column.getState().columns,
        [icao]: {
          airport: null,
          elevationPublished: true,
          weather: EMPTY_WEATHER,
          charts: CHARTS_PENDING,
          notamKeyConfigured: false,
        },
      },
    });
    const found = await lookup(icao);
    patchColumn(icao, (d) => ({ ...d, ...found }));
    await loadWeather(icao);
  }

  column.setState({
    region: deps.region(),
    now: deps.clock(),
    directTo: deps.directTo,
    refreshWeather: (icao) => {
      weather.clearCache(icao);
      void loadWeather(icao);
    },
  });

  const select = (icao: string | null) => {
    if (icao === null || requested.has(icao)) return;
    requested.add(icao);
    void load(icao);
  };
  select(app.getState().selectedAirportId);
  const unsubscribe = app.subscribe((state, previous) => {
    if (state.selectedAirportId !== previous.selectedAirportId) select(state.selectedAirportId);
  });
  const tick = setInterval(() => column.setState({ now: deps.clock() }), NOW_TICK_MS);
  return () => {
    unsubscribe();
    clearInterval(tick);
  };
}
