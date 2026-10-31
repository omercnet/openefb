//
//  FollowModeState.swift
//  efb-212
//
//  Follow-ownship state machine (design finding F3). Following is the default; a user
//  pan suspends it until Recenter re-engages it. Programmatic camera moves (our own
//  follow updates, zoom buttons) never suspend it.
//

import Foundation

nonisolated struct FollowModeState: Equatable, Sendable {

    enum Mode: Equatable, Sendable {
        /// Camera re-centres on every GPS fix.
        case following
        /// User moved the map; camera stays where the user left it.
        case suspended
    }

    private(set) var mode: Mode = .following

    var isFollowing: Bool { mode == .following }

    /// A camera change driven by the user's finger (pan or rotate gesture) suspends follow.
    /// Pinch/zoom gestures are not passed here: the next fix re-centres anyway.
    mutating func userMovedMap() {
        mode = .suspended
    }

    /// Recenter button: re-engage follow.
    mutating func recenter() {
        mode = .following
    }

    /// Whether a camera change should suspend follow. `isUserGesture` is true for pan or
    /// rotate gestures and false for programmatic moves.
    static func suspends(isUserGesture: Bool) -> Bool {
        isUserGesture
    }
}
