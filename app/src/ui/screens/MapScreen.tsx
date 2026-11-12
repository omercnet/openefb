import { useLayoutEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { openAviationDatabase } from '../../adapters/aviationDb';
import type { MapLayer } from '../../domain/core';
import { layerSpecsFor } from '../../domain/map/registry';
import type { MapDataSource } from '../../domain/map/mapDataController';
import { fixtureAdvisory, fixtureTfr } from '../../fixtures/mapLayers';
import { scenario } from '../../fixtures/scenario';
import { useLocalGlyphs } from '../../adapters/glyphInstall';
import { CompactMapLayout } from '../CompactMapLayout';
import { useWidthClass, usesCompactLayout } from '../layout';
import { MapSurface } from '../map/MapSurface';
import { REMOTE_GLYPHS_URL } from '../map/surfaceModel';
import { scenarioWeather, useAnimateFlag, useScenarioOwnship } from '../map/scenarioFeed';
import { useMapController, useMapModel } from '../map/useMapData';
import type { StripColumnKind } from '../../domain/types';
import { appStore } from '../state/appStore';
import { panels } from '../state/panels';
import { StripColumn, type StripScreen } from '../StripColumn';
import { StripMetrics } from '../tokens';

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
const ALL_LAYERS: ReadonlySet<MapLayer> = new Set<MapLayer>([
  ...SCENARIO_LAYERS,
  'navaids',
  'airspace',
  'tfrs',
  'advisories',
  'route',
]);
const SCENARIO_ROUTE = {
  kind: 'greatCircle' as const,
  points: [
    { lat: 37.4611, lon: -122.115 }, // KPAO
    { lat: scenario.next.lat, lon: scenario.next.lon }, // KOAK
  ],
};
const INITIAL_VIEW = { center: { lat: scenario.map.center[1], lon: scenario.map.center[0] }, zoom: scenario.map.zoom };

/** The strip column and selected airport each capture route opens with (the fidelity gate's screens). */
const OPENS_WITH: Record<StripScreen, { stripColumn: StripColumnKind; selectedAirportId: string | null }> = {
  map: { stripColumn: 'log', selectedAirportId: null },
  night: { stripColumn: 'log', selectedAirportId: null },
  airport: { stripColumn: 'airport', selectedAirportId: 'KSQL' },
  layers: { stripColumn: 'layers', selectedAirportId: null },
  nearest: { stripColumn: 'nearest', selectedAirportId: null },
  search: { stripColumn: 'search', selectedAirportId: null },
};

/**
 * The map-first layout (MapContainerView.swift): on a regular window the 400pt strip column beside the chart; on a
 * compact window (iPhone, narrow Split View) or with the flight log hidden, the compact layout with the 104pt NEXT rail
 * and NOW and the footer under the chart. A capture route passes `screen`, which decides what the strip opens with and
 * whether it is night; without it the strip just follows the app store.
 */
export function MapScreen({ screen, allLayers = false }: { screen?: StripScreen; allLayers?: boolean }) {
  // After the first commit but before paint (a layout effect): writing the store during render would update the strip of
  // a route that is still mounted, which React flags in development. After that the strip follows the store, so the Log
  // back button and the footer toggles work in a dev build.
  useLayoutEffect(() => {
    if (screen) appStore.setState(OPENS_WITH[screen]);
  }, [screen]);
  const { widthClass, width } = useWidthClass();
  const showsFlightLog = panels.useData((s) => s.showsFlightLog);
  const night = screen === 'night';
  const glyphs = useLocalGlyphs();
  if (glyphs.status === 'failed') console.warn('local glyph install failed; labels need a network', glyphs.error);
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
  const controller = useMapController({
    appState,
    db,
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

  const chart =
    glyphs.status === 'loading' ? null : (
      <MapSurface
        night={night}
        glyphsUrl={glyphs.status === 'ready' ? glyphs.url : REMOTE_GLYPHS_URL}
        sectional
        region={model.snapshot.region}
        visibleLayers={model.snapshot.visibleLayers}
        layers={layerSpecsFor(model.snapshot.region)}
        sources={model.sources}
        initialView={INITIAL_VIEW}
        camera={model.camera}
        onViewChange={model.onViewChange}
        onStyleLoaded={model.onStyleLoaded}
        onTileHealth={model.onTileHealth}
      />
    );
  return (
    <SafeAreaProvider>
      {usesCompactLayout(widthClass, showsFlightLog) ? (
        <CompactMapLayout screen={screen} width={width} compact={widthClass === 'compact'} chart={chart} />
      ) : (
        <View style={styles.row}>
          <StripColumn screen={screen} width={StripMetrics.width} />
          <View style={styles.map}>{chart}</View>
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row' },
  map: { flex: 1 },
});
