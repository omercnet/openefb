import { useFonts } from 'expo-font';
import { render } from '../../../tests/support/ui';
import { LogScreen } from '../screens/LogScreen';
import { Day } from '../tokens';

// The real provider waits for native inset events; the library's mock reports zero insets at once (as web does).
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
// Fonts count as loaded unless a test says otherwise.
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: jest.fn(() => [true, null]) }));

describe('LogScreen', () => {
  it('renders the reference Log full-screen on the Day paper, under the 32 pt status bar band', async () => {
    const view = await render(<LogScreen />);
    expect(view.text()).toContain('Log Next Plan a flight Now Flight REC 0:00:05 Flown No flights yet');
    expect(view.text()).toContain('Totals 0 flights 0.0 h');
    const page = view.all((n) => n.type === 'View' && n.props.style?.paddingTop === 32)[0];
    expect(page.props.style).toMatchObject({ flex: 1, backgroundColor: Day.paper });
  });

  it('shows only the bare paper until the bundled faces are registered', async () => {
    jest.mocked(useFonts).mockReturnValue([false, null]);
    try {
      const view = await render(<LogScreen />);
      expect(view.text()).toBe('');
    } finally {
      jest.mocked(useFonts).mockReturnValue([true, null]);
    }
  });
});
