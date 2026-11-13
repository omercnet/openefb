import { createStore, type StoreApi } from 'zustand';
import type { CVFRDebrief } from '../../domain/debrief/cvfrDebrief';
import type { DebriefAvailability, DebriefEngine } from '../../domain/ports/debriefEngine';

// What FlightDetailView does around its sections (efb-212/Views/Flights/FlightDetailView.swift): on appear it asks whether the
// on-device model can run, prewarms it, and loads the flight's CVFR debrief; on disappear it frees the model.

export interface FlightDetailDeps {
  /** The AI debrief; null where there is none (Android, owner decision Q8, or while the adapter is not there). */
  engine: DebriefEngine | null;
  /** The CVFR debrief of the flight (L5 loadCVFRDebrief over the recording and the Israel database); null outside Israel. */
  loadCvfr(): Promise<CVFRDebrief | null>;
}

export interface FlightDetailState {
  /** Whether the app has a debrief engine at all (not on Android, owner decision Q8). */
  hasEngine: boolean;
  /** Null until it is loaded, for a flight outside Israel, and when it cannot be loaded. */
  cvfr: CVFRDebrief | null;
  availability: DebriefAvailability;
  /** onAppear and .task: ask the model and prewarm it now; resolves when the CVFR debrief has loaded. */
  appear(): Promise<void>;
  /** onDisappear: free the model. */
  disappear(): void;
  /** Stops following the engine. */
  dispose(): void;
}

export type FlightDetailStore = StoreApi<FlightDetailState>;

export function createFlightDetailStore(deps: FlightDetailDeps): FlightDetailStore {
  const { engine } = deps;
  let appeared = false;
  /** Bumped by every appear and disappear: a CVFR load that is no longer the latest must not set the state. */
  let loadToken = 0;
  let unsubscribe = () => {};
  /** Whether the model last reported itself able to run; reset by every appear so a return to the screen prewarms again. */
  let wasAvailable = false;

  const store = createStore<FlightDetailState>()(() => ({
    hasEngine: engine !== null,
    cvfr: null,
    availability: engine?.state.availability ?? { kind: 'unknown' },

    async appear() {
      appeared = true;
      wasAvailable = false;
      const token = ++loadToken;
      engine?.checkAvailability();
      // Swift's loadBundled swallows its errors: the flight shows without the CVFR section.
      const cvfr = await deps.loadCvfr().catch(() => null);
      if (token === loadToken) store.setState({ cvfr });
    },

    disappear() {
      appeared = false;
      loadToken += 1;
      engine?.discard();
    },

    dispose: () => unsubscribe(),
  }));

  if (engine) {
    unsubscribe = engine.subscribe(() => {
      const availability = engine.state.availability;
      store.setState({ availability });
      // Prewarm the model once it is known to run, while the screen is up (the platform may answer after appear).
      const available = availability.kind === 'available';
      if (available && !wasAvailable && appeared) engine.prewarm();
      wasAvailable = available;
    });
  }
  return store;
}
