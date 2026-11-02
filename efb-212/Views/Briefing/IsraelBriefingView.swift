//
//  IsraelBriefingView.swift
//  efb-212
//
//  Israel pre-flight NOTAM briefing (IL-BRIEF): every LLLL/aerodrome NOTAM for the flight window, closures
//  first, with read/unread tracking. Opened from the map controls and from the Israel flight plan screen.
//

import CoreLocation
import SwiftUI

struct IsraelBriefingView: View {
    /// The planned route when opened from the flight plan screen; nil falls back to the activated route.
    var plannedRoute: BriefingRoute?

    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel = IsraelBriefingViewModel()
    @State private var expanded: Set<String> = []
    @State private var highlightActive = false
    @State private var cannotShow: String?
    @State private var filtersOpen = false

    /// IMS aviation page: the authoritative SIGMET/AIRMET and forecast source (docs/research/israel-cvfr.md section 5).
    static let imsAviationURL = URL(string: "https://ims.gov.il/en/aviation")

    var body: some View {
        NavigationStack {
            List {
                statusSection
                filterSection
                if viewModel.isListable, viewModel.report != nil {
                    if viewModel.rows.isEmpty {
                        Section { Text(emptyText).font(TypeRole.body).foregroundStyle(Palette.secondaryText) }
                    }
                    ForEach(BriefingSection.allCases, id: \.self) { section in
                        let rows = viewModel.rows(in: section)
                        if !rows.isEmpty {
                            Section(section.title) {
                                ForEach(rows) { row in rowView(row) }
                            }
                        }
                    }
                }
                weatherSection
            }
            .listStyle(.insetGrouped)
            .navigationTitle("NOTAM briefing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }.frame(minHeight: 44)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Mark all read") { viewModel.markAllRead() }
                        .frame(minHeight: 44)
                        .disabled(viewModel.unreadCount == 0)
                        .accessibilityIdentifier("briefing-mark-all-read")
                }
            }
            .refreshable { await viewModel.load(force: true) }
            .alert("Nothing to show", isPresented: Binding(get: { cannotShow != nil }, set: { if !$0 { cannotShow = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(cannotShow ?? "")
            }
        }
        .task {
            viewModel.route = plannedRoute ?? activeRoute()
            if let position = appState.ownshipPosition {
                viewModel.ownship = IsraelLatLon(lat: position.coordinate.latitude, lon: position.coordinate.longitude)
            }
            await viewModel.load()
        }
        .presentationDetents([.large])
        .presentationSizing(.page)
        .accessibilityIdentifier("israel-briefing")
    }

    // MARK: Status

    @ViewBuilder
    private var statusSection: some View {
        Section {
            if let report = viewModel.report {
                HStack {
                    Text("Feed").font(TypeRole.label).foregroundStyle(Palette.secondaryText)
                    DataAgeBadge(.notam, observed: report.feed.generatedAt)
                    Spacer()
                    Text("\(report.feed.items.count) NOTAMs")
                        .font(TypeRole.caption).foregroundStyle(Palette.secondaryText)
                }
                if viewModel.freshness?.level == .old {
                    banner("List is OLD. Re-check NOTAMs with the IAA before flying.", color: Palette.caution)
                }
                if !viewModel.isListable {
                    banner(
                        "NOTAM feed is \(viewModel.freshness?.text ?? "N/A"). The list is not current and is hidden. Check NOTAMs with the IAA.",
                        color: Palette.warning)
                    Button("Show last known list anyway") { viewModel.showStaleList = true }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("briefing-show-stale")
                } else if viewModel.showStaleList, viewModel.freshness?.level != .fresh, viewModel.freshness?.level != .old {
                    banner("Showing a stale list. It is NOT current.", color: Palette.warning)
                }
                if report.refreshFailed {
                    banner("Refresh failed. Showing the copy downloaded earlier.", color: Palette.caution)
                }
            } else if viewModel.isLoading {
                HStack { ProgressView(); Text("Loading NOTAMs").font(TypeRole.body) }
            } else if let message = viewModel.errorMessage {
                banner("NOTAMs not loaded: \(message)", color: Palette.warning)
                Button("Retry") { Task { await viewModel.load(force: true) } }.frame(minHeight: 44)
            }
        }
    }

    private func banner(_ text: String, color: Color) -> some View {
        Label(text, systemImage: "exclamationmark.triangle.fill")
            .font(TypeRole.body.weight(.semibold))
            .foregroundStyle(color)
    }

    // MARK: Filters

    @ViewBuilder
    private var filterSection: some View {
        Section {
            DisclosureGroup(isExpanded: $filtersOpen) {
            Picker("Window", selection: $viewModel.windowChoice) {
                ForEach(IsraelBriefingViewModel.WindowChoice.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("briefing-window")
            Text(windowText).font(TypeRole.caption).foregroundStyle(Palette.secondaryText)

            Picker("Distance from", selection: $viewModel.distanceChoice) {
                ForEach(IsraelBriefingViewModel.DistanceChoice.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("briefing-distance")
            if viewModel.distanceChoice != .off {
                Stepper(value: $viewModel.corridorNM, in: 5...100, step: 5) {
                    Text("Within \(Int(viewModel.corridorNM)) NM").font(TypeRole.body)
                }
                if viewModel.distanceChoice == .route, viewModel.route == nil {
                    Text("No planned or active route. Plan a flight to filter by route.")
                        .font(TypeRole.caption).foregroundStyle(Palette.caution)
                }
                if viewModel.distanceChoice == .ownship, viewModel.ownship == nil {
                    Text("No GPS position yet.").font(TypeRole.caption).foregroundStyle(Palette.caution)
                }
            }

            TextField("Aerodrome (LLHZ, LLBG)", text: $viewModel.aerodromeFilter)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .frame(minHeight: 44)
                .accessibilityLabel("Aerodrome filter")
                .accessibilityIdentifier("briefing-aerodrome")
            Toggle("Unread only", isOn: $viewModel.unreadOnly).frame(minHeight: 44)
            if highlightActive {
                Button("Clear map highlight") {
                    IsraelBriefingMapHighlight.clear(on: appState.sharedMapService)
                    highlightActive = false
                }
                .frame(minHeight: 44)
            }
            } label: {
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text("Filters").font(TypeRole.body.weight(.semibold))
                    Text(filterSummary).font(TypeRole.caption).foregroundStyle(Palette.secondaryText)
                }
                .frame(minHeight: 44)
            }
            .accessibilityIdentifier("briefing-filters")
        }
    }

    private var filterSummary: String {
        var parts = [viewModel.windowChoice.rawValue]
        if viewModel.distanceChoice != .off { parts.append("\(viewModel.distanceChoice.rawValue) \(Int(viewModel.corridorNM)) NM") }
        let aerodrome = viewModel.aerodromeFilter.trimmingCharacters(in: .whitespaces)
        if !aerodrome.isEmpty { parts.append(aerodrome.uppercased()) }
        if viewModel.unreadOnly { parts.append("Unread") }
        return parts.joined(separator: " · ")
    }
    private var windowText: String {
        let window = viewModel.window
        return "Valid \(BriefingTimeFormat.local(window.start)) to \(BriefingTimeFormat.local(window.end)) LT, PERM always"
    }

    private var emptyText: String {
        "No NOTAMs match these filters. Widen the window or distance."
    }

    // MARK: Rows

    @ViewBuilder
    private func rowView(_ row: BriefingRow) -> some View {
        let notam = row.notam
        let read = viewModel.isRead(notam)
        let isExpanded = expanded.contains(row.id)
        HStack(alignment: .top, spacing: Space.m) {
            Circle()
                .fill(read ? Color.clear : Palette.accentText)
                .frame(width: 12, height: 12)
                .padding(.top, 6)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Space.s) {
                HStack(alignment: .firstTextBaseline, spacing: Space.s) {
                    Text(notam.id).font(TypeRole.valueSmall).foregroundStyle(Palette.primaryText)
                    Text(notam.location).font(TypeRole.label).foregroundStyle(Palette.secondaryText)
                    if let type = notam.type, type.uppercased() == "NOTAMR" {
                        Text("REPLACES").font(TypeRole.sectionHeader).foregroundStyle(Palette.secondaryText)
                    }
                    Spacer()
                    closureBadge(row)
                }
                Text(BriefingTimeFormat.validity(for: notam, local: true))
                    .font(TypeRole.caption).foregroundStyle(Palette.secondaryText)
                Text(BriefingTimeFormat.validity(for: notam, local: false))
                    .font(TypeRole.caption).foregroundStyle(Palette.secondaryText)
                if let distance = row.distanceNM {
                    Text(distance < 0.5 ? "On the reference" : String(format: "%.0f NM away", distance))
                        .font(TypeRole.caption).foregroundStyle(Palette.secondaryText)
                }
                Text(plainText(notam))
                    .font(TypeRole.body)
                    .foregroundStyle(Palette.primaryText)
                    .lineLimit(isExpanded ? nil : 5)
                if isExpanded {
                    Text(notam.raw)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(Palette.secondaryText)
                        .textSelection(.enabled)
                }
                // One row when it fits (iPad); on a narrow iPhone the buttons wrap onto two rows
                // instead of squeezing "Show on map" into three lines.
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Space.m) { actionButtons(row: row, notam: notam, isExpanded: isExpanded, read: read, spacer: true) }
                    VStack(alignment: .leading, spacing: Space.s) {
                        HStack(spacing: Space.m) { actionButtons(row: row, notam: notam, isExpanded: isExpanded, read: read, spacer: false, readButton: false) }
                        HStack(spacing: Space.m) { readButton(notam: notam, read: read) }
                    }
                }
            }
        }
        .padding(.vertical, Space.xs)
        .contentShape(Rectangle())
        .onTapGesture { viewModel.markRead(notam) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(notam.id), \(notam.location), \(read ? "read" : "unread")")
    }

    @ViewBuilder
    private func actionButtons(row: BriefingRow, notam: IsraelNotam, isExpanded: Bool, read: Bool,
                               spacer: Bool, readButton includeRead: Bool = true) -> some View {
        if canShowOnMap(notam) {
            Button { showOnMap(row) } label: {
                Label("Show on map", systemImage: "map").labelStyle(.titleAndIcon).lineLimit(1).fixedSize().frame(minHeight: 44)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("briefing-show-on-map")
        }
        Button(isExpanded ? "Hide raw" : "Raw") {
            if isExpanded { expanded.remove(row.id) } else { expanded.insert(row.id) }
        }
        .buttonStyle(.bordered)
        .lineLimit(1).fixedSize()
        .frame(minHeight: 44)
        if spacer { Spacer() }
        if includeRead { readButton(notam: notam, read: read) }
    }

    private func readButton(notam: IsraelNotam, read: Bool) -> some View {
        Button(read ? "Mark unread" : "Mark read") {
            if read { viewModel.markUnread(notam) } else { viewModel.markRead(notam) }
        }
        .buttonStyle(.bordered)
        .lineLimit(1).fixedSize()
        .frame(minHeight: 44)
    }

    @ViewBuilder
    private func closureBadge(_ row: BriefingRow) -> some View {
        switch row.closure {
        case .full:
            badge("CLOSED", systemImage: "xmark.octagon.fill", color: Palette.warning)
        case .partial:
            badge("PARTIAL", systemImage: "exclamationmark.triangle.fill", color: Palette.caution)
        case .check, .none:
            if row.needsCheck { badge("CHECK NOTAM", systemImage: "exclamationmark.triangle.fill", color: Palette.caution) }
        }
        // A closure of someone else's routes (HEL, ultralight, ATS for a CVFR pilot): named, never red or amber.
        if row.closure == .none, !row.needsCheck, !row.otherRouteKinds.isEmpty {
            let kinds = row.otherRouteKinds.joined(separator: " + ")
            Label("\(kinds) ROUTE CLSD", systemImage: "arrow.triangle.branch")
                .font(TypeRole.label.weight(.semibold))
                .foregroundStyle(Palette.secondaryText)
                .accessibilityLabel("\(kinds) routes closed. Not your route network.")
                .accessibilityIdentifier("briefing-badge-other-route")
        }
    }

    private func badge(_ text: String, systemImage: String, color: Color) -> some View {
        Label(text, systemImage: systemImage)
            .font(TypeRole.label.weight(.bold))
            .foregroundStyle(color)
            .accessibilityIdentifier("briefing-badge-\(text.lowercased().replacingOccurrences(of: " ", with: "-"))")
    }

    /// E) as published; the full text when the relay could not read the fields.
    private func plainText(_ notam: IsraelNotam) -> String {
        let text = (notam.parsed ? notam.e : nil) ?? notam.raw
        return text.split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespaces)
    }

    // MARK: Show on map

    private func canShowOnMap(_ notam: IsraelNotam) -> Bool {
        if notam.geometry.polygon != nil || notam.geometry.circle != nil { return true }
        if let q = notam.q, q.centre != nil, (q.radiusNM ?? .infinity) < 100 { return true }
        return notam.closures.contains { $0.chain.count >= 2 }
    }

    private func showOnMap(_ row: BriefingRow) {
        viewModel.markRead(row.notam)
        let color: UIColor
        switch row.closure {
        case .full: color = .systemRed
        case .partial, .check: color = .systemOrange
        case .none: color = row.needsCheck ? .systemOrange : .systemBlue
        }
        guard IsraelBriefingMapHighlight.show(row.notam, color: color, on: appState.sharedMapService) else {
            cannotShow = "The map is not ready, or this NOTAM has no area or route to draw."
            return
        }
        highlightActive = true
        appState.isPresentingIsraelBriefing = false
        appState.selectedTab = .map
        dismiss()
    }

    // MARK: Route and weather

    private func activeRoute() -> BriefingRoute? {
        guard let active = appState.activeRoute, let first = active.legs.first else { return nil }
        let database = try? IsraelAviationDatabase.bundled()
        let departure = (try? database?.reportingPoint(code: first.fromCode)).flatMap { $0 }
            .map { IsraelLatLon(lat: $0.latitude, lon: $0.longitude) }
        return BriefingRoute(active: active, departurePoint: departure)
    }

    @ViewBuilder
    private var weatherSection: some View {
        Section("Weather") {
            Text("SIGMET/AIRMET for LLLL are not in the aviationweather.gov feed the app reads. The Israel Meteorological Service is the authoritative source.")
                .font(TypeRole.body)
                .foregroundStyle(Palette.secondaryText)
            if let url = Self.imsAviationURL {
                Link(destination: url) {
                    Label("IMS aviation: SIGMET, AIRMET, forecasts", systemImage: "arrow.up.right.square")
                        .frame(minHeight: 44)
                }
                .accessibilityIdentifier("briefing-ims-link")
            }
        }
    }
}

// MARK: - Time formatting

nonisolated enum BriefingTimeFormat {
    static let israel = TimeZone(identifier: "Asia/Jerusalem") ?? .gmt

    private static func formatter(_ zone: TimeZone, _ pattern: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = zone
        f.dateFormat = pattern
        return f
    }

    /// "28 Oct 10:45" in Israel local time.
    static func local(_ date: Date) -> String { formatter(israel, "d MMM HH:mm").string(from: date) }
    /// "28 Oct 07:45Z".
    static func zulu(_ date: Date) -> String { formatter(.gmt, "d MMM HH:mm'Z'").string(from: date) }

    /// "LT 28 Oct 10:45 to 16:30" / "UTC 28 Oct 07:45Z to 13:30Z"; PERM and EST marked.
    static func validity(for notam: IsraelNotam, local isLocal: Bool) -> String {
        let label = isLocal ? "LT" : "UTC"
        let render: (Date) -> String = { isLocal ? local($0) : zulu($0) }
        let from = notam.validFrom.map(render) ?? "?"
        let to: String
        if notam.permanent { to = "PERM" }
        else if let validTo = notam.validTo { to = render(validTo) + (notam.estimated ? " EST" : "") }
        else { to = "?" }
        return "\(label) \(from) to \(to)"
    }
}
