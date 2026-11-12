import { act } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { render } from '../../../tests/support/ui';
import { NowProvider, useNow } from './clock';

const START = Date.UTC(2026, 10, 11, 12, 0, 0);
const Probe = () => <Text>{String(useNow())}</Text>;

describe('useNow', () => {
  let onChange: ((state: AppStateStatus) => void) | null;
  const remove = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers({
      now: START,
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout'],
    });
    onChange = null;
    remove.mockClear();
    // jest-expo's AppState.addEventListener is already a jest.fn, so spyOn returns it: clear calls from earlier tests.
    jest
      .spyOn(AppState, 'addEventListener')
      .mockClear()
      .mockImplementation((_type, handler) => {
        onChange = handler as (state: AppStateStatus) => void;
        return { remove };
      });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('ticks every second while the app is active', async () => {
    const view = await render(<Probe />);
    expect(view.text()).toBe(String(START));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(view.text()).toBe(String(START + 1000));
  });

  it('pauses in the background and catches up at once on return to the foreground', async () => {
    const view = await render(<Probe />);
    expect(jest.getTimerCount()).toBe(1);
    await act(async () => onChange!('background'));
    expect(jest.getTimerCount()).toBe(0);
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(view.text()).toBe(String(START)); // no ticks while paused
    await act(async () => onChange!('active'));
    expect(view.text()).toBe(String(START + 10_000)); // immediately, not a second later
    expect(jest.getTimerCount()).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(view.text()).toBe(String(START + 11_000));
  });

  it('inactive (app switcher, a call) pauses too', async () => {
    await render(<Probe />);
    await act(async () => onChange!('inactive'));
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleanup clears the interval and removes the AppState subscription', async () => {
    const view = await render(<Probe />);
    await act(async () => view.unmount());
    expect(jest.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('a NowProvider fixes the clock: no interval, no subscription', async () => {
    const view = await render(
      <NowProvider value={42}>
        <Probe />
      </NowProvider>,
    );
    expect(view.text()).toBe('42');
    expect(jest.getTimerCount()).toBe(0);
    expect(AppState.addEventListener).not.toHaveBeenCalled();
  });
});
