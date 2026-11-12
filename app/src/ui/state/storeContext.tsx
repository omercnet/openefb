import { createContext, createElement, useContext, type ReactNode } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';

/**
 * One slice of UI data behind a Zustand store, plus a context to swap the store.
 *
 * Screens read their data through hooks over such a slice (plan 3.2: view models become hooks over a store plus domain
 * functions). The default store is seeded with `initial`, a fake until I1 feeds the real services into it
 * (`store.setState(...)` from a service subscription); tests and capture routes provide their own with `Provider`.
 *
 * `useData` follows Zustand's rule: the selector must return a value that is stable between calls (a field of the
 * state, a primitive), never a fresh object or array; derive those in a `useMemo` over the selected fields.
 */
export function createStoreContext<T extends object>(initial: T) {
  /** A fresh store, so tests never share state. */
  const make = (state: T = initial): StoreApi<T> => createStore<T>()(() => state);
  const store = make();
  const Context = createContext<StoreApi<T>>(store);
  const Provider = ({ store: provided, children }: { store: StoreApi<T>; children: ReactNode }) =>
    createElement(Context.Provider, { value: provided }, children);
  const useData = <S,>(selector: (state: T) => S): S => useStore(useContext(Context), selector);
  /** The store itself, for event handlers that write to it. */
  const useStoreApi = (): StoreApi<T> => useContext(Context);
  return { make, store, Provider, useData, useStoreApi };
}
