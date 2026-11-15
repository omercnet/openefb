import { createStore, useStore } from 'zustand';
import type { AppError } from '../../domain/errors';
import { NO_NAVIGATION, type ActiveNavigation } from '../../domain/route/navigation';
import type { StripColumnKind } from '../../domain/types';

// App-wide state, the port of the navigation and error parts of AppState.swift. UI-only state stays in components.
// High-rate streams (GPS at about 1 Hz, map follow mode) must not go through here per tick: they feed a domain reducer
// and only the resulting camera props reach the map (plan section 3.2). Add slices here as tracks need them.
export interface AppState {
  stripColumn: StripColumnKind;
  selectedAirportId: string | null;
  /** Why the aviation database could not be opened (AppState.databaseError): drives the red banner. */
  databaseError: AppError | null;
  /** Direct-To, route or plan being flown and its live progress (AppState+Navigation.swift). */
  navigation: ActiveNavigation;
  setStripColumn: (column: StripColumnKind) => void;
  /** Select an airport and show its column (the SwiftUI app always does both together). */
  showAirport: (icao: string) => void;
  reportDatabaseError: (error: AppError) => void;
  /** The Israel NOTAM briefing sheet is up (AppState.isPresentingIsraelBriefing). */
  isPresentingBriefing: boolean;
  setPresentingBriefing: (presenting: boolean) => void;
  clearDatabaseError: () => void;
  setNavigation: (navigation: ActiveNavigation) => void;
}

/** A fresh store; tests create their own so state never leaks between them. */
export const createAppStore = () =>
  createStore<AppState>()((set) => ({
    stripColumn: 'log',
    selectedAirportId: null,
    databaseError: null,
    navigation: NO_NAVIGATION,
    isPresentingBriefing: false,
    setPresentingBriefing: (isPresentingBriefing) => set({ isPresentingBriefing }),
    setStripColumn: (stripColumn) => set({ stripColumn }),
    showAirport: (icao) => set({ selectedAirportId: icao, stripColumn: 'airport' }),
    reportDatabaseError: (databaseError) => set({ databaseError }),
    clearDatabaseError: () => set({ databaseError: null }),
    setNavigation: (navigation) => set({ navigation }),
  }));

export const appStore = createAppStore();

/** Subscribes a component to the selected slice of the app store. */
export const useAppStore = <T>(selector: (state: AppState) => T): T => useStore(appStore, selector);
