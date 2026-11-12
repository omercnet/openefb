// Render tests for the airport column states of AirportColumnView.swift (no Swift view tests exist): the KSQL reference,
// weather loading / failed / unpublished / stale, the raw METAR disclosure, TAF present / absent, empty and unusual
// frequencies / runways / charts, long and Hebrew names, station-only and loading columns, and the actions.
import { StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';
import { press, render } from '../../../../tests/support/ui';
import { makeWeatherCache, type Airport } from '../../../domain/core';
import { appStore } from '../../state/appStore';
import { AirportColumn } from '../AirportColumn';
import { KSQL_COLUMN, KSQL_NOW } from './fixture';
import type { AirportWeather } from './logic';
import { airport, type AirportColumnData, type AirportColumnState } from './store';

type Overrides = Partial<Omit<AirportColumnData, 'weather' | 'airport'>> & {
  weather?: Partial<AirportWeather>;
  airport?: Partial<Airport> | null;
};

function column(over: Overrides = {}): AirportColumnData {
  const { weather, airport: a, ...rest } = over;
  return {
    ...KSQL_COLUMN,
    ...rest,
    airport: a === null ? null : { ...KSQL_COLUMN.airport!, ...a },
    weather: { ...KSQL_COLUMN.weather, ...weather },
  };
}

function setup(over: Overrides = {}, state: Partial<AirportColumnState> = {}, icao = 'KSQL') {
  const actions = {
    directTo: jest.fn(),
    refreshWeather: jest.fn(),
    openChart: jest.fn(),
    retryCharts: jest.fn(),
  };
  const store = airport.make({
    region: 'us',
    now: KSQL_NOW,
    columns: { [icao]: column(over) },
    rawMetarExpandedFor: null,
    ...actions,
    ...state,
  });
  appStore.setState({ selectedAirportId: icao, stripColumn: 'airport' });
  const element = (
    <airport.Provider store={store}>
      <AirportColumn />
    </airport.Provider>
  );
  return { element, store, actions };
}

const show = async (over: Overrides = {}, state: Partial<AirportColumnState> = {}, icao = 'KSQL') => {
  const s = setup(over, state, icao);
  return { ...s, view: await render(s.element) };
};

/** Host nodes only (the composite Pressable / View above them carries the same props). */
const host = (nodes: TestInstance[]) => nodes.filter((n) => typeof n.type === 'string');
const one = (nodes: TestInstance[]) => {
  const found = host(nodes);
  expect(found).toHaveLength(1);
  return found[0]!;
};

afterAll(() => appStore.setState({ selectedAirportId: null, stripColumn: 'log' }));

describe('AirportColumn, KSQL reference', () => {
  it('shows every reference row', async () => {
    const { view } = await show();
    const text = view.text();
    for (const s of [
      'KSQL',
      'MVFR',
      'San Carlos Airport',
      'Direct',
      "5' MSL",
      'Airport',
      "TPA 800'",
      '100LL, A, A+, UL94',
      '12 min',
      'Calm',
      '9.0 SM',
      "1200' BKN",
      '15\u00B0C',
      '13\u00B0C',
      '30.18 inHg',
      'Raw METAR',
      'TAF not loaded',
      '125.900',
      '118.025',
      '12/30',
      "2,621' x 75'",
      'Asphalt',
      'NOTAMs need a free FAA API key. Add it in Settings \u203A NOTAM API.',
      'FAA CHARTS',
      'Cycle 2611 \u00B7 Valid to 11/26',
      'Airport Diagram',
      'AIRPORT DIAGRAM',
      'Approaches',
      'RNAV (GPS) Y RWY 30',
      'RNAV (GPS) Z RWY 30',
      'Arrivals',
    ]) {
      expect(text).toContain(s);
    }
  });

  it('the title block hugs its content: no flex inside the header wrapper (the 61.5 pt header, not 60)', async () => {
    // React Native lays Yoga out with YGErrataAll: a flexing block inside ColumnHeader's flex: 1 wrapper is stretched to the
    // row's 60 pt minimum instead of its 61.5 pt content, and every row below sat 1.5 pt high (PR #47, run 43102552494).
    const { view } = await show();
    const style = StyleSheet.flatten(one(view.all((n) => n.props.testID === 'airport-title')).props.style);
    expect(style.flex).toBeUndefined();
    expect(style.flexGrow).toBeUndefined();
  });

  it('labels the header, Direct, chips, rows and the age badge for VoiceOver', async () => {
    const { view } = await show();
    const title = one(view.all((n) => n.props.testID === 'airport-title'));
    expect(title.props.accessibilityRole).toBe('header');
    expect(title.props.accessibilityLabel).toBe('KSQL, flight category MVFR, San Carlos Airport');
    const direct = one(view.all((n) => n.props.testID === 'airport-direct-to'));
    expect(direct.props).toMatchObject({ accessibilityLabel: 'Direct to KSQL', accessibilityRole: 'button' });
    expect(one(view.byLabel("TPA 800'")).props.accessible).toBe(true);
    const wind = one(view.all((n) => n.props.testID === 'airport-wx-Wind'));
    expect(wind.props).toMatchObject({ accessibilityLabel: 'Wind', accessibilityValue: { text: 'Calm' } });
    const freqs = host(view.all((n) => n.props.testID === 'airport-frequency'));
    expect(freqs.map((n) => n.props.accessibilityLabel)).toEqual([
      'ATIS',
      'C TAF',
      'Unicom',
      'Approach',
      'Approach',
      'Tower',
      'Ground',
      'Departure',
    ]);
    expect(freqs[6]!.props.accessibilityValue).toEqual({ text: '118.025 megahertz' });
    const rwy = one(view.all((n) => n.props.testID === 'airport-runway'));
    expect(rwy.props).toMatchObject({
      accessibilityLabel: 'Runway 12/30',
      accessibilityValue: { text: '2,621 by 75 feet, Asphalt' },
    });
    const badge = one(view.all((n) => n.props.testID === 'data-age-badge'));
    expect(badge.props).toMatchObject({ accessibilityLabel: 'METAR age', accessibilityValue: { text: '12 min' } });
    expect(host(view.byRole('header')).length).toBeGreaterThanOrEqual(5); // title, WEATHER, FREQUENCIES, RUNWAYS, NOTAMS, FAA CHARTS
  });

  it('Direct starts the route and returns to the flight log', async () => {
    const { view, actions } = await show();
    await press(view.byTestId('airport-direct-to'));
    expect(actions.directTo).toHaveBeenCalledWith(expect.objectContaining({ icao: 'KSQL' }));
    expect(appStore.getState().stripColumn).toBe('log');
  });

  it('refresh and chart rows call their actions', async () => {
    const { view, actions } = await show();
    await press(one(view.all((n) => n.props.testID === 'airport-refresh-weather')));
    expect(actions.refreshWeather).toHaveBeenCalledWith('KSQL');
    await press(one(view.byLabel('RNAV (GPS) Z RWY 30')));
    expect(actions.openChart).toHaveBeenCalledWith(expect.objectContaining({ name: 'RNAV (GPS) Z RWY 30' }));
  });
});

describe('weather states', () => {
  it('raw METAR disclosure expands and collapses, with its state', async () => {
    const { view, store } = await show();
    const disclosure = () => one(view.all((n) => n.props.testID === 'airport-raw-metar'));
    expect(disclosure().props).toMatchObject({
      accessibilityLabel: 'Raw METAR',
      accessibilityValue: { text: 'Collapsed' },
      accessibilityState: { expanded: false },
    });
    expect(view.text()).not.toContain('KSQL 082347Z');
    await press(disclosure());
    expect(store.getState().rawMetarExpandedFor).toBe('KSQL');
    expect(disclosure().props.accessibilityState).toEqual({ expanded: true });
    expect(disclosure().props.accessibilityValue).toEqual({ text: 'Expanded' });
    expect(view.text()).toContain('KSQL 082347Z 00000KT 9SM BKN012 15/13 A3018');
    await press(disclosure());
    expect(view.text()).not.toContain('KSQL 082347Z');
  });

  it('a new selection starts collapsed', async () => {
    const { view } = await show({}, { rawMetarExpandedFor: 'KPAO' });
    expect(one(view.all((n) => n.props.testID === 'airport-raw-metar')).props.accessibilityState).toEqual({
      expanded: false,
    });
  });

  it('no raw text, no disclosure', async () => {
    const { view } = await show({
      weather: { metar: makeWeatherCache({ ...KSQL_COLUMN.weather.metar!, rawMETAR: null }) },
    });
    expect(view.all((n) => n.props.testID === 'airport-raw-metar')).toHaveLength(0);
  });

  it('loading: spinner text, busy refresh, no age badge, no category', async () => {
    const { view } = await show({ weather: { metar: null, isLoading: true, tafFailed: false } });
    expect(view.text()).toContain('Loading weather...');
    expect(view.all((n) => n.props.testID === 'data-age-badge')).toHaveLength(0);
    expect(one(view.all((n) => n.props.testID === 'airport-refresh-weather')).props.accessibilityState).toMatchObject({
      busy: true,
    });
    expect(view.text()).not.toContain('MVFR');
    expect(one(view.all((n) => n.props.testID === 'airport-title')).props.accessibilityLabel).toBe(
      'KSQL, San Carlos Airport',
    );
  });

  it('failed load: notice, message and Retry', async () => {
    const { view, actions } = await show({ weather: { metar: null, errorMessage: 'The network is offline.' } });
    expect(view.text()).toContain('Weather not loaded');
    expect(view.text()).toContain('The network is offline.');
    await press(view.byTestId('weather-error-retry'));
    expect(actions.refreshWeather).toHaveBeenCalledWith('KSQL');
  });

  it('failed refresh keeps the last report under the notice', async () => {
    const { view } = await show({ weather: { errorMessage: 'Timed out' } });
    expect(view.text()).toContain('Weather refresh failed. Showing the last report.');
    expect(view.text()).toContain('Calm');
  });

  it('unpublished and absent METARs', async () => {
    let { view } = await show({ weather: { metar: null, metarPublished: false, tafFailed: false } });
    expect(view.text()).toContain('No METAR is published for this aerodrome. The forecast (TAF) is below.');
    ({ view } = await show({ weather: { metar: null, metarPublished: false, tafPublished: false, tafFailed: false } }));
    expect(view.text()).toContain('No METAR or TAF is published for this aerodrome.');
    ({ view } = await show({ weather: { metar: null, tafFailed: false } }));
    expect(view.text()).toContain('No METAR for this airport.');
  });

  it('stale and expired METAR badges', async () => {
    let { view } = await show({}, { now: KSQL_NOW + 90 * 60_000 });
    expect(one(view.all((n) => n.props.testID === 'data-age-badge')).props.accessibilityValue).toEqual({
      text: 'OLD 1h 42m',
    });
    ({ view } = await show({}, { now: KSQL_NOW + 4 * 3_600_000 }));
    expect(one(view.all((n) => n.props.testID === 'data-age-badge')).props.accessibilityValue).toEqual({
      text: 'EXPIRED',
    });
  });

  it('TAF present with its badge and failed-refresh note; absent shows nothing', async () => {
    const taf = 'TAF KSQL 082320Z 0900/0924 VRB03KT P6SM SKC';
    let { view } = await show({ weather: { taf, tafFetchedAt: KSQL_NOW - 5 * 60_000, tafFailed: true } });
    expect(view.text()).toContain(taf);
    expect(view.text()).toContain('TAF refresh failed. Showing the last forecast.');
    expect(view.text()).not.toContain('TAF not loaded');
    expect(view.byTestId('taf-age-badge')).toBeTruthy();
    ({ view } = await show({ weather: { tafFailed: false } }));
    expect(view.text()).not.toContain('TAF not loaded');
    expect(view.all((n) => n.props.testID === 'taf-age-badge')).toHaveLength(0);
    expect(view.all((n) => n.props.testID === 'airport-taf-text')).toHaveLength(0);
  });
});

describe('frequencies, runways, names', () => {
  it('no frequencies and no runways', async () => {
    const { view } = await show({
      airport: { frequencies: [], ctafFrequency: null, unicomFrequency: null, runways: [] },
    });
    expect(view.text()).toContain('No frequencies available');
    expect(view.text()).toContain('No runway data available');
  });

  it('CTAF / UNICOM fallback rows', async () => {
    const { view } = await show({ airport: { frequencies: [], ctafFrequency: 122.8, unicomFrequency: null } });
    expect(
      host(view.all((n) => n.props.testID === 'airport-frequency')).map((n) => n.props.accessibilityLabel),
    ).toEqual(['C TAF']);
  });

  it('unusual surfaces and widths', async () => {
    const base = KSQL_COLUMN.airport!.runways[0]!;
    const { view } = await show({
      airport: {
        runways: [
          { ...base, id: 'NW/SE', length: 12001, width: 1000, surface: 'water' },
          { ...base, id: 'H1', length: 40, width: 0, surface: 'other' },
        ],
      },
    });
    expect(view.text()).toContain("12,001' x 1,000'");
    expect(view.text()).toContain('Water');
    expect(view.text()).toContain("40' x 0'");
    expect(host(view.all((n) => n.props.testID === 'airport-runway')).map((n) => n.props.accessibilityLabel)).toEqual([
      'Runway NW/SE',
      'Runway H1',
    ]);
  });

  it('long and Hebrew names wrap to two lines at most', async () => {
    const long = 'Northern California Regional Executive and General Aviation Reliever Airport at San Carlos';
    let { view } = await show({ airport: { name: long } });
    const name = (text: string) => one(view.all((n) => n.type === 'Text' && n.props.children === text));
    expect(name(long).props.numberOfLines).toBe(2);
    ({ view } = await show({ airport: { name: '\u05D4\u05E8\u05E6\u05DC\u05D9\u05D4' } }));
    expect(name('\u05D4\u05E8\u05E6\u05DC\u05D9\u05D4').props.numberOfLines).toBe(2);
  });

  it('pattern altitude and fuel chips drop out; unpublished elevation says so', async () => {
    const { view } = await show({ airport: { patternAltitude: null, fuelTypes: [] }, elevationPublished: false });
    expect(view.text()).not.toContain('TPA');
    expect(view.all((n) => n.props.testID === 'airport-chip-fuel')).toHaveLength(0);
    expect(view.text()).toContain('ELEV not published');
  });
});

describe('NOTAM hint and charts', () => {
  it('no hint once a NOTAM key is set (the list is U4b)', async () => {
    const { view } = await show({ notamKeyConfigured: true });
    expect(view.text()).not.toContain('NOTAMS');
  });

  it('charts loading, failed with Retry, empty, expired, long list', async () => {
    let { view, actions } = await show({ charts: { state: 'loading' } });
    expect(view.text()).toContain('Loading charts...');
    ({ view, actions } = await show({ charts: { state: 'failed', message: 'Chart index unavailable offline.' } }));
    expect(view.text()).toContain('Chart index unavailable offline.');
    await press(view.byTestId('airport-charts-retry'));
    expect(actions.retryCharts).toHaveBeenCalledWith('KSQL');
    const cycle = { code: '2611', effective: 0, expires: Date.UTC(2026, 10, 26, 9, 1) };
    ({ view } = await show({ charts: { state: 'loaded', cycle, charts: [] } }));
    expect(view.text()).toContain('No FAA charts for this airport.');
    expect(view.text()).not.toContain('Cycle 2611');
    const many = Array.from({ length: 30 }, (_, i) => ({
      chartCode: i % 2 ? 'IAP' : 'DP',
      name: `PROCEDURE ${i}`,
      pdfName: `P${i}.PDF`,
      cycle: '2611',
    }));
    ({ view } = await show({ charts: { state: 'loaded', cycle, charts: many } }, { now: cycle.expires }));
    expect(view.text()).toContain('Charts expired 11/26. Do not use for navigation.');
    expect(host(view.all((n) => n.props.testID === 'airport-chart'))).toHaveLength(30);
    expect(view.text().indexOf('Approaches')).toBeLessThan(view.text().indexOf('Departures'));
  });

  it('no NOTAM or chart sections in Israel', async () => {
    const { view } = await show({}, { region: 'israel' });
    expect(view.text()).not.toContain('NOTAMS');
    expect(view.text()).not.toContain('FAA CHARTS');
    expect(view.text()).toContain('1022 hPa');
  });
});

describe('without an airport record', () => {
  it('an Israeli station shows its weather and the station-only note', async () => {
    const { view } = await show(
      { airport: null, weather: { metar: null, isLoading: true } },
      { region: 'israel' },
      'LLHZ',
    );
    expect(view.text()).toContain('LLHZ');
    expect(view.text()).toContain('Herzliya');
    expect(view.text()).toContain('Loading weather...');
    expect(view.text()).toContain('Airport data for Israel is not available yet.');
    expect(view.all((n) => n.props.testID === 'airport-direct-to')).toHaveLength(0);
  });

  it('loading while nothing is known yet', async () => {
    const { element, store } = setup();
    store.setState({ columns: {} });
    appStore.setState({ selectedAirportId: 'KPAO' });
    const view = await render(element);
    expect(view.text()).toContain('KPAO');
    expect(view.text()).toContain('Loading airport...');
  });
});
