// Port of Services/IsraelAircraftNetworkPreference.swift: which Israeli route network an aircraft usually flies (CVFR for
// GA, the sport-aviation network for LSA and ultralight aircraft). The planner preselects it from the active aircraft;
// the pilot can still pick. Swift keeps it in UserDefaults keyed by the profile UUID; here the storage is the
// `NetworkPreferenceStore` interface (a settings adapter implements it; tests use a Map).
import { ROUTE_NETWORKS, type IsraelRouteNetwork } from '../../data/aviation/israelTypes';

export interface NetworkPreferenceStore {
  getString(key: string): string | null;
  setString(key: string, value: string): void;
  remove(key: string): void;
}

const key = (profileID: string): string => `israel.routeNetwork.${profileID}`;

/** null when the pilot has not said (the planner then starts on CVFR) or the stored value is not a network. */
export function preferredNetwork(profileID: string, store: NetworkPreferenceStore): IsraelRouteNetwork | null {
  const raw = store.getString(key(profileID));
  return ROUTE_NETWORKS.find((n) => n === raw) ?? null;
}

/** Pass null to clear the preference. */
export function setPreferredNetwork(
  network: IsraelRouteNetwork | null,
  profileID: string,
  store: NetworkPreferenceStore,
): void {
  if (network === null) store.remove(key(profileID));
  else store.setString(key(profileID), network);
}
