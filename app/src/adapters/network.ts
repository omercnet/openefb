// Network reachability for the strip's OFFLINE badge (Swift: NWPathMonitor, path.status != .satisfied, in
// MapViewModel). The interface is what the app shell uses; the netinfo implementation is the only platform code.
import NetInfo from '@react-native-community/netinfo';

export interface NetworkStatusSource {
  /** Calls `listener` with the current state, then on every change. Returns the unsubscribe. */
  subscribe(listener: (offline: boolean) => void): () => void;
}

/** Only an explicit "not connected" is offline; an unknown state (null) never claims it. */
export const isOfflineFromNetInfo = (state: { isConnected: boolean | null }): boolean => state.isConnected === false;

export function createNetworkStatusSource(): NetworkStatusSource {
  return {
    subscribe(listener) {
      return NetInfo.addEventListener((state) => listener(isOfflineFromNetInfo(state)));
    },
  };
}

/** A controllable source for tests. */
export function createFakeNetworkStatus(
  initialOffline = false,
): NetworkStatusSource & { set: (offline: boolean) => void } {
  let offline = initialOffline;
  const listeners = new Set<(offline: boolean) => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(offline);
      return () => listeners.delete(listener);
    },
    set(next) {
      if (next === offline) return;
      offline = next;
      for (const l of [...listeners]) l(next);
    },
  };
}
