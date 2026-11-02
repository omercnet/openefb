//
//  FlightDetailView.swift
//  efb-212
//
//  Flight recording detail view with AI Debrief button and availability check.
//  Uses shared RecordingDatabase from AppState (not per-view instance).
//  Prewarms LanguageModelSession on appear, discards on disappear.
//

import SwiftUI
import SwiftData

struct FlightDetailView: View {
    let flightRecord: SchemaV1.FlightRecord
    @Environment(AppState.self) private var appState
    @State private var debriefEngine = DebriefEngine()
    /// The Israel CVFR debrief; nil for flights outside Israel (loaded once, off the main actor).
    @State private var cvfrDebrief: CVFRDebrief?
    @Environment(\.dynamicTypeSize) private var typeSize

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        return f
    }()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // MARK: - Flight Info Section
                flightInfoSection

                Divider()

                // MARK: - Recording Stats
                recordingStatsSection

                Divider()

                // MARK: - Track Replay Section
                replaySection

                Divider()

                // MARK: - CVFR Debrief Section (Israel flights; independent of Apple Intelligence)
                if let cvfrDebrief {
                    CVFRDebriefContent(debrief: cvfrDebrief)

                    Divider()
                }

                // MARK: - AI Debrief Section
                debriefSection
            }
            .padding()
        }
        .navigationTitle("Flight Details")
        .task(id: flightRecord.id) {
            guard let recordingDB = appState.getOrCreateRecordingDatabase() else { return }
            let id = flightRecord.id
            let window = RemoteConfigStore.shared.value(for: .cvfrReportWindowSeconds)  // seconds
            cvfrDebrief = await Task.detached { CVFRDebriefLoader.loadBundled(flightID: id, recordingDB: recordingDB, reportWindow: window) }.value
        }
        .onAppear {
            debriefEngine.checkAvailability()
            if debriefEngine.availabilityStatus == .available {
                debriefEngine.prewarm()
            }
        }
        .onDisappear {
            debriefEngine.discard()
        }
    }

    // MARK: - Flight Info

    @ViewBuilder
    private var flightInfoSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Flight Info", systemImage: "airplane")
                .font(.headline)

            LabeledContent("Date", value: Self.dateFormatter.string(from: flightRecord.startDate))

            let routeLayout = typeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(spacing: 8))
            routeLayout {
                VStack(alignment: .leading) {
                    Text("From")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(flightRecord.departureICAO ?? "---")
                        .font(.title3.bold())
                    if let name = flightRecord.departureName {
                        Text(name)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)

                Image(systemName: typeSize.isAccessibilitySize ? "arrow.down" : "arrow.right")
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .accessibilityHidden(true)

                VStack(alignment: .leading) {
                    Text("To")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(flightRecord.arrivalICAO ?? "---")
                        .font(.title3.bold())
                    if let name = flightRecord.arrivalName {
                        Text(name)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)

                Spacer()
            }

            LabeledContent("Duration", value: LogbookViewModel.formatDurationHM(flightRecord.durationSeconds))

            if let note = flightRecord.notes, flightRecord.healthWarning != nil {
                Label(note, systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline)
                    .foregroundStyle(Palette.caution)
            }
        }
    }

    // MARK: - Recording Stats

    @ViewBuilder
    private var recordingStatsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Recording Data", systemImage: "waveform")
                .font(.headline)

            LabeledContent("Track Points", value: "\(flightRecord.trackPointCount)")
            LabeledContent("Transcript Segments", value: "\(flightRecord.transcriptSegmentCount)")
            LabeledContent("Audio Quality", value: flightRecord.audioQuality.capitalized)
        }
    }

    // MARK: - Replay Section

    @ViewBuilder
    private var replaySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Track Replay", systemImage: "play.circle")
                .font(.headline)

            if appState.recordingStatus != .idle {
                // Recording is active -- disable replay
                Label("End the recording to replay a flight", systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else if flightRecord.trackPointCount > 0 {
                NavigationLink {
                    ReplayView(flightRecord: flightRecord)
                } label: {
                    HStack {
                        Image(systemName: "play.circle")
                            .font(.title3)
                            .accessibilityHidden(true)
                        Text("Replay Flight")
                            .font(.body.bold())
                        Spacer()
                        Image(systemName: "chevron.right")
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                    }
                    .padding()
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(Color.orange.opacity(0.1))
                    )
                }
                .buttonStyle(.plain)
            } else {
                Label("No track data available for replay", systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    // MARK: - Debrief Section

    /// Flights shorter than this, with no transcript, give the debrief nothing to work with.
    nonisolated static let minimumDebriefDurationSeconds: Double = 60   // seconds

    /// Why a debrief is not offered, or nil when it is. A debrief needs either a transcript or
    /// a flight of at least `minimumDebriefDurationSeconds`.
    nonisolated static func debriefIneligibleReason(
        durationSeconds: Double,
        transcriptSegmentCount: Int
    ) -> String? {
        guard transcriptSegmentCount == 0, durationSeconds < minimumDebriefDurationSeconds else { return nil }
        return "Too short for a debrief: this flight is under a minute and has no transcript."
    }

    @ViewBuilder
    private var debriefSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("AI Debrief", systemImage: "brain.head.profile")
                .font(.headline)

            switch debriefEngine.availabilityStatus {
            case .available:
                if !flightRecord.hasDebrief,
                   let reason = Self.debriefIneligibleReason(
                       durationSeconds: flightRecord.durationSeconds,
                       transcriptSegmentCount: flightRecord.transcriptSegmentCount
                   ) {
                    Label(reason, systemImage: "info.circle")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("debrief-ineligible")
                } else if let recordingDB = appState.getOrCreateRecordingDatabase() {
                    let metadata = buildMetadata()

                    NavigationLink {
                        DebriefView(
                            debriefEngine: debriefEngine,
                            flightID: flightRecord.id,
                            recordingDB: recordingDB,
                            metadata: metadata
                        )
                    } label: {
                        HStack {
                            Image(systemName: flightRecord.hasDebrief ? "brain" : "sparkles")
                                .font(.title3)
                                .accessibilityHidden(true)
                            Text(flightRecord.hasDebrief ? "View Debrief" : "Generate Debrief")
                                .font(.body.bold())
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                        }
                        .padding()
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(flightRecord.hasDebrief ? Palette.infoFill : Color.purple.opacity(0.1))
                        )
                    }
                    .buttonStyle(.plain)
                } else {
                    // RecordingDatabase initialization failed
                    Label("Recording database could not be opened", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                }

            case .unavailable(let reason):
                unavailableContent(reason: reason)

            case .unknown:
                ProgressView("Checking AI availability...")
            }
        }
    }

    // MARK: - Unavailable Content

    @ViewBuilder
    private func unavailableContent(reason: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "apple.intelligence")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text("Debrief needs Apple Intelligence.")
                .font(.headline)
            Text(reason)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Text("Track, transcript and logbook still work.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if reason.contains("not enabled") {
                Link("Open Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
            }
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(.quaternary)
        )
    }

    // MARK: - Helpers

    private func buildMetadata() -> FlightMetadata {
        FlightMetadata(
            aircraftType: nil,  // Could look up from profile if needed
            pilotName: nil,
            departureICAO: flightRecord.departureICAO,
            arrivalICAO: flightRecord.arrivalICAO,
            date: flightRecord.startDate,
            durationSeconds: flightRecord.durationSeconds
        )
    }
}
