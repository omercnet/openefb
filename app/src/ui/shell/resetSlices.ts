// The shared slices back to launch state, once, before the live app mounts: a capture route opened earlier in the same
// process leaves its fixtures in them (they are process-wide stores). Idempotent, and run outside any render.
import { airport } from '../columns/airport/store';
import { layers, type LayersData } from '../columns/layers/store';
import { nearest } from '../columns/nearest/store';
import { EMPTY_FLIGHT_LOG, flightLog } from '../flightLog/store';
import type { Region } from '../../domain/core';
import { appStore } from '../state/appStore';
import { gps } from '../state/gps';
import { regionSlice } from '../state/region';

/** The Layers slice holds the pilot's choices for the life of the process: it is reset only when fixtures were put in. */
let layersAreLive = false;

/** A capture route wrote its fixtures into the slices (ui/capture/seeds.ts): the next live start resets all of them. */
export function noteCaptureSeeded(): void {
  layersAreLive = false;
}

/** @param saved the saved Layers choices (display mode), applied when the Layers slice is reset. */
export function resetLiveSlices(region: Region, saved?: Partial<LayersData>): void {
  appStore.setState({
    stripColumn: 'log',
    selectedScreen: 'map',
    overlay: null,
    selectedAirportId: null,
    databaseError: null,
    isPresentingBriefing: false,
    briefingRoute: null,
    chartViewer: null,
  });
  // The restored region is in place before the first render (the strip's Israel branch reads it).
  regionSlice.store.setState({ region });
  flightLog.store.setState({ ...EMPTY_FLIGHT_LOG, region });
  gps.store.setState(gps.make().getState());
  nearest.store.setState({ entries: [], ownship: null, loading: false, error: null });
  airport.store.setState({ columns: {}, rawMetarExpandedFor: null });
  if (!layersAreLive) layers.store.setState({ ...layers.make().getState(), ...saved });
  layersAreLive = true;
}
