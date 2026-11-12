import { useState } from 'react';
import { Text, View } from 'react-native';
import { callHandler, render } from '../../../tests/support/ui';
import { OpacitySlider } from './Components';

/** The slider is controlled: a parent owns the value, as the Layers column does. */
function Harness({ start }: { start: number }) {
  const [value, setValue] = useState(start);
  return (
    <View>
      <Text testID="value">{String(value)}</Text>
      <OpacitySlider opacity={value} onChange={setValue} />
    </View>
  );
}

const action = (actionName: string) => ({ nativeEvent: { actionName } });

describe('OpacitySlider accessibility', () => {
  it('is an adjustable control labelled and spoken in percent', async () => {
    const view = await render(<Harness start={0.7} />);
    const [slider] = view.byRole('adjustable');
    expect(slider.props.accessibilityLabel).toBe('Sectional chart opacity');
    expect(slider.props.accessibilityValue).toEqual({ text: '70 percent' });
    expect(slider.props.accessibilityActions).toEqual([{ name: 'increment' }, { name: 'decrement' }]);
  });

  it('three increments from 70 percent read 80, 90 and 100 percent', async () => {
    const view = await render(<Harness start={0.7} />);
    const spoken: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      await callHandler(view.byRole('adjustable')[0], 'onAccessibilityAction', action('increment'));
      spoken.push(view.byRole('adjustable')[0].props.accessibilityValue.text);
    }
    expect(spoken).toEqual(['80 percent', '90 percent', '100 percent']);
  });

  it('decrement lowers it and an unknown action changes nothing', async () => {
    const view = await render(<Harness start={0.7} />);
    await callHandler(view.byRole('adjustable')[0], 'onAccessibilityAction', action('activate'));
    expect(view.byTestId('value').children).toEqual(['0.7']);
    await callHandler(view.byRole('adjustable')[0], 'onAccessibilityAction', action('decrement'));
    expect(view.byRole('adjustable')[0].props.accessibilityValue.text).toBe('60 percent');
  });
});
