import { useMemo, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { openAviationDatabase } from '../../adapters/aviationDb';
import type { MapLayer } from '../../domain/core';
import { layerSpecsFor } from '../../domain/map/registry';
import type { MapDataSource } from '../../domain/map/mapDataController';
import { fixtureAdvisory, fixtureTfr } from '../../fixtures/mapLayers';
import { scenario } from '../../fixtures/scenario';
import { MapSurface } from '../map/MapSurface';
import { scenarioWeather, useAnimateFlag, useScenarioOwnship } from '../map/scenarioFeed';
import { useMapController, useMapModel } from '../map/useMapData';
import { StripColumn, type StripScreen } from '../StripColumn';

export const STRIP_WIDTH_PT = 400; // matches the SwiftUI strip (docs/DESIGN.md)

/** Aviation database opened in the background: the screen mounts without waiting for the copy-on-first-launch. */
const lazyDb = (): MapDataSource => {
  const open = openAviationDatabase();
  open.catch(() => undefined); // each query awaits `open` itself and the controller reports the failure; this only avoids an unhandled rejection
  return {
    airportsNear: async (c, r) => (await open).airportsNear(c, r),
    toweredAirportsNear: async (c, r) => (await open).toweredAirportsNear(c, r),
    airspacesNear: async (c, r) => (await open).airspacesNear(c, r),
    navaidsNear: async (c, r) => (await open).navaidsNear(c, r),
  };
};

const SCENARIO_LAYERS: ReadonlySet<MapLayer> = new Set<MapLayer>(['sectional', 'airports', 'ownship', 'weatherDots']);
/** The `map-layers` capture state: every data layer on, with a fixture TFR and AIRMET. */
const ALL_LAYERS: ReadonlySet<MapLayer> = new Set<MapLayer>([...SCENARIO_LAYERS, 'navaids', 'airspace', 'tfrs', 'advisories', 'route']);
const SCENARIO_ROUTE = {
  kind: 'greatCircle' as const,
  points: [
    { lat: 37.4611, lon: -122.115 }, // KPAO
    { lat: scenario.next.lat, lon: scenario.next.lon }, // KOAK
  ],
};
const INITIAL_VIEW = { center: { lat: scenario.map.center[1], lon: scenario.map.center[0] }, zoom: scenario.map.zoom };

/**
 * The map-first layout: strip column beside the chart; `screen` picks the column and day or night. The map runs on the
 * fixture scenario (ownship, weather, layer set) until I1 wires the real app state; the surface and hooks are final.
 */
export function MapScreen({ screen, allLayers = false }: { screen: StripScreen; allLayers?: boolean }) {
  const { width } = useWindowDimensions();
  const stripWidth = width < 600 ? 104 : STRIP_WIDTH_PT; // iPhone rail is 104pt; the spike targets iPad
  const night = screen === 'night';
  const animate = useAnimateFlag();

  const appState = useMemo(
    () => ({
      region: 'us' as const,
      visibleLayers: new Set(allLayers ? ALL_LAYERS : SCENARIO_LAYERS),
      mapCenter: INITIAL_VIEW.center,
      mapZoom: INITIAL_VIEW.zoom,
      mapVisibleBounds: null,
    }),
    [allLayers],
  );
  const [db] = useState(lazyDb);
  const controller = useMapController({ appState, db,
    weather: scenarioWeather,
    ...(allLayers && {
      tfr: { currentTFRs: async () => ({ tfrs: [fixtureTfr], fetchedAt: Date.now() }) },
      advisories: { currentAdvisories: async () => ({ advisories: [fixtureAdvisory], fetchedAt: Date.now() }) },
    }),
  });
  const ownship = useScenarioOwnship(animate);
  const model = useMapModel({
    controller,
    ownship,
    // Fixture captures hold the camera on the scenario view (as the SwiftUI reference does); I1 passes the real flag.
    ownshipInRegion: false,
    rulerMinutes: scenario.trackRulerMinutes,
    route: allLayers ? SCENARIO_ROUTE : null,
  });

  return (
    <SafeAreaProvider>
      <View style={styles.row}>
        <StripColumn screen={screen} width={stripWidth} />
        <View style={styles.map}>
          <MapSurface
            night={night}
            sectional
            region={model.snapshot.region}
            visibleLayers={model.snapshot.visibleLayers}
            layers={layerSpecsFor(model.snapshot.region)}
            sources={model.sources}
            initialView={INITIAL_VIEW}
            camera={model.camera}
            onViewChange={model.onViewChange}
            onStyleLoaded={model.onStyleLoaded}
          />
        </View>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  map: { flex: 1 },
});
