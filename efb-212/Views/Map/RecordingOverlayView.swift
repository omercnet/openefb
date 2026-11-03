//
//  RecordingOverlayView.swift
//  efb-212
//
//  Recording UI overlay on the map view (F9):
//  - Record button (top-left, 60pt): neutral at rest, filled stop square while recording
//  - REC pill: "REC 00:12:34", flight phase and an audio level meter
//  - Microphone-denied notice with an "Open Settings" action (GPS track still records)
//  - Live transcript panel (collapsible, last 5 segments)
//  - Auto-start countdown display (3-2-1 with cancel)
//  - Stop confirmation dialog "End recording?"
//
//  EFB lens: red is reserved for warnings, so recording uses the accent colour; no pulsing
//  or other decorative animation in flight.
//

import SwiftUI
import UIKit

struct RecordingOverlayView: View {
    let viewModel: RecordingViewModel

    @Environment(\.openURL) private var openURL

    var body: some View {
        @Bindable var vm = viewModel

        VStack(alignment: .leading, spacing: Space.s) {
            HStack(alignment: .top) {
                recordButton
                    .padding(.leading, Space.l)

                Spacer()

                if viewModel.isRecording {
                    recordingStatusBar
                }

                Spacer()
            }

            if viewModel.microphoneDenied {
                microphoneDeniedNotice
                    .padding(.horizontal, Space.l)
            }

            if let error = viewModel.lastError {
                recordingErrorNotice(error)
                    .padding(.horizontal, Space.l)
            }

            if viewModel.showDiscardedNotice {
                discardedNotice
                    .padding(.horizontal, Space.l)
            }

            Spacer()
        }
        .confirmationDialog(
            "End recording?",
            isPresented: $vm.showStopConfirmation,
            titleVisibility: .visible
        ) {
            Button("End Recording", role: .destructive) {
                Task {
                    await viewModel.confirmStop()
                    Haptics.success()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Stops the GPS track, cockpit audio and transcript. The flight is saved to Flights.")
        }
    }

    // MARK: - Record Button

    @ViewBuilder
    private var recordButton: some View {
        Button {
            Task {
                switch viewModel.recordingStatus {
                case .idle:
                    await viewModel.startRecording()
                    if viewModel.microphoneDenied || viewModel.lastError != nil {
                        Haptics.warning()
                    } else {
                        Haptics.success()
                    }
                case .recording:
                    viewModel.requestStop()
                case .countdown:
                    await viewModel.cancelCountdown()
                default:
                    break
                }
            }
        } label: {
            ZStack {
                if viewModel.isCountingDown {
                    // Countdown: number, tap to cancel
                    Circle()
                        .fill(Palette.cautionFill)
                        .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
                    Text("\(viewModel.countdownRemaining)")
                        .font(.title2.bold())
                        .foregroundStyle(.black)
                } else if viewModel.isRecording {
                    // Recording: solid accent circle with a ring and a stop square, distinct from idle glass
                    Circle()
                        .fill(Palette.accent)
                        .overlay(Circle().stroke(Palette.onAccent, lineWidth: 3))
                        .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
                    RoundedRectangle(cornerRadius: Radius.xs)
                        .fill(Palette.onAccent)
                        .frame(width: 18, height: 18)
                } else {
                    // Idle: navy glass circle with a mic glyph, the same family as the other map controls
                    // (not warning red)
                    Image(systemName: "mic.fill")
                        .font(.title3)
                        .frame(width: MapControlMetrics.size, height: MapControlMetrics.size)
                        .mapControlSurface(in: .circle)
                }
            }
            .contentShape(Circle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(recordButtonLabel)
        .accessibilityIdentifier("record-button")
    }

    private var recordButtonLabel: String {
        switch viewModel.recordingStatus {
        case .idle: return "Start recording"
        case .recording: return "Stop recording"
        case .countdown: return "Cancel countdown"
        case .paused: return "Resume recording"
        case .stopping: return "Stopping recording"
        }
    }

    // MARK: - REC pill

    @ViewBuilder
    private var recordingStatusBar: some View {
        HStack(spacing: Space.s) {
            Text("REC")
                .font(.subheadline.weight(.heavy))
                .foregroundStyle(Palette.accentText)

            Text(viewModel.formattedElapsedTime)
                .font(.subheadline.monospacedDigit().bold())
                .foregroundStyle(Palette.primaryText)
                .accessibilityIdentifier("rec-elapsed")

            Text(viewModel.currentPhase.rawValue.capitalized)
                .font(.caption)
                .foregroundStyle(Palette.secondaryText)

            if !viewModel.microphoneDenied {
                AudioLevelMeter(dBFS: viewModel.audioLevel)
            }
        }
        .padding(.horizontal, Space.m)
        .padding(.vertical, Space.s)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .padding(.trailing, Space.l)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("rec-pill")
    }

    // MARK: - Microphone denied

    private var microphoneDeniedNotice: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Label("Microphone is off", systemImage: "mic.slash.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.caution)
            Text("The GPS track still records. For cockpit audio, turn the microphone on in Settings \u{203A} Kanaf \u{203A} Microphone.")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.secondaryText)
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    openURL(url)
                }
            } label: {
                // The frame sits inside the label so the bordered button itself is >= 60 pt.
                Text("Open Settings")
                    .frame(minWidth: MapControlMetrics.size, minHeight: MapControlMetrics.size)  // in-flight control: >= 60 pt
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }
        .padding(Space.m)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
        .frame(maxWidth: 420, alignment: .leading)
        .accessibilityIdentifier("mic-denied-notice")
    }

    // MARK: - Recording error

    /// A failed start or a mid-flight failure (e.g. audio write error), dismissible.
    /// Amber (caution) while recording continues, red (warning) once recording has stopped.
    private func recordingErrorNotice(_ error: EFBError) -> some View {
        let isCaution = viewModel.lastErrorSeverity == .caution
        let tint = isCaution ? Palette.caution : Palette.warning
        return HStack(alignment: .top, spacing: Space.s) {
            VStack(alignment: .leading, spacing: Space.xs) {
                Label(isCaution ? "Audio stopped" : "Recording failed",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(tint)
                Text(isCaution
                     ? "Cockpit audio and transcript stopped. The GPS track is still recording. \(Self.detail(of: error))"
                     : "Recording is not running. \(Self.detail(of: error))")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.secondaryText)
            }
            Spacer(minLength: Space.s)
            Button { viewModel.dismissError() } label: {
                // The frame sits inside the label so the bordered button itself is >= 60 pt.
                Text("Dismiss")
                    .frame(minWidth: MapControlMetrics.size, minHeight: MapControlMetrics.size)  // in-flight control: >= 60 pt
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .accessibilityLabel("Dismiss recording problem")
        }
        .padding(Space.m)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius)
                .stroke(tint, lineWidth: 2)
        )
        .frame(maxWidth: 420, alignment: .leading)
        .accessibilityIdentifier(isCaution ? "recording-error-notice-caution" : "recording-error-notice-warning")
    }

    /// The underlying cause without the "Recording failed:" prefix the notice title already says.
    private static func detail(of error: EFBError) -> String {
        switch error {
        case .recordingFailed(let underlying), .audioSessionFailed(let underlying):
            return underlying.localizedDescription
        default:
            return error.localizedDescription
        }
    }

    // MARK: - Discarded recording

    /// The recording ended with no GPS track points, so nothing was saved. Amber, dismissible.
    private var discardedNotice: some View {
        HStack(alignment: .top, spacing: Space.s) {
            VStack(alignment: .leading, spacing: Space.xs) {
                Label("Recording not saved", systemImage: "trash.slash.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.caution)
                Text("No GPS position was recorded, so there is no flight to keep. Check that Location is on and the aircraft had a fix before starting.")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.secondaryText)
            }
            Spacer(minLength: Space.s)
            Button { viewModel.showDiscardedNotice = false } label: {
                // The frame sits inside the label so the bordered button itself is >= 60 pt.
                Text("Dismiss")
                    .frame(minWidth: MapControlMetrics.size, minHeight: MapControlMetrics.size)  // in-flight control: >= 60 pt
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .accessibilityLabel("Dismiss recording not saved notice")
        }
        .padding(Space.m)
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: MapControlMetrics.cornerRadius))
        .frame(maxWidth: 420, alignment: .leading)
        .accessibilityIdentifier("recording-discarded-notice")
    }
}

// MARK: - Audio level meter

/// Five-segment input level meter. Maps -60...-10 dBFS onto the segments; no animation.
struct AudioLevelMeter: View {
    let dBFS: Float  // dBFS, -160 = silence / no signal

    private static let segments = 5

    private var lit: Int {
        let clamped = min(max(dBFS, -60), -10)
        return Int(((clamped + 60) / 50 * Float(Self.segments)).rounded(.up))
    }

    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<Self.segments, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1)
                    .fill(index < lit ? Palette.primaryText : Palette.fill)
                    .frame(width: 4, height: 8 + CGFloat(index) * 2)
            }
        }
        .frame(height: 16, alignment: .bottom)
        .accessibilityLabel("Audio level")
        .accessibilityValue("\(lit) of \(Self.segments)")
    }
}

// MARK: - Preview

#Preview {
    ZStack {
        Palette.fill
            .ignoresSafeArea()
        // Preview requires real coordinator -- this is for layout only
        Text("Map placeholder")
    }
}
