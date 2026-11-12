// No Swift suite targets IsraelAircraftNetworkPreference directly (it is exercised through the planner view model, U-track);
// these cases pin its key format and parsing.
import { preferredNetwork, setPreferredNetwork, type NetworkPreferenceStore } from './aircraftNetworkPreference';

function memoryStore(): NetworkPreferenceStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getString: (k) => data.get(k) ?? null,
    setString: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

describe('Aircraft network preference', () => {
  test('is unset until the pilot picks', () => {
    expect(preferredNetwork('P1', memoryStore())).toBeNull();
  });

  test('stores per profile under the Swift key and clears with null', () => {
    const store = memoryStore();
    setPreferredNetwork('lsa', 'P1', store);
    expect(store.data.get('israel.routeNetwork.P1')).toBe('lsa');
    expect(preferredNetwork('P1', store)).toBe('lsa');
    expect(preferredNetwork('P2', store)).toBeNull();
    setPreferredNetwork(null, 'P1', store);
    expect(preferredNetwork('P1', store)).toBeNull();
  });

  test('an unknown stored value reads as unset', () => {
    const store = memoryStore();
    store.data.set('israel.routeNetwork.P1', 'gliders');
    expect(preferredNetwork('P1', store)).toBeNull();
  });
});
