//
//  IsraelBriefingViewModelTests.swift
//  efb-212Tests
//
//  Loading, staleness gate and read/unread tracking of the Israel NOTAM briefing.
//

import Foundation
import Testing
@testable import efb_212

@MainActor
@Suite("Israel briefing view model", .serialized)
struct IsraelBriefingViewModelTests {
    private typealias F = BriefingFixtures

    private static func defaults() -> UserDefaults {
        UserDefaults(suiteName: "briefing-tests-\(UUID().uuidString)") ?? .standard
    }

    private static func report(_ items: [IsraelNotam], scrapedHoursAgo: Double = 0.1, failed: Bool = false) -> IsraelNotamReport {
        let feed = IsraelNotamFeed(generatedAt: F.hours(-scrapedHoursAgo), items: items, closures: items.flatMap(\.closures))
        return IsraelNotamReport(feed: feed, fetchedAt: F.t0, refreshFailed: failed)
    }

    private static func viewModel(
        _ report: Result<IsraelNotamReport, Error>, store: NotamReadStateStore? = nil
    ) -> (IsraelBriefingViewModel, NotamReadStateStore) {
        let store = store ?? NotamReadStateStore(defaults: defaults())
        let service = MockIsraelNotamService(result: report)
        let vm = IsraelBriefingViewModel(
            fetcher: { force in try await service.fetchFeed(forceRefresh: force) },
            readStore: store, now: { F.t0 })
        return (vm, store)
    }

    // MARK: Staleness

    @Test func freshFeedIsListedAndCurrent() async {
        let (vm, _) = Self.viewModel(.success(Self.report([F.notam("A")])))
        await vm.load()
        #expect(vm.isCurrent)
        #expect(vm.isListable)
        #expect(vm.rows.map(\.notam.id) == ["A"])
    }

    @Test func oldFeedIsListedButNotCurrent() async {
        let (vm, _) = Self.viewModel(.success(Self.report([F.notam("A")], scrapedHoursAgo: 2)))
        await vm.load()
        #expect(vm.freshness?.level == .old)
        #expect(!vm.isCurrent)
        #expect(vm.isListable)
    }

    @Test func expiredFeedIsHiddenUntilThePilotAsks() async {
        let (vm, _) = Self.viewModel(.success(Self.report([F.notam("A")], scrapedHoursAgo: 7)))
        await vm.load()
        #expect(vm.freshness?.level == .expired)
        #expect(!vm.isCurrent)
        #expect(vm.rows.isEmpty)
        vm.showStaleList = true
        #expect(vm.rows.map(\.notam.id) == ["A"])
    }

    @Test func failedFirstLoadKeepsNoListAndReportsTheError() async {
        let (vm, _) = Self.viewModel(.failure(EFBError.networkUnavailable))
        await vm.load()
        #expect(vm.report == nil)
        #expect(vm.errorMessage != nil)
        #expect(vm.rows.isEmpty)
    }

    // MARK: Read state

    @Test func notamsStartUnreadAndMarkAllReadClearsTheCount() async {
        let (vm, _) = Self.viewModel(.success(Self.report([F.notam("A"), F.notam("B")])))
        await vm.load()
        #expect(vm.unreadCount == 2)
        vm.markAllRead()
        #expect(vm.unreadCount == 0)
        let allRead = vm.rows.allSatisfy { vm.isRead($0.notam) }
        #expect(allRead)
    }

    @Test func unreadOnlyHidesReadNotams() async {
        let (vm, _) = Self.viewModel(.success(Self.report([F.notam("A"), F.notam("B")])))
        await vm.load()
        vm.markRead(F.notam("A"))
        vm.unreadOnly = true
        #expect(vm.rows.map(\.notam.id) == ["B"])
    }

    @Test func aReplacementNotamShowsUnreadEvenWhenTheOriginalWasRead() async {
        let original = F.notam("C100/26", created: F.hours(-48))
        let replacement = F.notam("C100/26", type: "NOTAMR", created: F.hours(-1))
        let (vm, _) = Self.viewModel(.success(Self.report([replacement])))
        await vm.load()
        vm.markRead(original)
        #expect(vm.isRead(original))
        #expect(!vm.isRead(replacement))
        #expect(vm.unreadCount == 1)
    }

    // MARK: Route

    @Test func settingARouteSelectsRouteDistanceAndRouteAerodromesSortFirst() async {
        let (vm, _) = Self.viewModel(.success(Self.report([F.notam("BG", location: "LLBG"), F.notam("HZ", location: "LLHZ")])))
        await vm.load()
        vm.route = BriefingRoute(codes: ["LLHZ", "GALIM"], points: [], departure: nil, eteSeconds: nil)
        #expect(vm.distanceChoice == .route)
        #expect(vm.rows.map(\.notam.id) == ["HZ", "BG"])
    }
}

@MainActor
@Suite("NOTAM read state store")
struct NotamReadStateStoreTests {
    private typealias F = BriefingFixtures

    private static func suite() -> (UserDefaults, String) {
        let name = "notam-store-\(UUID().uuidString)"
        return (UserDefaults(suiteName: name) ?? .standard, name)
    }

    @Test func readStatePersistsAcrossInstances() {
        let (defaults, _) = Self.suite()
        let notam = F.notam("A")
        NotamReadStateStore(defaults: defaults).markRead(notam)
        #expect(NotamReadStateStore(defaults: defaults).isRead(notam))
    }

    @Test func sameIdWithANewCreatedStampIsUnread() {
        let store = NotamReadStateStore(defaults: Self.suite().0)
        store.markRead(F.notam("C1/26", created: F.hours(-10)))
        #expect(!store.isRead(F.notam("C1/26", created: F.hours(-1))))
    }

    @Test func markUnreadUndoesMarkRead() {
        let store = NotamReadStateStore(defaults: Self.suite().0)
        let notam = F.notam("A")
        store.markRead(notam)
        store.markUnread(notam)
        #expect(!store.isRead(notam))
    }

    @Test func pruneDropsKeysOfNotamsNoLongerInTheFeed() {
        let (defaults, _) = Self.suite()
        let store = NotamReadStateStore(defaults: defaults)
        let gone = F.notam("GONE"), kept = F.notam("KEPT")
        store.markAllRead([gone, kept])
        store.prune(keeping: [kept])
        let reloaded = NotamReadStateStore(defaults: defaults)
        #expect(reloaded.isRead(kept))
        #expect(!reloaded.isRead(gone))
    }
}
