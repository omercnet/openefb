import { createStore, useStore } from 'zustand';
import type { OfflineRegionBounds } from '../../domain/offline/bounds';
import type { TerminalChart } from '../columns/airport/logic';
import type { BriefingRoute } from '../../domain/israel/briefingFilter';
import type { AppError } from '../../domain/errors';
import { NO_NAVIGATION, type ActiveNavigation } from '../../domain/route/navigation';
import type { StripColumnKind } from '../../domain/types';

// App-wide state, the port of the navigation and error parts of AppState.swift. UI-only state stays in components.
// High-rate streams (GPS at about 1 Hz, map follow mode) must not go through here per tick: they feed a domain reducer
// and only the resulting camera props reach the map (plan section 3.2). Add slices here as tracks need them.
/** AppState.selectedScreen: the map, or the log stack over it (the map stays mounted underneath). */
export type LiveScreen = 'map' | 'log';

/** A screen pushed over the log stack (LogRoute); more kinds arrive as their screens are wired live. */
export type LiveOverlay =
  { kind: 'entry'; id: string } | { kind: 'planner' } | { kind: 'flight'; id: string } | { kind: 'settings' };

export interface AppState {
  selectedScreen: LiveScreen;
  setScreen: (screen: LiveScreen) => void;
  overlay: LiveOverlay | null;
  /** The map's visible area, kept for what needs it away from the map (Settings > Offline Maps downloads "this view"). */
  mapBounds: OfflineRegionBounds | null;
  setMapBounds: (bounds: OfflineRegionBounds | null) => void;
  openOverlay: (overlay: LiveOverlay | null) => void;
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
  /** The planned route the briefing filters to (the planner's Brief button); null: the whole feed around ownship. */
  briefingRoute: BriefingRoute | null;
  openBriefing: (route: BriefingRoute | null) => void;
  /** The terminal chart open full screen (ChartPDFView), if any. */
  chartViewer: TerminalChart | null;
  openChartViewer: (chart: TerminalChart | null) => void;
  clearDatabaseError: () => void;
  setNavigation: (navigation: ActiveNavigation) => void;
}

/** A fresh store; tests create their own so state never leaks between them. */
export const createAppStore = () =>
  createStore<AppState>()((set) => ({
    selectedScreen: 'map',
    setScreen: (selectedScreen) => set({ selectedScreen }),
    overlay: null,
    mapBounds: null,
    setMapBounds: (mapBounds) => set({ mapBounds }),
    openOverlay: (overlay) => set({ overlay }),
    stripColumn: 'log',
    selectedAirportId: null,
    databaseError: null,
    navigation: NO_NAVIGATION,
    isPresentingBriefing: false,
    briefingRoute: null,
    openBriefing: (briefingRoute) => set({ briefingRoute, isPresentingBriefing: true }),
    chartViewer: null,
    openChartViewer: (chartViewer) => set({ chartViewer }),
    setPresentingBriefing: (isPresentingBriefing) =>
      set(isPresentingBriefing ? { isPresentingBriefing } : { isPresentingBriefing, briefingRoute: null }),
    setStripColumn: (stripColumn) => set({ stripColumn }),
    showAirport: (icao) => set({ selectedAirportId: icao, stripColumn: 'airport' }),
    reportDatabaseError: (databaseError) => set({ databaseError }),
    clearDatabaseError: () => set({ databaseError: null }),
    setNavigation: (navigation) => set({ navigation }),
  }));

export const appStore = createAppStore();

/** Subscribes a component to the selected slice of the app store. */
export const useAppStore = <T>(selector: (state: AppState) => T): T => useStore(appStore, selector);
