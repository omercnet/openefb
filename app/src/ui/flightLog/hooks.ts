// What every flight log piece reads: the flight log slice, GPS quality, the panel toggles and the nearest airport (the
// SwiftUI views get these from AppState, MapViewModel.gpsStatus, @AppStorage and NearestAirportViewModel).
import type { GpsFailureReason, GpsStatus } from '../../domain/location/gpsStatus';
import { isGpsStale } from '../../domain/location/gpsStatus';
import { useNearestEntry, type NearestAirportEntry } from '../columns/nearest/store';
import { gps } from '../state/gps';
import { panels } from '../state/panels';
import { useFlightLogData, type FlightLogData } from './store';

export interface FlightLogInputs {
  data: FlightLogData;
  gpsStatus: GpsStatus;
  gpsFailure: GpsFailureReason | null;
  /** The fix is lost: values dash or grey, nothing is shown as current. */
  stale: boolean;
  showsInstruments: boolean;
  showsPredictions: boolean;
  nearestEntry: NearestAirportEntry | null;
}

export function useFlightLog(): FlightLogInputs {
  const data = useFlightLogData();
  const gpsStatus = gps.useData((s) => s.status);
  const gpsFailure = gps.useData((s) => s.failure);
  const showsInstruments = panels.useData((s) => s.showsInstruments);
  const showsPredictions = panels.useData((s) => s.showsPredictions);
  const nearestEntry = useNearestEntry();
  return {
    data,
    gpsStatus,
    gpsFailure,
    stale: isGpsStale(gpsStatus),
    showsInstruments,
    showsPredictions,
    nearestEntry,
  };
}
