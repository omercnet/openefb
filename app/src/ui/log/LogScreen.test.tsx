import { useFonts } from 'expo-font';
import { render, type Rendered } from '../../../tests/support/ui';
import LogRoute from '../../app/log';
import { LogScreen } from '../screens/LogScreen';
import { dayFixture } from '../flightLog/fixtures';
import { Day, Night } from '../tokens';
import { NowProvider } from './clock';
import { LogReference } from './LogReference';

// The real provider waits for native inset events; the library's mock reports zero insets at once (as web does).
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
// Fonts count as loaded unless a test says otherwise.
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: jest.fn(() => [true, null]) }));

describe('LogScreen', () => {
  it('the log route renders the reference Log (reference/ipad-log.png) on the Day paper, under the 32 pt band', async () => {
    const view = await render(<LogRoute />);
    expect(view.text()).toContain('Log Next Plan a flight Now Flight REC 0:00:05 Flown No flights yet');
    expect(view.text()).toContain('Totals 0 flights 0.0 h');
    const page = view.all((n) => n.type === 'View' && n.props.style?.paddingTop === 32)[0];
    expect(page.props.style).toMatchObject({ flex: 1, backgroundColor: Day.paper });
  });

  // The shared slice's default is the map reference (dayFixture): Direct-To KOAK, recording 6 s, 552 s to KOAK, a fix
  // taken at its nowMs.
  const nowRow = (view: Rendered) => view.byTestId('log-now-row');

  it('without the reference stores the Log follows the shared flight log slice: Direct-To KOAK with its ETE', async () => {
    const view = await render(
      <NowProvider value={dayFixture.nowMs}>
        <LogScreen />
      </NowProvider>,
    );
    expect(view.text()).toContain('Now Direct KOAK REC 0:00:06 Next KOAK 0:09 Flown');
    expect(nowRow(view).props.accessibilityLabel).toBe('Now, Direct KOAK, REC 0:00:06, next KOAK, time to next 0h 9m');
  });

  it('the same slice 6 s later: the fix is stale and the ETE is dashed', async () => {
    const view = await render(
      <NowProvider value={dayFixture.nowMs + 6000}>
        <LogScreen />
      </NowProvider>,
    );
    expect(view.text()).toContain('Now Direct KOAK REC 0:00:06 Next KOAK ETE --- Flown');
    expect(nowRow(view).props.accessibilityLabel).toBe(
      'Now, Direct KOAK, REC 0:00:06, next KOAK, time to next unavailable',
    );
  });

  it('takes a theme: Night paper and night glass buttons', async () => {
    const view = await render(
      <LogReference>
        <LogScreen theme={Night} />
      </LogReference>,
    );
    const page = view.all((n) => n.type === 'View' && n.props.style?.paddingTop === 32)[0];
    expect(page.props.style).toMatchObject({ backgroundColor: Night.paper });
    const map = Object.assign({}, ...[view.byTestId('log-map-button').props.style].flat(Infinity).filter(Boolean));
    expect(map.backgroundColor).toBe(Night.paperSecondary);
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
