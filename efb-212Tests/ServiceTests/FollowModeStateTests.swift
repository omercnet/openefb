//
//  FollowModeStateTests.swift
//  efb-212Tests
//
//  Follow-ownship state machine (design finding F3): pan suspends, Recenter re-engages.
//

import Testing
@testable import efb_212

@Suite("Follow Mode State")
struct FollowModeStateTests {

    @Test func followingIsTheDefault() {
        let state = FollowModeState()
        #expect(state.mode == .following)
        #expect(state.isFollowing)
    }

    @Test func userPanSuspendsFollow() {
        var state = FollowModeState()
        state.userMovedMap()
        #expect(state.mode == .suspended)
        #expect(state.isFollowing == false)
    }

    @Test func recenterReengagesFollow() {
        var state = FollowModeState()
        state.userMovedMap()
        state.recenter()
        #expect(state.isFollowing)
    }

    @Test func repeatedPansStaySuspendedAndRecenterIsIdempotent() {
        var state = FollowModeState()
        state.userMovedMap()
        state.userMovedMap()
        #expect(state.mode == .suspended)
        state.recenter()
        state.recenter()
        #expect(state.mode == .following)
    }

    @Test func onlyUserGesturesSuspend() {
        // Our own follow updates and zoom buttons arrive as programmatic camera changes.
        #expect(FollowModeState.suspends(isUserGesture: true))
        #expect(FollowModeState.suspends(isUserGesture: false) == false)
    }
}
