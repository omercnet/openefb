import type { Region } from '../../domain/core/region';
import { createStoreContext } from './storeContext';

/** The region the pilot is in (AppState.region): decides which data layers, airport lists and searches exist. */
export interface RegionData {
  region: Region;
}

/** US until I1 feeds the location service's region in. */
export const regionSlice = createStoreContext<RegionData>({ region: 'us' });

export const useRegion = (): Region => regionSlice.useData((s) => s.region);
