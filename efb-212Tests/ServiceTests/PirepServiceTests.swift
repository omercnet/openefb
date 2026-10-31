//
//  PirepServiceTests.swift
//  efb-212Tests
//
//  Real aviationweather.gov PIREP response shapes against PirepParser and PirepService,
//  plus the 50 NM / 2 hour filter boundaries.
//

import Testing
import Foundation
import CoreLocation
import os
@testable import efb_212

@Suite("PIREP Service Tests")
struct PirepServiceTests {

    /// Entries captured 2026-10-30 from
    /// https://aviationweather.gov/api/data/pirep?id=KMCI&distance=1000&age=12&format=json
    static let fixture = """
    [{"receiptTime":"2026-10-30T18:55:05.951Z","obsTime":1793386320,"qcField":0,"icaoId":"KWBC","acType":"CL30","lat":43.1208,"lon":-77.5589,"fltLvl":5,"fltLvlType":"DURD","clouds":null,"visib":null,"wxString":"","temp":null,"wdir":null,"wspd":null,"icgBas1":null,"icgTop1":null,"icgInt1":"","icgType1":"","icgBas2":null,"icgTop2":null,"icgInt2":"","icgType2":"","tbBas1":null,"tbTop1":null,"tbInt1":"","tbType1":"","tbFreq1":"","tbBas2":null,"tbTop2":null,"tbInt2":"","tbType2":"","tbFreq2":"","vertGust":null,"brkAction":"","pirepType":"Urgent PIREP","rawOb":"ROC UUA /OV ROC100005/TM 1852/FL005/TP CL30/TB +/- 15 KTS/RM DURD RY28"},
    {"receiptTime":"2026-10-30T19:05:17.995Z","obsTime":1793386680,"qcField":0,"icaoId":"KWBC","acType":"P28A","lat":36.0396,"lon":-95.9846,"fltLvl":0,"fltLvlType":"DURD","clouds":[{"cover":"SCT","base":1300,"top":0},{"cover":"SCT","base":2300,"top":0}],"visib":null,"wxString":"","temp":null,"wdir":null,"wspd":null,"icgBas1":null,"icgTop1":null,"icgInt1":"","icgType1":"","icgBas2":null,"icgTop2":null,"icgInt2":"","icgType2":"","tbBas1":null,"tbTop1":null,"tbInt1":"","tbType1":"","tbFreq1":"","tbBas2":null,"tbTop2":null,"tbInt2":"","tbType2":"","tbFreq2":"","vertGust":null,"brkAction":"","pirepType":"PIREP","rawOb":"RVS UA /OV RVS/TM 1858/FLDURD/TP P28A/SK SCT013 SCT 023/RM -RA"},
    {"receiptTime":"2026-10-30T19:05:17.894Z","obsTime":1793386680,"qcField":0,"icaoId":"KWBC","acType":"F2TH","lat":33.5674,"lon":-91.7796,"fltLvl":230,"fltLvlType":"OTHER","clouds":null,"visib":null,"wxString":"","temp":-23,"wdir":null,"wspd":null,"icgBas1":230,"icgTop1":250,"icgInt1":"LGT","icgType1":"MIXED","icgBas2":null,"icgTop2":null,"icgInt2":"","icgType2":"","tbBas1":null,"tbTop1":null,"tbInt1":"","tbType1":"","tbFreq1":"","tbBas2":null,"tbTop2":null,"tbInt2":"","tbType2":"","tbFreq2":"","vertGust":null,"brkAction":"","pirepType":"PIREP","rawOb":"GLH UA /OV GLH270040/TM 1858/FL230/TP F2TH/TA M23/IC LGT MX 230-250/RM ZME 45"},
    {"receiptTime":"2026-10-30T19:10:14.780Z","obsTime":1793386980,"qcField":0,"icaoId":"KWBC","acType":"E75S","lat":42.9126,"lon":-84.4247,"fltLvl":320,"fltLvlType":"OTHER","clouds":null,"visib":null,"wxString":"","temp":null,"wdir":null,"wspd":null,"icgBas1":null,"icgTop1":null,"icgInt1":"","icgType1":"","icgBas2":null,"icgTop2":null,"icgInt2":"","icgType2":"","tbBas1":null,"tbTop1":null,"tbInt1":"MOD","tbType1":"CHOP","tbFreq1":"","tbBas2":null,"tbTop2":null,"tbInt2":"NEG","tbType2":"","tbFreq2":"","vertGust":null,"brkAction":"","pirepType":"PIREP","rawOb":"FNT UA /OV FNT270030/TM 1903/FL320/TP E75S/TB MOD CHOP 340-330 NEG 320 DURD/RM ZOB"},
    {"receiptTime":"2026-10-30T18:45:03.476Z","obsTime":1793385480,"qcField":0,"icaoId":"KWBC","acType":"BE65","lat":40.2063,"lon":-100.5921,"fltLvl":0,"fltLvlType":"UNKN","clouds":null,"visib":null,"wxString":"","temp":null,"wdir":null,"wspd":null,"icgBas1":null,"icgTop1":null,"icgInt1":"NEG","icgType1":"","icgBas2":null,"icgTop2":null,"icgInt2":"","icgType2":"","tbBas1":null,"tbTop1":null,"tbInt1":"","tbType1":"","tbFreq1":"","tbBas2":null,"tbTop2":null,"tbInt2":"","tbType2":"","tbFreq2":"","vertGust":null,"brkAction":"","pirepType":"PIREP","rawOb":"MCK UA /OV KMCK/TM 1838/FLUNKN/TP BE65/SK BASE 005/IC NEG/RM -ZDVWC-19"},
    {"receiptTime":"2026-10-30T18:36:03.908Z","obsTime":1793385000,"qcField":0,"icaoId":"KWBC","acType":"UAL2164","lat":37.0333,"lon":-100.9667,"fltLvl":300,"fltLvlType":"OTHER","clouds":null,"visib":null,"wxString":"","temp":null,"wdir":205,"wspd":33,"icgBas1":null,"icgTop1":null,"icgInt1":"","icgType1":"","icgBas2":null,"icgTop2":null,"icgInt2":"","icgType2":"","tbBas1":null,"tbTop1":null,"tbInt1":"","tbType1":"","tbFreq1":"","tbBas2":null,"tbTop2":null,"tbInt2":"","tbType2":"","tbFreq2":"","vertGust":null,"brkAction":"","pirepType":"AIREP","rawOb":"ARP UAL2164 3702N 10058W 1830 F300 205/033KT"},
    {"receiptTime":"2026-10-30T19:10:14.921Z","obsTime":1793387040,"qcField":0,"icaoId":"KWBC","acType":"B752","lat":29.6921,"lon":-82.273,"fltLvl":0,"fltLvlType":"DURC","clouds":[{"cover":"BKN","base":4500,"top":6500}],"visib":null,"wxString":"","temp":null,"wdir":null,"wspd":null,"icgBas1":null,"icgTop1":null,"icgInt1":"","icgType1":"","icgBas2":null,"icgTop2":null,"icgInt2":"","icgType2":"","tbBas1":null,"tbTop1":null,"tbInt1":"","tbType1":"","tbFreq1":"","tbBas2":null,"tbTop2":null,"tbInt2":"","tbType2":"","tbFreq2":"","vertGust":null,"brkAction":"","pirepType":"PIREP","rawOb":"JAX UA /OV GNV/TM 1904/FLDURC/TP B752/SK BKN045 TOPS 065"},
    {"receiptTime":"2026-10-30T19:05:18.139Z","obsTime":1793386680,"qcField":0,"icaoId":"KWBC","acType":"CRJ7","lat":30.1938,"lon":-91.9926,"fltLvl":0,"fltLvlType":"DURD","clouds":null,"visib":null,"wxString":"FU","temp":null,"wdir":null,"wspd":null,"icgBas1":null,"icgTop1":null,"icgInt1":"","icgType1":"","icgBas2":null,"icgTop2":null,"icgInt2":"","icgType2":"","tbBas1":null,"tbTop1":null,"tbInt1":"","tbType1":"","tbFreq1":"","tbBas2":null,"tbTop2":null,"tbInt2":"","tbType2":"","tbFreq2":"","vertGust":null,"brkAction":"","pirepType":"PIREP","rawOb":"LFT UA /OV LFT/TM 1858/FLDURD/TP CRJ7/WX FU FINAL RWY 22L"}]
    """

    static let kden = CLLocationCoordinate2D(latitude: 39.8617, longitude: -104.6731)
    static let degreesPerNM = 180 / (.pi * PirepParser.earthRadiusNM)  // degrees latitude per NM
    static let now = Date(timeIntervalSince1970: 1_793_390_000)

    static func parsed() throws -> [Pirep] {
        try PirepParser.parse(Data(fixture.utf8))
    }

    static func makePirep(northNM: Double, ageSeconds: TimeInterval, raw: String = "TEST UA") -> Pirep {
        Pirep(
            observationTime: now.addingTimeInterval(-ageSeconds),
            reportType: "PIREP",
            aircraftType: "C172",
            latitude: kden.latitude + northNM * degreesPerNM,
            longitude: kden.longitude,
            altitude: 6500,
            altitudeQualifier: nil,
            clouds: [],
            weather: nil,
            temperature: nil,
            windDirection: nil,
            windSpeed: nil,
            turbulence: [],
            icing: [],
            rawText: raw
        )
    }

    // MARK: - Parsing

    @Test func parsesEveryRealEntry() throws {
        #expect(try Self.parsed().count == 8)
    }

    @Test func urgentPirepIsFlaggedWithDescentAltitude() throws {
        let roc = try #require(try Self.parsed().first)
        #expect(roc.isUrgent)
        #expect(roc.reportType == "Urgent PIREP")
        #expect(roc.aircraftType == "CL30")
        #expect(roc.altitude == 500)                  // FL005 -> 500 ft MSL
        #expect(roc.altitudeQualifier == "DURD")
        #expect(roc.observationTime == Date(timeIntervalSince1970: 1_793_386_320))
        #expect(roc.turbulence.isEmpty)               // free-text "+/- 15 KTS" is not coded
        #expect(roc.weather == nil)
    }

    @Test func nonUrgentTypesAreNotFlagged() throws {
        let entries = try Self.parsed()
        #expect(entries.filter(\.isUrgent).count == 1)
        let airep = try #require(entries.first { $0.reportType == "AIREP" })
        #expect(!airep.isUrgent)
        #expect(airep.altitude == 30000)
        #expect(airep.windDirection == 205)           // degrees true
        #expect(airep.windSpeed == 33)                // knots
    }

    @Test func climbDescentReportsWithoutLevelHaveNoAltitude() throws {
        let entries = try Self.parsed()
        let rvs = try #require(entries.first { $0.aircraftType == "P28A" })
        #expect(rvs.altitude == nil)
        #expect(rvs.altitudeQualifier == "DURD")
        #expect(rvs.altitudeText == "Descending")
        // AWC encodes unreported tops as 0.
        #expect(rvs.clouds == [
            Pirep.CloudLayer(cover: "SCT", base: 1300, top: nil),
            Pirep.CloudLayer(cover: "SCT", base: 2300, top: nil),
        ])

        let jax = try #require(entries.first { $0.aircraftType == "B752" })
        #expect(jax.altitude == nil)
        #expect(jax.altitudeQualifier == "DURC")
        #expect(jax.clouds == [Pirep.CloudLayer(cover: "BKN", base: 4500, top: 6500)])
    }

    @Test func unknownLevelAndNegativeIcing() throws {
        let mck = try #require(try Self.parsed().first { $0.aircraftType == "BE65" })
        #expect(mck.altitude == nil)
        #expect(mck.altitudeQualifier == "UNKN")
        #expect(mck.icing == [Pirep.Condition(intensity: "NEG", type: nil, frequency: nil, base: nil, top: nil)])
        #expect(mck.icingSummary == "NEG")
        #expect(mck.turbulenceSummary == nil)
    }

    @Test func icingLayerBasesAreHundredsOfFeet() throws {
        let glh = try #require(try Self.parsed().first { $0.aircraftType == "F2TH" })
        #expect(glh.altitude == 23000)
        #expect(glh.altitudeQualifier == nil)
        #expect(glh.temperature == -23)
        #expect(glh.icing == [Pirep.Condition(intensity: "LGT", type: "MIXED", frequency: nil, base: 23000, top: 25000)])
    }

    @Test func multipleTurbulenceGroupsAreSummarized() throws {
        let fnt = try #require(try Self.parsed().first { $0.aircraftType == "E75S" })
        #expect(fnt.turbulence.count == 2)
        #expect(fnt.turbulenceSummary == "MOD CHOP, NEG")
    }

    @Test func presentWeatherIsKeptAndBlankIsNil() throws {
        let entries = try Self.parsed()
        #expect(entries.first { $0.aircraftType == "CRJ7" }?.weather == "FU")
        #expect(entries.first { $0.aircraftType == "F2TH" }?.weather == nil)
    }

    @Test func entriesMissingPositionTimeOrTextAreDropped() throws {
        let json = """
        [{"obsTime":1793386320,"lat":null,"lon":-77.5,"rawOb":"NO LAT"},
         {"lat":43.1,"lon":-77.5,"rawOb":"NO TIME"},
         {"obsTime":1793386320,"lat":43.1,"lon":-77.5,"rawOb":""},
         {"obsTime":1793386320,"lat":43.1,"lon":-77.5,"rawOb":"MINIMAL UA"}]
        """
        let entries = try PirepParser.parse(Data(json.utf8))
        let only = try #require(entries.first)
        #expect(entries.count == 1)
        #expect(only.rawText == "MINIMAL UA")
        #expect(only.reportType == "PIREP")
        #expect(only.aircraftType == nil)
        #expect(only.altitude == nil)
        #expect(only.altitudeText == "Alt unknown")
        #expect(only.clouds.isEmpty)
    }

    @Test func emptyBodyIsNoReports() throws {
        #expect(try PirepParser.parse(Data()).isEmpty)
    }

    @Test func nonArrayBodyThrows() {
        #expect(throws: EFBError.self) { try PirepParser.parse(Data(#"{"error":"bad"}"#.utf8)) }
    }

    // MARK: - Filtering boundaries

    @Test func radiusBoundaryIs50NM() {
        let reports = [
            Self.makePirep(northNM: 49.0, ageSeconds: 60, raw: "INSIDE"),
            Self.makePirep(northNM: 49.999, ageSeconds: 60, raw: "EDGE"),
            Self.makePirep(northNM: 50.001, ageSeconds: 60, raw: "OUTSIDE"),
            Self.makePirep(northNM: -50.001, ageSeconds: 60, raw: "OUTSIDE SOUTH"),
        ]
        let kept = PirepParser.filter(reports, near: Self.kden, radiusNM: 50, maxAge: 7200, now: Self.now)
        #expect(Set(kept.map(\.rawText)) == ["INSIDE", "EDGE"])
    }

    @Test func ageBoundaryIsInclusiveAtTwoHours() {
        let reports = [
            Self.makePirep(northNM: 0, ageSeconds: 7199, raw: "FRESH"),
            Self.makePirep(northNM: 0, ageSeconds: 7200, raw: "EDGE"),
            Self.makePirep(northNM: 0, ageSeconds: 7201, raw: "OLD"),
            Self.makePirep(northNM: 0, ageSeconds: -600, raw: "FUTURE"),
        ]
        let kept = PirepParser.filter(reports, near: Self.kden, radiusNM: 50, maxAge: 7200, now: Self.now)
        #expect(kept.map(\.rawText) == ["FRESH", "EDGE"])
    }

    @Test func resultsAreNewestFirst() {
        let reports = [
            Self.makePirep(northNM: 1, ageSeconds: 3000, raw: "B"),
            Self.makePirep(northNM: 2, ageSeconds: 100, raw: "A"),
            Self.makePirep(northNM: 3, ageSeconds: 6000, raw: "C"),
        ]
        let kept = PirepParser.filter(reports, near: Self.kden, radiusNM: 50, maxAge: 7200, now: Self.now)
        #expect(kept.map(\.rawText) == ["A", "B", "C"])
    }

    @Test func boundingBoxEnclosesRadius() {
        let box = PirepParser.boundingBox(around: Self.kden, radiusNM: 60)
            .split(separator: ",").compactMap { Double($0) }
        #expect(box.count == 4)
        #expect(abs(box[0] - (Self.kden.latitude - 1)) < 0.01)   // 60 NM ≈ 1° latitude
        #expect(abs(box[2] - (Self.kden.latitude + 1)) < 0.01)
        #expect(box[1] < Self.kden.longitude - 1.25)              // wider in longitude at 40°N
        #expect(box[3] > Self.kden.longitude + 1.25)
    }

    // MARK: - Service

    @Test func serviceQueriesBoundingBoxAndFiltersLocally() async throws {
        let now = Date().timeIntervalSince1970
        let json = """
        [{"obsTime":\(Int(now - 600)),"acType":"C172","lat":39.9,"lon":-104.7,"fltLvl":85,"fltLvlType":"OTHER","pirepType":"PIREP","rawOb":"DEN UA /OV DEN/FL085/TP C172"},
         {"obsTime":\(Int(now - 300)),"acType":"PC12","lat":41.2,"lon":-104.7,"fltLvl":120,"fltLvlType":"OTHER","pirepType":"PIREP","rawOb":"CYS UA /OV CYS/FL120/TP PC12"},
         {"obsTime":\(Int(now - 9000)),"acType":"SR22","lat":39.8,"lon":-104.6,"fltLvl":95,"fltLvlType":"OTHER","pirepType":"PIREP","rawOb":"OLD UA"}]
        """
        let requested = OSAllocatedUnfairLock<URL?>(initialState: nil)
        let session = StubURLProtocol.session { request in
            requested.withLock { $0 = request.url }
            return (200, Data(json.utf8))
        }

        let pireps = try await PirepService(session: session)
            .fetchPireps(near: Self.kden, radiusNM: 50, maxAge: 7200)

        #expect(pireps.map(\.aircraftType) == ["C172"])   // CYS is ~80 NM away, SR22 is 2.5 h old
        let url = try #require(requested.withLock { $0 })
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        #expect(items.contains(URLQueryItem(name: "age", value: "2.00")))
        #expect(items.contains(URLQueryItem(name: "format", value: "json")))
        #expect(items.contains { $0.name == "bbox" })
    }

    @Test func serviceTreatsNoContentAsEmpty() async throws {
        let session = StubURLProtocol.session { _ in (204, Data()) }
        let pireps = try await PirepService(session: session)
            .fetchPireps(near: Self.kden, radiusNM: 50, maxAge: 7200)
        #expect(pireps.isEmpty)
    }

    @Test func serviceMapsOfflineToNetworkUnavailable() async {
        let session = StubURLProtocol.session { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await PirepService(session: session).fetchPireps(near: Self.kden, radiusNM: 50, maxAge: 7200)
            Issue.record("Expected an error")
        } catch EFBError.networkUnavailable {
            // expected
        } catch {
            Issue.record("Unexpected error \(error)")
        }
    }

    @Test func serviceRejectsServerError() async {
        let session = StubURLProtocol.session { _ in (502, Data("<html>502 Bad Gateway</html>".utf8)) }
        await #expect(throws: EFBError.self) {
            _ = try await PirepService(session: session).fetchPireps(near: Self.kden, radiusNM: 50, maxAge: 7200)
        }
    }
}
