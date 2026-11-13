// BriefingOverMap: the sheet content waits for the bundled faces (Android measured the Feed label in a fallback face and
// clipped it to "Fee" when it rendered before they loaded).
import { useFonts } from 'expo-font';
import { render } from '../../../../tests/support/ui';
import { BriefingOverMap } from './BriefingOverMap';

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: jest.fn(() => [true, null]) }));
jest.mock('../../screens/MapScreen', () => ({ MapScreen: () => null }));

const mockedUseFonts = useFonts as jest.Mock;

describe('BriefingOverMap', () => {
  afterEach(() => mockedUseFonts.mockImplementation(() => [true, null]));

  it('renders the briefing once the faces are loaded', async () => {
    const view = await render(<BriefingOverMap />);
    expect(view.text()).toContain('NOTAM briefing');
    expect(view.byTestId('briefing-feed-label')).toBeTruthy();
  });

  it('renders nothing of the sheet while the faces are loading', async () => {
    mockedUseFonts.mockImplementation(() => [false, null]);
    const view = await render(<BriefingOverMap />);
    expect(view.text()).not.toContain('NOTAM briefing');
    expect(view.all((n) => n.props?.testID === 'briefing-feed-label')).toHaveLength(0);
  });

  it('renders it when the faces failed to load: a missing face must not hide the sheet', async () => {
    mockedUseFonts.mockImplementation(() => [false, new Error('font')]);
    const view = await render(<BriefingOverMap />);
    expect(view.text()).toContain('NOTAM briefing');
  });
});
