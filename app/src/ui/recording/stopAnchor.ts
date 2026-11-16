// Where the End recording confirmation points: the record button (Swift: confirmationDialog attached to it, a popover on
// iPad). The button registers its native view here; the dialog measures it when it opens. The view can arrive after the
// dialog was asked for (a screen that opens straight on the question), so it is observable.
import { useSyncExternalStore } from 'react';
import type { HostInstance } from 'react-native';

let view: HostInstance | null = null;
const listeners = new Set<() => void>();

/** The ref callback of the record button's native view. A stale unmount never clears a newer registration. */
export const registerRecordButtonAnchor = (next: HostInstance | null): void => {
  if (next) view = next;
  else if (view !== null) view = null;
  listeners.forEach((listener) => listener());
};

/** A ref callback owned by one record button: its unmount clears the registration only while it is still the registered one. */
export const createRecordButtonAnchorRef = () => {
  let mine: HostInstance | null = null;
  return (next: HostInstance | null): void => {
    if (next) {
      mine = next;
      registerRecordButtonAnchor(next);
    } else {
      const gone = mine;
      mine = null;
      if (gone !== null && gone === view) registerRecordButtonAnchor(null);
    }
  };
};

export const recordButtonView = (): HostInstance | null => view;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The record button's native view, or null until it is on screen. */
export const useRecordButtonView = (): HostInstance | null => useSyncExternalStore(subscribe, recordButtonView);

export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the record button is in the window, or null when it is not on screen. */
export const measureRecordButton = (target: HostInstance | null): Promise<WindowFrame | null> =>
  new Promise((resolve) => {
    if (!target) return resolve(null);
    target.measureInWindow((x, y, width, height) => resolve(width > 0 || height > 0 ? { x, y, width, height } : null));
  });
