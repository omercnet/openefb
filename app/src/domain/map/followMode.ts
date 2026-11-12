// Port of efb-212/Services/FollowModeState.swift: follow-ownship state machine (design finding F3).
// Following is the default; a user pan suspends it until Recenter re-engages it. Programmatic camera moves never do.
export type FollowMode = 'following' | 'suspended';

export interface FollowModeState {
  readonly mode: FollowMode;
}

export const followModeState = (): FollowModeState => ({ mode: 'following' });

export const isFollowing = (s: FollowModeState): boolean => s.mode === 'following';

/** A camera change driven by the user's finger (pan or rotate) suspends follow. */
export const userMovedMap = (_s: FollowModeState): FollowModeState => ({ mode: 'suspended' });

/** Recenter button: re-engage follow. */
export const recenter = (_s: FollowModeState): FollowModeState => ({ mode: 'following' });

/** Whether a camera change should suspend follow: true for pan/rotate gestures, false for programmatic moves. */
export const suspends = (isUserGesture: boolean): boolean => isUserGesture;
