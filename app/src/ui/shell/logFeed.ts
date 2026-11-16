// The Log screen on the user database (LogStackView's @Query and LogbookViewModel): recorded flights and logbook entries
// into the `log` slice, and the actions the Log raises. Navigation targets are the app store's screen and overlay.
import type { StoreApi } from 'zustand';
import type { FlightRecord } from '../../data/models';
import type { Repository } from '../../data/repositories/table';
import { addManualEntry } from '../../domain/logbook/logbookData';
import type { UserData } from '../../domain/userData';
import type { LogActions, LogData } from '../log/store';
import type { AppState } from '../state/appStore';

export interface LogFeedDeps {
  userData: UserData;
  flights: Pick<Repository<FlightRecord>, 'list'>;
  store: StoreApi<LogData>;
  app: StoreApi<AppState>;
  log?: (message: string) => void;
}

export interface LogFeed {
  /** Reads flights and entries again; the last good list stays when it fails (a stale list beats an empty one). */
  refresh(): Promise<void>;
  actions: LogActions;
}

export function createLogFeed(deps: LogFeedDeps): LogFeed {
  const log = deps.log ?? console.warn;
  let generation = 0;
  const refresh = async (): Promise<void> => {
    const mine = ++generation;
    try {
      const [flights, entries] = await Promise.all([deps.flights.list(), deps.userData.logbook.list()]);
      if (mine === generation) deps.store.setState({ flights, entries });
    } catch (error) {
      log(`Could not read the log: ${String(error)}`);
    }
  };
  const app = () => deps.app.getState();
  const actions: LogActions = {
    openMap: () => app().setScreen('map'),
    openSettings: () => app().openOverlay({ kind: 'settings' }),
    openPlanner: () => app().openOverlay({ kind: 'planner' }),
    addEntry: () => {
      void addManualEntry(deps.userData).then(
        (entry) => {
          app().openOverlay({ kind: 'entry', id: entry.id });
          return refresh();
        },
        (error) => log(`Could not add the entry: ${String(error)}`),
      );
    },
    openFlight: (id) => app().openOverlay({ kind: 'flight', id }),
    openEntry: (id) => app().openOverlay({ kind: 'entry', id }),
    deleteEntry: (id) => {
      void (async () => {
        try {
          // LogStackView.delete(_:): a signed entry is locked, whatever the caller says.
          // The signed check and the delete are one statement, so a confirm that lands in between keeps the entry.
          await deps.userData.logbook.removeUnconfirmed(id);
        } catch (error) {
          log(`Could not delete the entry: ${String(error)}`);
        }
        await refresh();
      })();
    },
  };
  return { refresh, actions };
}
