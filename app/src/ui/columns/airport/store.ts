// The airport column's data (AirportColumnView.swift's @State plus WeatherViewModel and the chart / NOTAM services'
// results) as a plain-data slice, and the hook the column reads it through, keyed by AppState.selectedAirportId.
// The default store holds the FAKE KSQL column (fixture.ts) until I1 feeds the database, weather, chart and NOTAM
// services in (`airport.store.setState`) and wires the action callbacks.
import { useMemo } from 'react';
import { weatherStation, type Airport, type Region, type WeatherStation } from '../../../domain/core';
import { useAppStore } from '../../state/appStore';
import { createStoreContext } from '../../state/storeContext';
import { KSQL_COLUMN, KSQL_NOW } from './fixture';
import type { AirportWeather, ChartCycle, TerminalChart } from './logic';

/** AirportChartsSection's load state. */
export type AirportCharts =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'loaded'; cycle: ChartCycle; charts: TerminalChart[] };

/** Everything the column shows for one selected airport. */
export interface AirportColumnData {
  /** Null where the region has no airport data (the column then shows only the station's weather). */
  airport: Airport | null;
  /** False for an Israeli aerodrome without a published elevation (chip reads "ELEV not published"). */
  elevationPublished: boolean;
  weather: AirportWeather;
  charts: AirportCharts;
  /** NotamService.isConfigured: false shows the "free FAA API key" hint instead of the NOTAM list. */
  notamKeyConfigured: boolean;
}

export interface AirportColumnState {
  region: Region;
  /** Epoch ms the ages and the chart cycle are judged at; I1 ticks it (the Swift badge re-evaluates on redraw). */
  now: number;
  /** Loaded columns by ICAO; a selected airport without an entry is still loading. */
  columns: Record<string, AirportColumnData>;
  /** The airport whose raw METAR is expanded; a new selection collapses it (Swift resets the flag on load). */
  rawMetarExpandedFor: string | null;
  /** onDirectTo: start a direct-to route to the airport. */
  directTo: (airport: Airport) => void;
  /** WeatherViewModel.refreshWeather for the airport (the refresh button and both Retry buttons). */
  refreshWeather: (icao: string) => void;
  /** Open a chart PDF (ChartPDFView full screen). */
  openChart: (chart: TerminalChart) => void;
  /** Reload the chart list after a failure. */
  retryCharts: (icao: string) => void;
}

const noop = () => {};

export const airport = createStoreContext<AirportColumnState>({
  region: 'us',
  now: KSQL_NOW,
  columns: { KSQL: KSQL_COLUMN },
  rawMetarExpandedFor: null,
  directTo: noop,
  refreshWeather: noop,
  openChart: noop,
  retryCharts: noop,
});

/** What the column renders, plus its actions bound to the selected airport. */
export interface AirportColumnModel {
  /** The selected airport's identifier ("" when nothing is selected). */
  icao: string;
  data: AirportColumnData | null;
  /** The region's weather station for the selection (Israel), used when there is no airport record. */
  station: WeatherStation | null;
  region: Region;
  now: number;
  rawMetarExpanded: boolean;
  /** Direct-to, then back to the flight log (the Swift button does both). */
  directTo: () => void;
  refreshWeather: () => void;
  toggleRawMetar: () => void;
  openChart: (chart: TerminalChart) => void;
  retryCharts: () => void;
}

export function useAirportColumn(): AirportColumnModel {
  const icao = useAppStore((s) => s.selectedAirportId) ?? '';
  const setStripColumn = useAppStore((s) => s.setStripColumn);
  const api = airport.useStoreApi();
  const data = airport.useData((s) => s.columns[icao]) ?? null;
  const region = airport.useData((s) => s.region);
  const now = airport.useData((s) => s.now);
  const rawMetarExpanded = airport.useData((s) => icao !== '' && s.rawMetarExpandedFor === icao);
  return useMemo(() => {
    return {
      icao,
      data,
      station: weatherStation(region, icao) ?? null,
      region,
      now,
      rawMetarExpanded,
      directTo: () => {
        if (!data?.airport) return;
        api.getState().directTo(data.airport);
        setStripColumn('log');
      },
      refreshWeather: () => api.getState().refreshWeather(icao),
      toggleRawMetar: () =>
        api.setState((s) => ({ rawMetarExpandedFor: s.rawMetarExpandedFor === icao ? null : icao })),
      openChart: (chart: TerminalChart) => api.getState().openChart(chart),
      retryCharts: () => api.getState().retryCharts(icao),
    };
  }, [api, icao, data, region, now, rawMetarExpanded, setStripColumn]);
}
