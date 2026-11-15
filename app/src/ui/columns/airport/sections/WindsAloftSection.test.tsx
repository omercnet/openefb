// Render tests for every state of WindsAloftSection.swift (no Swift view tests exist): loading (also over a report),
// failed with Retry, the report (station line, VALID badge, period line, grid, light and variable span, blank levels
// with the footnote), an empty level list, stale (outside the FOR USE window: notice and EXPIRED badge; NOT YET VALID;
// no window), the forecast picker and the `.task(id: icao-forecast)` load callback.
import { StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';
import { press, render, type Rendered } from '../../../../../tests/support/ui';
import { Day } from '../../../tokens';
import { ALS_REPORT, KDEN, SFO_REPORT, UNTIMED_REPORT, WINDS_AFTER_FOR_USE, WINDS_NOW } from './fixture';
import { WindsAloftSection, type WindsAloftSectionProps } from './WindsAloftSection';

function element(over: Partial<WindsAloftSectionProps> = {}) {
  const props: WindsAloftSectionProps = {
    airport: KDEN,
    forecast: 6,
    onSelectForecast: jest.fn(),
    loading: false,
    error: null,
    report: SFO_REPORT,
    now: WINDS_NOW,
    onRetry: jest.fn(),
    onLoad: jest.fn(),
    ...over,
  };
  return { props, el: <WindsAloftSection {...props} /> };
}

async function show(over: Partial<WindsAloftSectionProps> = {}) {
  const { props, el } = element(over);
  return { props, view: await render(el) };
}

const host = (nodes: TestInstance[]) => nodes.filter((n) => typeof n.type === 'string');
const byId = (view: Rendered, id: string) => host(view.all((n) => n.props.testID === id));
const textOf = (node: TestInstance): string =>
  node.children
    .map((c) => (typeof c === 'string' ? c : textOf(c)))
    .filter((s) => s !== '')
    .join(' ');
const badge = (view: Rendered) => host(view.all((n) => n.props.testID === 'data-age-badge'));
/** The text cells of each level row. */
const cells = (view: Rendered) =>
  byId(view, 'winds-level').map((row) => host(row.queryAll((n) => n.type === 'Text')).map(textOf));

describe('WindsAloftSection', () => {
  it('has the WINDS ALOFT header and the 6 / 12 / 24 h picker', async () => {
    const { view, props } = await show({ forecast: 12 });
    expect(host(view.byRole('header')).map(textOf)).toContain('WINDS ALOFT');
    const segments = host(
      view.all(
        (n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Forecast, '),
      ),
    );
    expect(segments.map((s) => s.props.accessibilityLabel)).toEqual([
      'Forecast, 6 h',
      'Forecast, 12 h',
      'Forecast, 24 h',
    ]);
    expect(segments.map((s) => s.props.accessibilityState.selected)).toEqual([false, true, false]);
    await press(segments[2]!);
    expect(props.onSelectForecast).toHaveBeenCalledWith(24);
  });

  it('spins while loading, also over a report (Swift sets .loading on every load)', async () => {
    for (const report of [null, SFO_REPORT]) {
      const { view } = await show({ loading: true, report });
      expect(byId(view, 'winds-loading')).toHaveLength(1);
      expect(byId(view, 'winds-report')).toHaveLength(0);
    }
  });

  it('shows the failure with Retry', async () => {
    const { view, props } = await show({ error: 'the station is not in the bulletin', report: null });
    expect(view.text()).toContain('Winds aloft not loaded: the station is not in the bulletin');
    expect(byId(view, 'winds-report')).toHaveLength(0);
    await press(byId(view, 'winds-error-retry')[0]!);
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the station, a VALID badge inside the FOR USE window, and the period line', async () => {
    const { view } = await show();
    const station = byId(view, 'winds-station')[0]!;
    expect(textOf(station)).toBe('SFO \u00b7 San Francisco \u00b7 15 NM');
    expect(station.props.accessibilityLabel).toBe('Station SFO, San Francisco, 15 nautical miles');
    expect(badge(view).map((b) => [b.props.accessibilityLabel, b.props.accessibilityValue.text])).toEqual([
      ['Winds aloft age', 'VALID'],
    ]);
    expect(textOf(byId(view, 'winds-period')[0]!)).toBe(
      'Valid 301800Z \u00b7 For use 1400Z\u20132100Z \u00b7 Issued 1400Z',
    );
    expect(byId(view, 'winds-outside-for-use')).toHaveLength(0);
  });

  it('draws the grid: headings, one row per level, forecast levels in the primary colour', async () => {
    const { view } = await show();
    const heading = byId(view, 'winds-grid-heading')[0]!;
    expect(heading.props.accessibilityLabel).toBe(
      'Altitude feet MSL, direction degrees true, speed knots, temperature Celsius',
    );
    expect(host(heading.queryAll((n) => n.type === 'Text')).map(textOf)).toEqual([
      'ALT (ft MSL)',
      'DIR (\u00b0T)',
      'SPD (kt)',
      'TEMP (\u00b0C)',
    ]);
    const rows = cells(view);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toEqual(['3,000', '210', '6', '\u2014']);
    expect(rows[3]).toEqual(['12,000', '230', '16', '-7']);
    expect(rows[8]).toEqual(['39,000', '230', '48', '-62']);
    const first = byId(view, 'winds-level')[0]!;
    expect(first.props).toMatchObject({
      accessibilityLabel: '3,000 feet',
      accessibilityValue: { text: 'wind 210 degrees at 6 knots' },
    });
    const colour = StyleSheet.flatten(host(first.queryAll((n) => n.type === 'Text'))[0]!.props.style).color;
    expect(colour).toBe(Day.primaryText);
    expect(byId(view, 'winds-blank-note')).toHaveLength(0);
  });

  it('greys blank levels, spans light and variable, and adds the elevation footnote', async () => {
    const { view } = await show({ report: ALS_REPORT });
    const rows = cells(view);
    expect(rows[0]).toEqual(['3,000', '\u2014', '\u2014', '\u2014']);
    expect(rows[3]).toEqual(['12,000', 'Light & variable', '2']);
    const blank = byId(view, 'winds-level')[0]!;
    expect(blank.props.accessibilityValue).toEqual({ text: 'not forecast' });
    expect(StyleSheet.flatten(host(blank.queryAll((n) => n.type === 'Text'))[0]!.props.style).color).toBe(
      Day.secondaryText,
    );
    expect(byId(view, 'winds-level')[3]!.props.accessibilityValue).toEqual({
      text: 'wind light and variable, temperature 2 degrees Celsius',
    });
    expect(textOf(byId(view, 'winds-blank-note')[0]!)).toBe(
      '\u2014 Not forecast within 1,500 ft of station elevation (7,535 ft MSL).',
    );
  });

  it('shows only the headings for a report without levels', async () => {
    const { view } = await show({ report: { ...SFO_REPORT, levels: [] } });
    expect(byId(view, 'winds-grid-heading')).toHaveLength(1);
    expect(byId(view, 'winds-level')).toHaveLength(0);
    expect(byId(view, 'winds-blank-note')).toHaveLength(0);
  });

  it('goes stale after the FOR USE window: caution notice and EXPIRED badge', async () => {
    const { view } = await show({ now: WINDS_AFTER_FOR_USE });
    expect(textOf(byId(view, 'winds-outside-for-use')[0]!)).toBe("Outside the forecast's for-use period");
    expect(badge(view)[0]!.props.accessibilityValue.text).toBe('EXPIRED');
    expect(cells(view)).toHaveLength(9); // the data stays readable
  });

  it('reads NOT YET VALID before the window opens', async () => {
    const { view } = await show({ now: Date.parse('2026-10-30T13:00:00Z') });
    expect(byId(view, 'winds-outside-for-use')).toHaveLength(1);
    expect(badge(view)[0]!.props.accessibilityValue.text).toBe('NOT YET VALID');
  });

  it('reads N/A and the period label when the bulletin carries no times', async () => {
    const { view } = await show({ report: UNTIMED_REPORT });
    expect(badge(view)[0]!.props.accessibilityValue.text).toBe('N/A');
    expect(textOf(byId(view, 'winds-period')[0]!)).toBe('6 h forecast');
    expect(byId(view, 'winds-outside-for-use')).toHaveLength(1);
  });

  it('loads on appear and when the airport or the period changes', async () => {
    const onLoad = jest.fn();
    const view = await render(element({ onLoad }).el);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenLastCalledWith(KDEN, 6);
    await view.update(element({ onLoad, now: WINDS_NOW + 60_000 }).el);
    expect(onLoad).toHaveBeenCalledTimes(1);
    await view.update(element({ onLoad, forecast: 24 }).el);
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(onLoad).toHaveBeenLastCalledWith(KDEN, 24);
    const kbjc = { icao: 'KBJC', latitude: 39.9088, longitude: -105.1172 };
    await view.update(element({ onLoad, forecast: 24, airport: kbjc }).el);
    expect(onLoad).toHaveBeenCalledTimes(3);
    expect(onLoad).toHaveBeenLastCalledWith(kbjc, 24);
  });
});
