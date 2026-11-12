// AirportColumnView has no Swift tests; these pin its static helpers and decisions from the Swift source, plus the cases
// of MetarVisibilityTests / RegionTests that reach WeatherViewModel.decoded* and TerminalProcedureServiceTests that reach
// TerminalChartCategory and AirportChartsSection.grouped (the parsers themselves are domain/data tests).
import {
  FREQUENCY_TYPES,
  makeAirport,
  makeWeatherCache,
  type Airport,
  type FrequencyType,
  type Runway,
  type WeatherCache,
} from '../../../domain/core';
import { KSQL_COLUMN, KSQL_NOW } from './fixture';
import {
  MISSING,
  capitalized,
  chartCategory,
  chartId,
  cycleStatus,
  decodedAltimeter,
  decodedCeiling,
  decodedDew,
  decodedTemp,
  decodedVisibility,
  decodedWind,
  formatMhz,
  frequencyLabel,
  frequencyRank,
  frequencyRows,
  frequencySpokenName,
  groupedCharts,
  headerAccessibilityLabel,
  infoChips,
  metarFreshness,
  runwayRow,
  shortDate,
  stationOnlyCaption,
  tafBlock,
  tafFreshness,
  weatherBody,
  weatherFields,
  type AirportWeather,
  type TerminalChart,
} from './logic';

const wx = (fields: Partial<WeatherCache> = {}): WeatherCache =>
  makeWeatherCache({ id: 'w', stationID: 'KPAO', fetchedAt: 0, ...fields });

const airport = (fields: Partial<Airport> = {}): Airport =>
  makeAirport({
    icao: 'KPAO',
    name: 'Palo Alto',
    latitude: 37.46,
    longitude: -122.11,
    elevation: 7,
    type: 'airport',
    ownership: 'public',
    ...fields,
  });

const runway = (fields: Partial<Runway> = {}): Runway => ({
  id: '13/31',
  length: 2443,
  width: 70,
  surface: 'asphalt',
  lighting: 'partTime',
  baseEndID: '13',
  reciprocalEndID: '31',
  baseEndLatitude: 0,
  baseEndLongitude: 0,
  reciprocalEndLatitude: 0,
  reciprocalEndLongitude: 0,
  ...fields,
});

const weather = (fields: Partial<AirportWeather> = {}): AirportWeather => ({
  metar: null,
  isLoading: false,
  errorMessage: null,
  metarPublished: true,
  tafPublished: true,
  taf: null,
  tafFetchedAt: null,
  tafFailed: false,
  ...fields,
});

describe('frequency labels, spoken names and order', () => {
  it('abbreviates every type for the label column', () => {
    const labels = Object.fromEntries(FREQUENCY_TYPES.map((t) => [t, frequencyLabel(t)]));
    expect(labels).toEqual({
      ctaf: 'CTAF',
      tower: 'TWR',
      ground: 'GND',
      clearance: 'CD',
      approach: 'APP',
      departure: 'DEP',
      atis: 'ATIS',
      awos: 'AWOS',
      asos: 'ASOS',
      unicom: 'UNICOM',
      multicom: 'MULTICOM',
      center: 'CTR',
      fss: 'FSS',
      other: 'FREQ',
    });
  });

  it('speaks words VoiceOver would otherwise spell', () => {
    expect(
      ['tower', 'ground', 'clearance', 'ctaf', 'center', 'fss', 'other'].map((t) =>
        frequencySpokenName(t as FrequencyType),
      ),
    ).toEqual(['Tower', 'Ground', 'Clearance delivery', 'C TAF', 'Center', 'Flight service', 'Frequency']);
    expect(frequencySpokenName('atis')).toBe('ATIS');
  });

  it('ranks weather, local, approach, tower, ground, clearance, departure, center, FSS, other', () => {
    const order: FrequencyType[] = [
      'atis',
      'ctaf',
      'approach',
      'tower',
      'ground',
      'clearance',
      'departure',
      'center',
      'fss',
      'other',
    ];
    const ranks = order.map(frequencyRank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(frequencyRank('awos')).toBe(frequencyRank('asos'));
    expect(frequencyRank('unicom')).toBe(frequencyRank('multicom'));
  });

  it('formats MHz with three decimals', () => {
    expect(formatMhz(118.025)).toBe('118.025');
    expect(formatMhz(119)).toBe('119.000');
  });

  it('sorts the list by rank and keeps the source order within a rank', () => {
    const f = (id: string, type: FrequencyType, frequency: number) => ({ id, type, frequency, name: id });
    const rows = frequencyRows(
      airport({
        frequencies: [
          f('dep', 'departure', 135.65),
          f('twr', 'tower', 119),
          f('app2', 'approach', 135.65),
          f('atis', 'atis', 125.9),
          f('app1', 'approach', 133.95),
          f('unicom', 'unicom', 122.95),
        ],
      }),
    );
    expect(rows.map((r) => `${r.label} ${r.mhz}`)).toEqual([
      'ATIS 125.900',
      'UNICOM 122.950',
      'APP 135.650',
      'APP 133.950',
      'TWR 119.000',
      'DEP 135.650',
    ]);
    expect(rows[4]).toMatchObject({ spoken: 'Tower', accessibilityValue: '119.000 megahertz' });
  });

  it('falls back to the CTAF and UNICOM fields, else no rows', () => {
    expect(frequencyRows(airport({ ctafFrequency: 122.8, unicomFrequency: 122.95 })).map((r) => r.label)).toEqual([
      'CTAF',
      'UNICOM',
    ]);
    expect(frequencyRows(airport({ unicomFrequency: 122.7 })).map((r) => r.spoken)).toEqual(['Unicom']);
    expect(frequencyRows(airport())).toEqual([]);
  });

  it('the KSQL fixture lists the reference rows in order', () => {
    expect(frequencyRows(KSQL_COLUMN.airport!).map((r) => `${r.label} ${r.mhz}`)).toEqual([
      'ATIS 125.900',
      'CTAF 119.000',
      'UNICOM 122.950',
      'APP 133.950',
      'APP 135.650',
      'TWR 119.000',
      'GND 118.025',
      'DEP 135.650',
    ]);
  });
});

describe('info chips and runway rows', () => {
  it('elevation, type, TPA and fuel for KSQL', () => {
    expect(infoChips(KSQL_COLUMN.airport!).map((c) => c.text)).toEqual([
      "5' MSL",
      'Airport',
      "TPA 800'",
      '100LL, A, A+, UL94',
    ]);
  });

  it('drops TPA and fuel when unknown, never groups digits, truncates like Int()', () => {
    expect(infoChips(airport({ elevation: 5280.9, type: 'seaplane' })).map((c) => c.text)).toEqual([
      "5280' MSL",
      'Seaplane',
    ]);
    expect(infoChips(airport({ elevation: -12.7 }))[0]!.text).toBe("-12' MSL");
  });

  it('says when an aerodrome publishes no elevation', () => {
    expect(infoChips(airport(), false)[0]).toEqual({ icon: 'elevation', text: 'ELEV not published' });
  });

  it('capitalizes like Swift String.capitalized', () => {
    expect(capitalized('asphalt')).toBe('Asphalt');
    expect(capitalized('ULTRALIGHT')).toBe('Ultralight');
    expect(capitalized('asphalt-concrete grooved')).toBe('Asphalt-Concrete Grooved');
  });

  it('formats a runway with grouped feet and the capitalized surface', () => {
    expect(runwayRow(KSQL_COLUMN.airport!.runways[0]!)).toMatchObject({
      ident: '12/30',
      dimensions: "2,621' x 75'",
      surface: 'Asphalt',
      accessibilityLabel: 'Runway 12/30',
      accessibilityValue: '2,621 by 75 feet, Asphalt',
    });
    expect(runwayRow(runway({ length: 12001, width: 1000, surface: 'water' }))).toMatchObject({
      dimensions: "12,001' x 1,000'",
      surface: 'Water',
    });
    expect(runwayRow(runway({ width: 0, surface: 'other' })).dimensions).toBe("2,443' x 0'");
  });
});

describe('decoded weather (WeatherViewModel)', () => {
  it('reads dashes without a report', () => {
    expect([decodedWind(null), decodedCeiling(null), decodedVisibility(null, 'us'), decodedTemp(null)]).toEqual([
      MISSING,
      MISSING,
      MISSING,
      MISSING,
    ]);
    expect(decodedDew(null)).toBe('---');
  });

  it('wind: calm, padded, gusts, variable and missing speed', () => {
    expect(decodedWind(wx({ windSpeed: 0, windDirection: 0 }))).toBe('Calm');
    expect(decodedWind(wx({ windSpeed: 8, windDirection: 310 }))).toBe('310/08 KT');
    expect(decodedWind(wx({ windSpeed: 8, windDirection: 40, windGust: 15 }))).toBe('040/08 G15 KT');
    expect(decodedWind(wx({ windSpeed: 2 }))).toBe('VRB/02 KT');
    expect(decodedWind(wx({ windDirection: 310 }))).toBe(MISSING);
  });

  it('ceiling or CLR', () => {
    expect(decodedCeiling(wx({ ceiling: 1200 }))).toBe("1200' BKN");
    expect(decodedCeiling(wx({ ceiling: 12000 }))).toBe("12000' BKN");
    expect(decodedCeiling(wx())).toBe('CLR');
  });

  it('US statute miles, capped as >10 SM', () => {
    expect(decodedVisibility(wx({ visibility: '9.0' }), 'us')).toBe('9.0 SM');
    expect(decodedVisibility(wx({ visibility: '10' }), 'us')).toBe('>10 SM');
    expect(decodedVisibility(wx({ visibility: '6+' }), 'us')).toBe('>10 SM');
    expect(decodedVisibility(wx(), 'us')).toBe(MISSING);
  });

  // MetarVisibilityTests.israelShowsMetresAndTheUSKeepsStatuteMiles and variableWindAndCavokReadFromTheLiveShapedReport.
  it('Israel reads metres from the raw METAR; the US keeps statute miles for the same report', () => {
    const llbg = wx({
      rawMETAR: 'METAR LLBG 010920Z 29005KT 250V330 9999 FEW025 26/15 Q1017 NOSIG',
      visibility: '6+',
      temperature: 26,
      dewpoint: 15,
      windDirection: 290,
      windSpeed: 5,
      altimeterHPa: 1017,
    });
    expect(decodedVisibility(llbg, 'israel')).toBe('\u226510 km');
    expect(decodedVisibility(llbg, 'us')).toBe('>10 SM');
    // israelWeatherRowUsesKnotsCelsiusAndHectopascals
    expect(decodedWind(llbg)).toContain('KT');
    expect(decodedTemp(llbg)).toBe('26\u00B0C');
    expect(decodedAltimeter(llbg, 'israel')).toBe('1017 hPa');
    const cavok = wx({
      rawMETAR: 'METAR LLBG 020120Z VRB02KT CAVOK 19/15 Q1016 NOSIG',
      windSpeed: 2,
      altimeterHPa: 1016,
    });
    expect(decodedWind(cavok)).toBe('VRB/02 KT');
    expect(decodedVisibility(cavok, 'israel')).toBe('\u226510 km');
    expect(decodedAltimeter(cavok, 'israel')).toBe('1016 hPa');
    expect(decodedVisibility(wx({ rawMETAR: 'LLBG 010920Z 29005KT 4000 26/15 Q1017' }), 'israel')).toBe('4000 m');
    expect(decodedVisibility(wx({ rawMETAR: null }), 'israel')).toBe(MISSING);
  });

  // RegionTests.weatherViewModelShowsHectopascalsInIsraelAndInHgInTheUS / missingAltimeterReadsAsDashes.
  it('altimeter in the region unit, dashes when missing', () => {
    expect(decodedAltimeter(wx({ altimeterHPa: 1017 }), 'israel')).toBe('1017 hPa');
    expect(decodedAltimeter(wx({ altimeterHPa: 1017 }), 'us')).toBe('30.03 inHg');
    expect(decodedAltimeter(wx(), 'us')).toBe(MISSING);
    expect(decodedAltimeter(null, 'israel')).toBe(MISSING);
  });

  it('temperatures truncate toward zero', () => {
    expect(decodedTemp(wx({ temperature: 15.8 }))).toBe('15\u00B0C');
    expect(decodedTemp(wx({ temperature: -0.5 }))).toBe('0\u00B0C');
    expect(decodedDew(wx({ dewpoint: -3.9 }))).toBe('-3\u00B0C');
  });

  it('the KSQL fixture decodes to the reference rows', () => {
    expect(weatherFields(KSQL_COLUMN.weather.metar, 'us').map((f) => `${f.label} ${f.value}`)).toEqual([
      'Wind Calm',
      'Vis 9.0 SM',
      "Ceiling 1200' BKN",
      'Temp 15\u00B0C',
      'Dewpt 13\u00B0C',
      'Altim 30.18 inHg',
    ]);
    expect(weatherFields(null, 'us').map((f) => f.spoken)).toEqual([
      'Wind',
      'Visibility',
      'Ceiling',
      'Temperature',
      'Dew point',
      'Altimeter',
    ]);
  });
});

describe('weather section state', () => {
  const metar = wx({ observationTime: 0 });

  it('a report wins, carrying a failed refresh', () => {
    expect(weatherBody(weather({ metar, isLoading: true }))).toEqual({ kind: 'report', refreshFailed: null });
    expect(weatherBody(weather({ metar, errorMessage: 'Offline' }))).toEqual({
      kind: 'report',
      refreshFailed: 'Offline',
    });
  });

  it('then loading, then the error, then the unpublished notes, then none', () => {
    expect(weatherBody(weather({ isLoading: true, errorMessage: 'x' }))).toEqual({ kind: 'loading' });
    expect(weatherBody(weather({ errorMessage: 'Offline' }))).toEqual({ kind: 'error', message: 'Offline' });
    expect(weatherBody(weather({ metarPublished: false }))).toEqual({
      kind: 'notPublished',
      text: 'No METAR is published for this aerodrome. The forecast (TAF) is below.',
    });
    expect(weatherBody(weather({ metarPublished: false, tafPublished: false }))).toEqual({
      kind: 'notPublished',
      text: 'No METAR or TAF is published for this aerodrome.',
    });
    expect(weatherBody(weather())).toEqual({ kind: 'none' });
  });

  it('METAR age: fresh, OLD from 75 min, EXPIRED from 3 h, none without a report', () => {
    const at = (minutes: number) => metarFreshness(weather({ metar }), minutes * 60_000);
    expect(at(12)).toMatchObject({ level: 'fresh', text: '12 min' });
    expect(at(80)).toMatchObject({ level: 'old', text: 'OLD 1h 20m' });
    expect(at(181)).toMatchObject({ level: 'expired', text: 'EXPIRED' });
    expect(metarFreshness(weather(), 0)).toBeNull();
    expect(metarFreshness(KSQL_COLUMN.weather, KSQL_NOW)).toMatchObject({ level: 'fresh', text: '12 min' });
  });

  it('TAF block: forecast, failed refresh note, not loaded, nothing', () => {
    expect(tafBlock(weather({ taf: 'TAF KSQL', tafFailed: true }))).toEqual({
      kind: 'taf',
      text: 'TAF KSQL',
      refreshFailed: true,
    });
    expect(tafBlock(weather({ tafFailed: true }))).toEqual({ kind: 'notLoaded' });
    expect(tafBlock(weather())).toEqual({ kind: 'none' });
    expect(tafBlock(KSQL_COLUMN.weather)).toEqual({ kind: 'notLoaded' });
  });

  it('TAF freshness: valid period end first, else fetch age', () => {
    const now = Date.UTC(2026, 10, 8, 12);
    const taf = 'TAF KSQL 081120Z 0812/0912 VRB03KT P6SM SKC';
    expect(tafFreshness(weather({ taf, tafFetchedAt: now - 60_000 }), now)).toMatchObject({
      level: 'fresh',
      text: '1 min',
    });
    expect(tafFreshness(weather({ taf, tafFetchedAt: now }), Date.UTC(2026, 10, 9, 13))).toMatchObject({
      level: 'expired',
      text: 'EXPIRED',
    });
    expect(tafFreshness(weather(), now)).toBeNull();
  });

  it('header label: identifier, category when known, name', () => {
    expect(headerAccessibilityLabel('KSQL', 'mvfr', 'San Carlos Airport')).toBe(
      'KSQL, flight category MVFR, San Carlos Airport',
    );
    expect(headerAccessibilityLabel('LLHZ', null, null)).toBe('LLHZ');
  });

  it('station-only caption names the region', () => {
    expect(stationOnlyCaption('Israel')).toBe(
      "Airport data for Israel is not available yet. Only this station's weather is shown.",
    );
  });
});

describe('charts (AirportChartsSection, TerminalChartCategory)', () => {
  const chart = (chartCode: string, name: string, pdfName = `${name}.PDF`): TerminalChart => ({
    chartCode,
    name,
    pdfName,
    cycle: '2611',
  });

  // TerminalProcedureServiceTests.mapsChartCodesToCategories
  it('maps chart codes to categories', () => {
    const expected: [string, string][] = [
      ['APD', 'diagram'],
      ['IAP', 'approach'],
      ['DP', 'departure'],
      ['ODP', 'departure'],
      ['STR', 'arrival'],
      ['STAR', 'arrival'],
      ['MIN', 'minimums'],
      ['HOT', 'other'],
      ['LAH', 'other'],
      ['DAU', 'other'],
      ['', 'other'],
      [' apd ', 'diagram'],
    ];
    for (const [code, category] of expected) expect(chartCategory(code)).toBe(category);
  });

  // TerminalProcedureServiceTests.groupsWithDiagramFirst (the KSQL records of its metafile, minus the deleted / non-PDF).
  it('groups with the diagram first, metafile order within a group', () => {
    const groups = groupedCharts([
      chart('MIN', 'TAKEOFF MINIMUMS', 'SW2TO.PDF'),
      chart('MIN', 'DIVERSE VECTOR AREA', 'SW2TO.PDF'),
      chart('IAP', 'RNAV (GPS) Y RWY 30'),
      chart('IAP', 'RNAV (GPS) Z RWY 30'),
      chart('APD', 'AIRPORT DIAGRAM'),
      chart('HOT', 'HOT SPOT'),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['diagram', 'approach', 'minimums', 'other']);
    expect(groups.map((g) => g.title)).toEqual(['Airport Diagram', 'Approaches', 'Minimums', 'Other']);
    expect(groups[1]!.charts.map((c) => c.name)).toEqual(['RNAV (GPS) Y RWY 30', 'RNAV (GPS) Z RWY 30']);
    expect(groupedCharts([])).toEqual([]);
  });

  it('chart ids include the name (several records share a PDF)', () => {
    expect(chartId(chart('MIN', 'TAKEOFF MINIMUMS', 'SW2TO.PDF'))).toBe('2611/SW2TO.PDF/TAKEOFF MINIMUMS');
  });

  // TerminalProcedureServiceTests.parsesCycleAndValidityWindow: expired from 0901Z on the next cycle's first day.
  it('cycle line until 0901Z on the expiry date, then the expired warning', () => {
    const cycle = { code: '2611', effective: Date.UTC(2026, 9, 29, 9, 1), expires: Date.UTC(2026, 10, 26, 9, 1) };
    expect(cycleStatus(cycle, Date.UTC(2026, 10, 26, 9, 0))).toEqual({
      expired: false,
      text: 'Cycle 2611 \u00B7 Valid to 11/26',
    });
    expect(cycleStatus(cycle, cycle.expires)).toEqual({
      expired: true,
      text: 'Charts expired 11/26. Do not use for navigation.',
    });
  });

  it('short dates are UTC MM/dd', () => {
    expect(shortDate(Date.UTC(2026, 0, 3, 23, 59))).toBe('01/03');
  });
});
