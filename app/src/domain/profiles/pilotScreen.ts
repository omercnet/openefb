// What Views/Aircraft/PilotProfileView.swift shows for a given set of profiles, as a pure decision so it is testable and the
// Swift behaviour below is explicit.
import type { PilotProfile } from '../../data/models';

export interface PilotScreenLayout {
  /** No profiles: the body is the "Create Pilot Profile" button. */
  empty: boolean;
  /** The "Pilot Profiles" list, with a tap to make one active: only when there is more than one profile. */
  showProfileList: boolean;
  /** Pilot Info, Currency Status and Night Landings are shown for this profile; null shows none of them. */
  active: PilotProfile | null;
  /** The toolbar plus: with at most one profile and none active. */
  showAddToolbar: boolean;
}

/**
 * SWIFT BUG, preserved: a new PilotProfile is inactive and nothing activates it, so with exactly one profile `active` is null
 * and the screen shows no profile at all (the list needs two). Making the first profile active on creation fixes it;
 * that needs owner approval (U7.md).
 */
export function pilotScreenLayout(profiles: readonly PilotProfile[]): PilotScreenLayout {
  const active = profiles.find((p) => p.isActive) ?? null;
  return {
    empty: profiles.length === 0,
    showProfileList: profiles.length > 1,
    active,
    showAddToolbar: profiles.length <= 1 && active === null,
  };
}
