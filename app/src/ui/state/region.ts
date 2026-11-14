import type { Region } from '../../domain/core/region';
import { createStoreContext } from './storeContext';

/** The region the pilot is in (AppState.region): decides which data layers, airport lists and searches exist. */
export interface RegionData {
  region: Region;
}

/** The saved region, set by the app shell at launch (RegionStore.load); US until then. */
export const regionSlice = createStoreContext<RegionData>({ region: 'us' });

export const useRegion = (): Region => regionSlice.useData((s) => s.region);
