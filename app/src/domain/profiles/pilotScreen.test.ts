// What Views/Aircraft/PilotProfileView.swift shows for a given set of profiles. Swift has no test of it; the cases follow the
// Swift view, including a Swift bug that is preserved on purpose (see app/docs/port-notes/U7.md).
import { newPilotProfile } from '../../data/defaults';
import type { PilotProfile } from '../../data/models';
import { pilotScreenLayout } from './pilotScreen';

const pilot = (id: string, isActive: boolean): PilotProfile => newPilotProfile({ id, isActive, createdAt: 1 });

describe('pilotScreenLayout', () => {
  it('no profiles: the Create Pilot Profile button, and the toolbar plus', () => {
    expect(pilotScreenLayout([])).toEqual({
      empty: true,
      showProfileList: false,
      active: null,
      showAddToolbar: true,
    });
  });

  it('one active profile: its info, currency and night landings, no list, no toolbar plus', () => {
    const only = pilot('a', true);
    expect(pilotScreenLayout([only])).toEqual({
      empty: false,
      showProfileList: false,
      active: only,
      showAddToolbar: false,
    });
  });

  it('two profiles: the list shows, and the info is the active one', () => {
    const [first, second] = [pilot('a', false), pilot('b', true)];
    expect(pilotScreenLayout([first, second])).toEqual({
      empty: false,
      showProfileList: true,
      active: second,
      showAddToolbar: false,
    });
  });

  it('two profiles and none active: the list shows (tapping a row activates it), no info', () => {
    const layout = pilotScreenLayout([pilot('a', false), pilot('b', false)]);
    expect(layout).toMatchObject({ showProfileList: true, active: null, showAddToolbar: false });
  });

  // The layout is Swift's. Creating a profile now activates the first one (Q5, see profileData.ts), so this state no longer comes
  // from the app itself; it can still be in the data (a deleted active profile, an older install).
  it('one profile that is not active: no list and no info, only Add Pilot Profile', () => {
    const only = pilot('a', false);
    expect(pilotScreenLayout([only])).toEqual({
      empty: false,
      showProfileList: false,
      active: null,
      showAddToolbar: true,
    });
  });

  it('the first active profile is the one shown when several are marked active', () => {
    const [a, b] = [pilot('a', true), pilot('b', true)];
    expect(pilotScreenLayout([a, b]).active).toBe(a);
  });
});
