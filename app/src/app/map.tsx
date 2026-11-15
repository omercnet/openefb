import { MapCaptureScreen } from '../ui/capture/MapCaptureScreen';

/** Route map: the map with the flight log in the strip (kanaf-dev://map?animate=1 animates the ownship). */
export default function MapRoute() {
  return <MapCaptureScreen screen="map" />;
}
