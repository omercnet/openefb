// Feeds the airport column (AirportColumnView's load plus WeatherViewModel.loadWeather / refreshWeather): when an airport
// is selected, its record comes from the aviation database (the curated aerodromes in Israel) and its METAR and TAF from
// the weather service. Charts and the NOTAM list are I1b (the airport sheet); until then the column says so.
import type { StoreApi } from 'zustand';
import type { IsraelAerodrome } from '../../data/aviation/israelTypes';
import type { IsraelAviationDatabase } from '../../data/aviation/israelDatabase';
import type { AviationDatabase } from '../../data/aviation/aviationDatabase';
import { weatherStation, type Airport, type Region } from '../../domain/core';
import { describeError } from '../../domain/describeError';
import { isLayerAvailable } from '../../domain/core';
import type { TerminalProcedureServiceLike } from '../../services/terminal/terminalProcedureService';
import type { WeatherServiceLike } from '../../services/weatherService';
import { NotamError, type NotamServiceLike } from '../../services/notamService';
import type { AirportColumnData, AirportColumnState, NotamState } from '../columns/airport/store';
import type { AirportWeather, TerminalChart } from '../columns/airport/logic';
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
  /** The FAA d-TPP charts (US only); null: no chart service. */
  charts?: Pick<TerminalProcedureServiceLike, 'charts' | 'currentCycle'> | null;
  /** The FAA NOTAM list; null: none (the column then shows only the key hint). */
  notams?: Pick<NotamServiceLike, 'fetchNotams'> | null;
  /** NotamService.isConfigured: a free FAA key is stored. */
  notamConfigured?: () => Promise<boolean>;
  /** Open the chart viewer (ChartPDFView). */
  openChart?: (chart: TerminalChart) => void;
  /** Diagnostics; defaults to the console. */
  log?: (message: string) => void;
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
  /** Lookups that failed (not "no such airport"): the refresh buttons retry them. */
  const lookupFailed = new Set<string>();
  /** Per station, the newest weather load: an older one that finishes later must not overwrite it. */
  const weatherRequest = new Map<string, number>();
  const lookupRequest = new Map<string, number>();
  let stopped = false;
  const patchColumn = (icao: string, change: (data: AirportColumnData) => AirportColumnData) => {
    const state = column.getState();
    const current = state.columns[icao];
    if (stopped || !current) return;
    column.setState({ columns: { ...state.columns, [icao]: change(current) } });
  };

  /** WeatherViewModel.loadWeather for one station. */
  async function loadWeather(icao: string, fallback: AirportWeather['metar'] = null): Promise<void> {
    const request = (weatherRequest.get(icao) ?? 0) + 1;
    weatherRequest.set(icao, request);
    const isLatest = () => !stopped && weatherRequest.get(icao) === request;
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
        // Keep the report that was shown (or the cache); the error says the refresh failed.
        metar = fallback ?? weather.cachedWeather(icao);
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
    if (!isLatest()) return;
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

  /** Rejects when the database cannot answer; "no such airport" is a null airport. */
  async function lookup(
    icao: string,
  ): Promise<{ airport: Airport | null; elevationPublished: boolean; aerodrome?: IsraelAerodrome }> {
    if (deps.region() === 'israel') {
      const aerodrome = (await deps.israel?.aerodrome(icao)) ?? null;
      return aerodrome
        ? { airport: israelAirport(aerodrome), elevationPublished: aerodrome.elevationFeet != null, aerodrome }
        : { airport: null, elevationPublished: true };
    }
    return { airport: (await deps.aviation?.airport(icao)) ?? null, elevationPublished: true };
  }

  /** Finds the airport record; a failed lookup is remembered so the refresh buttons retry it. */
  async function resolveAirport(icao: string): Promise<void> {
    const request = (lookupRequest.get(icao) ?? 0) + 1;
    lookupRequest.set(icao, request);
    let found: { airport: Airport | null; elevationPublished: boolean; aerodrome?: IsraelAerodrome };
    let failed = false;
    try {
      found = await lookup(icao);
    } catch (error) {
      failed = true;
      (deps.log ?? console.warn)(`Airport lookup for ${icao} failed: ${describeError(error)}`);
      found = { airport: null, elevationPublished: true };
    }
    // Overlapping lookups (two refresh taps): only the newest may write, the retry marker included, so a late failure
    // neither blanks a newer result nor makes a good airport look retryable.
    if (lookupRequest.get(icao) !== request) return;
    if (failed) lookupFailed.add(icao);
    else lookupFailed.delete(icao);
    patchColumn(icao, (d) => ({ ...d, ...found }));
  }

  const notamRequest = new Map<string, number>();
  /** NotamSection.load: the report, or why there is none; only the newest request for an airport may write. */
  async function loadNotams(icao: string): Promise<void> {
    const service = deps.notams;
    if (!service || !isLayerAvailable(deps.region(), 'notams')) return;
    const request = (notamRequest.get(icao) ?? 0) + 1;
    notamRequest.set(icao, request);
    patchColumn(icao, (d) => ({ ...d, notams: { kind: 'loading' } }));
    let notams: NotamState;
    try {
      const airport = column.getState().columns[icao]?.airport;
      notams = { kind: 'loaded', report: await service.fetchNotams({ icao, faaID: airport?.faaID ?? null }) };
    } catch (error) {
      if (error instanceof NotamError && error.code === 'notConfigured') notams = { kind: 'notConfigured' };
      else if (error instanceof NotamError) notams = { kind: 'credentialsRejected', message: error.message };
      else {
        (deps.log ?? console.warn)(`NOTAMs for ${icao} failed: ${describeError(error)}`);
        notams = { kind: 'failed', message: describeError(error) };
      }
    }
    if (stopped || notamRequest.get(icao) !== request) return;
    patchColumn(icao, (d) => ({ ...d, notams }));
  }

  const chartRequest = new Map<string, number>();
  /** AirportChartsSection.loadCharts: the index and the cycle; only the newest request for an airport may write. */
  async function loadCharts(icao: string): Promise<void> {
    const service = deps.charts;
    if (!service || !isLayerAvailable(deps.region(), 'airportCharts')) return;
    const request = (chartRequest.get(icao) ?? 0) + 1;
    chartRequest.set(icao, request);
    patchColumn(icao, (d) => ({ ...d, charts: { state: 'loading' } }));
    let charts: AirportColumnData['charts'];
    try {
      const airport = column.getState().columns[icao]?.airport;
      const list = await service.charts({ icao, faaID: airport?.faaID ?? null });
      const cycle = await service.currentCycle();
      charts = {
        state: 'loaded',
        cycle: { code: cycle.code, effective: cycle.effectiveMs, expires: cycle.expirationMs },
        charts: list.map(({ chartCode, name, pdfName, cycle: code }) => ({ chartCode, name, pdfName, cycle: code })),
      };
    } catch (error) {
      (deps.log ?? console.warn)(`Charts for ${icao} failed: ${describeError(error)}`);
      charts = { state: 'failed', message: describeError(error) };
    }
    if (stopped || chartRequest.get(icao) !== request) return;
    patchColumn(icao, (d) => ({ ...d, charts }));
  }

  async function load(icao: string): Promise<void> {
    column.setState({
      columns: {
        ...column.getState().columns,
        [icao]: {
          airport: null,
          elevationPublished: true,
          weather: EMPTY_WEATHER,
          charts:
            deps.charts && isLayerAvailable(deps.region(), 'airportCharts')
              ? { state: 'loading' as const }
              : CHARTS_PENDING,
          notamKeyConfigured: false,
          ...(deps.notams && isLayerAvailable(deps.region(), 'notams') ? { notams: { kind: 'loading' as const } } : {}),
        },
      },
    });
    await resolveAirport(icao);
    void loadCharts(icao);
    void loadNotams(icao);
    void deps.notamConfigured?.().then(
      (notamKeyConfigured) => patchColumn(icao, (d) => ({ ...d, notamKeyConfigured })),
      () => undefined,
    );
    await loadWeather(icao);
  }

  column.setState({
    region: deps.region(),
    now: deps.clock(),
    directTo: deps.directTo,
    openChart: (chart) => deps.openChart?.(chart),
    retryCharts: (icao) => void loadCharts(icao),
    retryNotams: (icao) => void loadNotams(icao),
    refreshWeather: (icao) => {
      // The cache is cleared so the fetch goes to the network; the report on screen stays the fallback if it fails.
      const shown = column.getState().columns[icao]?.weather.metar ?? weather.cachedWeather(icao);
      weather.clearCache(icao);
      if (lookupFailed.has(icao)) void resolveAirport(icao);
      void loadWeather(icao, shown);
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
    stopped = true;
    unsubscribe();
    clearInterval(tick);
  };
}
