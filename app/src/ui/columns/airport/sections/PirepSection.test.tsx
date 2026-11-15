// Render tests for every state of PirepSection.swift (no Swift view tests exist): loading, failed with Retry, empty, the
// list (urgent styling, decoded lines, location, age badges), stale (OLD / EXPIRED badges), a refresh over a loaded
// list, the raw report disclosure and the `.task(id: airport.icao)` load callback.
import { StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';
import { press, render, type Rendered } from '../../../../../tests/support/ui';
import { withAlpha } from '../../../flights/alpha';
import { Day } from '../../../tokens';
import { AIREP_UAL, E75S, F2TH, KDEN, PIREPS, PIREP_NOW, URGENT_CL30 } from './fixture';
import { PirepSection, type PirepSectionProps } from './PirepSection';

function element(over: Partial<PirepSectionProps> = {}) {
  const props: PirepSectionProps = {
    airport: KDEN,
    loading: false,
    error: null,
    pireps: PIREPS,
    now: PIREP_NOW,
    onRetry: jest.fn(),
    onLoad: jest.fn(),
    ...over,
  };
  return { props, el: <PirepSection {...props} /> };
}

async function show(over: Partial<PirepSectionProps> = {}) {
  const { props, el } = element(over);
  return { props, view: await render(el) };
}

/** Host nodes only (the composite Pressable / View above them carries the same props). */
const host = (nodes: TestInstance[]) => nodes.filter((n) => typeof n.type === 'string');
const byId = (view: Rendered, id: string) => host(view.all((n) => n.props.testID === id));
const textOf = (node: TestInstance): string =>
  node.children
    .map((c) => (typeof c === 'string' ? c : textOf(c)))
    .filter((s) => s !== '')
    .join(' ');

describe('PirepSection', () => {
  it('has the PIREPS header and a refresh button that reloads', async () => {
    const { view, props } = await show();
    const header = host(view.byRole('header'));
    expect(header.map(textOf)).toContain('PIREPS');
    const refresh = byId(view, 'pirep-refresh');
    expect(refresh).toHaveLength(1);
    expect(refresh[0]!.props.accessibilityLabel).toBe('Refresh PIREPs');
    await press(refresh[0]!);
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('spins before the first result', async () => {
    const { view } = await show({ loading: true, pireps: null });
    expect(byId(view, 'pirep-loading')).toHaveLength(1);
    expect(byId(view, 'pirep-row')).toHaveLength(0);
    expect(byId(view, 'pirep-refresh')[0]!.props.accessibilityState).toMatchObject({ busy: true });
  });

  it('shows the failure with Retry instead of the list', async () => {
    const { view, props } = await show({ error: 'The request timed out.' });
    expect(view.text()).toContain('PIREPs not loaded: The request timed out.');
    expect(byId(view, 'pirep-row')).toHaveLength(0);
    const retry = byId(view, 'pirep-error-retry');
    expect(retry).toHaveLength(1);
    await press(retry[0]!);
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('says so when there are no reports', async () => {
    const { view } = await show({ pireps: [] });
    expect(textOf(byId(view, 'pirep-empty')[0]!)).toBe('No PIREPs within 50 NM in the last 2 hours.');
    expect(byId(view, 'pirep-row')).toHaveLength(0);
  });

  it('lists the reports newest first with their header, location and decoded lines', async () => {
    const { view } = await show({ pireps: [AIREP_UAL, URGENT_CL30, F2TH, E75S] });
    const rows = byId(view, 'pirep-row');
    expect(rows).toHaveLength(4);
    expect(byId(view, 'pirep-location').map(textOf)).toEqual([
      '30 NM W of KDEN \u00b7 PIREP',
      'Over KDEN \u00b7 PIREP',
      '20 NM NE of KDEN \u00b7 Urgent PIREP',
      '40 NM S of KDEN \u00b7 AIREP',
    ]);
    expect(byId(view, 'pirep-summary').map(textOf)).toEqual([
      'Turbulence: MOD CHOP, NEG',
      'Icing: LGT MIXED 23,000\u201325,000 ft',
      'Temp -23\u00b0C',
      'Wind 205\u00b0 33 kt',
    ]);
    const text = view.text();
    for (const s of ['32,000 ft MSL', 'E75S', '500 ft MSL (descending)', 'CL30', '30,000 ft MSL', 'UAL2164']) {
      expect(text).toContain(s);
    }
    expect(byId(view, 'pirep-row-header').map((n) => n.props.accessibilityLabel)).toEqual([
      '32,000 ft MSL, E75S, PIREP age 50 min',
      '23,000 ft MSL, F2TH, PIREP age 55 min',
      'URGENT, 500 ft MSL (descending), CL30, PIREP age OLD 1h 1m',
      '30,000 ft MSL, UAL2164, PIREP age OLD 1h 23m',
    ]);
  });

  it('highlights the urgent report in red: URGENT label, 15% warning fill, warning stroke', async () => {
    const { view } = await show();
    expect(byId(view, 'pirep-urgent')).toHaveLength(1);
    const styles = byId(view, 'pirep-row').map((n) => StyleSheet.flatten(n.props.style));
    const urgent = styles[2]!;
    expect(urgent).toMatchObject({
      backgroundColor: withAlpha(Day.warning, 0.15),
      borderColor: Day.warning,
      borderWidth: 1,
    });
    expect(styles[0]).toMatchObject({ backgroundColor: Day.fill, borderWidth: 0 });
  });

  it('gives each report its age badge: fresh under an hour, OLD after', async () => {
    const { view } = await show();
    const badges = host(view.all((n) => n.props.testID === 'data-age-badge'));
    expect(badges.map((b) => b.props.accessibilityValue.text)).toEqual(['50 min', '55 min', 'OLD 1h 1m', 'OLD 1h 23m']);
    expect(badges.every((b) => b.props.accessibilityLabel === 'PIREP age')).toBe(true);
  });

  it('turns a list left on screen stale as the clock runs: OLD, then EXPIRED', async () => {
    const { view } = await show({ now: PIREP_NOW + 2 * 3_600_000 });
    const badges = host(view.all((n) => n.props.testID === 'data-age-badge'));
    expect(badges.map((b) => b.props.accessibilityValue.text)).toEqual(['EXPIRED', 'EXPIRED', 'EXPIRED', 'EXPIRED']);
    const later = await show({ now: PIREP_NOW + 15 * 60_000 });
    const texts = host(later.view.all((n) => n.props.testID === 'data-age-badge')).map(
      (b) => b.props.accessibilityValue.text,
    );
    expect(texts).toEqual(['OLD 1h 5m', 'OLD 1h 10m', 'OLD 1h 16m', 'OLD 1h 38m']);
  });

  it('keeps the list on screen during a refresh', async () => {
    const { view } = await show({ loading: true });
    expect(byId(view, 'pirep-row')).toHaveLength(4);
    expect(byId(view, 'pirep-loading')).toHaveLength(0);
  });

  it('expands and collapses the raw report per row', async () => {
    const { view } = await show();
    expect(byId(view, 'pirep-raw-text')).toHaveLength(0);
    const toggles = byId(view, 'pirep-raw-toggle');
    expect(toggles).toHaveLength(4);
    expect(toggles[2]!.props.accessibilityValue).toEqual({ text: 'Collapsed' });
    await press(toggles[2]!);
    const raw = byId(view, 'pirep-raw-text');
    expect(raw.map(textOf)).toEqual([URGENT_CL30.rawText]);
    expect(raw[0]!.props.selectable).toBe(true);
    expect(byId(view, 'pirep-raw-toggle')[2]!.props.accessibilityValue).toEqual({ text: 'Expanded' });
    await press(byId(view, 'pirep-raw-toggle')[0]!);
    expect(byId(view, 'pirep-raw-text').map(textOf)).toEqual([E75S.rawText, URGENT_CL30.rawText]);
    await press(byId(view, 'pirep-raw-toggle')[2]!);
    expect(byId(view, 'pirep-raw-text').map(textOf)).toEqual([E75S.rawText]);
  });

  it('loads on appear and when the airport changes, not on every render', async () => {
    const onLoad = jest.fn();
    const { el } = element({ onLoad });
    const view = await render(el);
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenLastCalledWith(KDEN);
    await view.update(element({ onLoad, now: PIREP_NOW + 60_000, airport: { ...KDEN } }).el);
    expect(onLoad).toHaveBeenCalledTimes(1);
    const kbjc = { icao: 'KBJC', latitude: 39.9088, longitude: -105.1172 };
    await view.update(element({ onLoad, airport: kbjc }).el);
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(onLoad).toHaveBeenLastCalledWith(kbjc);
  });

  it('renders without an onLoad callback', async () => {
    const { view } = await show({ onLoad: undefined });
    expect(byId(view, 'pirep-row')).toHaveLength(4);
  });
});
