import { press, render } from '../../../tests/support/ui';
import { formattedElapsedTime, litSegments, RecordButton } from './RecordButton';

describe('RecordButton', () => {
  it('at rest: Start recording, no time, no meter', async () => {
    const onPress = jest.fn();
    const view = await render(<RecordButton status={{ kind: 'idle' }} elapsed={0} level={-160} onPress={onPress} />);
    const button = view.byTestId('record-button');
    expect(button.props.accessibilityLabel).toBe('Start recording');
    expect(button.props.accessibilityValue).toEqual({ text: '' });
    expect(view.byLabel('Audio level')).toHaveLength(0);
    expect(view.text()).toBe('');
    await press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('recording: stop disc, level meter and elapsed time', async () => {
    const view = await render(
      <RecordButton status={{ kind: 'recording' }} elapsed={4325.9} level={-35} onPress={() => {}} />,
    );
    expect(view.byTestId('record-button').props.accessibilityValue).toEqual({ text: 'Recording, 01:12:05' });
    expect(view.byLabel('Audio level')[0].props.accessibilityValue).toEqual({ text: '3 of 5' });
    expect(view.text()).toBe('01:12:05');
  });

  it('recording with the microphone denied: no meter', async () => {
    const view = await render(
      <RecordButton status={{ kind: 'recording' }} elapsed={6} level={-20} microphoneDenied onPress={() => {}} />,
    );
    expect(view.byLabel('Audio level')).toHaveLength(0);
  });

  it('countdown and the other states name what a tap does', async () => {
    const countdown = await render(
      <RecordButton status={{ kind: 'countdown', remaining: 3 }} elapsed={0} level={-160} onPress={() => {}} />,
    );
    expect(countdown.byTestId('record-button').props.accessibilityLabel).toBe('Cancel countdown');
    expect(countdown.text()).toBe('3');
    for (const [kind, text] of [
      ['paused', 'Resume recording'],
      ['stopping', 'Stopping recording'],
    ] as const) {
      const view = await render(<RecordButton status={{ kind }} elapsed={0} level={-160} onPress={() => {}} />);
      expect(view.byTestId('record-button').props.accessibilityLabel).toBe(text);
    }
  });

  it('maps -60...-10 dBFS onto five segments, rounding up', () => {
    expect([-160, -60, -59, -35, -10, 0].map(litSegments)).toEqual([0, 0, 1, 3, 5, 5]);
    expect(formattedElapsedTime(6)).toBe('00:00:06');
  });
});

describe('RecordButton taps', () => {
  /** The onPress the Pressable itself holds (press() would climb on to RecordButton's own onPress prop). */
  const pressableOnPress = (node: { unstable_fiber: unknown }): unknown => {
    type Fiber = { return: Fiber | null; memoizedProps: Record<string, unknown> | null };
    let fiber = node.unstable_fiber as Fiber | null;
    while (fiber && !(fiber.memoizedProps && 'onPress' in fiber.memoizedProps)) fiber = fiber.return;
    return fiber?.memoizedProps?.onPress;
  };

  it('acts when idle, recording or counting down', async () => {
    for (const status of [{ kind: 'idle' }, { kind: 'recording' }, { kind: 'countdown', remaining: 2 }] as const) {
      const onPress = jest.fn();
      const view = await render(<RecordButton status={status} elapsed={0} level={-160} onPress={onPress} />);
      expect(pressableOnPress(view.byTestId('record-button'))).toBe(onPress);
    }
  });

  it('does nothing while paused or stopping; stopping reads as disabled', async () => {
    for (const kind of ['paused', 'stopping'] as const) {
      const view = await render(<RecordButton status={{ kind }} elapsed={0} level={-160} onPress={jest.fn()} />);
      const button = view.byTestId('record-button');
      expect(pressableOnPress(button)).toBeUndefined();
      expect(button.props.accessibilityState?.disabled ?? false).toBe(kind === 'stopping');
    }
  });
});
