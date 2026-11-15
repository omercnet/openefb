// WindsAloftSection.swift has no view tests; these pin its decisions from the Swift source on the inputs of the Swift
// tests that reach them: WindsAloftServiceTests (conus06 and conus12Header at its `reference`, forUsePeriodCheck, the
// blank / light-and-variable levels) and DataFreshnessTests (the FOR USE window badge).
import { blankLevel, decodeGroup, parseBulletin, type WindsAloftReport } from '../../../../services/windsAloft';
import { swiftRawFixture } from '../../../../services/swiftFixtures';
import { ALS_REPORT, SFO_REPORT, UNTIMED_REPORT, WINDS_NOW, windsReport } from './fixture';
import {
  DEFAULT_FORECAST,
  FORECAST_OPTIONS,
  GRID_HEADINGS,
  MISSING,
  blankLevelNote,
  gridRow,
  gridRows,
  periodText,
  showsOutsideForUse,
  spokenLevel,
  stationLine,
  stationSpoken,
  windsBody,
  windsErrorText,
  windsFreshness,
  windsTaskKey,
} from './windsAloftLogic';

const SWIFT = 'ServiceTests/WindsAloftServiceTests.swift';
const date = (iso: string) => Date.parse(iso);
const conus06 = parseBulletin(swiftRawFixture(SWIFT, 'conus06'), WINDS_NOW);
const level = (station: string, altitude: number) => {
  const found = conus06.rows.get(station)?.find((l) => l.altitude === altitude);
  if (!found) throw new Error(`${station} ${altitude}`);
  return found;
};
/** DataFreshnessTests.now. */
const FRESHNESS_NOW = 1_793_332_020_000;
const windowed = (start: number | null, end: number | null): WindsAloftReport => ({
  ...SFO_REPORT,
  forUseStart: start,
  forUseEnd: end,
});

describe('picker', () => {
  it('offers 6, 12 and 24 h, 6 h selected first', () => {
    expect(FORECAST_OPTIONS.map((o) => o.label)).toEqual(['6 h', '12 h', '24 h']);
    expect(FORECAST_OPTIONS.map((o) => o.forecast)).toEqual([6, 12, 24]);
    expect(DEFAULT_FORECAST).toBe(6);
  });

  it('reloads per airport and period, like the Swift task id', () => {
    expect(windsTaskKey('KDEN', 12)).toBe('KDEN-12');
    expect(windsTaskKey('KDEN', 6)).not.toBe(windsTaskKey('KDEN', 24));
  });
});

describe('windsBody', () => {
  it('spins on every load, even over a report (Swift sets .loading in load())', () => {
    expect(windsBody({ loading: true, error: null, report: SFO_REPORT })).toEqual({ kind: 'loading' });
    expect(windsBody({ loading: true, error: 'x', report: null })).toEqual({ kind: 'loading' });
    expect(windsBody({ loading: false, error: null, report: null })).toEqual({ kind: 'loading' });
  });

  it('shows the failure with the localized description', () => {
    expect(windsBody({ loading: false, error: 'the station is not in the bulletin', report: SFO_REPORT })).toEqual({
      kind: 'error',
      text: 'Winds aloft not loaded: the station is not in the bulletin',
    });
    expect(windsErrorText('x')).toBe('Winds aloft not loaded: x');
  });

  it('shows the report', () => {
    expect(windsBody({ loading: false, error: null, report: SFO_REPORT })).toEqual({
      kind: 'report',
      report: SFO_REPORT,
    });
  });
});

describe('station line', () => {
  it('names the station and its rounded distance', () => {
    expect(stationLine(SFO_REPORT)).toBe('SFO \u00b7 San Francisco \u00b7 15 NM');
    expect(stationSpoken(SFO_REPORT)).toBe('Station SFO, San Francisco, 15 nautical miles');
    expect(stationLine(ALS_REPORT)).toBe('ALS \u00b7 Alamosa \u00b7 23 NM');
    expect(stationLine({ ...SFO_REPORT, distanceNM: 14.5 })).toBe('SFO \u00b7 San Francisco \u00b7 15 NM');
    expect(stationLine({ ...SFO_REPORT, distanceNM: 14.49 })).toBe('SFO \u00b7 San Francisco \u00b7 14 NM');
  });
});

describe('periodText (parsesHeaderTimesAndLevels)', () => {
  it('gives the valid time, the FOR USE window and the issue time', () => {
    expect(periodText(SFO_REPORT)).toBe('Valid 301800Z \u00b7 For use 1400Z\u20132100Z \u00b7 Issued 1400Z');
  });

  it('spans midnight for the 12 h bulletin (forUsePeriodSpanningMidnight)', () => {
    const header = parseBulletin(swiftRawFixture(SWIFT, 'conus12Header'), WINDS_NOW);
    const report: WindsAloftReport = { ...SFO_REPORT, forecast: 12, ...header, levels: [] };
    expect(periodText(report)).toContain('Valid 310000Z \u00b7 For use 2100Z\u20130600Z');
  });

  it('leaves out missing parts and falls back to the period label', () => {
    expect(periodText({ ...SFO_REPORT, forUseEnd: null })).toBe('Valid 301800Z \u00b7 Issued 1400Z');
    expect(periodText({ ...SFO_REPORT, validTime: null, issued: null })).toBe('For use 1400Z\u20132100Z');
    expect(periodText(UNTIMED_REPORT)).toBe('6 h forecast');
    expect(periodText({ ...UNTIMED_REPORT, forecast: 24 })).toBe('24 h forecast');
  });
});

describe('FOR USE window', () => {
  it('shows the notice outside the window, both ends inclusive (forUsePeriodCheck)', () => {
    expect(showsOutsideForUse(SFO_REPORT, date('2026-10-30T14:00:00Z'))).toBe(false);
    expect(showsOutsideForUse(SFO_REPORT, date('2026-10-30T21:00:00Z'))).toBe(false);
    expect(showsOutsideForUse(SFO_REPORT, date('2026-10-30T21:01:00Z'))).toBe(true);
    expect(showsOutsideForUse(SFO_REPORT, date('2026-10-30T13:59:00Z'))).toBe(true);
  });

  it('shows the notice when the bulletin has no window', () => {
    expect(showsOutsideForUse(UNTIMED_REPORT, WINDS_NOW)).toBe(true);
  });

  it('judges the badge by the window, not the issue time (DataFreshnessTests.windsAloftWindow)', () => {
    const now = FRESHNESS_NOW;
    expect(windsFreshness(windowed(now - 3_600_000, now + 3_600_000), now)).toMatchObject({
      level: 'fresh',
      text: 'VALID',
    });
    expect(windsFreshness(windowed(now - 3_600_000, now - 1000), now)).toMatchObject({
      level: 'expired',
      text: 'EXPIRED',
    });
    expect(windsFreshness(windowed(now + 1_800_000, now + 5_400_000), now).text).toBe('NOT YET VALID');
  });

  it('reads N/A without a window (DataFreshnessTests.windsAloftUnknown)', () => {
    expect(windsFreshness(UNTIMED_REPORT, FRESHNESS_NOW)).toMatchObject({ level: 'unknown', text: 'N/A' });
  });
});

describe('grid', () => {
  it('has the four headings', () => {
    expect(GRID_HEADINGS).toEqual(['ALT (ft MSL)', 'DIR (\u00b0T)', 'SPD (kt)', 'TEMP (\u00b0C)']);
  });

  it('decodes every SFO column (fullRowDecodesEveryColumn)', () => {
    const rows = gridRows(SFO_REPORT);
    expect(rows.map((r) => r.altitudeText)).toEqual([
      '3,000',
      '6,000',
      '9,000',
      '12,000',
      '18,000',
      '24,000',
      '30,000',
      '34,000',
      '39,000',
    ]);
    expect(rows.map((r) => r.direction)).toEqual(['210', '190', '240', '230', '220', '230', '230', '230', '230']);
    expect(rows.map((r) => r.speed)).toEqual(['6', '10', '11', '16', '27', '34', '44', '45', '48']);
    expect(rows.map((r) => r.temperature)).toEqual([MISSING, '5', '0', '-7', '-19', '-28', '-44', '-54', '-62']);
    expect(rows.every((r) => r.tone === 'primary' && r.lightAndVariable === null)).toBe(true);
    expect(rows[0]).toMatchObject({ spokenLabel: '3,000 feet', spokenValue: 'wind 210 degrees at 6 knots' });
    expect(rows[3]!.spokenValue).toBe('wind 230 degrees at 16 knots, temperature -7 degrees Celsius');
    expect(blankLevelNote(SFO_REPORT)).toBeNull();
  });

  it('pads the direction to three digits', () => {
    expect(gridRow(decodeGroup('0507', 3000)!).direction).toBe('050');
  });

  it('greys and dashes blank low levels, with the footnote (blankLevelColumnsAreNotForecast)', () => {
    expect(gridRow(level('ABQ', 3000))).toMatchObject({
      direction: MISSING,
      speed: MISSING,
      temperature: MISSING,
      tone: 'secondary',
      spokenValue: 'not forecast',
    });
    expect(gridRow(level('ABQ', 9000))).toMatchObject({
      direction: '140',
      speed: '10',
      temperature: '7',
      tone: 'primary',
    });
    const rows = gridRows(ALS_REPORT);
    expect(rows.slice(0, 3).every((r) => r.tone === 'secondary')).toBe(true);
    expect(blankLevelNote(ALS_REPORT)).toBe('\u2014 Not forecast within 1,500 ft of station elevation (7,535 ft MSL).');
    expect(blankLevelNote(windsReport('ABQ', 5))).toBe(
      '\u2014 Not forecast within 1,500 ft of station elevation (5,352 ft MSL).',
    );
  });

  it('spans light and variable over direction and speed', () => {
    expect(gridRow(level('ALS', 12000))).toMatchObject({
      lightAndVariable: 'Light & variable',
      temperature: '2',
      tone: 'primary',
      spokenValue: 'wind light and variable, temperature 2 degrees Celsius',
    });
    expect(gridRow(level('BIH', 6000))).toMatchObject({
      lightAndVariable: 'Light & variable',
      temperature: MISSING,
      spokenValue: 'wind light and variable',
    });
  });

  it('gives wind without temperature within 2,500 ft of the station (AMA 6000)', () => {
    expect(gridRow(level('AMA', 6000))).toMatchObject({ direction: '180', speed: '12', temperature: MISSING });
    expect(gridRow(level('AMA', 9000))).toMatchObject({ direction: '180', temperature: '5' });
  });

  it('shows only the headings for a report without levels', () => {
    const empty = { ...SFO_REPORT, levels: [] };
    expect(gridRows(empty)).toEqual([]);
    expect(blankLevelNote(empty)).toBeNull();
  });
});

describe('spokenLevel', () => {
  it('says "not forecast" for a blank level and "no data" when nothing is known', () => {
    expect(spokenLevel(blankLevel(3000))).toBe('not forecast');
    expect(
      spokenLevel({ altitude: 3000, direction: null, speed: 5, temperature: null, isLightAndVariable: false }),
    ).toBe('no data');
    expect(spokenLevel({ ...blankLevel(3000), temperature: 4 })).toBe('temperature 4 degrees Celsius, not forecast');
  });
});
