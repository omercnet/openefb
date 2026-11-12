// FAKE KSQL column: exactly what app/reference/ipad-airport-KSQL.png shows (San Carlos, MVFR, a 12 min old METAR, TAF not
// loaded, no NOTAM key, d-TPP cycle 2611). Used by the default airport store until I1 wires the services.
import { makeAirport, makeWeatherCache, type Frequency, type FrequencyType } from '../../../domain/core';
import type { TerminalChart } from './logic';
import type { AirportColumnData } from './store';

/** The reference's clock: 8 Nov 2026, 12 minutes after the METAR. */
export const KSQL_NOW = Date.UTC(2026, 10, 8, 23, 59);
const OBSERVED = KSQL_NOW - 12 * 60_000;

const frequency = (type: FrequencyType, mhz: number, name: string, index: number): Frequency => ({
  id: `KSQL-${type}-${index}`,
  type,
  frequency: mhz,
  name,
});

const FREQUENCIES: Frequency[] = (
  [
    ['atis', 125.9, 'ATIS'],
    ['ctaf', 119.0, 'CTAF'],
    ['unicom', 122.95, 'UNICOM'],
    ['approach', 133.95, 'NORCAL APP'],
    ['approach', 135.65, 'NORCAL APP'],
    ['tower', 119.0, 'SAN CARLOS TWR'],
    ['ground', 118.025, 'SAN CARLOS GND'],
    ['departure', 135.65, 'NORCAL DEP'],
  ] as const
).map(([type, mhz, name], i) => frequency(type, mhz, name, i));

const chart = (chartCode: string, name: string, pdfName: string): TerminalChart => ({
  chartCode,
  name,
  pdfName,
  cycle: '2611',
});

export const KSQL_COLUMN: AirportColumnData = {
  airport: makeAirport({
    icao: 'KSQL',
    faaID: 'SQL',
    name: 'San Carlos Airport',
    latitude: 37.5119,
    longitude: -122.2495,
    elevation: 5,
    type: 'airport',
    ownership: 'public',
    ctafFrequency: 119.0,
    unicomFrequency: 122.95,
    patternAltitude: 800,
    fuelTypes: ['100LL', 'A', 'A+', 'UL94'],
    runways: [
      {
        id: '12/30',
        length: 2621,
        width: 75,
        surface: 'asphalt',
        lighting: 'partTime',
        baseEndID: '12',
        reciprocalEndID: '30',
        baseEndLatitude: 37.5153,
        baseEndLongitude: -122.2532,
        reciprocalEndLatitude: 37.5094,
        reciprocalEndLongitude: -122.2447,
      },
    ],
    frequencies: FREQUENCIES,
  }),
  elevationPublished: true,
  weather: {
    metar: makeWeatherCache({
      id: 'KSQL-metar',
      stationID: 'KSQL',
      rawMETAR: 'KSQL 082347Z 00000KT 9SM BKN012 15/13 A3018',
      temperature: 15,
      dewpoint: 13,
      windDirection: 0,
      windSpeed: 0,
      visibility: '9.0',
      ceiling: 1200,
      altimeterHPa: 30.18 * 33.8639,
      flightCategory: 'mvfr',
      observationTime: OBSERVED,
      fetchedAt: OBSERVED,
    }),
    isLoading: false,
    errorMessage: null,
    metarPublished: true,
    tafPublished: true,
    taf: null,
    tafFetchedAt: null,
    tafFailed: true,
  },
  charts: {
    state: 'loaded',
    cycle: { code: '2611', effective: Date.UTC(2026, 9, 29, 9, 1), expires: Date.UTC(2026, 10, 26, 9, 1) },
    // The reference shows the diagram, two approaches and, cut off by the footer, an "Arrivals" group; the
    // arrival's name is not visible there and is a placeholder.
    charts: [
      chart('APD', 'AIRPORT DIAGRAM', '09219AD.PDF'),
      chart('IAP', 'RNAV (GPS) Y RWY 30', '09219RY30.PDF'),
      chart('IAP', 'RNAV (GPS) Z RWY 30', '09219RZ30.PDF'),
      chart('STAR', 'ARRIVAL (FIXTURE)', '00000ARR.PDF'),
    ],
  },
  notamKeyConfigured: false,
};
