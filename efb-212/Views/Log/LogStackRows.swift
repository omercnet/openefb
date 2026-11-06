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

/// "DEP ▸ ARR" idents; "---" when unknown.
func logRouteText(_ departure: String?, _ arrival: String?) -> String {
    "\(departure ?? "---") \u{25B8} \(arrival ?? "---")"
}

/// "DEP to ARR" for VoiceOver.
func logRouteSpoken(_ departure: String?, _ arrival: String?) -> String {
    "\(departure ?? "unknown") to \(arrival ?? "unknown")"
}

// MARK: - Flown: recorded flight

/// A recorded flight: date, route idents, block time, health caution and, while its logbook
/// draft waits for a signature, a Sign button opening the draft.
struct FlownFlightRow: View {
    let record: SchemaV1.FlightRecord
    /// The flight's logbook entry when it is an unsigned draft.
    let draft: SchemaV1.LogbookEntry?
    let onOpen: () -> Void
    let onSign: (SchemaV1.LogbookEntry) -> Void

    private var blockTime: String { LogbookViewModel.formatDurationHM(record.durationSeconds) }

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

            if let draft {
                Button { onSign(draft) } label: {
                    LogDraftMarker()
                        .frame(minHeight: StripMetrics.cell)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Sign logbook draft, \(logRouteSpoken(record.departureICAO, record.arrivalICAO))")
                .accessibilityIdentifier("log-sign-draft")
            }
        }
        .logStripRow()
    }

    private var accessibilityText: String {
        var parts = [
            "Flight",
            record.startDate.formatted(date: .abbreviated, time: .shortened),
            logRouteSpoken(record.departureICAO, record.arrivalICAO),
            "block time \(blockTime)"
        ]
        if let warning = record.healthWarning { parts.append("Caution, \(warning)") }
        if draft != nil { parts.append("Logbook draft, not signed") }
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
