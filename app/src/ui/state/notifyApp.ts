import { describeError } from '../../domain/describeError';

/**
 * Runs a notification to the app shell (AppState follows a change). A throw is returned as text instead of propagating, so a
 * failing observer cannot undo or hide the change that caused it.
 */
export function notifyApp(call: () => void): string | null {
  try {
    call();
    return null;
  } catch (error) {
    return describeError(error);
  }
}
