//
//  AirSigmetServiceTests.swift
//  efb-212Tests
//
//  AIRMET/SIGMET/G-AIRMET parsing, validity windows, hazard colors and service caching.
//  Fixtures are real aviationweather.gov responses captured 2026-10-30 (subsets of the arrays).
//

import Testing
import Foundation
import os
@testable import efb_212

@Suite("AIRMET/SIGMET Service Tests")
struct AirSigmetServiceTests {

    // MARK: - Fixtures

    /// https://aviationweather.gov/api/data/airsigmet?format=json (convective SIGMET 50C;
    /// numeric coords, epoch validity, null altitudeLow1).
    static let airSigmetJSON = Data(#"""
[{"icaoId":"KKCI","alphaChar":"C","seriesId":"50C","receiptTime":"2026-10-30T18:48:10.791Z","creationTime":"2026-10-30T18:55:00.000Z","validTimeFrom":1793386500,"validTimeTo":1793393700,"airSigmetType":"SIGMET","hazard":"CONVECTIVE","altitudeHi1":32000,"altitudeHi2":32000,"altitudeLow1":null,"altitudeLow2":null,"movementDir":170,"movementSpd":15,"rawAirSigmet":"WSUS32 KKCI 301855\nMKCC WST 301855\n\nCONVECTIVE SIGMET 50C\nVALID UNTIL 2055Z\nOK KS\nFROM 60NNW OSW-30ENE OSW-60NW TUL-60NNW OSW\nAREA TS MOV FROM 17015KT. TOPS TO FL320.","postProcessFlag":0,"severity":5,"coords":[{"lon":-95.695,"lat":38.068},{"lon":-94.622,"lat":37.344},{"lon":-96.673,"lat":36.903},{"lon":-95.695,"lat":38.068}]}]
"""#.utf8)

    /// https://aviationweather.gov/api/data/gairmet?format=json: TURB-LO, IFR, MT_OBSC, ICE (FZL base),
    /// a FZLVL LINE and an M_FZLVL area (string coords, ISO validTime, epoch expireTime).
    static let gAirmetJSON = Data(#"""
[{"tag":"2W","forecastHour":3,"validTime":"2026-10-30T18:00:00.000Z","hazard":"TURB-LO","geometryType":"AREA","latlonpairs":14,"frequency":null,"severity":"MOD","due_to":null,"status":"NRML","top":"060","base":"SFC","fzltop":null,"fzlbase":null,"level":null,"receiptTime":1793376584,"issueTime":1793376540,"expireTime":1793394000,"product":"TANGO","geom":"AREA","coords":[{"lat":"46.97","lon":"-69.88"},{"lat":"45.77","lon":"-68.57"},{"lat":"44.37","lon":"-68.53"},{"lat":"42.76","lon":"-70.27"},{"lat":"41.20","lon":"-71.22"},{"lat":"40.67","lon":"-72.96"},{"lat":"39.66","lon":"-74.18"},{"lat":"39.80","lon":"-76.63"},{"lat":"41.11","lon":"-77.18"},{"lat":"42.37","lon":"-75.85"},{"lat":"44.01","lon":"-75.64"},{"lat":"45.01","lon":"-74.84"},{"lat":"45.55","lon":"-71.00"},{"lat":"46.97","lon":"-69.88"}]},{"tag":"2E","forecastHour":3,"validTime":"2026-10-30T18:00:00.000Z","hazard":"IFR","geometryType":"AREA","latlonpairs":10,"frequency":null,"severity":null,"due_to":"CIG BLW 010 VIS BLW 3SM PCPN BR","status":"NEW","top":null,"base":null,"fzltop":null,"fzlbase":null,"level":null,"receiptTime":1793382108,"issueTime":1793382060,"expireTime":1793394000,"product":"SIERRA","geom":"AREA","coords":[{"lat":"47.50","lon":"-122.14"},{"lat":"46.93","lon":"-121.88"},{"lat":"46.33","lon":"-122.26"},{"lat":"45.30","lon":"-122.29"},{"lat":"44.13","lon":"-122.44"},{"lat":"43.66","lon":"-123.16"},{"lat":"44.03","lon":"-123.53"},{"lat":"46.87","lon":"-123.76"},{"lat":"47.22","lon":"-123.43"},{"lat":"47.50","lon":"-122.14"}]},{"tag":"4E","forecastHour":3,"validTime":"2026-10-30T18:00:00.000Z","hazard":"MT_OBSC","geometryType":"AREA","latlonpairs":7,"frequency":null,"severity":null,"due_to":"MTNS OBSC BY CLDS PCPN BR","status":"NRML","top":null,"base":null,"fzltop":null,"fzlbase":null,"level":null,"receiptTime":1793382108,"issueTime":1793382060,"expireTime":1793394000,"product":"SIERRA","geom":"AREA","coords":[{"lat":"45.51","lon":"-113.70"},{"lat":"44.12","lon":"-113.08"},{"lat":"43.30","lon":"-114.07"},{"lat":"43.44","lon":"-115.24"},{"lat":"44.12","lon":"-115.69"},{"lat":"45.20","lon":"-115.09"},{"lat":"45.51","lon":"-113.70"}]},{"tag":"3C","forecastHour":3,"validTime":"2026-10-30T18:00:00.000Z","hazard":"ICE","geometryType":"AREA","latlonpairs":9,"frequency":null,"severity":"MOD","due_to":"ICE","status":"NRML","top":"220","base":"FZL","fzltop":"120","fzlbase":"110","level":null,"receiptTime":1793384794,"issueTime":1793384760,"expireTime":1793394000,"product":"ZULU","geom":"AREA","coords":[{"lat":"36.24","lon":"-115.52"},{"lat":"33.78","lon":"-114.79"},{"lat":"32.62","lon":"-115.48"},{"lat":"32.55","lon":"-116.68"},{"lat":"31.13","lon":"-119.94"},{"lat":"32.37","lon":"-119.73"},{"lat":"34.06","lon":"-117.78"},{"lat":"35.97","lon":"-116.81"},{"lat":"36.24","lon":"-115.52"}]},{"tag":"1C","forecastHour":3,"validTime":"2026-10-30T18:00:00.000Z","hazard":"FZLVL","geometryType":"LINE","latlonpairs":5,"frequency":null,"severity":null,"due_to":null,"status":"NRML","top":null,"base":null,"fzltop":null,"fzlbase":null,"level":"080","receiptTime":1793384794,"issueTime":1793384760,"expireTime":1793394000,"product":"ZULU","geom":"LINE","coords":[{"lat":"46.85","lon":"-47.07"},{"lat":"46.44","lon":"-46.77"},{"lat":"45.82","lon":"-46.15"},{"lat":"45.81","lon":"-46.14"},{"lat":"45.31","lon":"-45.27"}]},{"tag":"1C","forecastHour":3,"validTime":"2026-10-30T18:00:00.000Z","hazard":"M_FZLVL","geometryType":"AREA","latlonpairs":10,"frequency":null,"severity":null,"due_to":null,"status":"NRML","top":"060","base":"030","fzltop":null,"fzlbase":null,"level":null,"receiptTime":1793384794,"issueTime":1793384760,"expireTime":1793394000,"product":"ZULU","geom":"AREA","coords":[{"lat":"49.02","lon":"-96.20"},{"lat":"47.86","lon":"-89.44"},{"lat":"48.23","lon":"-88.22"},{"lat":"46.80","lon":"-84.98"},{"lat":"45.34","lon":"-82.56"},{"lat":"43.50","lon":"-82.15"},{"lat":"44.54","lon":"-83.87"},{"lat":"47.88","lon":"-93.67"},{"lat":"47.97","lon":"-96.46"},{"lat":"49.02","lon":"-96.20"}]}]
"""#.utf8)

    static func utc(_ string: String) -> Date? {
        ISO8601DateFormatter().date(from: string)
    }

    // MARK: - SIGMET Parsing

    @Test func parsesConvectiveSigmet() throws {
        let advisories = try AirSigmetParser.parseAirSigmets(Self.airSigmetJSON)
        let sigmet = try #require(advisories.first)
        #expect(advisories.count == 1)
        #expect(sigmet.kind == .sigmet)
        #expect(sigmet.hazard == .convective)
        #expect(sigmet.hazardCode == "CONVECTIVE")
        #expect(sigmet.validFrom == Date(timeIntervalSince1970: 1_793_386_500))  // 18:55Z
        #expect(sigmet.validTo == Date(timeIntervalSince1970: 1_793_393_700))    // 20:55Z
        #expect(sigmet.floorFeet == nil)       // altitudeLow1 null
        #expect(sigmet.ceilingFeet == 32000)   // TOPS TO FL320
        #expect(sigmet.boundaries.first == [38.068, -95.695])  // {"lon":-95.695,"lat":38.068}
        #expect(sigmet.boundaries.count == 4)
        #expect(sigmet.text?.contains("CONVECTIVE SIGMET 50C") == true)
        #expect(sigmet.colorHex == AdvisoryStyle.red)
    }

    @Test func emptyBodyMeansNoAdvisories() throws {
        // airsigmet answers HTTP 204 with an empty body when nothing matches
        #expect(try AirSigmetParser.parseAirSigmets(Data()).isEmpty)
        #expect(try AirSigmetParser.parseGAirmets(Data()).isEmpty)
    }

    @Test func skipsUnknownTypesAndDegenerateAreas() throws {
        let json = #"""
        [{"airSigmetType":"OUTLOOK","hazard":"CONVECTIVE","validTimeFrom":1,"validTimeTo":2,
          "coords":[{"lat":1,"lon":1},{"lat":2,"lon":2},{"lat":1,"lon":2}]},
         {"airSigmetType":"AIRMET","hazard":"TURB","validTimeFrom":1,"validTimeTo":2,
          "coords":[{"lat":1,"lon":1},{"lat":2,"lon":2}]}]
        """#
        #expect(try AirSigmetParser.parseAirSigmets(Data(json.utf8)).isEmpty)
    }

    // MARK: - G-AIRMET Parsing

    @Test func parsesGAirmetAreasAndDropsFreezingLevels() throws {
        let advisories = try AirSigmetParser.parseGAirmets(Self.gAirmetJSON)
        #expect(advisories.map(\.hazardCode) == ["TURB-LO", "IFR", "MT_OBSC", "ICE"])
        #expect(advisories.allSatisfy { $0.kind == .gAirmet })
        #expect(Set(advisories.map(\.id)).count == advisories.count)

        let turbulence = advisories[0]
        #expect(turbulence.hazard == .turbulence)
        #expect(turbulence.floorFeet == 0)        // "SFC"
        #expect(turbulence.ceilingFeet == 6000)   // "060" hundreds of feet
        #expect(turbulence.boundaries.first == [46.97, -69.88])  // string coords
        #expect(turbulence.boundaries.count == 14)

        let icing = advisories[3]
        #expect(icing.hazard == .icing)
        #expect(icing.floorFeet == 11000)         // base "FZL", fzlbase "110"
        #expect(icing.ceilingFeet == 22000)

        #expect(advisories[1].hazard == .ifr)
        #expect(advisories[1].floorFeet == nil)
        #expect(advisories[2].hazard == .mountainObscuration)
    }

    @Test func gAirmetSnapshotValidNinetyMinutesAroundValidTime() throws {
        let advisory = try #require(try AirSigmetParser.parseGAirmets(Self.gAirmetJSON).first)
        // validTime 18:00Z, expireTime 21:00Z
        #expect(advisory.validFrom == Self.utc("2026-10-30T16:30:00Z"))
        #expect(advisory.validTo == Self.utc("2026-10-30T19:30:00Z"))
    }

    @Test func gAirmetWindowCappedAtExpireTime() throws {
        let json = #"""
        [{"tag":"1W","validTime":"2026-10-30T18:00:00.000Z","hazard":"IFR","geometryType":"AREA",
          "expireTime":1793386800,"product":"SIERRA",
          "coords":[{"lat":"40.0","lon":"-100.0"},{"lat":"41.0","lon":"-100.0"},{"lat":"41.0","lon":"-99.0"}]}]
        """#
        let advisory = try #require(try AirSigmetParser.parseGAirmets(Data(json.utf8)).first)
        #expect(advisory.validTo == Date(timeIntervalSince1970: 1_793_386_800))  // 19:00Z, before 19:30Z
    }

    // MARK: - Validity Filtering

    @Test func snapshotShowsOnlyCurrentlyValidAdvisories() throws {
        let advisories = try AirSigmetParser.parseAirSigmets(Self.airSigmetJSON)
            + AirSigmetParser.parseGAirmets(Self.gAirmetJSON)
        let snapshot = AdvisorySnapshot(advisories: advisories, fetchedAt: Date(timeIntervalSince1970: 1_793_387_000))

        // 18:00Z: G-AIRMETs only (SIGMET starts 18:55Z)
        let at1800 = snapshot.valid(at: try #require(Self.utc("2026-10-30T18:00:00Z")))
        #expect(at1800.count == 4)
        #expect(!at1800.contains { $0.kind == .sigmet })

        // 19:00Z: both
        #expect(snapshot.valid(at: try #require(Self.utc("2026-10-30T19:00:00Z"))).count == 5)

        // 20:00Z: G-AIRMET snapshot window over, SIGMET still valid
        let at2000 = snapshot.valid(at: try #require(Self.utc("2026-10-30T20:00:00Z")))
        #expect(at2000.map(\.kind) == [.sigmet])

        // 21:00Z: everything expired
        #expect(snapshot.valid(at: try #require(Self.utc("2026-10-30T21:00:00Z"))).isEmpty)

        // Boundaries are inclusive
        let sigmet = try #require(advisories.first)
        #expect(sigmet.isValid(at: sigmet.validFrom))
        #expect(sigmet.isValid(at: sigmet.validTo))
        #expect(!sigmet.isValid(at: sigmet.validTo.addingTimeInterval(1)))
    }

    // MARK: - Hazard Mapping

    @Test func mapsHazardCodesFromBothEndpoints() {
        #expect(AdvisoryHazard(apiCode: "CONVECTIVE") == .convective)
        #expect(AdvisoryHazard(apiCode: "IFR") == .ifr)
        #expect(AdvisoryHazard(apiCode: "MTN OBSCN") == .mountainObscuration)
        #expect(AdvisoryHazard(apiCode: "MT_OBSC") == .mountainObscuration)
        #expect(AdvisoryHazard(apiCode: "TURB") == .turbulence)
        #expect(AdvisoryHazard(apiCode: "TURB-HI") == .turbulence)
        #expect(AdvisoryHazard(apiCode: "TURB-LO") == .turbulence)
        #expect(AdvisoryHazard(apiCode: "LLWS") == .turbulence)
        #expect(AdvisoryHazard(apiCode: "ICE") == .icing)
        #expect(AdvisoryHazard(apiCode: "SFC_WND") == .other)
    }

    @Test func mapsHazardsToColors() {
        #expect(AdvisoryStyle.colorHex(kind: .sigmet, hazard: .convective) == AdvisoryStyle.red)
        // Non-convective SIGMETs (severe turbulence/icing) are red too
        #expect(AdvisoryStyle.colorHex(kind: .sigmet, hazard: .turbulence) == AdvisoryStyle.red)
        #expect(AdvisoryStyle.colorHex(kind: .sigmet, hazard: .icing) == AdvisoryStyle.red)
        #expect(AdvisoryStyle.colorHex(kind: .gAirmet, hazard: .ifr) == AdvisoryStyle.purple)
        #expect(AdvisoryStyle.colorHex(kind: .gAirmet, hazard: .turbulence) == AdvisoryStyle.orange)
        #expect(AdvisoryStyle.colorHex(kind: .airmet, hazard: .icing) == AdvisoryStyle.blue)
        #expect(AdvisoryStyle.colorHex(kind: .airmet, hazard: .mountainObscuration) == AdvisoryStyle.brown)
        #expect(AdvisoryStyle.colorHex(kind: .gAirmet, hazard: .other) == AdvisoryStyle.gray)
        let allColors = [AdvisoryStyle.red, AdvisoryStyle.purple, AdvisoryStyle.orange,
                         AdvisoryStyle.blue, AdvisoryStyle.brown, AdvisoryStyle.gray]
        #expect(Set(allColors).count == allColors.count)
    }

    // MARK: - Service (network stubbed)

    static func makeSession(
        log: OSAllocatedUnfairLock<[String]>,
        gAirmetStatus: OSAllocatedUnfairLock<Int>
    ) -> URLSession {
        StubURLProtocol.session { request in
            let url = request.url?.absoluteString ?? ""
            log.withLock { $0.append(url) }
            if url.contains("/gairmet") {
                return (gAirmetStatus.withLock { $0 }, AirSigmetServiceTests.gAirmetJSON)
            }
            return (200, AirSigmetServiceTests.airSigmetJSON)
        }
    }

    @Test @MainActor func serviceFetchesBothFeedsAndCachesForTenMinutes() async throws {
        let log = OSAllocatedUnfairLock<[String]>(initialState: [])
        let status = OSAllocatedUnfairLock(initialState: 200)
        let clock = OSAllocatedUnfairLock(initialState: Date(timeIntervalSince1970: 1_793_387_000))
        let service = AirSigmetService(session: Self.makeSession(log: log, gAirmetStatus: status),
                                       now: { clock.withLock { $0 } })

        let first = try await service.currentAdvisories()
        #expect(first.advisories.count == 5)
        #expect(first.fetchedAt == Date(timeIntervalSince1970: 1_793_387_000))
        #expect(log.withLock { $0.count } == 2)

        clock.withLock { $0 = $0.addingTimeInterval(9 * 60) }
        _ = try await service.currentAdvisories()
        #expect(log.withLock { $0.count } == 2)

        clock.withLock { $0 = $0.addingTimeInterval(2 * 60) }
        let refreshed = try await service.currentAdvisories()
        #expect(log.withLock { $0.count } == 4)
        #expect(refreshed.fetchedAt == first.fetchedAt.addingTimeInterval(11 * 60))
    }

    @Test @MainActor func partialFailureKeepsLastGoodSnapshot() async throws {
        let log = OSAllocatedUnfairLock<[String]>(initialState: [])
        let status = OSAllocatedUnfairLock(initialState: 200)
        let clock = OSAllocatedUnfairLock(initialState: Date(timeIntervalSince1970: 1_793_387_000))
        let service = AirSigmetService(session: Self.makeSession(log: log, gAirmetStatus: status),
                                       now: { clock.withLock { $0 } })

        let first = try await service.currentAdvisories()
        status.withLock { $0 = 500 }
        clock.withLock { $0 = $0.addingTimeInterval(15 * 60) }
        let stale = try await service.currentAdvisories()
        #expect(stale == first)  // SIGMETs alone are not published as a fresh snapshot
    }

    @Test @MainActor func serviceThrowsWithoutAnyGoodFetch() async {
        let log = OSAllocatedUnfairLock<[String]>(initialState: [])
        let status = OSAllocatedUnfairLock(initialState: 503)
        let service = AirSigmetService(session: Self.makeSession(log: log, gAirmetStatus: status))
        await #expect(throws: (any Error).self) {
            _ = try await service.currentAdvisories()
        }
    }
}
