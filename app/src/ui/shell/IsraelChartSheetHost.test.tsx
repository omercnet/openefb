import { render } from '../../../tests/support/ui';
import { AIRSPACES_SELECTION, POINT_SELECTION } from '../sheets/israelChart/fixture';
import { IsraelChartSheet } from '../sheets/israelChart/IsraelChartSheet';
import { IsraelChartSheetHost, type ChartSheetSelection } from './IsraelChartSheetHost';

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('../sheets/briefing/BriefingPresentation', () => ({
  BriefingPresentation: ({ presented, children }: { presented: boolean; children: React.ReactNode }) =>
    presented ? children : null,
}));
jest.mock('../sheets/israelChart/IsraelChartSheet', () => ({ IsraelChartSheet: jest.fn(() => null) }));

describe('the Israel chart sheet over the map', () => {
  it('shows nothing until a point or the airspaces were tapped, then the sheet for it, and Done closes it', async () => {
    const onClose = jest.fn();
    const sheet = jest.mocked(IsraelChartSheet);
    sheet.mockClear();
    const view = await render(<IsraelChartSheetHost selection={null} onClose={onClose} />);
    expect(sheet).not.toHaveBeenCalled();
    await view.unmount();
    await render(<IsraelChartSheetHost selection={POINT_SELECTION as ChartSheetSelection} onClose={onClose} />);
    expect(sheet.mock.calls.at(-1)![0].selection).toBe(POINT_SELECTION);
    sheet.mock.calls.at(-1)![0].onClose();
    expect(onClose).toHaveBeenCalled();
    await render(<IsraelChartSheetHost selection={AIRSPACES_SELECTION as ChartSheetSelection} onClose={onClose} />);
    expect(sheet.mock.calls.at(-1)![0].selection).toBe(AIRSPACES_SELECTION);
  });
});
