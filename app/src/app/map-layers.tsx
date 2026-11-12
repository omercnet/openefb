import { MapScreen } from '../ui/screens/MapScreen';

/** Capture state: the map with every data layer on (kanaf-dev://map-layers); registered in the fidelity capture scripts. */
export default function MapLayersRoute() {
  return <MapScreen screen="map" allLayers />;
}
