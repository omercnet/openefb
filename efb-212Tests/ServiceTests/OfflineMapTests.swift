//
//  OfflineMapTests.swift
//  efb-212Tests
//
//  Sectional 56-day cycle, region size estimate, and offline-status derivation (F6).
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Offline Maps")
struct OfflineMapTests {

    // MARK: - Helpers

    static func utc(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
        var c = DateComponents()
        c.year = y; c.month = m; c.day = d; c.hour = h; c.minute = min
        c.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: c)!
    }

    static let paloAlto = OfflineRegionBounds(south: 37.3, west: -122.3, north: 37.6, east: -121.9)
    static let view = OfflineRegionBounds(south: 37.4, west: -122.2, north: 37.5, east: -122.0)

    static func pack(
        _ layer: OfflineLayer,
        bounds: OfflineRegionBounds = paloAlto,
        state: OfflinePackState = .complete,
        cycle: Date? = nil
    ) -> OfflinePackSummary {
        OfflinePackSummary(
            context: OfflinePackContext(
                id: UUID(), name: "Test", layer: layer, bounds: bounds,
                cycleEffective: cycle, createdAt: Date()
            ),
            state: state, completedResources: 10, expectedResources: 10, completedBytes: 1000
        )
    }

    // MARK: - Cycle

    @Test func cycleAnchorIsTheFAAEditionDate() {
        // FAA Dates of Latest Editions: sectionals Oct 29 2026, next Dec 24 2026.
        let cycle = SectionalCycle.current(at: Self.utc(2026, 11, 15))
        #expect(cycle.effective == Self.utc(2026, 10, 29, 9, 1))
        #expect(cycle.expires == Self.utc(2026, 12, 24, 9, 1))
    }

    @Test func cycleRollsOverExactlyAtTheBoundary() {
        let boundary = Self.utc(2026, 12, 24, 9, 1)
        let before = SectionalCycle.current(at: boundary.addingTimeInterval(-1))
        let at = SectionalCycle.current(at: boundary)
        #expect(before.effective == Self.utc(2026, 10, 29, 9, 1))
        #expect(at.effective == boundary)
        #expect(at.expires == boundary.addingTimeInterval(56 * 86_400))
    }

    @Test func cycleComputesEarlierCyclesBeforeTheAnchor() {
        let cycle = SectionalCycle.current(at: Self.utc(2026, 10, 1))
        #expect(cycle.effective == Self.utc(2026, 9, 3, 9, 1))
        #expect(cycle.expires == Self.utc(2026, 10, 29, 9, 1))
    }

    @Test func chartFromThePreviousCycleIsNotCurrent() {
        let now = Self.utc(2026, 11, 1)
        #expect(!SectionalCycle.isCurrent(chartEffective: Self.utc(2026, 9, 3, 9, 1), at: now))
        #expect(SectionalCycle.isCurrent(chartEffective: Self.utc(2026, 10, 29, 9, 1), at: now))
    }

    @Test func daysRemainingCountsWholeDaysToTheNextEdition() {
        #expect(SectionalCycle.daysRemaining(at: Self.utc(2026, 12, 20, 9, 1)) == 4)
        #expect(SectionalCycle.daysRemaining(at: Self.utc(2026, 12, 24, 9, 0)) == 0)
    }

    // MARK: - Size estimate

    @Test func tileCountMatchesHandComputedWorldBox() {
        // Box between 80N/80S and 170W/170E spans tiles x 0-1, y 0-1 at zoom 1.
        let box = OfflineRegionBounds(south: -80, west: -170, north: 80, east: 170)
        #expect(OfflineTileMath.tileCount(bounds: box, zooms: 1...1) == 4)
    }

    @Test func sectionalEstimateForASingleTileColumnIsOneTilePerZoom() {
        let point = OfflineRegionBounds(south: 37.4610, west: -122.1151, north: 37.4611, east: -122.1150)
        // z8-12 = 5 zoom levels, one tile each.
        #expect(OfflineTileMath.tileCount(bounds: point, zooms: OfflineLayer.sectional.zoomRange) == 5)
        #expect(OfflineTileMath.estimatedBytes(bounds: point, layer: .sectional) == 5 * OfflineLayer.sectional.averageTileBytes)
    }

    @Test func estimateGrowsWithAreaAndSumsLayers() {
        let small = Self.view
        let big = Self.paloAlto
        let smallBytes = OfflineTileMath.estimatedBytes(bounds: small, layers: [.sectional])
        let bigBytes = OfflineTileMath.estimatedBytes(bounds: big, layers: [.sectional])
        #expect(bigBytes > smallBytes)
        let both = OfflineTileMath.estimatedBytes(bounds: big, layers: [.sectional, .street])
        #expect(both == bigBytes + OfflineTileMath.estimatedBytes(bounds: big, layer: .street))
    }

    @Test func onlyRedistributableLayersAreDownloadable() {
        #expect(OfflineLayer.allCases == [.sectional, .street])
    }

    // MARK: - Status

    @Test func completeCurrentPackCoveringTheViewIsReady() {
        let now = Self.utc(2026, 11, 1)
        let packs = [Self.pack(.sectional, cycle: Self.utc(2026, 10, 29, 9, 1)), Self.pack(.street)]
        #expect(OfflineStatusResolver.status(visible: Self.view, style: .vfrSectional, packs: packs, at: now) == .ready)
    }

    @Test func noPacksIsNotDownloaded() {
        #expect(OfflineStatusResolver.status(visible: Self.view, style: .street, packs: []) == .notDownloaded)
    }

    @Test func vfrNeedsBothSectionalAndStreet() {
        let now = Self.utc(2026, 11, 1)
        let packs = [Self.pack(.sectional, cycle: Self.utc(2026, 10, 29, 9, 1))]
        #expect(OfflineStatusResolver.status(visible: Self.view, style: .vfrSectional, packs: packs, at: now) == .notDownloaded)
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .sectional, packs: packs, at: now) == .ready)
    }

    @Test func viewPartlyOutsideThePackIsPartial() {
        let wide = OfflineRegionBounds(south: 37.2, west: -122.5, north: 37.5, east: -122.0)
        #expect(OfflineStatusResolver.status(visible: wide, layer: .street, packs: [Self.pack(.street)]) == .partial)
    }

    @Test func packStillDownloadingIsPartial() {
        let packs = [Self.pack(.street, state: .downloading)]
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: packs) == .partial)
    }

    @Test func packElsewhereDoesNotCount() {
        let denver = OfflineRegionBounds(south: 39, west: -105.5, north: 40, east: -104)
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .street, packs: [Self.pack(.street, bounds: denver)]) == .notDownloaded)
    }

    @Test func sectionalFromAnEarlierCycleIsExpiredNeverReady() {
        let now = Self.utc(2026, 11, 1)
        let old = Self.pack(.sectional, cycle: Self.utc(2026, 9, 3, 9, 1))
        #expect(old.isExpired(at: now))
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .sectional, packs: [old], at: now) == .expired)
        let packs = [old, Self.pack(.street)]
        #expect(OfflineStatusResolver.status(visible: Self.view, style: .vfrSectional, packs: packs, at: now) == .expired)
    }

    @Test func aCurrentPackWinsOverAnExpiredOne() {
        let now = Self.utc(2026, 11, 1)
        let packs = [
            Self.pack(.sectional, cycle: Self.utc(2026, 9, 3, 9, 1)),
            Self.pack(.sectional, cycle: Self.utc(2026, 10, 29, 9, 1)),
        ]
        #expect(OfflineStatusResolver.status(visible: Self.view, layer: .sectional, packs: packs, at: now) == .ready)
    }

    @Test func streetPacksNeverExpireWithTheChartCycle() {
        #expect(!Self.pack(.street).isExpired(at: Self.utc(2030, 1, 1)))
    }

    // MARK: - Pack style

    @Test func packStyleKeepsOnlyTheLayersSources() throws {
        let base = """
        {"version":8,"glyphs":"https://example.com/{fontstack}/{range}.pbf",
         "sources":{"vfr-sectional":{"type":"raster","tiles":["https://a/{z}/{y}/{x}"]},
                    "openmaptiles":{"type":"vector","url":"https://b"}},
         "layers":[{"id":"bg","type":"background"},
                   {"id":"base-vfr-sectional","type":"raster","source":"vfr-sectional"},
                   {"id":"street-water","type":"fill","source":"openmaptiles","source-layer":"water"}]}
        """
        let data = try OfflinePackStyle.styleData(for: .sectional, base: Data(base.utf8))
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let sources = try #require(json["sources"] as? [String: Any])
        let layers = try #require(json["layers"] as? [[String: Any]])
        #expect(Set(sources.keys) == ["vfr-sectional"])
        #expect(layers.compactMap { $0["id"] as? String } == ["base-vfr-sectional"])
        #expect(json["glyphs"] == nil)
    }

    @Test func packStyleRejectsMalformedBaseStyle() {
        #expect(throws: EFBError.self) {
            _ = try OfflinePackStyle.styleData(for: .street, base: Data("{}".utf8))
        }
    }
}
