import { createStore, useStore } from 'zustand';
import type { AppError } from '../../domain/errors';
import type { StripColumnKind } from '../../domain/types';

// App-wide state, the port of the navigation and error parts of AppState.swift. UI-only state stays in components.
// High-rate streams (GPS at about 1 Hz, map follow mode) must not go through here per tick: they feed a domain reducer
// and only the resulting camera props reach the map (plan section 3.2). Add slices here as tracks need them.
export interface AppState {
  stripColumn: StripColumnKind;
  selectedAirportId: string | null;
  /** Set when the user database failed to open; the app then runs on an in-memory fallback and shows a banner. */
  databaseError: AppError | null;
  setStripColumn: (column: StripColumnKind) => void;
  /** Select an airport and show its column (the SwiftUI app always does both together). */
  showAirport: (icao: string) => void;
  reportDatabaseError: (error: AppError) => void;
  clearDatabaseError: () => void;
}

export const createAppStore = () =>
  createStore<AppState>()((set) => ({
    stripColumn: 'log',
    selectedAirportId: null,
    databaseError: null,
    setStripColumn: (stripColumn) => set({ stripColumn }),
    showAirport: (icao) => set({ selectedAirportId: icao, stripColumn: 'airport' }),
    reportDatabaseError: (databaseError) => set({ databaseError }),
    clearDatabaseError: () => set({ databaseError: null }),
  }));

export const appStore = createAppStore();

export const useAppStore = <T>(selector: (state: AppState) => T): T => useStore(appStore, selector);
