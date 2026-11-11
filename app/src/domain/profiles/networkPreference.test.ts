// Port of Services/IsraelAircraftNetworkPreference.swift over Preferences. The Swift enum is covered by L3's IsraelLSAPlannerTests;
// these cases follow its source.
import { FakePreferences } from '../ports/preferences';
import { preferencesNetworkPreference, routeNetworkKey } from './networkPreference';

describe('IsraelAircraftNetworkPreference', () => {
  it('stores one string per aircraft under israel.routeNetwork.<id>', async () => {
    const prefs = new FakePreferences();
    await preferencesNetworkPreference(prefs).set('abc', 'lsa');
    expect(routeNetworkKey('abc')).toBe('israel.routeNetwork.abc');
    expect(await prefs.get('israel.routeNetwork.abc')).toBe('lsa');
  });

  it('reads nothing until the pilot has said, then the stored network', async () => {
    const pref = preferencesNetworkPreference(new FakePreferences());
    expect(await pref.get('abc')).toBeNull();
    await pref.set('abc', 'cvfr');
    expect(await pref.get('abc')).toBe('cvfr');
    expect(await pref.get('other')).toBeNull();
  });

  it('setting none clears the preference (set(nil))', async () => {
    const prefs = new FakePreferences();
    const pref = preferencesNetworkPreference(prefs);
    await pref.set('abc', 'lsa');
    await pref.set('abc', null);
    expect(await pref.get('abc')).toBeNull();
    expect(await prefs.get('israel.routeNetwork.abc')).toBeNull();
  });

  it('an unknown stored value reads as none (IsraelRouteNetwork(rawValue:) is nil)', async () => {
    const pref = preferencesNetworkPreference(new FakePreferences({ 'israel.routeNetwork.abc': 'helicopter' }));
    expect(await pref.get('abc')).toBeNull();
  });
});
