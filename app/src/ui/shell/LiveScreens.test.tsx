import { act, useEffect } from 'react';
import { press, render } from '../../../tests/support/ui';
import { appStore } from '../state/appStore';
import { LogScreen } from '../screens/LogScreen';
import { layers } from '../columns/layers/store';
import { Night } from '../tokens';
import { LogbookEntryScreen } from '../screens/LogbookEntryScreen';
import { LiveScreens } from './LiveScreens';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../screens/LogScreen', () => ({ LogScreen: jest.fn(() => null) }));
jest.mock('../screens/LogbookEntryScreen', () => ({ LogbookEntryScreen: jest.fn(() => null) }));
const entryScreen = jest.mocked(LogbookEntryScreen);
const logScreen = jest.mocked(LogScreen);

const has = (view: Awaited<ReturnType<typeof render>>, id: string) =>
  view.all((n) => n.props?.testID === id).length > 0;

beforeEach(() => {
  layers.store.setState({ displayMode: 'day' });
  entryScreen.mockClear();
  appStore.setState({ selectedScreen: 'map', overlay: null });
});

describe('LiveScreens', () => {
  it('the Log follows the live display mode: night passes the night theme', async () => {
    appStore.setState({ selectedScreen: 'log', overlay: null });
    layers.store.setState({ displayMode: 'night' });
    await render(<LiveScreens logbookEntry={{} as never} />);
    expect(logScreen.mock.calls.at(-1)![0].theme).toBe(Night);
  });

  it('an entry editor is remounted for another entry id (no draft carried over)', async () => {
    let mounts = 0;
    entryScreen.mockImplementation(() => {
      useEffect(() => void (mounts += 1), []);
      return null as never;
    });
    await render(<LiveScreens logbookEntry={{} as never} />);
    await act(async () => appStore.setState({ selectedScreen: 'log', overlay: { kind: 'entry', id: 'a' } }));
    await act(async () => appStore.setState({ overlay: { kind: 'entry', id: 'b' } }));
    expect(mounts).toBe(2);
  });

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

  it('a flight shows when the recording database is open, with the renderer; nothing without it', async () => {
    const view = await render(<LiveScreens logbookEntry={{} as never} />);
    await act(async () => appStore.setState({ selectedScreen: 'log', overlay: { kind: 'flight', id: 'f1' } }));
    expect(has(view, 'live-flight')).toBe(false);
    const seen: string[] = [];
    await view.update(
      <LiveScreens
        logbookEntry={{} as never}
        renderFlight={(id) => {
          seen.push(id);
          return null;
        }}
      />,
    );
    expect(has(view, 'live-flight')).toBe(true);
    expect(seen).toContain('f1');
  });
});
