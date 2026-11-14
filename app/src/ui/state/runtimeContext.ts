// The services the live map reads, provided by the app shell once the launch sequence is done. Capture routes and tests
// provide nothing and render from fixtures or their own props. The type is erased: this file never imports the
// composition root (ui/shell/runtime.ts), which requires the bundled databases.
import { createContext, useContext } from 'react';
import type { AppRuntime } from '../shell/runtime';

export const RuntimeContext = createContext<AppRuntime | null>(null);

/** The runtime of the live app; throws outside it (a live screen mounted without the shell is a bug). */
export function useRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useRuntime: no AppRuntime (the live map must be rendered by LiveApp)');
  return runtime;
}
