// Jest helpers for component tests (jest-expo + test-renderer). The renderer only exposes host nodes (View, Text, ...),
// but handlers such as onPress live on the composite component above them, so `callHandler` climbs the React fibers.
import { act, type ReactElement } from 'react';
import { createRoot, type JsonNode, type Root, type TestInstance } from 'test-renderer';

type Handler = (...args: unknown[]) => unknown;
type FiberLike = { return: FiberLike | null; memoizedProps: Record<string, unknown> | null };

export interface Rendered {
  root: Root;
  /** All text in the tree, concatenated with single spaces. */
  text: () => string;
  /** Host nodes matching the predicate, in tree order. */
  all: (predicate: (node: TestInstance) => boolean) => TestInstance[];
  /** The one node with this testID (throws unless exactly one). */
  byTestId: (id: string) => TestInstance;
  /** Nodes with this accessibilityRole. */
  byRole: (role: string) => TestInstance[];
  /** Nodes with this accessibilityLabel. */
  byLabel: (label: string) => TestInstance[];
  /** Re-render with a new element (same root). */
  update: (element: ReactElement) => Promise<void>;
  /** Unmount now (inside act); trees still mounted are unmounted after each test anyway. */
  unmount: () => Promise<void>;
}

const flatten = (node: JsonNode | null | undefined): string[] => {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  return node.children.flatMap(flatten);
};

const mounted = new Set<Root>();

// Like Testing Library: unmount whatever a test rendered, so trees from one test never react to the next test's store
// updates (a global store such as appStore outlives the test).
afterEach(async () => {
  for (const root of mounted) await act(async () => root.unmount());
  mounted.clear();
});

/** Render inside act so effects and store subscriptions have settled when it resolves. */
export async function render(element: ReactElement): Promise<Rendered> {
  const root = createRoot();
  mounted.add(root);
  await act(async () => root.render(element));
  const all = (predicate: (node: TestInstance) => boolean) => root.container.queryAll(predicate);
  return {
    root,
    text: () => flatten(root.container.toJSON()).join(' '),
    all,
    byTestId: (id) => {
      const found = all((n) => n.props?.testID === id);
      if (found.length !== 1) throw new Error(`expected one node with testID ${id}, found ${found.length}`);
      return found[0];
    },
    byRole: (role) => all((n) => n.props?.accessibilityRole === role),
    byLabel: (label) => all((n) => n.props?.accessibilityLabel === label),
    update: (next) => act(async () => root.render(next)),
    unmount: () => {
      mounted.delete(root);
      return act(async () => root.unmount());
    },
  };
}

/**
 * Call the handler (`onPress`, `onChangeText`, `onValueChange`, ...) of the nearest component at or above the host node, in
 * act. A Pressable with `disabled` set is skipped like the real one. Throws when no ancestor has the handler.
 */
export async function callHandler(node: TestInstance, name: string, ...args: unknown[]): Promise<void> {
  let fiber = node.unstable_fiber as unknown as FiberLike | null;
  while (fiber) {
    const props = fiber.memoizedProps;
    if (props && typeof props[name] === 'function') {
      if (props.disabled === true && name === 'onPress') return;
      await act(async () => {
        (props[name] as Handler)(...args);
      });
      return;
    }
    fiber = fiber.return;
  }
  throw new Error(`no ${name} handler at or above the node`);
}

export const press = (node: TestInstance) => callHandler(node, 'onPress');
