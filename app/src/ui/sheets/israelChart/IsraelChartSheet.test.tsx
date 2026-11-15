// The Israel CVFR chart tap sheet over the FAKE fixture: every field IsraelChartSheets.swift shows for a reporting
// point and for overlapping airspaces, the empty cases, and Done. No Swift test targets the sheet view itself.
import { StyleSheet } from 'react-native';
import type { IsraelChartSelection } from '../../../domain/map/israel';
import { press, render } from '../../../../tests/support/ui';
import { AERODROME_SELECTION, AIRSPACES_SELECTION, LONELY_POINT_SELECTION, POINT_SELECTION } from './fixture';
import { IsraelChartSheet } from './IsraelChartSheet';

const show = (selection: IsraelChartSelection, onClose = jest.fn()) =>
  render(<IsraelChartSheet selection={selection} onClose={onClose} />);

describe('IsraelChartSheet', () => {
  describe('reporting point', () => {
    it('shows the code, both names and the kind', async () => {
      const view = await show(POINT_SELECTION);
      expect(view.byTestId('israel-chart-point-code').props.children).toBe('SHARO');
      expect(view.byTestId('israel-chart-point-name').props.children).toBe('Sharon Junction');
      const hebrew = view.byTestId('israel-chart-point-hebrew');
      expect(hebrew.props.children).toBe('צומת השרון');
      expect(StyleSheet.flatten(hebrew.props.style).writingDirection).toBe('rtl');
      expect(view.text()).toContain('Compulsory reporting point');
    });

    it('lists every direction under the section header with altitude, route type and closures', async () => {
      const view = await show(POINT_SELECTION);
      const header = view.byRole('header');
      expect(header.map((h) => h.props.children)).toEqual(['ROUTE SEGMENTS (ALTITUDE FT MSL, PUBLISHED)']);
      const rows = view.all((n) => n.props.testID === 'israel-chart-segment');
      expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
        'SHARO \u2192 DEROR, 2000 ft, Civil, CLSD 1500-2000 ft to 16:00Z, EXC ACFT WITH PRIOR COORDINATION',
        'SHARO \u2192 HADRA, 1500/2500 ft, By request (ATC approval), CLSD to 13:30Z',
        'SHARO \u2192 OLGAA, 1000 ft, Military (IAF approval)',
        'DEROR \u2192 SHARO, 1500 ft, Civil, CLSD 1500-2000 ft to 16:00Z, EXC ACFT WITH PRIOR COORDINATION',
        'HADRA \u2192 SHARO, none published, By request (ATC approval), CLSD to 13:30Z',
        'OLGAA \u2192 SHARO, 1000 ft, Military (IAF approval)',
      ]);
      const text = view.text();
      for (const shown of [
        'SHARO \u2192 HADRA',
        '1500/2500 ft',
        'none published',
        'By request (ATC approval)',
        'Military (IAF approval)',
        'CLSD to 13:30Z',
        'EXC ACFT WITH PRIOR COORDINATION',
      ]) {
        expect(text).toContain(shown);
      }
      // 44 pt rows (minHeight), one combined element each.
      expect(StyleSheet.flatten(rows[0]!.props.style).minHeight).toBe(44);
      expect(rows.every((r) => r.props.accessible === true)).toBe(true);
    });

    it('draws a full closure red and a partial one amber', async () => {
      const view = await show(POINT_SELECTION);
      expect(view.all((n) => n.props.testID === 'israel-chart-closure-full')).toHaveLength(2);
      expect(view.all((n) => n.props.testID === 'israel-chart-closure-partial')).toHaveLength(2);
    });

    it('says no segment ends here and hides the names a point lacks', async () => {
      const view = await show(LONELY_POINT_SELECTION);
      expect(view.byTestId('israel-chart-no-segments').props.children).toBe('No CVFR route segment ends here.');
      expect(view.byRole('header')).toHaveLength(0);
      expect(view.all((n) => n.props.testID === 'israel-chart-segment')).toHaveLength(0);
      expect(view.all((n) => n.props.testID === 'israel-chart-point-name')).toHaveLength(0);
      expect(view.all((n) => n.props.testID === 'israel-chart-point-hebrew')).toHaveLength(0);
      expect(view.text()).toContain('Sport-aviation route end (not a published point)');
    });
  });

  describe('airspaces', () => {
    it('shows each airspace in order, separated by dividers', async () => {
      const view = await show(AIRSPACES_SELECTION);
      const blocks = view.all((n) => n.props.testID === 'israel-chart-airspace');
      expect(blocks.map((b) => (b.props.accessibilityLabel as string).split(', ')[0])).toEqual([
        'LLR104',
        'Hof Dor',
        'LLBG TMA',
      ]);
      expect(view.all((n) => n.props.testID === 'israel-chart-divider')).toHaveLength(2);
    });

    it('shows title, names, type, ceiling, floor, authority, chart text and the inferred-reference note', async () => {
      const view = await show(AIRSPACES_SELECTION);
      const [restricted, danger, tma] = view.all((n) => n.props.testID === 'israel-chart-airspace');
      expect(restricted!.props.accessibilityLabel).toBe(
        'LLR104, Palmachim, פלמחים, R (restricted area), Ceiling, 3000/3500 ft (as published), Floor, SFC (ground), Authority, Military',
      );
      // English name equal to the title is not repeated; nothing optional is shown.
      expect(danger!.props.accessibilityLabel).toBe('Hof Dor, D (danger area), Ceiling, FL95, Floor, not published');
      expect(tma!.props.accessibilityLabel).toMatch(
        /^LLBG TMA, Ben Gurion TMA 2, אזור פיקוח מסוף בן גוריון 2, TMA \(terminal control area\), Ceiling, 8000 ft MSL, Floor, 2500 ft MSL, Authority, Civil, Chart text, LLBG TMA 2 500 - 8 000, Altitude reference \(MSL\) is inferred/,
      );

      const text = view.text();
      for (const shown of ['Ceiling', 'Floor', 'Authority', 'Chart text', 'LLBG TMA 2 500 - 8 000', 'FL95']) {
        expect(text).toContain(shown);
      }
      expect(view.all((n) => n.props.testID === 'israel-chart-airspace-name').map((n) => n.props.children)).toEqual([
        'Palmachim',
        'Ben Gurion TMA 2',
      ]);
      const hebrew = view.all((n) => n.props.testID === 'israel-chart-airspace-hebrew');
      expect(hebrew).toHaveLength(2);
      expect(StyleSheet.flatten(hebrew[0]!.props.style).writingDirection).toBe('rtl');
      expect(view.all((n) => n.props.testID === 'israel-chart-airspace-authority')).toHaveLength(2);
      expect(view.all((n) => n.props.testID === 'israel-chart-airspace-rawText')).toHaveLength(1);
      // Only the TMA's MSL limits are inferred; the restricted area's are SFC and published text.
      expect(view.all((n) => n.props.testID === 'israel-chart-reference-note')).toHaveLength(1);
      expect(text).toContain(
        'Altitude reference (MSL) is inferred from the AIP; the CAAI data does not state it. Check the AIP.',
      );
    });

    it('draws ceiling and floor semibold, authority regular', async () => {
      const view = await show(AIRSPACES_SELECTION);
      const weight = (id: string) =>
        StyleSheet.flatten(view.all((n) => n.props.testID === id)[0]!.props.style).fontWeight;
      expect(weight('israel-chart-airspace-ceiling')).toBe('600');
      expect(weight('israel-chart-airspace-floor')).toBe('600');
      expect(weight('israel-chart-airspace-authority')).toBeUndefined();
    });
  });

  it('renders an empty body for an aerodrome, which opens the airport sheet instead', async () => {
    const view = await show(AERODROME_SELECTION);
    expect(view.byTestId('israel-chart-sheet')).toBeTruthy();
    expect(view.text()).toBe('Done');
  });

  it('calls onClose from Done', async () => {
    const onClose = jest.fn();
    const view = await show(POINT_SELECTION, onClose);
    await press(view.byTestId('israel-chart-done'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
