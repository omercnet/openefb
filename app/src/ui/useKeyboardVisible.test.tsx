import { act } from 'react';
import { DeviceEventEmitter, Keyboard, Platform, Text } from 'react-native';
import { render } from '../../tests/support/ui';
import { useKeyboardVisible } from './useKeyboardVisible';

function Probe() {
  return <Text testID="keyboard">{useKeyboardVisible() ? 'up' : 'down'}</Text>;
}

const emit = (event: string) => act(async () => DeviceEventEmitter.emit(event, {}));
const state = (view: Awaited<ReturnType<typeof render>>) => view.byTestId('keyboard').children[0];

describe('useKeyboardVisible', () => {
  // React Native's own Keyboard module remembers the last event it saw (isVisible), and a test emits events through the
  // shared emitter: start every test from "no keyboard" so one test's events cannot leak into the next.
  beforeEach(() => jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false));
  afterEach(() => jest.restoreAllMocks());

  it('is down until the keyboard is announced, on iOS before it animates', async () => {
    const view = await render(<Probe />);
    expect(state(view)).toBe('down');
    await emit('keyboardWillShow');
    expect(state(view)).toBe('up');
    await emit('keyboardWillHide');
    expect(state(view)).toBe('down');
  });

  it('on iOS the late events (Did...) change nothing, so the state flips once per change', async () => {
    const view = await render(<Probe />);
    await emit('keyboardDidShow');
    expect(state(view)).toBe('down');
  });

  it('on Android it follows the Did events', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await render(<Probe />);
    await emit('keyboardWillShow');
    expect(state(view)).toBe('down');
    await emit('keyboardDidShow');
    expect(state(view)).toBe('up');
    await emit('keyboardDidHide');
    expect(state(view)).toBe('down');
  });

  it('stops listening when unmounted', async () => {
    const count = () => ['keyboardWillShow', 'keyboardWillHide'].map((e) => DeviceEventEmitter.listenerCount(e));
    const [showBefore, hideBefore] = count();
    const view = await render(<Probe />);
    expect(count()).toEqual([showBefore + 1, hideBefore + 1]);
    await view.unmount();
    expect(count()).toEqual([showBefore, hideBefore]);
  });

  it('an announcement with no height does not count, one with height does', async () => {
    const view = await render(<Probe />);
    await act(async () => DeviceEventEmitter.emit('keyboardWillShow', { endCoordinates: { height: 0 } }));
    expect(state(view)).toBe('down');
    await act(async () => DeviceEventEmitter.emit('keyboardWillShow', { endCoordinates: { height: 398 } }));
    expect(state(view)).toBe('up');
  });

  it('starts up when the keyboard is already up as the view mounts', async () => {
    jest.spyOn(Keyboard, 'isVisible').mockReturnValue(true);
    const view = await render(<Probe />);
    expect(state(view)).toBe('up');
    await emit('keyboardWillHide');
    expect(state(view)).toBe('down');
  });
});
