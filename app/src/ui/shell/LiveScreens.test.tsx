import { act } from 'react';
import { press, render } from '../../../tests/support/ui';
import { appStore } from '../state/appStore';
import { LogbookEntryScreen } from '../screens/LogbookEntryScreen';
import { LiveScreens } from './LiveScreens';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../screens/LogScreen', () => ({ LogScreen: () => null }));
jest.mock('../screens/LogbookEntryScreen', () => ({ LogbookEntryScreen: jest.fn(() => null) }));
const entryScreen = jest.mocked(LogbookEntryScreen);

const has = (view: Awaited<ReturnType<typeof render>>, id: string) =>
  view.all((n) => n.props?.testID === id).length > 0;

beforeEach(() => {
  entryScreen.mockClear();
  appStore.setState({ selectedScreen: 'map', overlay: null });
});

describe('LiveScreens', () => {
  it('shows only the map until the log is opened, and the map again after', async () => {
    const view = await render(<LiveScreens logbookEntry={{} as never} />);
    expect(has(view, 'live-log')).toBe(false);
    await act(async () => appStore.getState().setScreen('log'));
    expect(has(view, 'live-log')).toBe(true);
    await act(async () => appStore.getState().setScreen('map'));
    expect(has(view, 'live-log')).toBe(false);
  });

  it('an entry opens over the log and closing it tells the log to read again', async () => {
    const closed = jest.fn();
    const view = await render(<LiveScreens logbookEntry={{} as never} onOverlayClosed={closed} />);
    await act(async () => appStore.setState({ selectedScreen: 'log', overlay: { kind: 'entry', id: 'e1' } }));
    expect(has(view, 'live-entry')).toBe(true);
    const props = entryScreen.mock.calls.at(-1)![0];
    expect(props.entryId).toBe('e1');
    await act(async () => props.onClose!());
    expect(appStore.getState().overlay).toBeNull();
    expect(closed).toHaveBeenCalled();
    expect(has(view, 'live-entry')).toBe(false);
    void press;
  });

  it('the planner shows when a renderer is given, and nothing without one', async () => {
    const withoutRenderer = await render(<LiveScreens logbookEntry={{} as never} />);
    await act(async () => appStore.setState({ selectedScreen: 'log', overlay: { kind: 'planner' } }));
    expect(has(withoutRenderer, 'live-planner')).toBe(false);
    await withoutRenderer.update(<LiveScreens logbookEntry={{} as never} renderPlanner={() => null} />);
    expect(has(withoutRenderer, 'live-planner')).toBe(true);
  });
});
