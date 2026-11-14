import type { OwnshipInput } from '../map/useMapData';
import { createStoreContext } from './storeContext';

/** What the map draws for ownship (MapService.updateOwnship): the last fix, greyed when GPS is lost. */
export interface OwnshipData {
  input: OwnshipInput;
}

/** Before the first fix: nothing drawn, the camera stays on the region's home view. */
export const NO_OWNSHIP: OwnshipInput = {
  position: null,
  trackDeg: 0,
  groundSpeedKt: 0,
  timestamp: null,
  stale: false,
};

export const ownship = createStoreContext<OwnshipData>({ input: NO_OWNSHIP });

export const useOwnship = (): OwnshipInput => ownship.useData((s) => s.input);
