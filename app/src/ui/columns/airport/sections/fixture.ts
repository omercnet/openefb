// Test fixtures for the PIREP and winds aloft sections, built from the Swift test inputs: the PIREP field values of
// efb-212Tests/ServiceTests/PirepServiceTests.swift (the CL30 urgent report, E75S, F2TH, the UAL2164 AIREP) placed
// around its KDEN coordinate at its `now`, and an excerpt of WindsAloftServiceTests.conus06 (rows kept byte for byte,
// the FD columns are positional) parsed at its `reference` time.
import { destinationPoint, type Coordinate } from '../../../../domain/core';
import type { Pirep } from '../../../../services/pirep';
import { parseBulletin, type WindsAloftForecast, type WindsAloftReport } from '../../../../services/windsAloft';
import { WINDS_ALOFT_STATIONS } from '../../../../services/windsAloftStations';
import type { SectionAirport } from './pirepLogic';

// MARK: - PIREPs

/** PirepServiceTests.now: 2026-10-30T19:53:20Z. */
export const PIREP_NOW = 1_793_390_000_000;

/** PirepServiceTests.kden. */
export const KDEN: SectionAirport = { icao: 'KDEN', latitude: 39.8617, longitude: -104.6731 };

const at = (bearing: number, distanceNM: number): Coordinate =>
  destinationPoint({ lat: KDEN.latitude, lon: KDEN.longitude }, distanceNM, bearing);

function pirep(over: Partial<Pirep> & Pick<Pirep, 'observationTime' | 'rawText'>, position: Coordinate): Pirep {
  return {
    reportType: 'PIREP',
    aircraftType: null,
    latitude: position.lat,
    longitude: position.lon,
    altitude: null,
    altitudeQualifier: null,
    clouds: [],
    weather: null,
    temperature: null,
    windDirection: null,
    windSpeed: null,
    turbulence: [],
    icing: [],
    ...over,
  };
}

/** CL30 "Urgent PIREP": FL005 during descent, 61 min old (OLD), 20 NM north-east. */
export const URGENT_CL30 = pirep(
  {
    observationTime: 1_793_386_320_000,
    reportType: 'Urgent PIREP',
    aircraftType: 'CL30',
    altitude: 500,
    altitudeQualifier: 'DURD',
    rawText: 'ROC UUA /OV ROC100005/TM 1852/FL005/TP CL30/TB +/- 15 KTS/RM DURD RY28',
  },
  at(45, 20),
);

/** E75S at FL320, two turbulence groups ("MOD CHOP, NEG"), 50 min old, 30 NM west. */
export const E75S = pirep(
  {
    observationTime: 1_793_386_980_000,
    aircraftType: 'E75S',
    altitude: 32000,
    turbulence: [
      { intensity: 'MOD', type: 'CHOP', frequency: null, base: null, top: null },
      { intensity: 'NEG', type: null, frequency: null, base: null, top: null },
    ],
    rawText: 'FNT UA /OV FNT270030/TM 1903/FL320/TP E75S/TB MOD CHOP 340-330 NEG 320 DURD/RM ZOB',
  },
  at(270, 30),
);

/** F2TH at FL230, M23, light mixed icing 230-250, 55 min old, over the field. */
export const F2TH = pirep(
  {
    observationTime: 1_793_386_680_000,
    aircraftType: 'F2TH',
    altitude: 23000,
    temperature: -23,
    icing: [{ intensity: 'LGT', type: 'MIXED', frequency: null, base: 23000, top: 25000 }],
    rawText: 'GLH UA /OV GLH270040/TM 1858/FL230/TP F2TH/TA M23/IC LGT MX 230-250/RM ZME 45',
  },
  at(0, 0.4),
);

/** UAL2164 AIREP at F300, wind 205/33, 83 min old (OLD), 40 NM south. */
export const AIREP_UAL = pirep(
  {
    observationTime: 1_793_385_000_000,
    reportType: 'AIREP',
    aircraftType: 'UAL2164',
    altitude: 30000,
    windDirection: 205,
    windSpeed: 33,
    rawText: 'ARP UAL2164 3702N 10058W 1830 F300 205/033KT',
  },
  at(180, 40),
);

/** In PirepService order (newest first). */
export const PIREPS: readonly Pirep[] = [E75S, F2TH, URGENT_CL30, AIREP_UAL];

// MARK: - Winds aloft

/** WindsAloftServiceTests.reference: 2026-10-30T16:00:00Z, inside the 1400-2100Z FOR USE window. */
export const WINDS_NOW = Date.parse('2026-10-30T16:00:00Z');
/** One minute past the FOR USE window. */
export const WINDS_AFTER_FOR_USE = Date.parse('2026-10-30T21:01:00Z');

/** Excerpt of WindsAloftServiceTests.conus06 (header and the ABQ, ALS, BIH, SFO rows). */
export const CONUS06_EXCERPT = [
  '000',
  'FBUS31 KWNO 301400',
  'FD1US1',
  'DATA BASED ON 301200Z',
  'VALID 301800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000',
  '',
  'FT  3000    6000    9000   12000   18000   24000  30000  34000  39000',
  'ABQ              1410+07 1212+01 1908-12 2218-24 232739 233550 235161',
  'ALS                      9900+02 1608-14 2421-25 233340 224151 224362',
  'BIH      9900    1811+02 2017-03 2027-17 2127-29 261643 262052 253461',
  'SFO 2106 1910+05 2411+00 2316-07 2227-19 2334-28 234444 234554 234862',
].join('\n');

/** A report for `stationId` from the excerpt, as WindsAloftService.fetchWindsAloft returns it. */
export function windsReport(stationId: string, distanceNM: number, forecast: WindsAloftForecast = 6): WindsAloftReport {
  const bulletin = parseBulletin(CONUS06_EXCERPT, WINDS_NOW);
  const station = WINDS_ALOFT_STATIONS.find((s) => s.id === stationId);
  if (!station) throw new Error(`no winds aloft station ${stationId}`);
  return {
    station,
    distanceNM,
    forecast,
    issued: bulletin.issued,
    basedOn: bulletin.basedOn,
    validTime: bulletin.validTime,
    forUseStart: bulletin.forUseStart,
    forUseEnd: bulletin.forUseEnd,
    levels: bulletin.rows.get(stationId) ?? [],
  };
}

/** WindsAloftServiceTests.forUsePeriodCheck's report: SFO at 15 NM, every level forecast. */
export const SFO_REPORT = windsReport('SFO', 15);
/** ALS (7,535 ft): three blank levels, then light and variable at 12,000 ft. */
export const ALS_REPORT = windsReport('ALS', 22.6);
/** A report without any FD times (the period line falls back to "6 h forecast", the badge to N/A). */
export const UNTIMED_REPORT: WindsAloftReport = {
  ...SFO_REPORT,
  issued: null,
  basedOn: null,
  validTime: null,
  forUseStart: null,
  forUseEnd: null,
};
