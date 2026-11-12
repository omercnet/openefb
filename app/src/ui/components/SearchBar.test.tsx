import { StyleSheet } from 'react-native';
import { callHandler, render } from '../../../tests/support/ui';
import { StripMetrics } from '../tokens';
import { SearchBar } from './Components';

const bar = (props: { text?: string; label?: string; onChangeText?: (v: string) => void } = {}) => (
  <SearchBar
    text={props.text ?? ''}
    onChangeText={props.onChangeText ?? (() => undefined)}
    placeholder="ICAO, name or city"
    accessibilityLabel={props.label}
    onSubmit={() => undefined}
  />
);

describe('SearchBar', () => {
  it('speaks the label on the input itself, the placeholder when there is none', async () => {
    const labelled = await render(bar({ label: 'Search airports' }));
    expect(labelled.byLabel('Search airports')).toHaveLength(1);
    expect(labelled.byLabel('Search airports')[0].type).toBe('TextInput');
    await labelled.unmount();
    const plain = await render(bar());
    expect(plain.all((n) => n.type === 'TextInput')[0].props.accessibilityLabel).toBe('ICAO, name or city');
  });

  it('keeps the 60 pt box with text in it: the input and the clear button sit inside the 1 pt border', async () => {
    const empty = await render(bar());
    const input = empty.all((n) => n.type === 'TextInput')[0];
    expect(StyleSheet.flatten(input.props.style).minHeight).toBe(StripMetrics.cell - 2);
    expect(empty.byLabel('Clear search')).toHaveLength(0);
    await empty.unmount();
    const typed = await render(bar({ text: 'KPA' }));
    const [clear] = typed.byLabel('Clear search');
    expect(StyleSheet.flatten(clear.props.style).minHeight).toBe(StripMetrics.cell - 2);
  });

  it('the clear button empties the field', async () => {
    const changes: string[] = [];
    const view = await render(bar({ text: 'KPA', onChangeText: (v) => changes.push(v) }));
    await callHandler(view.byLabel('Clear search')[0], 'onPress');
    expect(changes).toEqual(['']);
  });
});
