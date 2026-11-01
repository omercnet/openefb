//
//  IsraelChartFeaturesTests.swift
//  efb-212Tests
//
//  IL-3: the CVFR chart's feature building (direction labels, published two-number text,
//  airspace limit labels, closure styling inputs, stale closures hidden), the tap-sheet details
//  and layer availability by region. Pure logic: no map, no network.
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Israel CVFR chart features")
struct IsraelChartFeaturesTests {

    // MARK: Fixtures

    private static func point(_ id: Int, _ code: String, _ kind: IsraelPointKind = .compulsory,
                              lat: Double = 32.0, lon: Double = 34.8) -> IsraelReportingPoint {
        IsraelReportingPoint(id: id, code: code, nameEnglish: code.capitalized, nameHebrew: nil, kind: kind,
                             latitude: lat, longitude: lon)
    }

    private static func altitude(_ published: String) -> IsraelRouteAltitude {
        IsraelRouteAltitude(published: published, feet: Int(published))
    }

    private static func segment(
        _ id: Int, _ from: String, _ to: String, bearing: Double = 90,
        forward: IsraelRouteAltitude? = nil, reverse: IsraelRouteAltitude? = nil,
        military: Bool = false, byRequest: Bool = false
    ) -> IsraelRouteSegment {
        IsraelRouteSegment(
            id: id, fromCode: from, toCode: to, fromPointID: 1, toPointID: 2, nameEnglish: nil, nameHebrew: nil,
            lengthNM: 10, isCivil: !military, isMilitary: military, isByRequest: byRequest, bearingTrue: bearing,
            altitudeForward: forward, altitudeReverse: reverse, lowerAltitudeFeet: nil, mapSheet: nil,
            polyline: [CLLocationCoordinate2D(latitude: 32.0, longitude: 34.8), CLLocationCoordinate2D(latitude: 32.0, longitude: 35.0)]
        )
    }

    private static let origin = CLLocationCoordinate2D(latitude: 32.0, longitude: 34.9)

    // MARK: Direction labels

    @Test func eastboundLabelReadsAlongTheLineWithEachDirectionsAltitude() throws {
        let label = try #require(IsraelChartFeatureBuilder.segmentLabel(
            forward: Self.altitude("2500"), reverse: Self.altitude("3000"),
            bearingTrue: 90, at: Self.origin, military: false
        ))
        #expect(label.text == "\u{2192}2500 / \u{2190}3000")
        #expect(label.rotationDegrees == 0)
    }

    @Test func westboundLabelFlipsSoTextIsNeverUpsideDownAndArrowsSwap() throws {
        // from -> to is west (270): text must run east, i.e. along to -> from, so the reverse altitude leads.
        let label = try #require(IsraelChartFeatureBuilder.segmentLabel(
            forward: Self.altitude("2500"), reverse: Self.altitude("3000"),
            bearingTrue: 270, at: Self.origin, military: false
        ))
        #expect(label.text == "\u{2192}3000 / \u{2190}2500")
        #expect(label.rotationDegrees == 0)
    }

    @Test func rotationNeverLeavesTheReadableHalfPlane() {
        for bearing in stride(from: 0.0, through: 359.0, by: 1.0) {
            let rotation = IsraelChartFeatureBuilder.textRotation(bearingTrue: bearing)
            #expect(rotation >= -90 && rotation <= 90, "bearing \(bearing) rotates text to \(rotation)")
        }
    }

    @Test func twoNumberPublishedAltitudeIsShownAsPublished() throws {
        let twoNumbers = IsraelRouteAltitude(published: "2500/3500", feet: nil)
        let label = try #require(IsraelChartFeatureBuilder.segmentLabel(
            forward: twoNumbers, reverse: Self.altitude("3000"),
            bearingTrue: 45, at: Self.origin, military: false
        ))
        #expect(label.text == "\u{2192}2500/3500 / \u{2190}3000")
    }

    @Test func oneDirectionOnlyDropsTheMissingDirection() throws {
        let label = try #require(IsraelChartFeatureBuilder.segmentLabel(
            forward: nil, reverse: Self.altitude("3500"), bearingTrue: 90, at: Self.origin, military: false
        ))
        #expect(label.text == "\u{2190}3500")
    }

    @Test func noPublishedAltitudeMeansNoLabel() {
        #expect(IsraelChartFeatureBuilder.segmentLabel(
            forward: nil, reverse: nil, bearingTrue: 90, at: Self.origin, military: false
        ) == nil)
    }

    @Test func militaryRoutesAreFlaggedInTheLabel() throws {
        let label = try #require(IsraelChartFeatureBuilder.segmentLabel(
            forward: Self.altitude("2500"), reverse: nil, bearingTrue: 90, at: Self.origin, military: true
        ))
        #expect(label.text.hasSuffix("MIL"))
    }

    @Test func routeStyleSeparatesCivilByRequestAndMilitary() {
        #expect(IsraelChartFeatureBuilder.routeStyle(Self.segment(1, "A", "B")) == .civil)
        #expect(IsraelChartFeatureBuilder.routeStyle(Self.segment(2, "A", "B", byRequest: true)) == .byRequest)
        #expect(IsraelChartFeatureBuilder.routeStyle(Self.segment(3, "A", "B", military: true)) == .military)
        // Military wins when a segment is both military and by request: the pilot needs IAF approval first.
        #expect(IsraelChartFeatureBuilder.routeStyle(Self.segment(4, "A", "B", military: true, byRequest: true)) == .military)
    }

    @Test func midpointIsHalfwayAlongTheLengthNotTheMiddleVertex() throws {
        // Vertices 0, 0.1 and 1.0 degrees east: the middle vertex is near one end.
        let line = [
            CLLocationCoordinate2D(latitude: 32, longitude: 34.0),
            CLLocationCoordinate2D(latitude: 32, longitude: 34.1),
            CLLocationCoordinate2D(latitude: 32, longitude: 35.0)
        ]
        let mid = try #require(IsraelChartFeatureBuilder.midpoint(of: line))
        #expect(abs(mid.longitude - 34.5) < 0.001)
    }

    @Test func segmentsWithoutAGeometryAreSkipped() {
        var broken = Self.segment(9, "A", "B")
        broken = IsraelRouteSegment(
            id: 9, fromCode: "A", toCode: "B", fromPointID: 1, toPointID: 2, nameEnglish: nil, nameHebrew: nil,
            lengthNM: nil, isCivil: true, isMilitary: false, isByRequest: false, bearingTrue: 0,
            altitudeForward: nil, altitudeReverse: nil, lowerAltitudeFeet: nil, mapSheet: nil, polyline: [Self.origin]
        )
        #expect(IsraelChartFeatureBuilder.segmentFeatures([broken, Self.segment(1, "A", "B")]).map(\.id) == [1])
    }

    // MARK: Airspace limits

    @Test func limitsReadSurfaceToCeilingInFeet() {
        let floor = IsraelAirspaceLimit(feet: 0, reference: .surface, publishedText: nil)
        let ceiling = IsraelAirspaceLimit(feet: 3000, reference: .msl, publishedText: nil)
        #expect(IsraelChartFeatureBuilder.limitsText(floor: floor, ceiling: ceiling) == "SFC\u{2013}3000")
    }

    @Test func flightLevelUnlimitedAndTwoNumberLimitsKeepTheirForm() {
        let floor = IsraelAirspaceLimit(feet: 1500, reference: .msl, publishedText: nil)
        let fl = IsraelAirspaceLimit(feet: 9500, reference: .flightLevel, publishedText: nil)
        #expect(IsraelChartFeatureBuilder.limitsText(floor: floor, ceiling: fl) == "1500\u{2013}FL95")

        let unlimited = IsraelAirspaceLimit(feet: 99000, reference: .unlimited, publishedText: nil)
        let sfc = IsraelAirspaceLimit(feet: 0, reference: .surface, publishedText: nil)
        #expect(IsraelChartFeatureBuilder.limitsText(floor: sfc, ceiling: unlimited) == "SFC\u{2013}UNL")

        let twoNumbers = IsraelAirspaceLimit(feet: 3500, reference: .msl, publishedText: "3000/3500")
        #expect(IsraelChartFeatureBuilder.limitsText(floor: sfc, ceiling: twoNumbers) == "SFC\u{2013}3000/3500")
    }

    @Test func unpublishedLimitsAreMarkedUnknownNeverInvented() {
        let none = IsraelAirspaceLimit(feet: nil, reference: nil, publishedText: nil)
        #expect(IsraelChartFeatureBuilder.limitsText(floor: none, ceiling: none) == "")
        let sfc = IsraelAirspaceLimit(feet: 0, reference: .surface, publishedText: nil)
        #expect(IsraelChartFeatureBuilder.limitsText(floor: sfc, ceiling: none) == "SFC\u{2013}?")
    }

    @Test func prohibitedRestrictedAndDangerAreRestrictedOthersAreNot() {
        for kind in IsraelAirspaceKind.allCases {
            let expected = [.prohibited, .restricted, .danger].contains(kind)
            #expect(IsraelChartFeatureBuilder.isRestricted(kind) == expected, "\(kind)")
        }
    }

    @Test func firIsNotDrawnAsAnAirspace() {
        let ring = [
            CLLocationCoordinate2D(latitude: 32, longitude: 34), CLLocationCoordinate2D(latitude: 32, longitude: 35),
            CLLocationCoordinate2D(latitude: 33, longitude: 35)
        ]
        func airspace(_ id: Int, _ kind: IsraelAirspaceKind) -> IsraelAirspace {
            IsraelAirspace(
                id: id, kind: kind, code: "LLX", nameEnglish: nil, nameHebrew: nil, label: nil, authority: .civil,
                floor: IsraelAirspaceLimit(feet: 0, reference: .surface, publishedText: nil),
                ceiling: IsraelAirspaceLimit(feet: 3000, reference: .msl, publishedText: nil),
                polygons: [[ring]]
            )
        }
        let features = IsraelChartFeatureBuilder.airspaceFeatures([airspace(1, .fir), airspace(2, .ctr), airspace(3, .prohibited)])
        #expect(features.map(\.id) == [2, 3])
        #expect(features.map(\.isRestricted) == [false, true])
    }

    // MARK: Closures

    private static let now = Date(timeIntervalSince1970: 1_793_524_800)  // 2026-11-01 09:20Z

    private static func closure(
        chain: [String], kind: String = "CVFR", validFrom: Date? = nil, validTo: Date? = nil, id: String = "C1/26"
    ) -> IsraelRouteClosure {
        IsraelRouteClosure(notamId: id, routeKind: kind, routeName: nil, chain: chain,
                           validFrom: validFrom ?? now.addingTimeInterval(-3600), validTo: validTo ?? now.addingTimeInterval(7200),
                           schedule: nil)
    }

    private static func report(closures: [IsraelRouteClosure], scrapedAgo: TimeInterval) -> IsraelNotamReport {
        IsraelNotamReport(
            feed: IsraelNotamFeed(generatedAt: now.addingTimeInterval(-scrapedAgo), items: [], closures: closures),
            fetchedAt: now, refreshFailed: false
        )
    }

    private static let network = IsraelChartNetwork(
        points: [point(1, "GALIM"), point(2, "DAROM"), point(3, "HOTRM")],
        segments: [segment(10, "GALIM", "DAROM"), segment(11, "DAROM", "HOTRM")]
    )

    @Test func freshClosureMarksTheClosedSegmentWithItsValidity() throws {
        let set = IsraelChartFeatureBuilder.closures(
            from: Self.report(closures: [Self.closure(chain: ["GALIM", "DAROM"])], scrapedAgo: 300),
            network: Self.network, now: Self.now
        )
        #expect(set.freshness == .fresh)
        #expect(set.marks.keys.sorted() == [10])
        let mark = try #require(set.marks[10])
        #expect(mark.notamID == "C1/26")
        #expect(mark.text == "CLSD to 11:20Z")
    }

    @Test func closureEndingOnAnotherUTCDayShowsTheDate() throws {
        let tomorrow = Self.now.addingTimeInterval(86_400)
        let set = IsraelChartFeatureBuilder.closures(
            from: Self.report(closures: [Self.closure(chain: ["GALIM", "DAROM"], validTo: tomorrow)], scrapedAgo: 60),
            network: Self.network, now: Self.now
        )
        #expect(set.marks[10]?.text == "CLSD to 2 Nov 09:20Z")
    }

    @Test func staleFeedDrawsNoClosuresAtAll() {
        // 7 h since the relay scraped the IAA: past the 6 h NOTAM expiry.
        let set = IsraelChartFeatureBuilder.closures(
            from: Self.report(closures: [Self.closure(chain: ["GALIM", "DAROM"])], scrapedAgo: 7 * 3600),
            network: Self.network, now: Self.now
        )
        #expect(set.marks.isEmpty)
        #expect(set.freshness == .expired)
        #expect(set.generatedAt != nil)  // the panel still shows how old it is
    }

    @Test func oldButNotExpiredFeedDrawsClosuresAndSaysHowOldTheDataIs() throws {
        let set = IsraelChartFeatureBuilder.closures(
            from: Self.report(closures: [Self.closure(chain: ["GALIM", "DAROM"])], scrapedAgo: 2 * 3600),
            network: Self.network, now: Self.now
        )
        #expect(set.freshness == .old)
        let text = try #require(set.marks[10]?.text)
        #expect(text.hasSuffix("(data 2h00m old)"))
    }

    @Test func absentFeedDrawsNothing() {
        let set = IsraelChartFeatureBuilder.closures(from: nil, network: Self.network, now: Self.now)
        #expect(set.marks.isEmpty)
        #expect(set.generatedAt == nil)
    }

    @Test func expiredAndOtherNetworkClosuresAreNotDrawn() {
        let ended = Self.closure(chain: ["GALIM", "DAROM"], validFrom: Self.now.addingTimeInterval(-7200),
                                 validTo: Self.now.addingTimeInterval(-60))
        let helicopter = Self.closure(chain: ["DAROM", "HOTRM"], kind: "HEL")
        let set = IsraelChartFeatureBuilder.closures(
            from: Self.report(closures: [ended, helicopter], scrapedAgo: 60), network: Self.network, now: Self.now
        )
        #expect(set.marks.isEmpty)
    }

    @Test func closureFeaturesCoverOnlyClosedSegmentsAndRotateWithTheLine() throws {
        let segments = IsraelChartFeatureBuilder.segmentFeatures([
            Self.segment(10, "GALIM", "DAROM", bearing: 90), Self.segment(11, "DAROM", "HOTRM", bearing: 0)
        ])
        let mark = IsraelChartClosureMark(notamID: "C1/26", text: "CLSD", schedule: nil)
        let features = IsraelChartFeatureBuilder.closureFeatures(segments, marks: [11: mark, 99: mark])
        #expect(features.map(\.segmentID) == [11])
        let feature = try #require(features.first)
        #expect(feature.rotationDegrees == -90)
        #expect(feature.mark == mark)
    }

    // MARK: Tap sheets

    @Test func pointSheetListsEverySegmentDirectionWithItsPublishedAltitude() {
        let point = Self.point(2, "DAROM")
        let segments = [
            Self.segment(10, "GALIM", "DAROM", forward: Self.altitude("2500"), reverse: IsraelRouteAltitude(published: "2500/3500", feet: nil)),
            Self.segment(11, "DAROM", "HOTRM", reverse: Self.altitude("1500"), byRequest: true),
            Self.segment(12, "XXXXX", "YYYYY", forward: Self.altitude("1000"))
        ]
        let mark = IsraelChartClosureMark(notamID: "C1/26", text: "CLSD to 11:20Z", schedule: nil)
        let detail = IsraelChartDetails.point(point, segments: segments, closures: [10: mark])
        #expect(detail.rows.count == 4)  // segment 12 does not touch DAROM
        #expect(detail.rows.map { "\($0.from)>\($0.to)" } == ["DAROM>GALIM", "DAROM>HOTRM", "GALIM>DAROM", "HOTRM>DAROM"])
        let toGalim = detail.rows[0]
        #expect(toGalim.altitude == "2500/3500 ft")
        #expect(toGalim.closure == "CLSD to 11:20Z")
        #expect(detail.rows[1].altitude == "none published")
        #expect(detail.rows[1].routeType == "By request (ATC approval)")
        #expect(detail.kindText == "Compulsory reporting point")
    }

    @Test func airspaceSheetKeepsPublishedTextAndFlagsAnInferredReference() {
        let inferred = IsraelAirspaceLimit(feet: 3000, reference: .msl, publishedText: nil)
        let sfc = IsraelAirspaceLimit(feet: 0, reference: .surface, publishedText: nil)
        #expect(IsraelChartDetails.referenceNote(floor: sfc, ceiling: inferred) != nil)
        #expect(IsraelChartDetails.referenceNote(floor: sfc, ceiling: sfc) == nil)
        #expect(IsraelChartDetails.limitDetail(inferred) == "3000 ft MSL")
        #expect(IsraelChartDetails.limitDetail(sfc) == "SFC (ground)")
        let twoNumbers = IsraelAirspaceLimit(feet: 3500, reference: .msl, publishedText: "3000/3500")
        #expect(IsraelChartDetails.limitDetail(twoNumbers) == "3000/3500 ft (as published)")
        #expect(IsraelChartDetails.limitDetail(IsraelAirspaceLimit(feet: nil, reference: nil, publishedText: nil)) == "not published")
    }

    @Test func overlappingAirspacesListProhibitedRestrictedAndDangerFirst() {
        func airspace(_ id: Int, _ kind: IsraelAirspaceKind) -> IsraelAirspace {
            IsraelAirspace(
                id: id, kind: kind, code: "LL\(id)", nameEnglish: nil, nameHebrew: nil, label: nil, authority: nil,
                floor: IsraelAirspaceLimit(feet: 0, reference: .surface, publishedText: nil),
                ceiling: IsraelAirspaceLimit(feet: 3000, reference: .msl, publishedText: nil), polygons: []
            )
        }
        let details = IsraelChartDetails.airspaces([airspace(1, .ctr), airspace(2, .prohibited), airspace(3, .tma)])
        #expect(details.map(\.id) == [2, 1, 3])
    }
}

@Suite("Israel CVFR layer availability")
@MainActor
struct IsraelChartAvailabilityTests {

    @Test func israelHasTheChartLayersAndTheUSHasNone() {
        for layer in MapLayer.cvfrChart {
            #expect(Region.israel.supports(layer), "\(layer)")
            #expect(!Region.us.supports(layer), "\(layer)")
        }
        for layer in RegionDataLayer.cvfrChart {
            #expect(Region.israel.isAvailable(layer))
            #expect(!Region.us.isAvailable(layer))
        }
    }

    @Test func switchingToIsraelShowsTheChartAndBackToTheUSDropsIt() {
        let appState = AppState()
        appState.region = .israel
        #expect(Set(MapLayer.cvfrChart).isSubset(of: appState.visibleLayers))
        // US-only layers are gone in Israel
        #expect(!appState.visibleLayers.contains(.sectional))
        appState.region = .us
        #expect(Set(MapLayer.cvfrChart).isDisjoint(with: appState.visibleLayers))
    }

    @Test func onlyTheChartLayersAreRoutedToTheOverlay() {
        for layer in MapLayer.allCases {
            #expect(layer.isCVFRChart == MapLayer.cvfrChart.contains(layer))
        }
        #expect(MapLayer.cvfrChart.count == RegionDataLayer.cvfrChart.count)
    }
}

@Suite("Israel CVFR defaults with the official chart")
@MainActor
struct IsraelChartDefaultsTests {
    @Test func officialChartKeepsOnlyClosuresAndTapTargets() {
        let on = IsraelChartDefaults.visibleLayers(officialChartPresent: true)
        #expect(on == [.cvfrClosures, .cvfrPoints])
        #expect(!on.contains(.cvfrRoutes) && !on.contains(.cvfrAirspace) && !on.contains(.cvfrRunways))
    }

    @Test func streetBaseDrawsEverything() {
        #expect(IsraelChartDefaults.visibleLayers(officialChartPresent: false) == Set(MapLayer.cvfrChart))
    }
}

@Suite("Israel CVFR aerodromes (IL-4)")
struct IsraelChartAerodromeTests {
    private static func aerodrome(_ code: String, type: IsraelAerodromeType = .airstrip, use: IsraelAerodromeUse = .civil,
                                  reviewed: Bool = true) -> IsraelAerodrome {
        IsraelAerodrome(
            id: code.hashValue, code: code, nameHebrew: code, nameEnglish: code, type: type, use: use,
            latitude: 31.5, longitude: 34.8, elevationFeet: nil, circuitAltitudeFeet: nil, circuitDirection: nil,
            hours: nil, ppr: .unknown, pprText: nil, remarks: nil,
            sources: IsraelAerodromeSources(identity: "test", runways: nil, frequencies: nil, circuit: nil, hours: nil, remarks: nil),
            uncertainGroups: [], notes: nil, reviewStatus: reviewed ? .reviewed : .unreviewed, runways: [], frequencies: []
        )
    }

    @Test func onlyAerodromesWithoutAnARPPointAreDrawnAndForeignOnesNever() {
        let arp = IsraelReportingPoint(id: 1, code: "LLHZ", nameEnglish: nil, nameHebrew: nil, kind: .arp, latitude: 32, longitude: 34)
        let compulsory = IsraelReportingPoint(id: 2, code: "NAAN", nameEnglish: nil, nameHebrew: nil, kind: .compulsory, latitude: 32, longitude: 34)
        let drawn = IsraelChartFeatureBuilder.aerodromesWithoutPoint(
            [Self.aerodrome("LLHZ", type: .airport), Self.aerodrome("NAAN"), Self.aerodrome("llar"), Self.aerodrome("OJAM", use: .foreign)],
            points: [arp, compulsory]
        ).map(\.code)
        // NAAN is a compulsory point, not an ARP, so the strip still gets its own symbol.
        #expect(drawn == ["NAAN", "llar"])
    }

    @Test func unreviewedAerodromesAreStarred() {
        #expect(IsraelChartFeatureBuilder.aerodromeLabel(Self.aerodrome("SAAD")) == "SAAD")
        #expect(IsraelChartFeatureBuilder.aerodromeLabel(Self.aerodrome("SAAD", reviewed: false)) == "SAAD*")
    }

    @Test func symbolFollowsAerodromeType() {
        #expect(IsraelChartSymbol(IsraelAerodromeType.airport) == .aerodrome)
        #expect(IsraelChartSymbol(IsraelAerodromeType.airstrip) == .airstrip)
        #expect(IsraelChartSymbol(IsraelAerodromeType.heliport) == .heliport)
    }
}
