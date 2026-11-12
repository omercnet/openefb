import { act } from 'react';
import { Text } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { createStoreContext } from './storeContext';

type Data = { count: number; label: string };
const initial: Data = { count: 1, label: 'one' };

function setup() {
  const slice = createStoreContext<Data>(initial);
  const Probe = () => <Text>{slice.useData((s) => `${s.label}:${s.count}`)}</Text>;
  return { slice, Probe };
}

const textOf = (renderer: Root) => JSON.stringify(renderer.container.toJSON());

describe('createStoreContext', () => {
  it('seeds the default store with the initial data', async () => {
    const { Probe } = setup();
    const renderer = createRoot();
    await act(async () => renderer.render(<Probe />));
    expect(textOf(renderer)).toContain('one:1');
  });

  it('re-renders a subscriber when the store changes', async () => {
    const { slice, Probe } = setup();
    const renderer = createRoot();
    await act(async () => renderer.render(<Probe />));
    await act(async () => slice.store.setState({ count: 2, label: 'two' }));
    expect(textOf(renderer)).toContain('two:2');
  });

  it('reads the store a Provider supplies, not the default one', async () => {
    const { slice, Probe } = setup();
    const own = slice.make({ count: 9, label: 'nine' });
    const renderer = createRoot();
    await act(async () =>
      renderer.render(
        <slice.Provider store={own}>
          <Probe />
        </slice.Provider>,
      ),
    );
    expect(textOf(renderer)).toContain('nine:9');
    expect(slice.store.getState()).toEqual(initial);
  });

  it('make returns independent stores', () => {
    const { slice } = setup();
    const a = slice.make();
    const b = slice.make();
    a.setState({ count: 5 });
    expect(b.getState().count).toBe(1);
    expect(slice.store.getState().count).toBe(1);
  });
});
