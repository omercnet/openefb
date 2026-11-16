import { render } from '../../../tests/support/ui';
import { AlertsCapture, AloftCapture, ChartSheetCapture, UsPlanCapture } from './MountedCaptures';

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../map/MapSurface', () => ({ MapSurface: () => null }));
jest.mock('../../adapters/glyphInstall', () => ({
  useLocalGlyphs: () => ({ status: 'ready', url: 'file:///g/{fontstack}/{range}.pbf' }),
}));
jest.mock('../../adapters/aviationDb', () => ({ openAviationDatabase: () => new Promise(() => undefined) }));
jest.mock('../map/mapStatus', () => ({ getCurrentMapStatus: () => null }));
jest.mock('react-native/Libraries/Settings/Settings', () => ({ __esModule: true, default: { get: () => undefined } }));

const has = (view: Awaited<ReturnType<typeof render>>, text: string) => view.text().includes(text);

describe('capture routes of the screens mounted in I1d', () => {
  it('usplan: the planner with a KPAO to KSQL plan and the saved plans', async () => {
    const view = await render(<UsPlanCapture />);
    expect(has(view, 'KPAO')).toBe(true);
    expect(has(view, 'KSQL')).toBe(true);
    expect(view.text()).toContain('Flight Plans'); // the pushed screen's large title
    expect(view.byTestId('planner-back')).toBeTruthy(); // and the way back
  });

  it('chartsheet and chartairspace: the CVFR chart sheet for a point and for airspaces', async () => {
    const point = await render(<ChartSheetCapture />);
    const area = await render(<ChartSheetCapture airspaces />);
    expect(point.text()).not.toBe(area.text());
    expect(has(point, 'Done')).toBe(true);
  });

  it('aloft: PIREPs and winds aloft', async () => {
    const view = await render(<AloftCapture />);
    expect(has(view, 'PIREPS')).toBe(true);
    expect(has(view, 'WINDS ALOFT')).toBe(true);
  });

  it('alerts: the Israel alert banner and the airspace check notice on the strip', async () => {
    const view = await render(<AlertsCapture />);
    expect(has(view, 'Inside prohibited area LLP-1')).toBe(true);
    expect(has(view, 'Airspace check unavailable')).toBe(true);
  });
});
