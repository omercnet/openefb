// Where the End recording confirmation points: the record button (Swift: confirmationDialog attached to it, a popover on
// iPad). The button registers its native tag here and the dialog reads it. The tag can arrive after the dialog was asked
// for (a screen that opens straight on the question), so it is observable.
import { useSyncExternalStore } from 'react';
import { findNodeHandle, type HostInstance } from 'react-native';

let handle: number | null = null;
let owner: HostInstance | null = null;
const listeners = new Set<() => void>();

/** The ref callback of the record button's native view. A stale unmount never clears a newer registration. */
export const registerRecordButtonAnchor = (view: HostInstance | null): void => {
  if (view) {
    owner = view;
    handle = findNodeHandle(view) ?? null;
  } else if (owner !== null) {
    owner = null;
    handle = null;
  }
  listeners.forEach((listener) => listener());
};

export const recordButtonHandle = (): number | null => handle;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The record button's native tag, or null until it is on screen. */
export const useRecordButtonHandle = (): number | null => useSyncExternalStore(subscribe, recordButtonHandle);
