// Ports efb-212Tests/ServiceTests/FollowModeStateTests.swift (5 cases, same names).
import { followModeState, isFollowing, recenter, suspends, userMovedMap } from './followMode';

describe('Follow Mode State', () => {
  it('followingIsTheDefault', () => {
    const state = followModeState();
    expect(state.mode).toBe('following');
    expect(isFollowing(state)).toBe(true);
  });

  it('userPanSuspendsFollow', () => {
    const state = userMovedMap(followModeState());
    expect(state.mode).toBe('suspended');
    expect(isFollowing(state)).toBe(false);
  });

  it('recenterReengagesFollow', () => {
    expect(isFollowing(recenter(userMovedMap(followModeState())))).toBe(true);
  });

  it('repeatedPansStaySuspendedAndRecenterIsIdempotent', () => {
    let state = userMovedMap(userMovedMap(followModeState()));
    expect(state.mode).toBe('suspended');
    state = recenter(recenter(state));
    expect(state.mode).toBe('following');
  });

  it('onlyUserGesturesSuspend', () => {
    expect(suspends(true)).toBe(true);
    expect(suspends(false)).toBe(false);
  });
});
