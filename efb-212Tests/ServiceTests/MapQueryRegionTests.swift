//
//  MapQueryRegionTests.swift
//  efb-212Tests
//
//  Bounds-based airport query radius and low-zoom thinning (design finding F8).
//

import Testing
import Foundation
import CoreLocation
@testable import efb_212

@Suite("Map Query Region")
struct MapQueryRegionTests {

    static let kpao = CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150)

    /// Bounds roughly `halfLatDeg` tall and `halfLonDeg` wide around a centre.
    static func bounds(around center: CLLocationCoordinate2D, halfLatDeg: Double, halfLonDeg: Double)
        -> (ne: CLLocationCoordinate2D, sw: CLLocationCoordinate2D) {
        (
            ne: CLLocationCoordinate2D(latitude: center.latitude + halfLatDeg, longitude: center.longitude + halfLonDeg),
            sw: CLLocationCoordinate2D(latitude: center.latitude - halfLatDeg, longitude: center.longitude - halfLonDeg)
        )
    }

    // MARK: - Radius

    @Test func radiusCoversTheFarthestVisibleCornerWithMargin() {
        // Half-height 0.5 deg lat = 30 NM; half-width 0.5 deg lon at 37.5N = ~23.8 NM.
        let b = Self.bounds(around: Self.kpao, halfLatDeg: 0.5, halfLonDeg: 0.5)
        let radius = MapQueryRegion.radiusNM(center: Self.kpao, northEast: b.ne, southWest: b.sw)
        // The southern corners are farthest: a degree of longitude is wider at lower latitude.
        let corners = [b.ne, b.sw,
                       CLLocationCoordinate2D(latitude: b.ne.latitude, longitude: b.sw.longitude),
                       CLLocationCoordinate2D(latitude: b.sw.latitude, longitude: b.ne.longitude)]
        let farthestNM = corners.map { MapQueryRegion.haversineNM(from: Self.kpao, to: $0) }.max() ?? 0
        #expect(farthestNM > MapQueryRegion.haversineNM(from: Self.kpao, to: b.ne))
        #expect(abs(radius - farthestNM * MapQueryRegion.marginFactor) < 0.01)
        #expect(radius > 38 && radius < 43)
    }

    @Test func zoomedInViewUsesMinimumRadius() {
        // ~0.5 NM half-height: the clamp keeps the field under the aircraft in the query.
        let b = Self.bounds(around: Self.kpao, halfLatDeg: 0.008, halfLonDeg: 0.01)
        let radius = MapQueryRegion.radiusNM(center: Self.kpao, northEast: b.ne, southWest: b.sw)
        #expect(radius == MapQueryRegion.minRadiusNM)
    }

    @Test func conusViewIsCappedAtMaximumRadius() {
        let conus = CLLocationCoordinate2D(latitude: 39, longitude: -98)
        let b = Self.bounds(around: conus, halfLatDeg: 15, halfLonDeg: 30)
        let radius = MapQueryRegion.radiusNM(center: conus, northEast: b.ne, southWest: b.sw)
        #expect(radius == MapQueryRegion.maxRadiusNM)
    }

    @Test func wideScreenUsesTheWideAxis() {
        // Landscape iPad: half-width larger than half-height. Radius must exceed the half-height.
        let b = Self.bounds(around: Self.kpao, halfLatDeg: 0.2, halfLonDeg: 0.6)
        let radius = MapQueryRegion.radiusNM(center: Self.kpao, northEast: b.ne, southWest: b.sw)
        let halfHeightNM = MapQueryRegion.haversineNM(
            from: Self.kpao,
            to: CLLocationCoordinate2D(latitude: Self.kpao.latitude + 0.2, longitude: Self.kpao.longitude)
        )
        #expect(radius > halfHeightNM * 2)
    }

    @Test func radiusGrowsWhenZoomingOutAtTheSameCentre() {
        // The old formula skipped the reload on zoom-only changes; the radius must change here.
        let near = Self.bounds(around: Self.kpao, halfLatDeg: 0.1, halfLonDeg: 0.15)
        let far = Self.bounds(around: Self.kpao, halfLatDeg: 0.4, halfLonDeg: 0.6)
        let r1 = MapQueryRegion.radiusNM(center: Self.kpao, northEast: near.ne, southWest: near.sw)
        let r2 = MapQueryRegion.radiusNM(center: Self.kpao, northEast: far.ne, southWest: far.sw)
        #expect(r2 > r1 * 3)
    }

    // MARK: - Requery decision

    @Test func firstQueryAlwaysRuns() {
        #expect(MapQueryRegion.shouldRequery(lastCenter: nil, lastRadiusNM: nil, center: Self.kpao, radiusNM: 20))
    }

    @Test func smallPanAtSameZoomDoesNotRequery() {
        let moved = CLLocationCoordinate2D(latitude: Self.kpao.latitude + 0.02, longitude: Self.kpao.longitude)  // ~1.2 NM
        #expect(MapQueryRegion.shouldRequery(lastCenter: Self.kpao, lastRadiusNM: 20, center: moved, radiusNM: 21) == false)
    }

    @Test func zoomOutInPlaceRequeries() {
        #expect(MapQueryRegion.shouldRequery(lastCenter: Self.kpao, lastRadiusNM: 20, center: Self.kpao, radiusNM: 40))
    }

    @Test func largePanRequeries() {
        let moved = CLLocationCoordinate2D(latitude: Self.kpao.latitude + 0.2, longitude: Self.kpao.longitude)  // 12 NM
        #expect(MapQueryRegion.shouldRequery(lastCenter: Self.kpao, lastRadiusNM: 20, center: moved, radiusNM: 20))
    }

    // MARK: - Thinning

    static func airport(_ icao: String, type: AirportType = .airport, lat: Double, lon: Double) -> Airport {
        Airport(icao: icao, name: icao, latitude: lat, longitude: lon, elevation: 0, type: type, ownership: .publicOwned)
    }

    @Test func smallResultIsReturnedUntouched() {
        let list = [Self.airport("KPAO", lat: 37.46, lon: -122.11), Self.airport("KSQL", lat: 37.51, lon: -122.25)]
        #expect(MapQueryRegion.thin(list, around: Self.kpao, maxCount: 10).map(\.icao) == ["KPAO", "KSQL"])
    }

    @Test func thinningKeepsICAOAirportsOverHeliportsAndNearerOverFarther() {
        let list = [
            Self.airport("15CA", type: .heliport, lat: 37.44, lon: -122.17),   // nearest, but a heliport
            Self.airport("1CA9", lat: 38.0, lon: -122.0),                      // far local strip
            Self.airport("KSJC", lat: 37.36, lon: -121.93),                    // ICAO, farther
            Self.airport("KPAO", lat: 37.46, lon: -122.11),                    // ICAO, nearest
            Self.airport("KSQL", lat: 37.51, lon: -122.25),                    // ICAO, middle
        ]
        let kept = MapQueryRegion.thin(list, around: Self.kpao, maxCount: 3).map(\.icao)
        #expect(kept == ["KPAO", "KSQL", "KSJC"])
    }

    @Test func priorityRanks() {
        #expect(MapQueryRegion.priorityRank(Self.airport("KPAO", lat: 0, lon: 0)) == 0)
        #expect(MapQueryRegion.priorityRank(Self.airport("1CA9", lat: 0, lon: 0)) == 1)
        #expect(MapQueryRegion.priorityRank(Self.airport("US-2776", type: .heliport, lat: 0, lon: 0)) == 2)
        #expect(MapQueryRegion.priorityRank(Self.airport("S00", type: .seaplane, lat: 0, lon: 0)) == 2)
    }

    @Test func haversineMatchesKnownDistance() {
        // KPAO to KSQL is about 7.1 NM.
        let ksql = CLLocationCoordinate2D(latitude: 37.5119, longitude: -122.2494)
        let nm = MapQueryRegion.haversineNM(from: Self.kpao, to: ksql)
        #expect(abs(nm - 7.1) < 0.2)
    }
}
