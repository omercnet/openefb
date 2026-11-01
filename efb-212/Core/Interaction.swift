//
//  Interaction.swift
//  efb-212
//
//  Feedback primitives for custom controls (T08 microinteractions): a pressed state for every
//  custom button and haptics. Haptics fire once per user action or alert transition, never in
//  a loop. No decorative animation: the pressed state is instant.
//

import SwiftUI
import UIKit

/// Pressed state for custom buttons: dims and shrinks slightly while the finger is down.
/// Instant (no animation) so it also reads in turbulence and costs nothing on the map.
struct PressableButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.55 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(nil, value: configuration.isPressed)
    }
}

/// Haptic feedback. Call once per discrete event.
@MainActor
enum Haptics {
    /// Toggle or selection changed.
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    /// Completed action: recording started / stopped, data loaded after a retry.
    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    /// A new alert appeared (TFR / proximity), or recording failed to start.
    static func warning() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }
}
