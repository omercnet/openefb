import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppFailure } from '../../domain/errors';
import { regionContains, regionDefaultCenter, regionDefaultZoom } from '../../domain/core';
import type { MapDataSource } from '../../domain/map/mapDataController';
import { initialVisibleLayers } from '../../domain/map/initialLayers';
import { useNearestAirports } from '../columns/nearest/refresh';
import { footer } from '../flightLog/footerStore';
import { MapLayout } from '../map/MapLayout';
import { navigationRoute } from '../map/navigationRoute';
import { refreshableMapFor, useDataRefresh } from '../map/refreshDue';
import { useMapController, useMapModel } from '../map/useMapData';
import { useAppStore } from '../state/appStore';
import { flightLog } from '../flightLog/store';
import { useOwnship } from '../state/ownship';
import { useRuntime } from '../state/runtimeContext';
import { layers } from '../columns/layers/store';
import { bindLayers } from '../shell/layersFeed';
import { advisorySource } from '../shell/mapSources';

/** With the aviation database closed every query fails; the controller reports it and the red banner explains. */
const closedDb: MapDataSource = {
  airportsNear: async () => failClosed(),
  toweredAirportsNear: async () => failClosed(),
  airspacesNear: async () => failClosed(),
  navaidsNear: async () => failClosed(),
};
function failClosed(): never {
  throw new AppFailure({ kind: 'databaseCorrupted' });
}

/**
 * The live map screen (MapContainerView.swift): the chart and the strip on the aviation database, the weather, TFR and
 * AIRMET/SIGMET services, the location service and the active navigation. The capture routes render the same layout
 * from fixtures (ui/capture/MapCaptureScreen).
 */
export function MapScreen() {
  const runtime = useRuntime();
  // The region the launch sequence restored, not the slice: LiveApp writes the slice in an effect, after this first render.
  const region = runtime.started.region;
  const [initial] = useState(() => ({ center: regionDefaultCenter(region), zoom: regionDefaultZoom(region) }));
  const [appState] = useState(() => ({
    region,
    visibleLayers: initialVisibleLayers(region),
    mapCenter: initial.center,
    mapZoom: initial.zoom,
    mapVisibleBounds: null,
  }));
  const controller = useMapController({
    appState,
    db: runtime.started.aviation ?? closedDb,
    weather: runtime.weather,
    tfr: runtime.tfr,
    advisories: advisorySource(runtime.advisories),
  });

  const ownship = useOwnship();
  const navigation = useAppStore((s) => s.navigation);
  const route = useMemo(() => navigationRoute(navigation, ownship.position), [navigation, ownship.position]);
  const model = useMapModel({
    controller,
    ownship,
    ownshipInRegion: ownship.position !== null && regionContains(region, ownship.position),
    route,
  });

  // The Layers column and the controller follow each other; the footer's zoom cells follow the camera.
  const layersStore = layers.useStoreApi();
  useEffect(() => bindLayers(controller, layersStore, Date.now), [controller, layersStore]);
  const footerStore = footer.useStoreApi();
  const { zoomTo, recenter } = model;
  useEffect(() => {
    footerStore.setState({ zoomTo, recenter });
  }, [footerStore, zoomTo, recenter]);
  useEffect(() => {
    footerStore.setState({ following: model.isFollowing });
  }, [footerStore, model.isFollowing]);
  const { onViewChange } = model;
  const trackedViewChange = useCallback(
    (change: Parameters<typeof onViewChange>[0]) => {
      footerStore.setState({ zoom: change.zoom });
      onViewChange(change);
    },
    [footerStore, onViewChange],
  );
  const modelWithZoom = useMemo(() => ({ ...model, onViewChange: trackedViewChange }), [model, trackedViewChange]);

  // The NRST cell refreshes on every fix while another column is open (MapContainerView's onChange(ownshipPosition)).
  useNearestAirports();
  useDataRefresh(() => ({
    map: refreshableMapFor(controller),
    lowPower: false,
    networkAvailable: !flightLog.store.getState().isOffline,
  }));

  return <MapLayout model={modelWithZoom} initialView={initial} />;
}
