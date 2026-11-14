import type { Airport as DataAirport } from '../../data/aviation/types';
import type { Airport } from '../../domain/core';
import { AppFailure } from '../../domain/errors';
import { createAppStore } from '../state/appStore';
import { airport as airportSlice } from '../columns/airport/store';
import { startAirportColumnLoader, type AirportColumnLoaderDeps } from './airportColumnLoader';

const KSQL = { icao: 'KSQL', name: 'San Carlos', elevation: 5 } as unknown as DataAirport & Airport;
const METAR = { stationID: 'KSQL', fetchedAt: 1 } as never;

function setup(over: Partial<AirportColumnLoaderDeps> = {}) {
  const app = createAppStore();
  const column = airportSlice.make();
  const weather = {
    fetchMETAR: jest.fn(async () => METAR),
    fetchTAF: jest.fn(async () => 'TAF KSQL'),
    cachedWeather: jest.fn(() => null),
    clearCache: jest.fn(),
  };
  const deps: AirportColumnLoaderDeps = {
    app,
    column,
    aviation: { airport: async (icao) => (icao === 'KSQL' ? KSQL : null) },
    israel: null,
    weather,
    region: () => 'us',
    clock: () => 5000,
    directTo: jest.fn(),
    ...over,
  };
  const stop = startAirportColumnLoader(deps);
  const settle = () => new Promise((r) => setImmediate(r));
  return { app, column, weather, deps, stop, settle };
}

describe('airport column loader', () => {
  it('loads the selected airport and its METAR and TAF', async () => {
    const { app, column, weather, settle, stop } = setup();
    app.getState().showAirport('KSQL');
    await settle();
    const data = column.getState().columns.KSQL!;
    expect(data.airport).toBe(KSQL);
    expect(data.weather).toMatchObject({
      metar: METAR,
      isLoading: false,
      errorMessage: null,
      taf: 'TAF KSQL',
      tafFailed: false,
    });
    expect(weather.fetchMETAR).toHaveBeenCalledWith('KSQL');
    stop();
  });

  it('shows a loading column first', async () => {
    const { app, column, stop } = setup();
    app.getState().showAirport('KSQL');
    expect(column.getState().columns.KSQL!.weather.isLoading).toBe(true);
    stop();
  });

  it('a METAR failure keeps the cached report and says the refresh failed', async () => {
    const cached = { stationID: 'KSQL', fetchedAt: 0 } as never;
    const { app, column, settle, stop } = setup({
      weather: {
        fetchMETAR: async () => {
          throw new AppFailure({ kind: 'weatherFetchFailed', cause: new Error('x') });
        },
        fetchTAF: async () => 'TAF',
        cachedWeather: () => cached,
        clearCache: () => undefined,
      },
    });
    app.getState().showAirport('KSQL');
    await settle();
    const weather = column.getState().columns.KSQL!.weather;
    expect(weather.metar).toBe(cached);
    expect(weather.errorMessage).not.toBeNull();
    stop();
  });

  it('a TAF failure is not an error banner: tafFailed only', async () => {
    const { app, column, settle, stop } = setup({
      weather: {
        fetchMETAR: async () => METAR,
        fetchTAF: async () => {
          throw new Error('no');
        },
        cachedWeather: () => null,
        clearCache: () => undefined,
      },
    });
    app.getState().showAirport('KSQL');
    await settle();
    expect(column.getState().columns.KSQL!.weather).toMatchObject({ errorMessage: null, tafFailed: true, taf: null });
    stop();
  });

  it('Israel publishes weather for its station list only: no request for another aerodrome', async () => {
    const { app, column, weather, settle, stop } = setup({
      region: () => 'israel',
      israel: { aerodrome: async () => null },
    });
    app.getState().showAirport('LLXX');
    await settle();
    expect(weather.fetchMETAR).not.toHaveBeenCalled();
    expect(column.getState().columns.LLXX!.weather).toMatchObject({
      metarPublished: false,
      tafPublished: false,
      metar: null,
    });
    stop();
  });

  it('LLHZ publishes a TAF only', async () => {
    const { app, column, weather, settle, stop } = setup({
      region: () => 'israel',
      israel: { aerodrome: async () => null },
    });
    app.getState().showAirport('LLHZ');
    await settle();
    expect(weather.fetchMETAR).not.toHaveBeenCalled();
    expect(weather.fetchTAF).toHaveBeenCalledWith('LLHZ');
    expect(column.getState().columns.LLHZ!.weather).toMatchObject({ metarPublished: false, tafPublished: true });
    stop();
  });

  it('the refresh button clears the cache and reloads', async () => {
    const { app, column, weather, settle, stop } = setup();
    app.getState().showAirport('KSQL');
    await settle();
    column.getState().refreshWeather('KSQL');
    await settle();
    expect(weather.clearCache).toHaveBeenCalledWith('KSQL');
    expect(weather.fetchMETAR).toHaveBeenCalledTimes(2);
    stop();
  });

  it('Direct on the column starts Direct-To', () => {
    const { column, deps, stop } = setup();
    column.getState().directTo(KSQL);
    expect(deps.directTo).toHaveBeenCalledWith(KSQL);
    stop();
  });

  it('selecting the same airport again does not reload it; a lookup that finds nothing leaves the airport null', async () => {
    const { app, column, weather, settle, stop } = setup();
    app.getState().showAirport('KSQL');
    await settle();
    app.getState().showAirport('KSQL');
    await settle();
    expect(weather.fetchMETAR).toHaveBeenCalledTimes(1);
    app.getState().showAirport('KXXX');
    await settle();
    expect(column.getState().columns.KXXX!.airport).toBeNull();
    stop();
  });
});
