//
//  LogStackRows.swift
//  efb-212
//
//  Strip rows of the log stack (Direction 2): section headers, the Flown rows for recorded
//  flights and logbook entries, and the strip row styling. Amber is caution and always carries
//  a triangle glyph and words, never color alone.
//

import SwiftUI

/// Uppercase strip label heading a log section, with an optional trailing control.
struct LogSectionHeader<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack {
            Text(title)
                .font(TypeRole.stripLabel)
                .textCase(.uppercase)
                .tracking(StripMetrics.labelTracking)
                .foregroundStyle(Palette.inkSecondary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            trailing
        }
    }
}

extension LogSectionHeader where Trailing == EmptyView {
    init(title: String) {
        self.init(title: title) { EmptyView() }
    }
}

extension View {
    /// A strip in the log: at least one in-flight tap target tall, on the active cell with rule hairlines.
    func logStripRow() -> some View {
        frame(maxWidth: .infinity, minHeight: StripMetrics.cell, alignment: .leading)
            .contentShape(Rectangle())
            .listRowBackground(Palette.activeCell)
            .listRowSeparatorTint(Palette.rule)
    }
}

/// Amber caution marker: triangle glyph plus words.
struct LogCautionMarker: View {
    let text: String

    var body: some View {
        Label(text, systemImage: "exclamationmark.triangle.fill")
            .font(TypeRole.dataEmphasis)
            .foregroundStyle(Palette.caution)
    }
}

/// Draft logbook entry waiting for a signature: a neutral to-do, not a caution (efb-77r.32).
struct LogDraftMarker: View {
    var body: some View {
        Label("Draft, sign", systemImage: "signature")
            .font(TypeRole.dataEmphasis)
            .foregroundStyle(Palette.ink)
    }
}

/// Signed logbook entry, opened read-only: neutral ink, nothing to do.
struct LogSignedEntryMarker: View {
    var body: some View {
        Label("Logbook", systemImage: "book.closed")
            .font(TypeRole.dataEmphasis)
            .foregroundStyle(Palette.ink)
    }
}

/// What a recorded flight's row offers for its linked logbook entry.
enum FlownEntryAction: Equatable {
    /// Unsigned draft: open it to edit and sign.
    case sign
    /// Signed entry: open it read-only.
    case review

    /// The action for a flight's linked entry; nil when the flight has no entry.
    static func forEntry(_ entry: SchemaV1.LogbookEntry?) -> FlownEntryAction? {
        guard let entry else { return nil }
        return entry.isConfirmed ? .review : .sign
    }

    /// Each recorded flight's logbook entry, keyed by flight ID. An unsigned draft wins over a
    /// signed entry so a pending signature is never hidden; otherwise the first entry is kept.
    static func entriesByFlight(_ entries: [SchemaV1.LogbookEntry]) -> [UUID: SchemaV1.LogbookEntry] {
        var byFlight: [UUID: SchemaV1.LogbookEntry] = [:]
        for entry in entries {
            guard let flightID = entry.flightID else { continue }
            if let current = byFlight[flightID], !current.isConfirmed || entry.isConfirmed { continue }
            byFlight[flightID] = entry
        }
        return byFlight
    }
}

/// "DEP ▸ ARR" idents; "---" when unknown.
func logRouteText(_ departure: String?, _ arrival: String?) -> String {
    "\(departure ?? "---") \u{25B8} \(arrival ?? "---")"
}

/// "DEP to ARR" for VoiceOver.
func logRouteSpoken(_ departure: String?, _ arrival: String?) -> String {
    "\(departure ?? "unknown") to \(arrival ?? "unknown")"
}

// MARK: - Flown: recorded flight

/// A recorded flight: date, route idents, block time, health caution and its logbook entry:
/// a Sign button while the entry is an unsigned draft, a read-only Logbook button once signed.
struct FlownFlightRow: View {
    let record: SchemaV1.FlightRecord
    /// The flight's logbook entry, signed or not.
    let entry: SchemaV1.LogbookEntry?
    let onOpen: () -> Void
    let onOpenEntry: (SchemaV1.LogbookEntry) -> Void

    private var blockTime: String { LogbookViewModel.formatDurationHM(record.durationSeconds) }
    private var routeSpoken: String { logRouteSpoken(record.departureICAO, record.arrivalICAO) }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Button(action: onOpen) {
                HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                    VStack(alignment: .leading, spacing: Space.xs) {
                        Text(record.startDate.formatted(date: .abbreviated, time: .shortened))
                            .font(TypeRole.data)
                            .foregroundStyle(Palette.inkSecondary)
                        Text(logRouteText(record.departureICAO, record.arrivalICAO))
                            .font(TypeRole.rowIdent)
                            .foregroundStyle(Palette.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                        if let warning = record.healthWarning {
                            LogCautionMarker(text: warning)
                        }
                    }
                    Spacer(minLength: Space.s)
                    Text(blockTime)
                        .font(TypeRole.rowTime)
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                }
                .frame(maxWidth: .infinity, minHeight: StripMetrics.cell, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText)
            .accessibilityHint("Opens flight details, debrief and replay")
            .accessibilityIdentifier("log-flight-row")

            if let entry, let action = FlownEntryAction.forEntry(entry) {
                Button { onOpenEntry(entry) } label: {
                    Group {
                        switch action {
                        case .sign: LogDraftMarker()
                        case .review: LogSignedEntryMarker()
                        }
                    }
                    .frame(minHeight: StripMetrics.cell)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(action == .sign ? "Sign logbook draft, \(routeSpoken)" : "Logbook entry, \(routeSpoken)")
                .accessibilityIdentifier(action == .sign ? "log-sign-draft" : "log-open-entry")
            }
        }
        .logStripRow()
    }

    private var accessibilityText: String {
        var parts = [
            "Flight",
            record.startDate.formatted(date: .abbreviated, time: .shortened),
            routeSpoken,
            "block time \(blockTime)"
        ]
        if let warning = record.healthWarning { parts.append("Caution, \(warning)") }
        switch FlownEntryAction.forEntry(entry) {
        case .sign: parts.append("Logbook draft, not signed")
        case .review: parts.append("Logbook entry signed")
        case nil: break
        }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Flown: logbook entry without a recording

/// A logbook entry with no recorded flight (manual, or its recording was deleted).
struct FlownEntryRow: View {
    let entry: SchemaV1.LogbookEntry
    let onOpen: () -> Void

    private var duration: String { LogbookViewModel.formatDurationHM(entry.durationSeconds) }

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .firstTextBaseline, spacing: Space.m) {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(entry.date.formatted(date: .abbreviated, time: .omitted))
                        .font(TypeRole.data)
                        .foregroundStyle(Palette.inkSecondary)
                    Text(logRouteText(entry.departureICAO, entry.arrivalICAO))
                        .font(TypeRole.rowIdent)
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if entry.isConfirmed {
                        Label("Signed", systemImage: "checkmark")
                            .font(TypeRole.data)
                            .foregroundStyle(Palette.inkSecondary)
                    } else {
                        LogDraftMarker()
                    }
                }
                Spacer(minLength: Space.s)
                VStack(alignment: .trailing, spacing: Space.xs) {
                    Text(duration)
                        .font(TypeRole.rowTime)
                        .foregroundStyle(Palette.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(entry.aircraftType ?? "Aircraft not set")
                        .font(TypeRole.data)
                        .foregroundStyle(Palette.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: StripMetrics.cell, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityHint(entry.isConfirmed ? "Opens the signed entry" : "Opens the entry to edit and sign")
        .accessibilityIdentifier("log-entry-row")
        .logStripRow()
    }

    private var accessibilityText: String {
        [
            "Logbook entry",
            entry.date.formatted(date: .abbreviated, time: .omitted),
            logRouteSpoken(entry.departureICAO, entry.arrivalICAO),
            "time \(duration)",
            entry.aircraftType ?? "aircraft not set",
            entry.isConfirmed ? "signed" : "draft, not signed"
        ].joined(separator: ", ")
    }
}
