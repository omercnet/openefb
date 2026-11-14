import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppFailure } from '../../domain/errors';
import { regionContains, regionDefaultCenter, regionDefaultZoom } from '../../domain/core';
import type { MapDataSource } from '../../domain/map/mapDataController';
import type { IsraelClosureStatus } from '../../domain/map/israel';
import { initialVisibleLayers } from '../../domain/map/initialLayers';
import { useNearestAirports } from '../columns/nearest/refresh';
import { footer } from '../flightLog/footerStore';
import { MapLayout } from '../map/MapLayout';
import { navigationRoute } from '../map/navigationRoute';
import { useIsraelChart } from '../map/useIsraelChart';
import { offlineStatusFor } from '../map/offlineStatus';
import { useOfflineMaps } from '../map/useOfflineMaps';
import type { OfflineRegionBounds } from '../../domain/offline/bounds';
import { useDataRefresh } from '../map/refreshDue';
import { useMapController, useMapModel } from '../map/useMapData';
import { useAppStore } from '../state/appStore';
import { flightLog } from '../flightLog/store';
import { useOwnship } from '../state/ownship';
import { useIsNight } from '../state/night';
import { useRegion } from '../state/region';
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
  const region = useRegion();
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
  const displayMode = layers.useData((s) => s.displayMode);
  const sectionalOpacity = layers.useData((s) => s.sectionalOpacity);
  const mapMode = layers.useData((s) => s.mapMode);
  const night = useIsNight(displayMode, ownship.position);
  const navigation = useAppStore((s) => s.navigation);
  const route = useMemo(() => navigationRoute(navigation, ownship.position), [navigation, ownship.position]);
  const layersStore = layers.useStoreApi();
  const onClosureStatus = useCallback(
    (status: IsraelClosureStatus) =>
      layersStore.setState({
        closureStatus:
          status.kind === 'noFeed'
            ? { kind: 'noFeed' }
            : { kind: 'loaded', generatedAt: status.generatedAt, level: status.level, closed: status.closedSegments },
      }),
    [layersStore],
  );
  const israelSources = useIsraelChart({
    db: runtime.started.israel,
    notam: runtime.israelNotam,
    enabled: region === 'israel',
    onClosureStatus,
  });
  const model = useMapModel({
    controller,
    ownship,
    ownshipInRegion: ownship.position !== null && regionContains(region, ownship.position),
    route,
    initialMode: mapMode,
    extraSources: israelSources,
  });

  // Orientation (North up / Track up) set in the Layers column drives the camera (MapViewModel.setMapMode).
  const { setMode } = model;
  const setModeRef = useRef(setMode);
  const appliedMode = useRef(mapMode);
  useEffect(() => {
    setModeRef.current = setMode;
  });
  useEffect(() => {
    if (appliedMode.current === mapMode) return;
    appliedMode.current = mapMode;
    setModeRef.current(mapMode);
  }, [mapMode]);
  // The Layers column and the controller follow each other; the footer's zoom cells follow the camera.
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
  const [bounds, setBounds] = useState<OfflineRegionBounds | null>(null);
  const offline = useOfflineMaps(runtime.offline);
  const sectionalOn = model.snapshot.visibleLayers.has('sectional');
  useEffect(() => {
    layersStore.setState({ offlineStatus: offlineStatusFor(runtime.offline, bounds, sectionalOn, Date.now()) });
  }, [layersStore, runtime.offline, bounds, sectionalOn, offline]);
  const trackedViewChange = useCallback(
    (change: Parameters<typeof onViewChange>[0]) => {
      footerStore.setState({ zoom: change.zoom });
      setBounds({
        south: change.southWest.lat,
        west: change.southWest.lon,
        north: change.northEast.lat,
        east: change.northEast.lon,
      });
      onViewChange(change);
    },
    [footerStore, onViewChange],
  );
  const modelWithZoom = useMemo(() => ({ ...model, onViewChange: trackedViewChange }), [model, trackedViewChange]);

  // The NRST cell refreshes on every fix while another column is open (MapContainerView's onChange(ownshipPosition)).
  useNearestAirports();
  useDataRefresh(() => {
    const snapshot = controller.getSnapshot();
    return {
      map: {
        region: snapshot.region,
        visibleLayers: snapshot.visibleLayers,
        weatherFetchedAt: snapshot.weatherFetchedAt,
        tfrFetchedAt: snapshot.tfrFetchedAt,
        advisoriesFetchedAt: snapshot.advisoriesFetchedAt,
        loadWeatherDots: () => controller.loadWeatherDots(),
        loadTFRs: () => controller.loadTFRs(),
        loadAdvisories: () => controller.loadAdvisories(),
      },
      lowPower: false,
      networkAvailable: !flightLog.store.getState().isOffline,
    };
  });

  return (
    <MapLayout
      model={modelWithZoom}
      initialView={initial}
      night={night}
      liveNight={night}
      sectional={model.snapshot.visibleLayers.has('sectional')}
      sectionalOpacity={sectionalOpacity}
    />
  );
}
