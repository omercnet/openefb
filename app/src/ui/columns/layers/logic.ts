// Pure parts behind the Layers column: MapViewModel.toggleLayer (the visibility half; the map service reacts to the
// slice), OfflineMapService's status labels and OfflineMapsView.dateString.
import { regionSupports, type Region } from '../../../domain/core/region';
import type { MapLayer } from '../../../domain/core/types';

/** Offline pack coverage of the visible map (OfflineMapService.OfflineStatus). */
export type OfflineStatus = 'ready' | 'partial' | 'notDownloaded' | 'expired';

/** The visible layers after one tap; unchanged (same array) when the region has no source for the layer. */
export function toggleLayer(visible: readonly MapLayer[], layer: MapLayer, region: Region): readonly MapLayer[] {
  if (!regionSupports(region, layer)) return visible;
  return visible.includes(layer) ? visible.filter((l) => l !== layer) : [...visible, layer];
}

const OFFLINE_LABELS: Record<OfflineStatus, string> = {
  ready: 'Offline: ready',
  partial: 'Offline: partial',
  notDownloaded: 'Offline: not downloaded',
  expired: 'Offline: expired',
};
export const offlineStatusLabel = (status: OfflineStatus): string => OFFLINE_LABELS[status];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "d MMM yyyy" in UTC, en_US_POSIX ("24 Dec 2026"). */
export function cycleDateText(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
