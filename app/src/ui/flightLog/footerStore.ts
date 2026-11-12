import { createStoreContext } from '../state/storeContext';

/**
 * What the footer's zoom cells need from the map (Swift: AppState.mapZoom, MapViewModel.isFollowing, setZoomLevel and
 * recenter). I1 feeds `zoom` from the camera (after it settles) and `following`, and wires the two actions. Feed it with
 * `footer.store.setState(partial)` (merge), never `replace`: the slice carries its callbacks.
 */
export interface FooterData {
  /** The camera's last reported zoom level. */
  zoom: number;
  /** False after a pan: ZOOM + becomes RECENTER until the chart follows ownship again. */
  following: boolean;
  /**
   * Animate the camera to this zoom level. The footer swallows a throw or a rejection (map not ready) and forgets the
   * level, so the next tap starts from the reported zoom.
   */
  zoomTo: (level: number) => void | Promise<void>;
  /** Follow ownship again. The footer swallows a throw or a rejection. */
  recenter: () => void | Promise<void>;
}

export const footer = createStoreContext<FooterData>({
  zoom: 10,
  following: true,
  zoomTo: () => {},
  recenter: () => {},
});
