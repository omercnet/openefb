import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState as NativeAppState, View } from 'react-native';
import { airport } from '../columns/airport/store';
import { AirportQueriesContext } from '../columns/nearest/sources';
import { nearest } from '../columns/nearest/store';
import { DatabaseUnavailableBanner, RemoteConfigBanner } from '../components/Components';
import { flightLog } from '../flightLog/store';
import { MapScreen } from '../screens/MapScreen';
import { appStore, useAppStore } from '../state/appStore';
import { useRegion } from '../state/region';
import { RuntimeContext } from '../state/runtimeContext';
import { startAirportColumnLoader } from './airportColumnLoader';
import { airportQueriesFor } from './airportQueries';
import { bannerItems } from './banners';
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
  // The version changes whenever the store's notices or dismissals do; the items are derived from them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => (store ? bannerItems(store, region) : []), [store, region, version]);
  return <RemoteConfigBanner items={items} onDismiss={(id) => store?.dismissBanner(id)} />;
}
const noSubscribe = () => () => undefined;
const zeroVersion = () => 0;

/**
 * ContentView.swift: the banners above the always-mounted map, with the services connected behind them. Mounted by the
 * app shell once the launch sequence (startup.ts) is done.
 */
export function LiveApp({ runtime }: { runtime: AppRuntime }) {
  const { started } = runtime;
  const databaseError = useAppStore((s) => s.databaseError);
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
    return () => {
      stopData();
      stopAirport();
      stopChecks();
    };
  }, [runtime, started]);

  return (
    <RuntimeContext.Provider value={runtime}>
      <AirportQueriesContext.Provider value={queries}>
        <View style={{ flex: 1 }}>
          <DatabaseUnavailableBanner visible={databaseError !== null} />
          <RemoteBanner runtime={runtime} />
          <View style={{ flex: 1 }}>
            <MapScreen />
          </View>
        </View>
      </AirportQueriesContext.Provider>
    </RuntimeContext.Provider>
  );
}
