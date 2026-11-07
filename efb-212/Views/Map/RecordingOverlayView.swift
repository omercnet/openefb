//
//  RecordingOverlayView.swift
//  efb-212
//
//  Recording controls for the flight log strip (F9):
//  - RecordButton (strip header, 60pt cell): mic at rest; while recording the stop square and level
//    meter over the elapsed time "00:12:34", the auto-start countdown (tap to cancel), and the stop
//    confirmation "End recording?"
//  - RecordingNotices (strip rows): microphone denied with "Open Settings" (GPS track still records),
//    recording errors and the discarded-recording notice
//
//  EFB lens: red is reserved for warnings, so recording uses the accent colour; no pulsing
//  or other decorative animation in flight. Night: no filled amber (amber rule and amber type).
//

import SwiftUI
import UIKit

// MARK: - Record button

struct RecordButton: View {
    let viewModel: RecordingViewModel
    /// iPhone rail: glyph only, no elapsed time or level meter.
    var compact: Bool = false

    var body: some View {
        @Bindable var vm = viewModel

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
            // Glyph (and level meter) over the elapsed time, like the header's other cells: the
            // 400pt header keeps its width for the route title.
            VStack(spacing: 2) {
                HStack(spacing: Space.xs) {
                    glyph
                    if viewModel.isRecording, !compact, !viewModel.microphoneDenied {
                        AudioLevelMeter(dBFS: viewModel.audioLevel)
                    }
                }
                if viewModel.isRecording, !compact {
                    Text(viewModel.formattedElapsedTime)
                        .font(TypeRole.data)
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .padding(.horizontal, Space.s)
            .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)  // in-flight control: >= 60 pt
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(label)
        .accessibilityValue(viewModel.isRecording ? "Recording, \(viewModel.formattedElapsedTime)" : "")
        .accessibilityIdentifier("record-button")
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

    @ViewBuilder
    private var glyph: some View {
        let size: CGFloat = 36  // points, glyph disc inside the 60pt target
        if viewModel.isCountingDown {
            // Countdown: amber number in an amber ring (no filled amber block), tap to cancel
            Text("\(viewModel.countdownRemaining)")
                .font(TypeRole.dataEmphasis)
                .foregroundStyle(Palette.caution)
                .frame(width: size, height: size)
                .overlay(Circle().stroke(Palette.caution, lineWidth: 2))
        } else if viewModel.isRecording {
            // Recording: accent disc with a stop square, distinct from idle
            Circle()
                .fill(Palette.accent)
                .frame(width: size, height: size)
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.xs)
                        .fill(Palette.onAccent)
                        .frame(width: 14, height: 14)
                )
        } else {
            Image(systemName: "mic.fill")
                .font(.title3)
                .foregroundStyle(Palette.ink)
                .frame(width: size, height: size)
        }
    }

    private var label: String {
        switch viewModel.recordingStatus {
        case .idle: return "Start recording"
        case .recording: return "Stop recording"
        case .countdown: return "Cancel countdown"
        case .paused: return "Resume recording"
        case .stopping: return "Stopping recording"
        }
    }
}

// MARK: - Recording notices

/// Recording problems as full-width strip rows, shown only when one applies.
struct RecordingNotices: View {
    let viewModel: RecordingViewModel

    @Environment(\.openURL) private var openURL

    var body: some View {
        if viewModel.microphoneDenied {
            microphoneDeniedNotice
        }
        if let error = viewModel.lastError {
            recordingErrorNotice(error)
        }
        if viewModel.showDiscardedNotice {
            discardedNotice
        }
    }

    // MARK: Microphone denied

    private var microphoneDeniedNotice: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Label("Microphone is off", systemImage: "mic.slash.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Palette.caution)
            Text("The GPS track still records. For cockpit audio, turn the microphone on in Settings \u{203A} Kanaf \u{203A} Microphone.")
                .font(TypeRole.caption)
                .foregroundStyle(Palette.inkSecondary)
            Button {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    openURL(url)
                }
            } label: {
                // The frame sits inside the label so the bordered button itself is >= 60 pt.
                Text("Open Settings")
                    .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)  // in-flight control: >= 60 pt
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
        }
        .noticeRow(tint: Palette.caution)
        .accessibilityIdentifier("mic-denied-notice")
    }

    // MARK: Recording error

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
                    .foregroundStyle(Palette.inkSecondary)
            }
            Spacer(minLength: Space.s)
            Button { viewModel.dismissError() } label: {
                Text("Dismiss")
                    .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)  // in-flight control: >= 60 pt
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .accessibilityLabel("Dismiss recording problem")
        }
        .noticeRow(tint: tint)
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

    // MARK: Discarded recording

    /// The recording ended with no GPS track points, so nothing was saved. Amber, dismissible.
    private var discardedNotice: some View {
        HStack(alignment: .top, spacing: Space.s) {
            VStack(alignment: .leading, spacing: Space.xs) {
                Label("Recording not saved", systemImage: "trash.slash.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Palette.caution)
                Text("No GPS position was recorded, so there is no flight to keep. Check that Location is on and the aircraft had a fix before starting.")
                    .font(TypeRole.caption)
                    .foregroundStyle(Palette.inkSecondary)
            }
            Spacer(minLength: Space.s)
            Button { viewModel.showDiscardedNotice = false } label: {
                Text("Dismiss")
                    .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)  // in-flight control: >= 60 pt
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .accessibilityLabel("Dismiss recording not saved notice")
        }
        .noticeRow(tint: Palette.caution)
        .accessibilityIdentifier("recording-discarded-notice")
    }
}

extension View {
    /// Full-width notice row in the strip: active-cell background with a leading rule in the
    /// notice's colour (amber caution or red warning; never a filled amber block).
    func noticeRow(tint: Color) -> some View {
        padding(Space.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.activeCell)
            .overlay(alignment: .leading) {
                Rectangle().fill(tint).frame(width: 4)
            }
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
                    .fill(index < lit ? Palette.ink : Palette.rule)
                    .frame(width: 4, height: 8 + CGFloat(index) * 2)
            }
        }
        .frame(height: 16, alignment: .bottom)
        .accessibilityLabel("Audio level")
        .accessibilityValue("\(lit) of \(Self.segments)")
    }
}
