import { createStoreContext } from './storeContext';

/**
 * The map-screen panel toggles (Layers > Panels). Swift keeps them in UserDefaults (`FlightLogVisibility`: showsFlightLog,
 * showsInstruments, showsPredictions); the Layers column writes them and the strip reads them. Persistence is wired in I1.
 * Flight log and instruments default to on, predictions to off (pilots opt in to the preview).
 */
export interface PanelsData {
  showsFlightLog: boolean;
  showsInstruments: boolean;
  showsPredictions: boolean;
}

export const panels = createStoreContext<PanelsData>({
  showsFlightLog: true,
  showsInstruments: true,
  showsPredictions: false,
});
