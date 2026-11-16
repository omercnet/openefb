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
import { useAirportDiagrams } from '../map/useAirportDiagrams';
import { useIsraelChart } from '../map/useIsraelChart';
import { offlineStatusFor } from '../map/offlineStatus';
import { useOfflineMaps } from '../map/useOfflineMaps';
import type { OfflineRegionBounds } from '../../domain/offline/bounds';
import { refreshableMapFor, useDataRefresh } from '../map/refreshDue';
import { useMapController, useMapModel } from '../map/useMapData';
import { ThemeContext } from '../Primitives';
import { Day, Night } from '../tokens';
import { appStore, useAppStore } from '../state/appStore';
import { flightLog } from '../flightLog/store';
import { useOwnship } from '../state/ownship';
import { useIsNight } from '../state/night';
import { useRuntime } from '../state/runtimeContext';
import { layers } from '../columns/layers/store';
import { bindLayers } from '../shell/layersFeed';
import { LiveBriefing } from '../shell/LiveBriefing';
import type { Highlight } from '../sheets/briefing/briefingHighlight';
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
  const israelChart = useIsraelChart({
    db: runtime.started.israel,
    notam: runtime.israelNotam,
    enabled: region === 'israel',
    onClosureStatus,
  });
  // IsraelBriefingMapHighlight: the NOTAM drawn from the briefing's "Show on map" until it is cleared.
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  // The highlight is drawn whether or not the chart data loaded (a polygon NOTAM needs no point lookup).
  const extraSources = useMemo(() => {
    if (!israelChart.sources && !highlight) return undefined;
    return { ...israelChart.sources, ...(highlight ? { 'il-brief-highlight': highlight.source } : null) };
  }, [israelChart.sources, highlight]);
  const model = useMapModel({
    controller,
    ownship,
    ownshipInRegion: ownship.position !== null && regionContains(region, ownship.position),
    route,
    initialMode: mapMode,
    extraSources,
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
  // The Layers clock ticks each minute: the status is judged again, so a pack expires at the cycle boundary.
  const clock = layers.useData((s) => s.now);
  const [bounds, setBounds] = useState<OfflineRegionBounds | null>(null);
  const offline = useOfflineMaps(runtime.offline);
  const sectionalOn = model.snapshot.visibleLayers.has('sectional');
  useEffect(() => {
    layersStore.setState({ offlineStatus: offlineStatusFor(runtime.offline, bounds, sectionalOn, Date.now()) });
  }, [layersStore, runtime.offline, bounds, sectionalOn, offline, clock]);
  const trackedViewChange = useCallback(
    (change: Parameters<typeof onViewChange>[0]) => {
      footerStore.setState({ zoom: change.zoom });
      const visible = {
        south: change.southWest.lat,
        west: change.southWest.lon,
        north: change.northEast.lat,
        east: change.northEast.lon,
      };
      setBounds(visible);
      appStore.getState().setMapBounds(visible);
      onViewChange(change);
    },
    [footerStore, onViewChange],
  );
  const diagrams = useAirportDiagrams({
    source: runtime.chartPacks.diagramSource,
    region: model.snapshot.region,
    enabled: () => layersStore.getState().airportDiagrams,
    subscribeEnabled: (listener) =>
      layersStore.subscribe((s, p) => s.airportDiagrams !== p.airportDiagrams && listener()),
    remote: runtime.started.remoteConfig,
  });
  const { onCamera: diagramCamera } = diagrams;
  const viewAndDiagrams = useCallback(
    (change: Parameters<typeof onViewChange>[0]) => {
      trackedViewChange(change);
      diagramCamera(change);
    },
    [trackedViewChange, diagramCamera],
  );
  const modelWithZoom = useMemo(() => ({ ...model, onViewChange: viewAndDiagrams }), [model, viewAndDiagrams]);

  // The NRST cell refreshes on every fix while another column is open (MapContainerView's onChange(ownshipPosition)).
  useNearestAirports();
  useDataRefresh(() => ({
    map: refreshableMapFor(controller),
    lowPower: runtime.lowPower.isEnabled(),
    networkAvailable: !flightLog.store.getState().isOffline,
  }));

  const presentingBriefing = useAppStore((s) => s.isPresentingBriefing);
  const briefingRoute = useAppStore((s) => s.briefingRoute);
  const dismissBriefing = useCallback(() => appStore.getState().setPresentingBriefing(false), []);
  const { frame } = model;
  const showHighlight = useCallback(
    (shown: Highlight) => {
      setHighlight(shown);
      frame(shown.bounds);
    },
    [frame],
  );
  const clearHighlight = useCallback(() => setHighlight(null), []);
  const fetchFeed = useCallback((force: boolean) => runtime.israelNotam.fetchFeed(force), [runtime.israelNotam]);

  return (
    <>
      <MapLayout
        model={modelWithZoom}
        initialView={initial}
        night={night}
        liveNight={night}
        sectional={model.snapshot.visibleLayers.has('sectional')}
        sectionalOpacity={sectionalOpacity}
        diagrams={diagrams.sources}
      />
      <ThemeContext.Provider value={night ? Night : Day}>
        <LiveBriefing
          highlightActive={highlight !== null}
          fetcher={fetchFeed}
          readStore={runtime.notamReadStore}
          ownship={ownship.position}
          route={briefingRoute}
          pointLookup={israelChart.pointLookup}
          presented={presentingBriefing}
          onDismiss={dismissBriefing}
          onShow={showHighlight}
          onClear={clearHighlight}
        />
      </ThemeContext.Provider>
    </>
  );
}
