// The Layers column's offline row (LayersColumnView.offlineStatusRow): the pack coverage of what the map shows now.
import type { MapStyle } from '../../domain/core';
import type { OfflineRegionBounds } from '../../domain/offline/bounds';
import type { OfflineStatus } from '../columns/layers/logic';

/** The status resolver keys the sectional and street packs off `vfrSectional` while the sectional layer is on. */
export const offlineStyleFor = (sectionalOn: boolean): MapStyle => (sectionalOn ? 'vfrSectional' : 'street');

/** No visible bounds yet reads as not downloaded (`mapVisibleBounds.map { ... } ?? .notDownloaded`). */
export function offlineStatusFor(
  service: { status(visible: OfflineRegionBounds, style: MapStyle, atMs?: number): OfflineStatus },
  bounds: OfflineRegionBounds | null,
  sectionalOn: boolean,
  nowMs: number,
): OfflineStatus {
  return bounds ? service.status(bounds, offlineStyleFor(sectionalOn), nowMs) : 'notDownloaded';
}
