//
//  OfflinePackStatusCharacterizationTests.swift
//  efb-212Tests
//
//  Characterization: pins what the pure offline-pack types (OfflinePackSummary,
//  OfflineStatusResolver, OfflineRegionBounds) do today at the edges OfflineMapTests leaves
//  open. No MapLibre objects are created; `mlnBounds` is a plain struct.
//

import Testing
import Foundation
import CoreLocation
import MapLibre
@testable import efb_212

@Suite("Offline Pack Status Characterization")
struct OfflinePackStatusCharacterizationTests {

    // MARK: - Helpers

    static func utc(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) throws -> Date {
        var c = DateComponents()
        c.year = y; c.month = m; c.day = d; c.hour = h; c.minute = min
        c.timeZone = TimeZone(identifier: "UTC")
        return try #require(Calendar(identifier: .gregorian).date(from: c))
    }

    /// Visible map box around Palo Alto (degrees).
    static let view = OfflineRegionBounds(south: 37.4, west: -122.2, north: 37.5, east: -122.0)

    static func pack(
        _ layer: OfflineLayer,
        bounds: OfflineRegionBounds,
        state: OfflinePackState = .complete,
        completed: Int = 10,
        expected: Int = 10,
        cycle: Date? = nil
    ) -> OfflinePackSummary {
        OfflinePackSummary(
            context: OfflinePackContext(
                id: UUID(), name: "Char", layer: layer, bounds: bounds,
                cycleEffective: cycle, createdAt: Date(timeIntervalSince1970: 1_793_000_000)
            ),
            state: state, completedResources: completed, expectedResources: expected, completedBytes: 1000
        )
    }

    // MARK: - Resource counts vs state

    @Test func completeStateWithMissingResourcesReadsPartialNotReady() {
        let half = Self.pack(.street, bounds: Self.view, completed: 5, expected: 10)
        #expect(half.fraction == 0.5)
        // efb-asl: MapLibre marked it complete but half its tiles are missing: not "Offline: ready".
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: [half]) == .partial)
    }

    @Test func completePackWithZeroExpectedResourcesIsFullyDoneAndReady() {
        let empty = Self.pack(.street, bounds: Self.view, completed: 0, expected: 0)
        #expect(empty.fraction == 1)
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: [empty]) == .ready)
        let downloading = Self.pack(.street, bounds: Self.view, state: .downloading, completed: 0, expected: 0)
        #expect(downloading.fraction == 0)
    }

    @Test func fractionIsCappedAtOneWhenCompletedExceedsExpected() {
        #expect(Self.pack(.street, bounds: Self.view, completed: 15, expected: 10).fraction == 1)
    }

    @Test func failedPackCoveringTheViewReadsNotDownloaded() {
        let failed = Self.pack(.street, bounds: Self.view, state: .failed("Removed"))
        // efb-epd: a failed (removed/invalid) pack provides nothing offline.
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: [failed]) == .notDownloaded)
    }

    @Test func failedPackDoesNotHideAHealthyPackOnTheSameLayer() {
        let failed = Self.pack(.street, bounds: Self.view, state: .failed("Removed"))
        let good = Self.pack(.street, bounds: Self.view)
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: [failed, good]) == .ready)
    }

    @Test func pausedPackCoveringTheViewReadsPartial() {
        let paused = Self.pack(.street, bounds: Self.view, state: .paused, completed: 3, expected: 10)
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: [paused]) == .partial)
    }

    // MARK: - isExpired boundary

    @Test func packFromTheCurrentCycleEffectiveIsNotExpired() throws {
        let now = try Self.utc(2026, 11, 15)
        let effective = SectionalCycle.current(at: now).effective
        let expectedEffective = try Self.utc(2026, 10, 29, 9, 1)
        #expect(effective == expectedEffective)
        #expect(!Self.pack(.sectional, bounds: Self.view, cycle: effective).isExpired(at: now))
        // `>=` comparison: one second before the cycle effective is already the previous edition.
        #expect(Self.pack(.sectional, bounds: Self.view, cycle: effective.addingTimeInterval(-1)).isExpired(at: now))
        #expect(Self.pack(.sectional, bounds: Self.view, cycle: effective.addingTimeInterval(-86_400)).isExpired(at: now))
    }

    @Test func packIsExpiredFromTheExactNextCycleBoundary() throws {
        let effective = try Self.utc(2026, 10, 29, 9, 1)
        let nextCycle = try Self.utc(2026, 12, 24, 9, 1)
        let current = Self.pack(.sectional, bounds: Self.view, cycle: effective)
        #expect(!current.isExpired(at: nextCycle.addingTimeInterval(-1)))
        #expect(current.isExpired(at: nextCycle))
    }

    @Test func sectionalPackWithoutCycleNeverExpires() throws {
        let noCycle = Self.pack(.sectional, bounds: Self.view, cycle: nil)
        let farFuture = try Self.utc(2030, 1, 1)
        // BUG(failed-pack-reads-partial, efb-epd): pins current behavior; a sectional context
        // without cycleEffective (e.g. decoded from a malformed context) is treated as current forever.
        #expect(!noCycle.isExpired(at: farFuture))
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .sectional, packs: [noCycle], at: farFuture) == .ready)
    }

    @Test func packCycleInTheFutureIsNotExpired() throws {
        let now = try Self.utc(2026, 11, 15)
        let june = try Self.utc(2027, 6, 1)
        let future = Self.pack(.sectional, bounds: Self.view, cycle: june)
        #expect(!future.isExpired(at: now))
    }

    // MARK: - Coverage

    @Test func twoAdjacentPacksThatTogetherCoverTheViewArePartial() {
        let westHalf = OfflineRegionBounds(south: 37.3, west: -122.3, north: 37.6, east: -122.1)
        let eastHalf = OfflineRegionBounds(south: 37.3, west: -122.1, north: 37.6, east: -121.9)
        let packs = [Self.pack(.street, bounds: westHalf), Self.pack(.street, bounds: eastHalf)]
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: packs) == .partial)
    }

    @Test func packThatOnlyTouchesTheViewEdgeCountsAsIntersecting() {
        // Pack's east edge equals the view's west edge: zero-area overlap.
        let touching = OfflineRegionBounds(south: 37.4, west: -122.5, north: 37.5, east: -122.2)
        #expect(touching.intersects(Self.view))
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: [Self.pack(.street, bounds: touching)])
                == .partial)
    }

    @Test func viewExactlyEqualToPackBoundsIsReady() {
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: [Self.pack(.street, bounds: Self.view)])
                == .ready)
    }

    @Test func expiredFullCoverPlusCurrentPartialCoverIsPartialNotExpired() throws {
        let now = try Self.utc(2026, 11, 15)
        let wide = OfflineRegionBounds(south: 37.0, west: -123.0, north: 38.0, east: -121.0)
        let small = OfflineRegionBounds(south: 37.45, west: -122.15, north: 37.55, east: -122.05)
        let previousCycle = try Self.utc(2026, 9, 3, 9, 1)
        let currentCycle = try Self.utc(2026, 10, 29, 9, 1)
        let packs = [
            Self.pack(.sectional, bounds: wide, cycle: previousCycle),
            Self.pack(.sectional, bounds: small, cycle: currentCycle),
        ]
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .sectional, packs: packs, at: now) == .partial)
    }

    @Test func styleStatusWorstLayerWinsExpiredOverPartial() throws {
        let now = try Self.utc(2026, 11, 15)
        let previousCycle = try Self.utc(2026, 9, 3, 9, 1)
        let packs = [
            Self.pack(.sectional, bounds: Self.view, cycle: previousCycle),
            Self.pack(.street, bounds: Self.view, state: .downloading),
        ]
        #expect(OfflineStatusResolver.status(visible: Self.view, style: .vfrSectional, packs: packs, at: now) == .expired)
    }

    // MARK: - Bounds

    @Test func boundsNormaliseSwappedMinMax() {
        let swapped = OfflineRegionBounds(south: 40, west: -100, north: 30, east: -110)
        #expect(swapped == OfflineRegionBounds(south: 30, west: -110, north: 40, east: -100))
    }

    @Test func boundsAcrossTheAntimeridianBecomeTheWrongWayAroundBox() {
        // West 170E to east 170W (a 20 degree box over the date line) is reordered, not wrapped.
        let dateLine = OfflineRegionBounds(south: 50, west: 170, north: 55, east: -170)
        #expect(dateLine.west == -170)
        #expect(dateLine.east == 170)   // 340 degrees wide: documented "no antimeridian handling"
    }

    @Test func boundsAroundAPointAtTheEquator() {
        // 30 NM half side: 0.5 degree latitude; cos(0) = 1 so 0.5 degree longitude.
        let box = OfflineRegionBounds(around: CLLocationCoordinate2D(latitude: 0, longitude: 10), halfNM: 30)
        #expect(abs(box.south - -0.5) < 1e-9)
        #expect(abs(box.north - 0.5) < 1e-9)
        #expect(abs(box.west - 9.5) < 1e-9)
        #expect(abs(box.east - 10.5) < 1e-9)
    }

    @Test func boundsAroundAHighLatitudePointClampTheLongitudeScale() {
        // cos(89 deg) = 0.017 is clamped to 0.05, so the longitude half-width is 60 / (60 * 0.05) = 20 degrees.
        let box = OfflineRegionBounds(around: CLLocationCoordinate2D(latitude: 89, longitude: 0), halfNM: 60)
        #expect(abs(box.west - -20) < 1e-9)
        #expect(abs(box.east - 20) < 1e-9)
        #expect(abs(box.south - 88) < 1e-9)
        #expect(abs(box.north - 90) < 1e-9)
    }

    @Test func boundsAroundAPointNearThePoleExceedNinetyDegrees() {
        // Latitude is not clamped: 89.5 + 1 degree = 90.5, and mlnBounds passes it through.
        let box = OfflineRegionBounds(around: CLLocationCoordinate2D(latitude: 89.5, longitude: 0), halfNM: 60)
        #expect(abs(box.north - 90.5) < 1e-9)
        let mln = box.mlnBounds
        #expect(abs(mln.ne.latitude - 90.5) < 1e-9)
        #expect(abs(mln.sw.latitude - 88.5) < 1e-9)
        #expect(abs(mln.sw.longitude - -20) < 1e-9)
        #expect(abs(mln.ne.longitude - 20) < 1e-9)
    }
}
