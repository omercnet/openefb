import { useLayoutEffect, useMemo, useState } from 'react';
import { openAviationDatabase } from '../../adapters/aviationDb';
import type { MapLayer } from '../../domain/core';
import type { MapDataSource } from '../../domain/map/mapDataController';
import { fixtureAdvisory, fixtureTfr } from '../../fixtures/mapLayers';
import { scenario } from '../../fixtures/scenario';
import { scenarioWeather, useAnimateFlag, useScenarioOwnship } from './scenarioFeed';
import { MapLayout } from '../map/MapLayout';
import type { StripScreen } from '../StripColumn';
import { useMapController, useMapModel } from '../map/useMapData';
import type { StripColumnKind } from '../../domain/types';
import { AirportQueriesContext } from '../columns/nearest/sources';
import { appStore } from '../state/appStore';
import { applyCaptureSeeds, captureAirportQueries } from './seeds';

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
export function MapCaptureScreen({ screen, allLayers = false }: { screen?: StripScreen; allLayers?: boolean }) {
  // After the first commit but before paint (a layout effect): writing the store during render would update the strip of
  // a route that is still mounted, which React flags in development. After that the strip follows the store, so the Log
  // back button and the footer toggles work in a dev build.
  useLayoutEffect(() => {
    if (screen) appStore.setState(OPENS_WITH[screen]);
  }, [screen]);
  // The reference data goes into the slices before the first render: the capture routes compare against fixed screens.
  const [queries] = useState(() => {
    applyCaptureSeeds();
    return captureAirportQueries();
  });
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

  return (
    <AirportQueriesContext.Provider value={queries}>
      <MapLayout screen={screen} night={night} model={model} initialView={INITIAL_VIEW} />
    </AirportQueriesContext.Provider>
  );
}
