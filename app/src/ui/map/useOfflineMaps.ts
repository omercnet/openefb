import { useEffect, useSyncExternalStore } from 'react';
import type { OfflineMapService, OfflineSnapshot } from '../../domain/offline/offlineMapService';

/** The service as an external store; reads the engine's packs once on mount. */
export function useOfflineMaps(service: OfflineMapService): OfflineSnapshot {
  useEffect(() => {
    void service.refresh();
  }, [service]);
  return useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
}
