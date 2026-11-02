//
//  IsraelBriefingViewModel.swift
//  efb-212
//
//  State behind the Israel NOTAM briefing (IL-BRIEF): loads the relay feed, applies the flight-window,
//  distance and aerodrome filters, and tracks read/unread. A feed past the NOTAM freshness limit is
//  never listed as current.
//

import Foundation
import Observation

@Observable
@MainActor
final class IsraelBriefingViewModel {

    enum WindowChoice: String, CaseIterable, Identifiable {
        case flight = "Flight"
        case next6h = "6 h"
        case next24h = "24 h"
        var id: String { rawValue }
    }

    enum DistanceChoice: String, CaseIterable, Identifiable {
        case off = "Any"
        case route = "Route"
        case ownship = "Ownship"
        var id: String { rawValue }
    }

    // MARK: Inputs the user sets

    var windowChoice: WindowChoice = .flight
    var distanceChoice: DistanceChoice = .off
    /// Corridor half-width -- nautical miles.
    var corridorNM: Double = 25
    var aerodromeFilter: String = ""
    var unreadOnly = false
    /// The pilot asked to see a list the app judges too old to be current.
    var showStaleList = false

    // MARK: Context from the caller

    var route: BriefingRoute? {
        didSet { if route != nil, distanceChoice == .off { distanceChoice = .route } }
    }
    var ownship: IsraelLatLon?

    // MARK: Loaded state

    private(set) var report: IsraelNotamReport?
    private(set) var isLoading = false
    private(set) var errorMessage: String?

    @ObservationIgnored private let fetcher: @Sendable (Bool) async throws -> IsraelNotamReport
    @ObservationIgnored private let readStore: any NotamReadStateStoreProtocol
    @ObservationIgnored private let now: @Sendable () -> Date

    init(
        fetcher: (@Sendable (Bool) async throws -> IsraelNotamReport)? = nil,
        readStore: any NotamReadStateStoreProtocol = NotamReadStateStore.shared,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        if let fetcher {
            self.fetcher = fetcher
        } else {
            let service = IsraelNotamService()
            self.fetcher = { force in
                if let override = try await Self.debugFeedOverride() { return override }
                return try await service.fetchFeed(forceRefresh: force)
            }
        }
        self.readStore = readStore
        self.now = now
    }

    // MARK: Loading

    func load(force: Bool = false) async {
        guard !isLoading else { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }
        do {
            let loaded = try await fetcher(force)
            report = loaded
            if let store = readStore as? NotamReadStateStore { store.prune(keeping: loaded.feed.items) }
        } catch {
            // Keep whatever was loaded before; the banner says the refresh failed.
            errorMessage = error.localizedDescription
        }
    }

    // MARK: Freshness

    var freshness: DataFreshness? { report?.freshness(now: now()) }

    /// Fresh enough to list as current: the relay scraped the IAA within the NOTAM old limit.
    var isCurrent: Bool {
        guard let level = freshness?.level else { return false }
        return level == .fresh
    }

    /// Listed with an age badge but not as current (old), or hidden behind the stale gate (expired).
    var isListable: Bool {
        guard let level = freshness?.level else { return false }
        switch level {
        case .fresh, .old: return true
        case .unknown, .expired, .unsafe: return showStaleList
        }
    }

    // MARK: Rows

    var window: BriefingWindow {
        let date = now()
        switch windowChoice {
        case .flight: return .flight(route: route, now: date)
        case .next6h: return BriefingWindow(start: date, end: date.addingTimeInterval(6 * 3600))
        case .next24h: return BriefingWindow(start: date, end: date.addingTimeInterval(24 * 3600))
        }
    }

    var query: BriefingQuery {
        let reference: BriefingReference
        switch distanceChoice {
        case .off: reference = .none
        case .route: reference = route.map { .route($0) } ?? .none
        case .ownship: reference = ownship.map { .ownship($0) } ?? .none
        }
        return BriefingQuery(
            window: window, reference: reference, corridorNM: corridorNM,
            aerodrome: aerodromeFilter, routeAerodromes: route?.aerodromes ?? [],
            network: route?.network ?? .cvfr)
    }

    /// Rows for the current filters, closures first. Empty until a feed is loaded and listable.
    var rows: [BriefingRow] {
        guard let report, isListable else { return [] }
        let all = IsraelBriefingFilter.rows(from: report.feed.items, query: query)
        return unreadOnly ? all.filter { !readStore.isRead($0.notam) } : all
    }

    func rows(in section: BriefingSection) -> [BriefingRow] { rows.filter { $0.section == section } }

    var unreadCount: Int { rows.filter { !readStore.isRead($0.notam) }.count }

    // MARK: Read state

    func isRead(_ notam: IsraelNotam) -> Bool { readStore.isRead(notam) }
    func markRead(_ notam: IsraelNotam) { readStore.markRead(notam) }
    func markUnread(_ notam: IsraelNotam) { readStore.markUnread(notam) }
    func markAllRead() { readStore.markAllRead(rows.map(\.notam)) }

    // MARK: Debug

    /// DEBUG: the notams.json named by `IsraelChartDebugNotamsPath` stands in for the relay (screenshots, UI tests).
    nonisolated private static func debugFeedOverride() async throws -> IsraelNotamReport? {
        #if DEBUG
        guard let path = UserDefaults.standard.string(forKey: "IsraelChartDebugNotamsPath") else { return nil }
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let feed = try IsraelNotamService.decoder.decode(IsraelNotamFeed.self, from: data)
        return IsraelNotamReport(feed: feed, fetchedAt: Date(), refreshFailed: false)
        #else
        return nil
        #endif
    }
}
