// The usage counters the screens raise (ContentView: Navigation.screen on every change of the selected screen;
// IsraelBriefingView: Israel.briefingOpened). Counts only; the Telemetry sends nothing unless a Worker URL is built in.
import type { StoreApi } from 'zustand';
import type { Telemetry } from '../../domain/telemetry/telemetry';
import type { AppState } from '../state/appStore';

/** The Telemetry's signal, narrowed to the events raised here. */
export type Signals = Pick<Telemetry, 'signal'>;

export function bindNavigationTelemetry(app: StoreApi<AppState>, telemetry: Signals): () => void {
  return app.subscribe((state, previous) => {
    if (state.selectedScreen !== previous.selectedScreen) {
      telemetry.signal('Navigation.screen', { screen: state.selectedScreen });
    }
    if (state.isPresentingBriefing && !previous.isPresentingBriefing) telemetry.signal('Israel.briefingOpened');
  });
}
