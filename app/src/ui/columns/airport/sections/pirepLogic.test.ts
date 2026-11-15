// PirepSection.swift has no view tests; these pin its decisions from the Swift source, on the inputs of the Swift tests
// that reach them: PirepServiceTests (the captured AWC fixture, makePirep around KDEN, its `now`), DataFreshnessTests and
// DataFreshnessEdgeCharacterizationTests (the PIREP thresholds the row badge shows).
import { EARTH_RADIUS_NM, productExpiredAfter } from '../../../../domain/core';
import { parsePireps, pirepId, type Pirep } from '../../../../services/pirep';
import { swiftRawFixture } from '../../../../services/swiftFixtures';
import { AIREP_UAL, E75S, F2TH, KDEN, PIREP_NOW, URGENT_CL30 } from './fixture';
import {
  PIREP_EMPTY_TEXT,
  PIREP_MAX_AGE_SECONDS,
  PIREP_RADIUS_NM,
  compassPoint,
  pirepBody,
  pirepErrorText,
  pirepFreshness,
  pirepLocationText,
  pirepRow,
  pirepSummaryLines,
  rawReportValue,
  sortNewestFirst,
} from './pirepLogic';

const parsed = parsePireps(swiftRawFixture('ServiceTests/PirepServiceTests.swift', 'fixture'));
const byAircraft = (type: string) => parsed.find((p) => p.aircraftType === type) as Pirep;
const degreesPerNM = 180 / (Math.PI * EARTH_RADIUS_NM); // degrees latitude per NM

/** PirepServiceTests.makePirep: a C172 report `northNM` north of KDEN, `ageSeconds` before `now`. */
function makePirep(northNM: number, ageSeconds: number, raw = 'TEST UA'): Pirep {
  return {
    observationTime: PIREP_NOW - ageSeconds * 1000,
    reportType: 'PIREP',
    aircraftType: 'C172',
    latitude: KDEN.latitude + northNM * degreesPerNM,
    longitude: KDEN.longitude,
    altitude: 6500,
    altitudeQualifier: null,
    clouds: [],
    weather: null,
    temperature: null,
    windDirection: null,
    windSpeed: null,
    turbulence: [],
    icing: [],
    rawText: raw,
  };
}

describe('query window', () => {
  it('is 50 NM and 2 hours, the PIREP EXPIRED threshold of DataFreshness', () => {
    expect(PIREP_RADIUS_NM).toBe(50);
    expect(PIREP_MAX_AGE_SECONDS).toBe(7200);
    expect(PIREP_MAX_AGE_SECONDS).toBe(productExpiredAfter('pirep'));
  });
});

describe('pirepBody', () => {
  const list = [makePirep(10, 600, 'A'), makePirep(20, 60, 'B')];

  it('spins before the first result', () => {
    expect(pirepBody({ loading: true, error: null, pireps: null })).toEqual({ kind: 'loading' });
    expect(pirepBody({ loading: false, error: null, pireps: null })).toEqual({ kind: 'loading' });
  });

  it('keeps a loaded list on screen while a refresh runs (Swift keeps .loaded)', () => {
    const body = pirepBody({ loading: true, error: null, pireps: list });
    expect(body.kind).toBe('list');
  });

  it('shows the failure instead of the list, with the localized description', () => {
    expect(
      pirepBody({ loading: false, error: 'The Internet connection appears to be offline.', pireps: list }),
    ).toEqual({
      kind: 'error',
      text: 'PIREPs not loaded: The Internet connection appears to be offline.',
    });
    expect(pirepErrorText('x')).toBe('PIREPs not loaded: x');
  });

  it('says so when nothing is within 50 NM in the last 2 hours', () => {
    expect(pirepBody({ loading: false, error: null, pireps: [] })).toEqual({ kind: 'empty', text: PIREP_EMPTY_TEXT });
    expect(PIREP_EMPTY_TEXT).toBe('No PIREPs within 50 NM in the last 2 hours.');
  });

  it('lists newest first (PirepServiceTests.resultsAreNewestFirst)', () => {
    const body = pirepBody({ loading: false, error: null, pireps: list });
    expect(body.kind === 'list' && body.pireps.map((p) => p.rawText)).toEqual(['B', 'A']);
  });
});

describe('sortNewestFirst', () => {
  it('orders the Swift fixture by observation time, keeping ties in service order', () => {
    const sorted = sortNewestFirst(parsed);
    expect(sorted.map((p) => p.aircraftType)).toEqual([
      'B752', // 1793387040
      'E75S', // 1793386980
      'P28A', // 1793386680, three reports at the same minute keep their order
      'F2TH',
      'CRJ7',
      'CL30', // 1793386320
      'BE65', // 1793385480
      'UAL2164', // 1793385000
    ]);
  });

  it('does not mutate its input', () => {
    const input = [makePirep(1, 600), makePirep(1, 60)];
    sortNewestFirst(input);
    expect(input[0]!.observationTime).toBeLessThan(input[1]!.observationTime);
  });
});

describe('pirepLocationText', () => {
  it('gives the rounded distance and compass point from the airport, then the report type', () => {
    expect(pirepLocationText(KDEN, makePirep(10, 0))).toBe('10 NM N of KDEN \u00b7 PIREP');
    expect(pirepLocationText(KDEN, makePirep(-30.4, 0))).toBe('30 NM S of KDEN \u00b7 PIREP');
    expect(pirepLocationText(KDEN, makePirep(49.5, 0))).toBe('50 NM N of KDEN \u00b7 PIREP');
    expect(pirepLocationText(KDEN, URGENT_CL30)).toBe('20 NM NE of KDEN \u00b7 Urgent PIREP');
    expect(pirepLocationText(KDEN, E75S)).toBe('30 NM W of KDEN \u00b7 PIREP');
    expect(pirepLocationText(KDEN, AIREP_UAL)).toBe('40 NM S of KDEN \u00b7 AIREP');
  });

  it('reads "Over" under 1 NM', () => {
    expect(pirepLocationText(KDEN, makePirep(0.99, 0))).toBe('Over KDEN \u00b7 PIREP');
    expect(pirepLocationText(KDEN, F2TH)).toBe('Over KDEN \u00b7 PIREP');
    expect(pirepLocationText(KDEN, makePirep(1.01, 0))).toBe('1 NM N of KDEN \u00b7 PIREP');
  });

  it('measures the captured reports from KDEN (all far outside the 50 NM window)', () => {
    // Rochester (CL30) is east-north-east of Denver, Lafayette (CRJ7) south-east.
    expect(pirepLocationText(KDEN, byAircraft('CL30'))).toMatch(/^\d{4} NM E of KDEN \u00b7 Urgent PIREP$/);
    expect(pirepLocationText(KDEN, byAircraft('CRJ7'))).toMatch(/^\d{3} NM SE of KDEN \u00b7 PIREP$/);
  });
});

describe('compassPoint', () => {
  it('splits the circle into eight 45 degree sectors centred on the points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(22.49)).toBe('N');
    expect(compassPoint(22.5)).toBe('NE');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(247.5)).toBe('W');
    expect(compassPoint(315)).toBe('NW');
    expect(compassPoint(337.5)).toBe('N');
    expect(compassPoint(359.99)).toBe('N');
  });
});

describe('pirepSummaryLines (PirepServiceTests cases)', () => {
  it('summarizes several turbulence groups on one line', () => {
    expect(pirepSummaryLines(byAircraft('E75S'))).toEqual(['Turbulence: MOD CHOP, NEG']);
  });

  it('gives negative icing without turbulence', () => {
    const be65 = byAircraft('BE65');
    expect(pirepSummaryLines(be65)[0]).toBe('Icing: NEG');
    expect(pirepSummaryLines(be65).some((l) => l.startsWith('Turbulence'))).toBe(false);
  });

  it('gives icing layers in feet and the temperature', () => {
    expect(pirepSummaryLines(byAircraft('F2TH'))).toEqual([
      'Icing: LGT MIXED 23,000\u201325,000 ft',
      'Temp -23\u00b0C',
    ]);
  });

  it('gives the cloud layers, with tops', () => {
    expect(pirepSummaryLines(byAircraft('B752'))).toEqual(['Sky: BKN 4,500 ft tops 6,500 ft']);
    expect(pirepSummaryLines(byAircraft('P28A'))[0]).toBe('Sky: SCT 1,300 ft, SCT 2,300 ft');
  });

  it('keeps the present weather', () => {
    expect(pirepSummaryLines(byAircraft('CRJ7'))).toContain('Weather: FU');
  });

  it('gives the AIREP wind', () => {
    expect(pirepSummaryLines(byAircraft('UAL2164'))).toContain('Wind 205\u00b0 33 kt');
  });

  it('joins temperature and wind with a middle dot, in that order, after the other lines', () => {
    const p = { ...makePirep(5, 0), turbulence: E75S.turbulence, temperature: -5, windDirection: 70, windSpeed: 12 };
    expect(pirepSummaryLines(p)).toEqual(['Turbulence: MOD CHOP, NEG', 'Temp -5\u00b0C \u00b7 Wind 070\u00b0 12 kt']);
    expect(pirepSummaryLines({ ...p, windDirection: null })).toContain('Temp -5\u00b0C \u00b7 Wind VRB 12 kt');
  });

  it('is empty for a report with nothing decoded', () => {
    expect(pirepSummaryLines(makePirep(5, 0))).toEqual([]);
  });
});

describe('pirepFreshness (DataFreshnessTests.pirepThresholds)', () => {
  const minutes = (m: number) => pirepFreshness(makePirep(0, m * 60), PIREP_NOW);

  it('is fresh under 60 min, OLD from 60 min, EXPIRED from 2 h', () => {
    expect(minutes(59)).toMatchObject({ level: 'fresh', text: '59 min' });
    expect(minutes(60)).toMatchObject({ level: 'old', text: 'OLD 1h' });
    expect(minutes(119)).toMatchObject({ level: 'old', text: 'OLD 1h 59m' });
    expect(minutes(120)).toMatchObject({ level: 'expired', text: 'EXPIRED' });
  });

  it('reads <1 min for a report from the future (clock skew)', () => {
    expect(pirepFreshness(makePirep(0, -120), PIREP_NOW)).toMatchObject({ level: 'fresh', text: '<1 min' });
  });
});

describe('pirepRow', () => {
  it('flags the captured urgent report (urgentPirepIsFlaggedWithDescentAltitude)', () => {
    const row = pirepRow(KDEN, byAircraft('CL30'), PIREP_NOW);
    expect(row).toMatchObject({
      tone: 'urgent',
      urgent: true,
      altitudeText: '500 ft MSL (descending)',
      aircraftType: 'CL30',
      freshness: { level: 'old', text: 'OLD 1h 1m' },
      summaryLines: [],
      rawText: 'ROC UUA /OV ROC100005/TM 1852/FL005/TP CL30/TB +/- 15 KTS/RM DURD RY28',
    });
    expect(row.id).toBe(pirepId(byAircraft('CL30')));
    expect(row.headerAccessibilityLabel).toBe('URGENT, 500 ft MSL (descending), CL30, PIREP age OLD 1h 1m');
  });

  it('keeps the other types plain (nonUrgentTypesAreNotFlagged)', () => {
    const rows = parsed.map((p) => pirepRow(KDEN, p, PIREP_NOW));
    expect(rows.filter((r) => r.urgent)).toHaveLength(1);
    expect(rows.filter((r) => r.tone === 'normal')).toHaveLength(7);
  });

  it('spells out climb, descent and unknown levels (climbDescentReportsWithoutLevelHaveNoAltitude)', () => {
    expect(pirepRow(KDEN, byAircraft('P28A'), PIREP_NOW).altitudeText).toBe('Descending');
    expect(pirepRow(KDEN, byAircraft('B752'), PIREP_NOW).altitudeText).toBe('Climbing');
    expect(pirepRow(KDEN, byAircraft('BE65'), PIREP_NOW).altitudeText).toBe('Alt unknown');
    expect(pirepRow(KDEN, byAircraft('UAL2164'), PIREP_NOW).altitudeText).toBe('30,000 ft MSL');
  });

  it('leaves the aircraft out of the spoken header when the report has none', () => {
    const row = pirepRow(KDEN, { ...makePirep(5, 600), aircraftType: null }, PIREP_NOW);
    expect(row.aircraftType).toBeNull();
    expect(row.headerAccessibilityLabel).toBe('6,500 ft MSL, PIREP age 10 min');
  });
});

it('rawReportValue', () => {
  expect(rawReportValue(true)).toBe('Expanded');
  expect(rawReportValue(false)).toBe('Collapsed');
});
