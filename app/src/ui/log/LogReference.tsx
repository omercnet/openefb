// The stores and clock that reproduce reference/ipad-log.png, for the /log capture route (the fidelity gate). The shared
// slices' defaults are the map reference (Direct-To KOAK, recording 6 s), so the route supplies its own.
import { useState, type ReactNode } from 'react';
import { flightLog } from '../flightLog/store';
import { NowProvider } from './clock';
import { REFERENCE_FLIGHT_LOG, REFERENCE_LOG, REFERENCE_NOW_MS } from './fixtures';
import { log } from './store';

export function LogReference({ children }: { children: ReactNode }) {
  const [stores] = useState(() => ({ log: log.make(REFERENCE_LOG), flightLog: flightLog.make(REFERENCE_FLIGHT_LOG) }));
  return (
    <NowProvider value={REFERENCE_NOW_MS}>
      <flightLog.Provider store={stores.flightLog}>
        <log.Provider store={stores.log}>{children}</log.Provider>
      </flightLog.Provider>
    </NowProvider>
  );
}
