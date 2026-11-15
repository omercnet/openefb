import { MapCaptureScreen } from '../ui/capture/MapCaptureScreen';

/** Capture state: the map with every data layer on (kanaf-dev://map-layers); registered in the fidelity capture scripts. */
export default function MapLayersRoute() {
  return <MapCaptureScreen screen="map" allLayers />;
}
