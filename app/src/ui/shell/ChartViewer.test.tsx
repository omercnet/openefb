import { act } from 'react';
import { press, render } from '../../../tests/support/ui';
import { StyleSheet } from 'react-native';
import { layers } from '../columns/layers/store';
import { Night } from '../tokens';
import { appStore } from '../state/appStore';
import { ChartViewer } from './ChartViewer';

jest.mock('../map/ChartPdfView', () => ({ ChartPdfView: () => null }));

const chart = { chartCode: 'APD', name: 'AIRPORT DIAGRAM', pdfName: '00375AD.PDF', cycle: '2611' };

describe('ChartViewer', () => {
  beforeEach(() => appStore.setState({ chartViewer: null }));

  it('shows the chart the column opened, and Done closes it', async () => {
    const view = await render(<ChartViewer terminal={{ pdfPath: async () => '/x.pdf' }} />);
    await act(async () => appStore.getState().openChartViewer(chart));
    expect(view.text()).toContain('AIRPORT DIAGRAM');
    await press(view.byTestId('chart-viewer-done'));
    expect(appStore.getState().chartViewer).toBeNull();
  });

  it('follows the night palette of the map', async () => {
    layers.store.setState({ displayMode: 'night' });
    const view = await render(<ChartViewer terminal={{ pdfPath: async () => '/x.pdf' }} />);
    await act(async () => appStore.getState().openChartViewer(chart));
    const painted = view.all((n) => StyleSheet.flatten(n.props?.style)?.backgroundColor === Night.paper);
    expect(painted.length).toBeGreaterThan(0);
    layers.store.setState({ displayMode: 'auto' });
  });
});
