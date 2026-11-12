import type { GpsFailureReason, GpsStatus } from '../../domain/location/gpsStatus';
import { createStoreContext } from './storeContext';

/** GPS quality as the strip and the footer show it (the Swift views read it from the map view model and AppState). */
export interface GpsData {
  status: GpsStatus;
  /** Why the stream failed (denied, restricted, unavailable, no fix yet), when it did. */
  failure: GpsFailureReason | null;
}

/** A good fix until I1 feeds the location service in. */
export const gps = createStoreContext<GpsData>({ status: { kind: 'ok' }, failure: null });

export const useGpsStatus = (): GpsStatus => gps.useData((s) => s.status);
