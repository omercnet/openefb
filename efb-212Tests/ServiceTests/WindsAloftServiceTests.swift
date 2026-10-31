//
//  WindsAloftServiceTests.swift
//  efb-212Tests
//
//  FD winds/temps aloft decoding against real aviationweather.gov bulletins
//  (captured 2026-10-30), nearest-station selection, and WindsAloftService.
//

import Testing
import Foundation
import CoreLocation
import os
@testable import efb_212

@Suite("Winds Aloft Service Tests")
struct WindsAloftServiceTests {

    /// Excerpt of https://aviationweather.gov/api/data/windtemp?region=all&level=low&fcst=06
    static let conus06 = """

    000
    FBUS31 KWNO 301400
    FD1US1
    DATA BASED ON 301200Z
    VALID 301800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000

    FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
    ABI      1330+09 1533+05 1918+03 2022-09 2232-19 223735 223747 226160
    ABQ              1410+07 1212+01 1908-12 2218-24 232739 233550 235161
    ALS                      9900+02 1608-14 2421-25 233340 224151 224362
    AMA      1812    1815+05 1516+00 1423-10 1623-21 213636 214447 206661
    BIH      9900    1811+02 2017-03 2027-17 2127-29 261643 262052 253461
    DEN              9900+10 9900+02 2217-15 2226-27 244241 235151 226263
    GLD      1924    2024+08 2117+02 2115-14 2124-24 234839 226750 720262
    MQT 2908 3133+00 3043-05 2950-10 2971-19 2983-31 289245 780054 289862
    SFO 2106 1910+05 2411+00 2316-07 2227-19 2334-28 234444 234554 234862
    """

    /// Header of the fcst=12 bulletin: the FOR USE window spans midnight.
    static let conus12Header = """
    FBUS33 KWNO 301400
    FD3US3
    DATA BASED ON 301200Z
    VALID 310000Z   FOR USE 2100-0600Z. TEMPS NEG ABV 24000

    FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
    SFO 2106 1910+05 2411+00 2316-07 2227-19 2334-28 234444 234554 234862
    """

    /// Excerpt of region=hawaii: different level set, no temps at or below 3000 ft.
    static let hawaii06 = """

    000
    FBHW31 KWNO 301400
    FD1HW1
    DATA BASED ON 301200Z
    VALID 301800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000

    FT  1000 1500 2000 3000    6000    9000   12000   15000   18000   24000
    LIH 0718 0723 0728 0830 0916+15 9900+11 2810+09 2916+03 2724-04 2630-15
    HNL 0620 0724 0729 0828 0709+15 3006+12 3011+09 3018+04 2824-03 2725-15
    LNY           0729 0823 0508+15 9900+11 3111+09 3118+04 3023-03 2823-15
    OGG 0617 0619 0724 0824 0610+15 2905+11 3112+08 3118+03 3024-04 2826-15
    """

    /// region=alaska row with a +100 kt group carrying an explicit temperature sign.
    static let alaska06 = """
    FBAK31 KWNO 301400
    FD1AK1
    DATA BASED ON 301200Z
    VALID 301800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000

    FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
    ANC 1436 1742-01 1942-07 1941-13 2068-23 7001-31 700844 209445 227643
    """

    static let reference = date("2026-10-30T16:00:00Z")
    static let kpao = CLLocationCoordinate2D(latitude: 37.4611, longitude: -122.1150)
    static let phnl = CLLocationCoordinate2D(latitude: 21.3187, longitude: -157.9225)
    static let kden = CLLocationCoordinate2D(latitude: 39.8617, longitude: -104.6731)
    static let panc = CLLocationCoordinate2D(latitude: 61.1743, longitude: -149.9962)

    static func date(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso) ?? .distantPast
    }

    static func level(_ bulletin: WindsAloftBulletin, _ station: String, _ altitude: Int) throws -> WindsAloftLevel {
        let row = try #require(bulletin.rows[station])
        return try #require(row.first { $0.altitude == altitude })
    }

    // MARK: - Group decoding

    @Test func decodesWindOnlyGroupWithoutTemperature() throws {
        let level = try #require(WindsAloftDecoder.decodeGroup("2106", altitude: 3000))
        #expect(level.direction == 210)   // degrees true
        #expect(level.speed == 6)         // knots
        #expect(level.temperature == nil) // 3000 ft group carries no temperature
        #expect(!level.isLightAndVariable)
    }

    @Test func decodesSignedTemperatureGroup() throws {
        let warm = try #require(WindsAloftDecoder.decodeGroup("1330+09", altitude: 6000))
        #expect(warm.direction == 130)
        #expect(warm.speed == 30)
        #expect(warm.temperature == 9)
        let cold = try #require(WindsAloftDecoder.decodeGroup("2022-09", altitude: 18000))
        #expect(cold.temperature == -9)
    }

    @Test func lightAndVariable() throws {
        let plain = try #require(WindsAloftDecoder.decodeGroup("9900", altitude: 6000))
        #expect(plain.isLightAndVariable)
        #expect(plain.direction == nil)
        #expect(plain.temperature == nil)
        #expect(plain.isForecast)

        let withTemp = try #require(WindsAloftDecoder.decodeGroup("9900+02", altitude: 12000))
        #expect(withTemp.isLightAndVariable)
        #expect(withTemp.temperature == 2)
    }

    @Test func directionPlus50EncodesSpeedPlus100Knots() throws {
        let synthetic = try #require(WindsAloftDecoder.decodeGroup("7315", altitude: 30000))
        #expect(synthetic.direction == 230)
        #expect(synthetic.speed == 115)

        // Real groups from the 2026-10-30 bulletins.
        let mqt = try #require(WindsAloftDecoder.decodeGroup("780054", altitude: 34000))
        #expect(mqt.direction == 280)
        #expect(mqt.speed == 100)
        #expect(mqt.temperature == -54)

        let anc = try #require(WindsAloftDecoder.decodeGroup("7001-31", altitude: 24000))
        #expect(anc.direction == 200)
        #expect(anc.speed == 101)
        #expect(anc.temperature == -31)
    }

    @Test func sixDigitGroupsAboveFL240HaveImpliedNegativeTemperature() throws {
        let level = try #require(WindsAloftDecoder.decodeGroup("234862", altitude: 39000))
        #expect(level.direction == 230)
        #expect(level.speed == 48)
        #expect(level.temperature == -62)
    }

    @Test func rejectsMalformedGroups() {
        #expect(WindsAloftDecoder.decodeGroup("12A4", altitude: 3000) == nil)
        #expect(WindsAloftDecoder.decodeGroup("9100", altitude: 3000) == nil)   // 91 is neither 01-36, 51-86 nor 99
        #expect(WindsAloftDecoder.decodeGroup("21065", altitude: 3000) == nil)
        #expect(WindsAloftDecoder.decodeGroup("1910*05", altitude: 6000) == nil)
    }

    // MARK: - Bulletin parsing

    @Test func parsesHeaderTimesAndLevels() throws {
        let bulletin = try WindsAloftDecoder.parseBulletin(Self.conus06, reference: Self.reference)
        #expect(bulletin.levels == [3000, 6000, 9000, 12000, 18000, 24000, 30000, 34000, 39000])
        #expect(bulletin.issued == Self.date("2026-10-30T14:00:00Z"))
        #expect(bulletin.basedOn == Self.date("2026-10-30T12:00:00Z"))
        #expect(bulletin.validTime == Self.date("2026-10-30T18:00:00Z"))
        #expect(bulletin.forUseStart == Self.date("2026-10-30T14:00:00Z"))
        #expect(bulletin.forUseEnd == Self.date("2026-10-30T21:00:00Z"))
        #expect(bulletin.rows.count == 9)
        #expect(bulletin.rows.keys.contains("000") == false)
        #expect(bulletin.rows.keys.contains("FD1") == false)
    }

    @Test func forUsePeriodSpanningMidnight() throws {
        let bulletin = try WindsAloftDecoder.parseBulletin(Self.conus12Header, reference: Self.reference)
        #expect(bulletin.validTime == Self.date("2026-10-31T00:00:00Z"))
        #expect(bulletin.forUseStart == Self.date("2026-10-30T21:00:00Z"))
        #expect(bulletin.forUseEnd == Self.date("2026-10-31T06:00:00Z"))
    }

    @Test func fullRowDecodesEveryColumn() throws {
        let bulletin = try WindsAloftDecoder.parseBulletin(Self.conus06, reference: Self.reference)
        let sfo = try #require(bulletin.rows["SFO"])
        #expect(sfo.map(\.direction) == [210, 190, 240, 230, 220, 230, 230, 230, 230])
        #expect(sfo.map(\.speed) == [6, 10, 11, 16, 27, 34, 44, 45, 48])
        #expect(sfo.map(\.temperature) == [nil, 5, 0, -7, -19, -28, -44, -54, -62])
    }

    @Test func blankLowLevelColumnsAreNotForecast() throws {
        let bulletin = try WindsAloftDecoder.parseBulletin(Self.conus06, reference: Self.reference)

        // ABQ (5,355 ft): 3000 and 6000 blank.
        #expect(try !Self.level(bulletin, "ABQ", 3000).isForecast)
        #expect(try !Self.level(bulletin, "ABQ", 6000).isForecast)
        let abq9 = try Self.level(bulletin, "ABQ", 9000)
        #expect(abq9.direction == 140 && abq9.speed == 10 && abq9.temperature == 7)

        // ALS (7,539 ft): first three blank, then light and variable at 12000.
        #expect(bulletin.rows["ALS"]?.prefix(3).allSatisfy { !$0.isForecast } == true)
        let als12 = try Self.level(bulletin, "ALS", 12000)
        #expect(als12.isLightAndVariable && als12.temperature == 2)

        // AMA: 3000 blank, 6000 wind without temperature (within 2,500 ft of elevation).
        #expect(try !Self.level(bulletin, "AMA", 3000).isForecast)
        let ama6 = try Self.level(bulletin, "AMA", 6000)
        #expect(ama6.direction == 180 && ama6.speed == 12 && ama6.temperature == nil)
        let ama9 = try Self.level(bulletin, "AMA", 9000)
        #expect(ama9.direction == 180 && ama9.temperature == 5)

        // BIH: 9900 with no temperature at 6000.
        let bih6 = try Self.level(bulletin, "BIH", 6000)
        #expect(bih6.isLightAndVariable && bih6.temperature == nil)
    }

    @Test func highSpeedGroupsInRealRows() throws {
        let bulletin = try WindsAloftDecoder.parseBulletin(Self.conus06, reference: Self.reference)
        let gld39 = try Self.level(bulletin, "GLD", 39000)
        #expect(gld39.direction == 220 && gld39.speed == 102 && gld39.temperature == -62)
        let mqt34 = try Self.level(bulletin, "MQT", 34000)
        #expect(mqt34.direction == 280 && mqt34.speed == 100 && mqt34.temperature == -54)

        let alaska = try WindsAloftDecoder.parseBulletin(Self.alaska06, reference: Self.reference)
        let anc24 = try Self.level(alaska, "ANC", 24000)
        #expect(anc24.direction == 200 && anc24.speed == 101 && anc24.temperature == -31)
        let anc30 = try Self.level(alaska, "ANC", 30000)
        #expect(anc30.direction == 200 && anc30.speed == 108 && anc30.temperature == -44)
    }

    @Test func hawaiiLevelSetFromHeader() throws {
        let bulletin = try WindsAloftDecoder.parseBulletin(Self.hawaii06, reference: Self.reference)
        #expect(bulletin.levels == [1000, 1500, 2000, 3000, 6000, 9000, 12000, 15000, 18000, 24000])
        let lny = try #require(bulletin.rows["LNY"])
        #expect(!lny[0].isForecast && !lny[1].isForecast)
        #expect(lny[2].direction == 70 && lny[2].speed == 29 && lny[2].temperature == nil)
        let hnl24 = try Self.level(bulletin, "HNL", 24000)
        #expect(hnl24.direction == 270 && hnl24.speed == 25 && hnl24.temperature == -15)
    }

    @Test func textWithoutHeaderRowThrows() {
        #expect(throws: EFBError.self) {
            try WindsAloftDecoder.parseBulletin("<html>502 Bad Gateway</html>", reference: Self.reference)
        }
    }

    @Test func dayOfMonthResolvesAcrossMonthBoundaries() {
        #expect(WindsAloftDecoder.resolve(ddhhmm: "302200Z", reference: Self.date("2026-11-01T01:00:00Z"))
                == Self.date("2026-10-30T22:00:00Z"))
        #expect(WindsAloftDecoder.resolve(ddhhmm: "010500Z", reference: Self.date("2026-10-31T23:00:00Z"))
                == Self.date("2026-11-01T05:00:00Z"))
        #expect(WindsAloftDecoder.resolve(ddhhmm: "321200Z", reference: Self.reference) == nil)
    }

    // MARK: - Nearest station

    @Test func bundledTableCoversAllBulletinStations() {
        let ids = WindsAloftDecoder.stations.map(\.id)
        #expect(ids.count == 233)
        #expect(Set(ids).count == ids.count)
    }

    @Test func nearestStationSelection() throws {
        let stations = WindsAloftDecoder.stations
        let paloAlto = try #require(WindsAloftDecoder.nearestStation(to: Self.kpao, among: stations))
        #expect(paloAlto.station.id == "SFO")
        #expect(paloAlto.distanceNM > 14 && paloAlto.distanceNM < 17)   // nautical miles

        #expect(WindsAloftDecoder.nearestStation(to: Self.kden, among: stations)?.station.id == "DEN")
        let honolulu = try #require(WindsAloftDecoder.nearestStation(to: Self.phnl, among: stations))
        #expect(honolulu.station.id == "HNL")
        #expect(honolulu.station.region == .hawaii)
        #expect(WindsAloftDecoder.nearestStation(to: Self.panc, among: stations)?.station.region == .alaska)
        #expect(WindsAloftDecoder.nearestStation(to: Self.kpao, among: []) == nil)
    }

    // MARK: - Service

    @Test func serviceReturnsNearestStationLevels() async throws {
        let requested = OSAllocatedUnfairLock<URL?>(initialState: nil)
        let body = Data(Self.conus06.utf8)
        let session = StubURLProtocol.session { request in
            requested.withLock { $0 = request.url }
            return (200, body)
        }

        let report = try await WindsAloftService(session: session)
            .fetchWindsAloft(near: Self.kpao, forecast: .twelveHour)

        #expect(report.station.id == "SFO")
        #expect(report.forecast == .twelveHour)
        #expect(report.levels.count == 9)
        #expect(report.levels.first?.direction == 210)
        #expect(report.levels.first?.speed == 6)

        let url = try #require(requested.withLock { $0 })
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(items.contains(URLQueryItem(name: "region", value: "all")))
        #expect(items.contains(URLQueryItem(name: "level", value: "low")))
        #expect(items.contains(URLQueryItem(name: "fcst", value: "12")))
    }

    @Test func serviceRequestsRegionOfNearestStation() async throws {
        let requested = OSAllocatedUnfairLock<URL?>(initialState: nil)
        let body = Data(Self.hawaii06.utf8)
        let session = StubURLProtocol.session { request in
            requested.withLock { $0 = request.url }
            return (200, body)
        }

        let report = try await WindsAloftService(session: session)
            .fetchWindsAloft(near: Self.phnl, forecast: .sixHour)

        #expect(report.station.id == "HNL")
        let url = try #require(requested.withLock { $0 })
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(items.contains(URLQueryItem(name: "region", value: "hawaii")))
        #expect(items.contains(URLQueryItem(name: "fcst", value: "06")))
    }

    @Test func serviceFallsBackWhenNearestStationMissingFromBulletin() async throws {
        let sfo = try #require(WindsAloftDecoder.stations.first { $0.id == "SFO" })
        let missing = WindsAloftStation(
            id: "ZZZ", name: "Not in bulletin",
            latitude: Self.kpao.latitude, longitude: Self.kpao.longitude,
            elevation: 0, region: .conus
        )
        let body = Data(Self.conus06.utf8)
        let session = StubURLProtocol.session { _ in (200, body) }

        let report = try await WindsAloftService(session: session, stations: [missing, sfo])
            .fetchWindsAloft(near: Self.kpao, forecast: .sixHour)

        #expect(report.station.id == "SFO")
    }

    @Test func serviceMapsOfflineToNetworkUnavailable() async {
        let session = StubURLProtocol.session { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await WindsAloftService(session: session).fetchWindsAloft(near: Self.kpao, forecast: .sixHour)
            Issue.record("Expected an error")
        } catch EFBError.networkUnavailable {
            // expected
        } catch {
            Issue.record("Unexpected error \(error)")
        }
    }

    @Test func forUsePeriodCheck() throws {
        let bulletin = try WindsAloftDecoder.parseBulletin(Self.conus06, reference: Self.reference)
        let sfo = try #require(WindsAloftDecoder.stations.first { $0.id == "SFO" })
        let report = WindsAloftReport(
            station: sfo, distanceNM: 15, forecast: .sixHour,
            issued: bulletin.issued, basedOn: bulletin.basedOn, validTime: bulletin.validTime,
            forUseStart: bulletin.forUseStart, forUseEnd: bulletin.forUseEnd,
            levels: bulletin.rows["SFO"] ?? []
        )
        #expect(report.isInForUsePeriod(at: Self.date("2026-10-30T14:00:00Z")))
        #expect(report.isInForUsePeriod(at: Self.date("2026-10-30T21:00:00Z")))
        #expect(!report.isInForUsePeriod(at: Self.date("2026-10-30T21:01:00Z")))
        #expect(!report.isInForUsePeriod(at: Self.date("2026-10-30T13:59:00Z")))
    }
}
