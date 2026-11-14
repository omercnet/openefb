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

  it('an older weather load that finishes last does not overwrite the newer one', async () => {
    const first = Promise.withResolvers<string>();
    const newer = { stationID: 'KSQL', fetchedAt: 2 } as never;
    const older = { stationID: 'KSQL', fetchedAt: 1 } as never;
    let calls = 0;
    const { app, column, settle, stop } = setup({
      weather: {
        fetchMETAR: async () => (++calls === 1 ? older : newer),
        fetchTAF: () => (calls === 1 ? first.promise : Promise.resolve('TAF new')),
        cachedWeather: () => null,
        clearCache: () => undefined,
      },
    });
    app.getState().showAirport('KSQL');
    await settle();
    column.getState().refreshWeather('KSQL');
    await settle();
    expect(column.getState().columns.KSQL!.weather).toMatchObject({ metar: newer, taf: 'TAF new', isLoading: false });
    first.resolve('TAF old');
    await settle();
    expect(column.getState().columns.KSQL!.weather).toMatchObject({ metar: newer, taf: 'TAF new', isLoading: false });
    stop();
  });

  it('a failed refresh keeps the report on screen even though the cache was cleared', async () => {
    let failing = false;
    const cache = new Map<string, unknown>();
    const { app, column, settle, stop } = setup({
      weather: {
        fetchMETAR: async (icao: string) => {
          if (failing) throw new Error('offline');
          cache.set(icao, METAR);
          return METAR;
        },
        fetchTAF: async () => 'TAF',
        cachedWeather: (icao: string) => (cache.get(icao) ?? null) as never,
        clearCache: (icao: string) => void cache.delete(icao),
      },
    });
    app.getState().showAirport('KSQL');
    await settle();
    failing = true;
    column.getState().refreshWeather('KSQL');
    await settle();
    const shown = column.getState().columns.KSQL!.weather;
    expect(shown.metar).toBe(METAR);
    expect(shown.errorMessage).not.toBeNull();
    stop();
  });

  it('a failed airport lookup is not "no such airport": the refresh button looks it up again', async () => {
    let failing = true;
    const { app, column, settle, stop } = setup({
      aviation: {
        airport: async () => {
          if (failing) throw new Error('db closed');
          return KSQL;
        },
      },
    });
    app.getState().showAirport('KSQL');
    await settle();
    expect(column.getState().columns.KSQL!.airport).toBeNull();
    failing = false;
    column.getState().refreshWeather('KSQL');
    await settle();
    expect(column.getState().columns.KSQL!.airport).toBe(KSQL);
    stop();
  });

  it('once stopped, a pending load writes nothing', async () => {
    const gate = Promise.withResolvers<Airport | null>();
    const { app, column, settle, stop } = setup({ aviation: { airport: () => gate.promise as never } });
    app.getState().showAirport('KSQL');
    await settle();
    stop();
    gate.resolve(KSQL);
    await settle();
    expect(column.getState().columns.KSQL!.airport).toBeNull();
  });
});
