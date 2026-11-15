import { act } from 'react';
import { press, render } from '../../../tests/support/ui';
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
});
