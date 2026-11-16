import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Region } from '../../domain/core';
import { AppState as NativeAppState, Linking, View } from 'react-native';
import { fileTextStorage } from '../../adapters/fileTextStorage';
import { airport } from '../columns/airport/store';
import { layers } from '../columns/layers/store';
import { AirportQueriesContext } from '../columns/nearest/sources';
import { nearest } from '../columns/nearest/store';
import { DatabaseUnavailableBanner, RemoteConfigBanner } from '../components/Components';
import { flightLog } from '../flightLog/store';
import { MapScreen } from '../screens/MapScreen';
import { appStore, useAppStore } from '../state/appStore';
import { useRegion } from '../state/region';
import { RuntimeContext } from '../state/runtimeContext';
import { RecordingStoreContext } from '../recording/RecordingStoreContext';
import { StopRecordingDialog } from '../recording/StopRecordingDialog';
import { bindRecording, markRecordingUnavailable } from './recordingBinding';
import type { RecordingRuntime } from './recordingRuntime';
import { flightRecordRepository } from '../../data/repositories';
import { userDataFromDb } from '../../domain/userData';
import { log, logActions } from '../log/store';
import { createLogbookEntryStore } from '../state/logbookEntryStore';
import { createLogFeed } from './logFeed';
import { createPlannerNetworkStore } from './israelPlanner';
import { PlannerHost, UsPlannerHost } from './LivePlanner';
import { createFlightScreenStores } from './flightScreens';
import { LiveSettings } from './LiveSettings';
import { createSettingsServices } from './settingsServices';
import { LiveFlight } from './LiveFlight';
import { LiveScreens } from './LiveScreens';
import { ChartViewer } from './ChartViewer';
import { startAirportColumnLoader } from './airportColumnLoader';
import { airportQueriesFor } from './airportQueries';
import { bannerItems } from './banners';
import { bindNavigationTelemetry } from './navigationTelemetry';
import { persistLayerSettings } from './layersSettings';
import { setHaptics } from '../haptics';
import { ownship } from '../state/ownship';
import { startAlerts } from './alertsBinding';
import { startLiveData } from './liveData';
import { startRemoteConfigChecks } from './remoteConfigChecks';
import type { AppRuntime } from './runtime';

/** The remote config's notices, as the stacked banner (RemoteConfigBanner.swift). */
function RemoteBanner({ runtime }: { runtime: AppRuntime }) {
  const store = runtime.started.remoteConfig;
  const region = useRegion();
  const version = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    store?.getVersion ?? zeroVersion,
    store?.getVersion ?? zeroVersion,
  );
  // Notices and the config expire by the clock without the store changing: re-derive the items every minute.
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    const id = setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 60_000);
    return () => clearInterval(id);
  }, []);
  // The version changes whenever the store's notices or dismissals do; the items are derived from them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => (store ? bannerItems(store, region) : []), [store, region, version, minute]);
  return <RemoteConfigBanner items={items} onDismiss={(id) => store?.dismissBanner(id)} />;
}
const noSubscribe = () => () => undefined;
const zeroVersion = () => 0;

/**
 * ContentView.swift: the banners above the always-mounted map, with the services connected behind them. Mounted by the
 * app shell once the launch sequence (startup.ts) is done.
 */
export function LiveApp({
  runtime,
  startRecording,
  onRegionChange,
}: {
  runtime: AppRuntime;
  /** Settings changed the region: the gate restarts the live app on it (the map, the data and the strip follow). */
  onRegionChange?: (region: Region) => void;
  /** Builds the recording services (runtime.ts `startRecordingServices`); omitted: no recorder (tests). */
  startRecording?: (runtime: AppRuntime) => Promise<RecordingRuntime>;
}) {
  const [recording, setRecording] = useState<RecordingRuntime | null>(null);
  // The Log (LogStackView): flights and entries from the user database, entry editor, and the actions the Log raises.
  const [logbookEntry] = useState(() => createLogbookEntryStore({ userData: userDataFromDb(runtime.started.userDb) }));
  const [feed] = useState(() =>
    createLogFeed({
      userData: userDataFromDb(runtime.started.userDb),
      flights: flightRecordRepository(runtime.started.userDb),
      store: log.store,
      app: appStore,
    }),
  );
  useEffect(() => {
    logActions.store.setState(feed.actions);
    flightLog.store.setState({
      actions: {
        ...flightLog.store.getState().actions,
        openLog: () => appStore.getState().setScreen('log'),
        // The GPS-denied notice (Swift: UIApplication.openSettingsURLString): the system page of this app.
        openSettings: () =>
          void Linking.openSettings().catch((error) => console.warn('Could not open Settings', error)),
      },
    });
    void feed.refresh();
    // The Log reads again whenever it opens, and when a recording has been saved.
    return appStore.subscribe((state, previous) => {
      if (state.selectedScreen === 'log' && previous.selectedScreen !== 'log') void feed.refresh();
    });
  }, [feed]);
  useEffect(() => {
    if (!recording) return;
    return recording.store.subscribe((state, previous) => {
      if (state.persistenceSerial !== previous.persistenceSerial) void feed.refresh();
    });
  }, [recording, feed]);
  const { started } = runtime;
  const databaseError = useAppStore((s) => s.databaseError);
  // The restored region goes in before the first render (the Nearest hook reads the slice).
  // The Israel flight plan (Swift: FlightPlanView shows IsraelFlightPlanView in the Israel region). One store per opening.
  const renderFlight = (flightId: string, close: () => void) =>
    recording ? (
      <LiveFlight
        flightId={flightId}
        load={(id) => flightRecordRepository(started.userDb).get(id)}
        build={(flight) =>
          createFlightScreenStores({
            flight,
            database: recording.database,
            israel: started.region === 'israel' ? started.israel : null,
            debrief: runtime.debrief,
            openAudio: runtime.openReplayAudio,
          })
        }
        recording={recording.store}
        databaseOpened
        onClose={close}
      />
    ) : null;
  const [networkStore] = useState(() => createPlannerNetworkStore(runtime.preferences));
  const renderPlanner = (close: () => void) =>
    started.region !== 'israel' ? (
      <UsPlannerHost
        deps={{
          aviation: started.aviation,
          userDb: started.userDb,
          aircraft: () => runtime.profiles.aircraft.getState().profiles,
          app: appStore,
        }}
        onClose={close}
      />
    ) : (
      <PlannerHost
        deps={{
          israel: started.israel,
          notam: runtime.israelNotam,
          profiles: () => ({
            aircraft: runtime.profiles.aircraft.getState().profiles,
            pilots: runtime.profiles.pilot.getState().profiles,
          }),
          app: appStore,
          signal: (name, parameters) =>
            (runtime.telemetry.signal as (n: string, p?: unknown) => void)(name, parameters),
        }}
        networkStore={networkStore}
        onClose={close}
      />
    );
  // Settings (Swift: SettingsView over the log). The services keep their identity while the screen is open.
  const settingsServices = useMemo(
    () =>
      createSettingsServices({
        runtime,
        files: fileTextStorage,
        onRegionChange: (region) => onRegionChange?.(region),
        onDisplayModeChange: (mode) => layers.store.setState({ displayMode: mode }),
      }),
    [runtime, onRegionChange],
  );
  const renderSettings = (close: () => void) => (
    <LiveSettings
      services={settingsServices}
      aircraft={runtime.profiles.aircraft}
      pilot={runtime.profiles.pilot}
      offline={runtime.offline}
      mapBounds={() => appStore.getState().mapBounds}
      onClose={close}
    />
  );
  const queries = useMemo(() => airportQueriesFor(runtime), [runtime]);

  useEffect(() => {
    if (started.databaseError) appStore.getState().reportDatabaseError(started.databaseError);
    else appStore.getState().clearDatabaseError();
  }, [started.databaseError]);

  useEffect(() => {
    const stopData = startLiveData({ location: runtime.location, network: runtime.network, region: started.region });
    const stopAirport = startAirportColumnLoader({
      app: appStore,
      column: airport.store,
      aviation: started.aviation,
      israel: started.israel,
      weather: runtime.weather,
      region: () => started.region,
      clock: Date.now,
      directTo: (a) => nearest.store.getState().directTo(a),
      charts: runtime.terminal,
      notams: runtime.notams,
      pireps: runtime.pirep,
      windsAloft: runtime.windsAloft,
      notamConfigured: runtime.notamConfigured,
      openChart: (chart) => appStore.getState().openChartViewer(chart),
    });
    const stopChecks = started.remoteConfig
      ? startRemoteConfigChecks({
          store: started.remoteConfig,
          flightLog: flightLog.store,
          appActive: {
            subscribe: (listener) => {
              const sub = NativeAppState.addEventListener('change', (state) => listener(state === 'active'));
              return () => sub.remove();
            },
          },
        })
      : () => undefined;
    const stopTelemetry = bindNavigationTelemetry(appStore, runtime.telemetry);
    // Swift's global Haptics: the views tap through it; installed for the life of the live app.
    setHaptics(runtime.haptics);
    // Proximity and Israel alerts (MapContainerView.initializeServices): notices, banner and the warning haptic.
    const alertsBinding = startAlerts({
      runtime,
      haptics: runtime.haptics,
      flightLog: flightLog.store,
      ownship: ownship.store,
      visibleLayers: () => layers.store.getState().visibleLayers,
      subscribeLayers: (listener) => layers.store.subscribe(listener),
      log: console.warn,
    });
    const stopSettings = persistLayerSettings(layers.store, started.userDb, fileTextStorage, console.warn);
    return () => {
      alertsBinding.stop();
      setHaptics(null);
      stopTelemetry();
      stopSettings();
      stopData();
      stopAirport();
      stopChecks();
    };
  }, [runtime, started]);

  // The planners and the profile screens read the profiles, whether or not the recording database opened.
  useEffect(() => {
    void runtime.profiles.load().catch((error) => console.warn('The profiles did not load', error));
  }, [runtime]);

  useEffect(() => {
    if (!startRecording) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    startRecording(runtime).then(
      async (services) => {
        // The services are the process's (startRecordingServices): a recording in progress outlives this screen, and a
        // remount binds to the same coordinator instead of starting a second one.
        if (cancelled) return;
        stop = bindRecording(services, flightLog.store, NativeAppState, runtime.haptics);
        setRecording(services);
        // Crash recovery (Swift: FlightRecoveryService at launch): the profiles settle the active ids first.
        try {
          await runtime.profiles.load();
        } catch (error) {
          // Recovering now would save the flights with no aircraft or pilot, and a saved flight is never revisited: they
          // stay in the recording database for the next launch.
          console.warn('Crash recovery postponed: the profiles did not load', error);
          return;
        }
        await services.recoverOrphans(runtime.profiles.activeIds()).catch((e) => console.warn('Recovery failed', e));
      },
      (error) => {
        console.warn('Recording database unavailable', error);
        if (!cancelled) markRecordingUnavailable(flightLog.store);
      },
    );
    return () => {
      cancelled = true;
      stop?.();
      setRecording(null);
    };
  }, [runtime, startRecording]);

  return (
    <RuntimeContext.Provider value={runtime}>
      <AirportQueriesContext.Provider value={queries}>
        <RecordingStoreContext.Provider value={recording?.store ?? null}>
          <View style={{ flex: 1 }}>
            <DatabaseUnavailableBanner visible={databaseError !== null} />
            <RemoteBanner runtime={runtime} />
            <View style={{ flex: 1 }}>
              <MapScreen />
            </View>
            <LiveScreens
              logbookEntry={logbookEntry}
              onOverlayClosed={() => void feed?.refresh()}
              renderPlanner={renderPlanner}
              {...(recording ? { renderFlight } : {})}
              renderSettings={renderSettings}
            />
            <ChartViewer terminal={runtime.terminal} />
            {recording ? <StopRecordingDialog store={recording.store} onConfirmed={runtime.haptics.success} /> : null}
          </View>
        </RecordingStoreContext.Provider>
      </AirportQueriesContext.Provider>
    </RuntimeContext.Provider>
  );
}
