// The app's haptics for the views (Swift: the global `Haptics` enum). The shell installs the real adapter once; until then
// (tests, capture routes, the web preview) every call does nothing.
import type { Haptics } from '../adapters/haptics';

const silent: Haptics = { warning: () => undefined, success: () => undefined, light: () => undefined };
let current: Haptics = silent;

export const setHaptics = (haptics: Haptics | null): void => {
  current = haptics ?? silent;
};

/** Call sites use these, never the adapter, so a view needs no wiring to tap. */
export const haptic: Haptics = {
  warning: () => current.warning(),
  success: () => current.success(),
  light: () => current.light(),
};
