//
//  LogStackView.swift
//  efb-212
//
//  The home screen, Direction 2: the log stack in three tenses. NEXT (the active plan, plan a
//  flight), NOW (the flight in progress), FLOWN (recorded flights and logbook entries, newest
//  first), then the logbook totals. The stack is also the logbook: drafts are signed from it,
//  manual entries are added and deleted in it. The Map button returns to the chart.
//

import SwiftUI
import SwiftData

struct LogStackView: View {
    @Environment(AppState.self) private var appState
    @Environment(\.modelContext) private var modelContext

    @Query(sort: \SchemaV1.FlightRecord.startDate, order: .reverse)
    private var flights: [SchemaV1.FlightRecord]
    @Query(sort: \SchemaV1.LogbookEntry.date, order: .reverse)
    private var entries: [SchemaV1.LogbookEntry]

    @State private var logbook = LogbookViewModel()
    @State private var path: [LogRoute] = []

    enum LogRoute: Hashable {
        case planner
        case settings
        case flight(SchemaV1.FlightRecord)
        case entry(SchemaV1.LogbookEntry)
    }

    /// One row of the Flown section, in date order.
    private enum FlownItem: Identifiable {
        /// A recorded flight and its logbook entry while that entry is an unsigned draft.
        case flight(SchemaV1.FlightRecord, draft: SchemaV1.LogbookEntry?)
        /// A logbook entry with no recorded flight (manual, or its recording was deleted).
        case entry(SchemaV1.LogbookEntry)

        var id: PersistentIdentifier {
            switch self {
            case .flight(let record, _): record.persistentModelID
            case .entry(let entry): entry.persistentModelID
            }
        }

        var date: Date {
            switch self {
            case .flight(let record, _): record.startDate
            case .entry(let entry): entry.date
            }
        }
    }

    var body: some View {
        @Bindable var logbook = logbook

        NavigationStack(path: $path) {
            List {
                Section {
                    nextRows
                } header: {
                    LogSectionHeader(title: "Next")
                }

                if isLive {
                    Section {
                        nowRow
                    } header: {
                        LogSectionHeader(title: "Now")
                    }
                }

                Section {
                    flownRows
                } header: {
                    LogSectionHeader(title: "Flown") {
                        Button(action: addManualEntry) {
                            Image(systemName: "plus")
                                .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)
                                .contentShape(Rectangle())
                        }
                        .foregroundStyle(Palette.ink)
                        .accessibilityLabel("Add logbook entry")
                        .accessibilityIdentifier("log-add-entry")
                    }
                }

                Section {
                    totalsRow
                } header: {
                    LogSectionHeader(title: "Totals")
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(Palette.paper)
            .navigationTitle("Log")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        appState.selectedScreen = .map
                    } label: {
                        Label("Map", systemImage: "map")
                            .labelStyle(.titleAndIcon)
                            .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Back to map")
                    .accessibilityIdentifier("log-map-button")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: LogRoute.settings) {
                        Image(systemName: "gearshape")
                            .frame(minWidth: StripMetrics.cell, minHeight: StripMetrics.cell)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Settings")
                    .accessibilityIdentifier("log-settings-link")
                }
            }
            .navigationDestination(for: LogRoute.self) { route in
                destination(for: route)
            }
        }
        .sheet(isPresented: $logbook.isShowingManualEntry, onDismiss: reloadTotals) {
            if let entry = logbook.selectedEntry {
                NavigationStack {
                    LogbookEntryEditView(entry: entry, viewModel: logbook, isReadOnly: false)
                        .navigationTitle("New Entry")
                }
            }
        }
        .onAppear(perform: reloadTotals)
        .onChange(of: entries.count) { reloadTotals() }
    }

    // MARK: - Next

    @ViewBuilder
    private var nextRows: some View {
        if let plan = activePlanText {
            Button { path.append(.planner) } label: {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("Active plan")
                        .font(TypeRole.stripLabel)
                        .textCase(.uppercase)
                        .tracking(StripMetrics.labelTracking)
                        .foregroundStyle(Palette.inkSecondary)
                    Text(plan)
                        .font(TypeRole.rowIdent)
                        .foregroundStyle(Palette.route)
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                }
                .frame(maxWidth: .infinity, minHeight: StripMetrics.cell, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Active plan, \(activePlanSpoken ?? plan)")
            .accessibilityHint("Opens the flight planner")
            .accessibilityIdentifier("log-active-plan")
            .logStripRow()
        }

        Button { path.append(.planner) } label: {
            Label("Plan a flight", systemImage: "plus")
                .font(TypeRole.rowIdent)
                .foregroundStyle(Palette.ink)
                .frame(maxWidth: .infinity, minHeight: StripMetrics.cell, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the flight planner and saved plans")
        .accessibilityIdentifier("log-plan-flight")
        .logStripRow()
    }

    /// Route idents of the active plan: the Israel route's points, or departure ▸ destination.
    private var activePlanCodes: [String]? {
        if let route = appState.activeRoute, let first = route.legs.first {
            return [first.fromCode] + route.legs.map(\.toCode)
        }
        guard appState.activeFlightPlan,
              let departure = appState.activePlanDeparture,
              let destination = appState.activePlanDestination else { return nil }
        return [departure, destination]
    }

    private var activePlanText: String? { activePlanCodes?.joined(separator: " \u{25B8} ") }
    private var activePlanSpoken: String? { activePlanCodes?.joined(separator: " to ") }

    // MARK: - Now

    private var isLive: Bool { appState.recordingStatus != .idle || appState.hasActiveNavigation }

    /// What is being flown now: the plan's route, a Direct-To, or a recording without navigation.
    private var nowRouteText: String {
        if let direct = appState.directToAirport { return "Direct \(direct.icao)" }
        return activePlanText ?? "Flight"
    }

    /// The next waypoint's ident.
    private var nextIdent: String? {
        appState.activeRoute?.current?.toCode ?? appState.directToAirport?.icao ?? appState.activePlanDestination
    }

    private var recordingText: String? {
        switch appState.recordingStatus {
        case .idle: nil
        case .countdown(let remaining): "REC in \(remaining) s"
        case .recording: "REC \(Duration.seconds(appState.recordingElapsedTime).formatted(.time(pattern: .hourMinuteSecond)))"
        case .paused: "REC paused"
        case .stopping: "REC stopping"
        }
    }

    private var nowRow: some View {
        Button { appState.selectedScreen = .map } label: {
            // Ages the last fix once a second so a stale ETE is never shown as current.
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let stale = GPSStatus.evaluate(
                    fix: appState.ownshipPosition.map { GPSFix(location: $0, isStationary: appState.gpsStationary) },
                    gpsAvailable: appState.gpsAvailable,
                    now: context.date
                ).isStale
                let ete = stale ? nil : appState.estimatedTimeEnroute  // seconds

                VStack(alignment: .leading, spacing: Space.xs) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(nowRouteText)
                            .font(TypeRole.rowIdent)
                            .foregroundStyle(Palette.route)
                            .lineLimit(2)
                            .minimumScaleFactor(0.6)
                        Spacer(minLength: Space.s)
                        if let recordingText {
                            Text(recordingText)
                                .font(TypeRole.dataEmphasis)
                                .foregroundStyle(Palette.ink)
                        }
                    }
                    if let nextIdent {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Next \(nextIdent)")
                                .font(TypeRole.dataEmphasis)
                                .foregroundStyle(Palette.ink)
                            Spacer(minLength: Space.s)
                            Text(ete.map { Duration.seconds($0).formatted(.time(pattern: .hourMinute)) } ?? "ETE ---")
                                .font(TypeRole.rowTime)
                                .foregroundStyle(stale ? Palette.inkSecondary : Palette.ink)
                        }
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(nowSpoken(ete: ete))
            }
            .frame(maxWidth: .infinity, minHeight: StripMetrics.cell, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Returns to the map")
        .accessibilityIdentifier("log-now-row")
        .logStripRow()
    }

    private func nowSpoken(ete: TimeInterval?) -> String {
        var parts = ["Now", appState.directToAirport.map { "Direct \($0.icao)" } ?? activePlanSpoken ?? "Flight"]
        if let recordingText { parts.append(recordingText) }
        if let nextIdent {
            parts.append("next \(nextIdent)")
            parts.append(ete.map { "time to next \(LogbookViewModel.formatDurationHM($0))" } ?? "time to next unavailable")
        }
        return parts.joined(separator: ", ")
    }

    // MARK: - Flown

    /// Recorded flights with their drafts, plus logbook entries that have no recorded flight, newest first.
    private var flownItems: [FlownItem] {
        let flightIDs = Set(flights.map(\.id))
        var draftsByFlight: [UUID: SchemaV1.LogbookEntry] = [:]
        for entry in entries where !entry.isConfirmed {
            if let flightID = entry.flightID { draftsByFlight[flightID] = draftsByFlight[flightID] ?? entry }
        }
        let flightItems = flights.map { FlownItem.flight($0, draft: draftsByFlight[$0.id]) }
        let standalone = entries
            .filter { entry in entry.flightID.map { !flightIDs.contains($0) } ?? true }
            .map(FlownItem.entry)
        return (flightItems + standalone).sorted { $0.date > $1.date }
    }

    @ViewBuilder
    private var flownRows: some View {
        let items = flownItems
        if items.isEmpty {
            VStack(alignment: .leading, spacing: Space.xs) {
                Text("No flights yet")
                    .font(TypeRole.rowIdent)
                    .foregroundStyle(Palette.ink)
                Text("Recordings from the map appear here. Plan a flight above, or add a logbook entry with +.")
                    .font(TypeRole.data)
                    .foregroundStyle(Palette.inkSecondary)
            }
            .accessibilityElement(children: .combine)
            .logStripRow()
        } else {
            ForEach(items) { item in
                switch item {
                case .flight(let record, let draft):
                    FlownFlightRow(
                        record: record,
                        draft: draft,
                        onOpen: { path.append(.flight(record)) },
                        onSign: { path.append(.entry($0)) }
                    )
                    .swipeActions {
                        if let draft {
                            Button("Delete draft", role: .destructive) { delete(draft) }
                        }
                    }
                case .entry(let entry):
                    FlownEntryRow(entry: entry) { path.append(.entry(entry)) }
                        .swipeActions {
                            if !entry.isConfirmed {
                                Button("Delete", role: .destructive) { delete(entry) }
                            }
                        }
                }
            }
        }
    }

    // MARK: - Totals

    private var draftCount: Int { entries.filter { !$0.isConfirmed }.count }

    /// Logbook totals. The draft count is neutral text: a draft is a to-do, not a warning (T22).
    private var totalsRow: some View {
        let flightsText = logbook.totalFlights == 1 ? "1 flight" : "\(logbook.totalFlights) flights"
        let timeText = "\(LogbookViewModel.formatDurationDecimal(logbook.totalFlightTimeSeconds)) h"
        let draftsText: String? = switch draftCount {
        case 0: nil
        case 1: "1 draft to sign"
        default: "\(draftCount) drafts to sign"
        }

        return ViewThatFits(in: .horizontal) {
            HStack(spacing: Space.l) {
                Text(flightsText)
                Text(timeText)
                Spacer(minLength: 0)
                if let draftsText { Text(draftsText) }
            }
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(flightsText)
                Text(timeText)
                if let draftsText { Text(draftsText) }
            }
        }
        .font(TypeRole.dataEmphasis)
        .foregroundStyle(Palette.ink)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(["Logbook total", flightsText, "\(LogbookViewModel.formatDurationDecimal(logbook.totalFlightTimeSeconds)) hours", draftsText]
            .compactMap { $0 }
            .joined(separator: ", "))
        .accessibilityIdentifier("log-totals")
        .logStripRow()
    }

    // MARK: - Navigation

    @ViewBuilder
    private func destination(for route: LogRoute) -> some View {
        switch route {
        case .planner:
            FlightPlanView()
        case .settings:
            SettingsView()
        case .flight(let record):
            FlightDetailView(flightRecord: record)
        case .entry(let entry):
            LogbookEntryEditView(entry: entry, viewModel: logbook, isReadOnly: entry.isConfirmed)
        }
    }

    // MARK: - Actions

    private func reloadTotals() {
        logbook.loadEntries(modelContext: modelContext)
    }

    private func addManualEntry() {
        let entry = logbook.createManualEntry(modelContext: modelContext)
        logbook.selectedEntry = entry
        logbook.isShowingManualEntry = true
    }

    /// Only unsigned entries are deleted; a signed entry is locked.
    private func delete(_ entry: SchemaV1.LogbookEntry) {
        guard !entry.isConfirmed else { return }
        logbook.deleteEntry(entry, modelContext: modelContext)
        reloadTotals()
    }
}

#Preview {
    LogStackView()
        .environment(AppState())
        .modelContainer(for: [
            SchemaV1.FlightRecord.self,
            SchemaV1.LogbookEntry.self,
            SchemaV1.UserSettings.self
        ])
}
