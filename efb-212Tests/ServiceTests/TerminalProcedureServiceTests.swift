//
//  TerminalProcedureServiceTests.swift
//  efb-212Tests
//
//  FAA d-TPP metafile parsing, category mapping, cycle computation, and on-disk cache behaviour.
//  Fixture is trimmed from the real https://aeronav.faa.gov/d-tpp/2611/xml_data/d-tpp_Metafile.xml.
//

import Testing
import Foundation
import os
@testable import efb_212

/// Scripted network: records requests and lets a test swap responses mid-test.
private final class FakeNetwork: @unchecked Sendable {
    typealias Respond = @Sendable (URL) throws -> (Int, Data)
    private struct State {
        var urls: [String] = []
        var respond: Respond
    }
    private let state: OSAllocatedUnfairLock<State>

    init(_ respond: @escaping Respond) {
        state = OSAllocatedUnfairLock(initialState: State(respond: respond))
    }

    var urls: [String] { state.withLock { $0.urls } }

    func setResponder(_ respond: @escaping Respond) { state.withLock { $0.respond = respond } }

    var session: URLSession {
        StubURLProtocol.session { [self] request in
            guard let url = request.url else { throw URLError(.badURL) }
            let respond = state.withLock { state -> Respond in
                state.urls.append(url.absoluteString)
                return state.respond
            }
            return try respond(url)
        }
    }

    static let offline: Respond = { _ in throw URLError(.notConnectedToInternet) }
}

@Suite("Terminal Procedure Service Tests")
@MainActor
struct TerminalProcedureServiceTests {

    // MARK: - Fixtures

    nonisolated private static func record(seq: Int, code: String, name: String, pdf: String, action: String = "") -> String {
        """
                <record>
                  <chartseq>\(seq)</chartseq>
                  <chart_code>\(code)</chart_code>
                  <chart_name>\(name)</chart_name>
                  <useraction>\(action)</useraction>
                  <pdf_name>\(pdf)</pdf_name>
                  <cn_flg>N</cn_flg>
                  <bvpage>227</bvpage>
                  <procuid>11667</procuid>
                  <civil>C</civil>
                </record>
        """
    }

    nonisolated static let metafile: Data = {
        let xml = """
        <?xml version="1.0" encoding="utf-8" standalone="yes"?>
        <digital_tpp cycle="2611" from_edate="0901Z  10/29/26" to_edate="0901Z  11/26/26">
          <state_code ID="CA" state_fullname="CALIFORNIA">
            <city_name ID="PALO ALTO" volume="SW-2">
              <airport_name ID="PALO ALTO" military="N" apt_ident="PAO" icao_ident="KPAO" alnum="9216">
        \(record(seq: 10100, code: "MIN", name: "TAKEOFF MINIMUMS", pdf: "SW2TO.PDF"))
        \(record(seq: 30000, code: "STR", name: "POINT REYES THREE", pdf: "00375POINTREYES.PDF"))
        \(record(seq: 53525, code: "IAP", name: "RNAV (GPS) RWY 31", pdf: "09216R31.PDF"))
        \(record(seq: 70000, code: "APD", name: "AIRPORT DIAGRAM", pdf: "09216AD.PDF"))
        \(record(seq: 90100, code: "DP", name: "CASEL SEVEN", pdf: "DELETED_JOB.PDF", action: "D"))
              </airport_name>
              <airport_name ID="SAN CARLOS" military="N" apt_ident="SQL" icao_ident="KSQL" alnum="9219">
        \(record(seq: 10100, code: "MIN", name: "TAKEOFF MINIMUMS", pdf: "SW2TO.PDF"))
        \(record(seq: 10110, code: "MIN", name: "DIVERSE VECTOR AREA", pdf: "SW2TO.PDF"))
        \(record(seq: 53525, code: "IAP", name: "RNAV (GPS) Y RWY 30", pdf: "09219RY30.PDF"))
        \(record(seq: 53525, code: "IAP", name: "RNAV (GPS) Z RWY 30", pdf: "09219RZ30.PDF"))
        \(record(seq: 70000, code: "APD", name: "AIRPORT DIAGRAM", pdf: "09219AD.PDF"))
        \(record(seq: 80000, code: "HOT", name: "HOT SPOT", pdf: "09219HS.PDF"))
        \(record(seq: 99999, code: "IAP", name: "NOT A PDF", pdf: "09219.XML"))
              </airport_name>
            </city_name>
          </state_code>
          <state_code ID="AL" state_fullname="ALABAMA">
            <city_name ID="ATMORE" volume="SE-4">
              <airport_name ID="ATMORE MUNI" military="N" apt_ident="0R1" icao_ident="" alnum="9420">
        \(record(seq: 53525, code: "IAP", name: "RNAV (GPS) RWY 18", pdf: "09420R18.PDF"))
              </airport_name>
            </city_name>
          </state_code>
        </digital_tpp>
        """
        return Data(xml.utf8)
    }()

    nonisolated static let infoJSON = Data(
        #"{"status":{"code":200,"message":"OK"},"edition":[{"geoname":"US","editionName":"CURRENT","format":"ZIP","editionDate":"10/29/2026","editionNumber":11}]}"#.utf8
    )

    static func utc(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso) ?? .distantPast
    }

    /// 2026-10-30, inside cycle 2611 (10/29 0901Z - 11/26 0901Z).
    static let today = utc("2026-10-30T12:00:00Z")

    static func airport(_ icao: String, faa: String? = nil) -> Airport {
        Airport(icao: icao, faaID: faa, name: icao, latitude: 37, longitude: -122, elevation: 10,
                type: .airport, ownership: .publicOwned)
    }

    static func tempDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("dtpp-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private static func makeService(
        directory: URL, network: FakeNetwork, now: Date = today
    ) -> TerminalProcedureService {
        TerminalProcedureService(session: network.session, baseDirectory: directory, now: { now })
    }

    /// Serves the metafile and cycle info like the FAA hosts do.
    private static let faaResponder: FakeNetwork.Respond = { url in
        url.absoluteString.hasSuffix("d-tpp_Metafile.xml") ? (200, metafile) : (200, infoJSON)
    }

    // MARK: - Metafile parsing

    @Test func parsesCycleAndValidityWindow() throws {
        let index = try TerminalProcedureService.parseMetafile(data: Self.metafile)
        #expect(index.cycle.code == "2611")
        #expect(index.cycle.effectiveDate == Self.utc("2026-10-29T09:01:00Z"))
        #expect(index.cycle.expirationDate == Self.utc("2026-11-26T09:01:00Z"))
        #expect(index.cycle.isCurrent(at: Self.today))
        #expect(index.cycle.isExpired(at: Self.utc("2026-11-26T09:01:00Z")))
        #expect(!index.cycle.isExpired(at: Self.utc("2026-11-26T09:00:00Z")))
    }

    @Test func keepsPerAirportRecordsAndSkipsDeletedAndNonPDF() throws {
        let index = try TerminalProcedureService.parseMetafile(data: Self.metafile)
        let pao = try #require(index.airports["KPAO"])
        #expect(pao.map(\.name) == ["TAKEOFF MINIMUMS", "POINT REYES THREE", "RNAV (GPS) RWY 31", "AIRPORT DIAGRAM"])
        #expect(!pao.contains { $0.pdfName == "DELETED_JOB.PDF" })

        let sql = try #require(index.airports["KSQL"])
        #expect(sql.count == 6)  // XML pdf skipped
        #expect(!sql.contains { $0.pdfName.hasSuffix(".XML") })
        #expect(sql.allSatisfy { $0.cycle == "2611" })
        // Shared PDF, distinct records: both kept with distinct ids.
        let minimums = sql.filter { $0.pdfName == "SW2TO.PDF" }
        #expect(minimums.count == 2)
        #expect(Set(minimums.map(\.id)).count == 2)
    }

    @Test func rejectsMalformedXML() {
        #expect(throws: EFBError.self) {
            try TerminalProcedureService.parseMetafile(data: Data("<digital_tpp cycle=\"2611\"><state_code>".utf8))
        }
    }

    // MARK: - Matching

    @Test func matchesIcaoThenFallsBackToFaaIdent() throws {
        let index = try TerminalProcedureService.parseMetafile(data: Self.metafile)
        #expect(index.charts(icao: "KPAO", faaID: "PAO").count == 4)
        // Airport without an ICAO ident in the metafile is keyed by FAA ident.
        #expect(index.charts(icao: "0R1", faaID: nil).map(\.pdfName) == ["09420R18.PDF"])
        #expect(index.charts(icao: "K0R1", faaID: "0R1").map(\.pdfName) == ["09420R18.PDF"])
        // FAA ident also resolves an ICAO-keyed airport when the ICAO id is unknown to us.
        #expect(index.charts(icao: "XXXX", faaID: "SQL").count == 6)
        #expect(index.charts(icao: "KZZZ", faaID: "ZZZ").isEmpty)
        // Case-insensitive.
        #expect(index.charts(icao: "kpao", faaID: nil).count == 4)
    }

    // MARK: - Categories

    @Test func mapsChartCodesToCategories() {
        let expected: [(String, TerminalChartCategory)] = [
            ("APD", .diagram), ("IAP", .approach), ("DP", .departure), ("ODP", .departure),
            ("STR", .arrival), ("STAR", .arrival), ("MIN", .minimums),
            ("HOT", .other), ("LAH", .other), ("DAU", .other), ("", .other),
        ]
        for (code, category) in expected {
            #expect(TerminalChartCategory(chartCode: code) == category, "\(code)")
        }
    }

    @Test func groupsWithDiagramFirst() throws {
        let index = try TerminalProcedureService.parseMetafile(data: Self.metafile)
        let groups = AirportChartsSection.grouped(index.charts(icao: "KSQL", faaID: "SQL"))
        #expect(groups.map(\.category) == [.diagram, .approach, .minimums, .other])
        #expect(groups[1].charts.map(\.name) == ["RNAV (GPS) Y RWY 30", "RNAV (GPS) Z RWY 30"])
    }

    // MARK: - Cycle computation

    @Test func computesCycleCodesFromAiracSchedule() {
        let cases: [(String, String, String)] = [
            ("2026-10-30T12:00:00Z", "2611", "2026-10-29T09:01:00Z"),
            ("2026-01-22T09:01:00Z", "2601", "2026-01-22T09:01:00Z"),  // first cycle of 2026
            ("2026-01-22T09:00:59Z", "2513", "2025-12-25T09:01:00Z"),  // last cycle of 2025
            ("2020-01-02T09:01:00Z", "2001", "2020-01-02T09:01:00Z"),
            ("2027-01-21T09:01:00Z", "2701", "2027-01-21T09:01:00Z"),
        ]
        for (iso, code, effective) in cases {
            let cycle = TerminalProcedureService.cycle(containing: Self.utc(iso))
            #expect(cycle.code == code, "\(iso)")
            #expect(cycle.effectiveDate == Self.utc(effective), "\(iso)")
            #expect(cycle.expirationDate == cycle.effectiveDate.addingTimeInterval(28 * 86_400))
        }
    }

    @Test func parsesFaaCycleInfoResponse() throws {
        let cycle = try TerminalProcedureService.parseCycleInfo(Self.infoJSON)
        #expect(cycle.code == "2611")
        #expect(cycle.effectiveDate == Self.utc("2026-10-29T09:01:00Z"))
        #expect(throws: EFBError.self) {
            try TerminalProcedureService.parseCycleInfo(Data(#"{"edition":[]}"#.utf8))
        }
    }

    // MARK: - Cache behaviour

    @Test func usesPersistedIndexWithoutNetworkFetch() async throws {
        let dir = try Self.tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }

        // Seed the cache with one network-backed load.
        let seedNetwork = FakeNetwork(Self.faaResponder)
        let first = Self.makeService(directory: dir, network: seedNetwork)
        let charts = try await first.charts(for: Self.airport("KPAO", faa: "PAO"))
        #expect(charts.count == 4)
        #expect(seedNetwork.urls.contains { $0.hasSuffix("/2611/xml_data/d-tpp_Metafile.xml") })
        #expect(FileManager.default.fileExists(atPath: dir.appendingPathComponent("2611/index.json").path))

        // A fresh service (new process) must serve from disk with zero requests.
        let network = FakeNetwork(FakeNetwork.offline)
        let second = Self.makeService(directory: dir, network: network)
        let again = try await second.charts(for: Self.airport("KSQL", faa: "SQL"))
        #expect(again.count == 6)
        #expect(try await second.currentCycle().code == "2611")
        #expect(network.urls.isEmpty)
    }

    @Test func servesExpiredCachedIndexWhenOffline() async throws {
        let dir = try Self.tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        _ = try await Self.makeService(directory: dir, network: FakeNetwork(Self.faaResponder))
            .charts(for: Self.airport("KPAO"))

        let later = Self.utc("2026-12-15T00:00:00Z")  // cycle 2611 expired
        let service = Self.makeService(directory: dir, network: FakeNetwork(FakeNetwork.offline), now: later)
        #expect(try await service.charts(for: Self.airport("KPAO")).count == 4)
        let cycle = try await service.currentCycle()
        #expect(cycle.isExpired(at: later))
    }

    @Test func throwsWhenOfflineWithNoCache() async throws {
        let dir = try Self.tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let service = Self.makeService(directory: dir, network: FakeNetwork(FakeNetwork.offline))
        await #expect(throws: EFBError.self) {
            _ = try await service.charts(for: Self.airport("KPAO"))
        }
    }

    @Test func fallsBackToComputedCycleWhenInfoEndpointFails() async throws {
        let dir = try Self.tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let network = FakeNetwork { url in
            url.absoluteString.hasSuffix("d-tpp_Metafile.xml") ? (200, Self.metafile) : (503, Data())
        }
        let charts = try await Self.makeService(directory: dir, network: network).charts(for: Self.airport("KPAO"))
        #expect(charts.count == 4)
        #expect(network.urls.contains("https://aeronav.faa.gov/d-tpp/2611/xml_data/d-tpp_Metafile.xml"))
    }

    // MARK: - PDF download

    nonisolated private static let pdfBytes = Data("%PDF-1.4\n%fake chart body\n".utf8)

    @Test func downloadsPdfOnceThenServesOffline_andPurgesOlderCycles() async throws {
        let dir = try Self.tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let oldCycle = dir.appendingPathComponent("2610", isDirectory: true)
        try FileManager.default.createDirectory(at: oldCycle, withIntermediateDirectories: true)
        try Self.pdfBytes.write(to: oldCycle.appendingPathComponent("09216AD.PDF"))

        let network = FakeNetwork { _ in (200, Self.pdfBytes) }
        let service = Self.makeService(directory: dir, network: network)
        let chart = TerminalChart(chartCode: "APD", name: "AIRPORT DIAGRAM", pdfName: "09216AD.PDF", cycle: "2611")

        let url = try await service.pdfURL(for: chart)
        #expect(url == dir.appendingPathComponent("2611/09216AD.PDF"))
        #expect(try Data(contentsOf: url) == Self.pdfBytes)
        #expect(network.urls == ["https://aeronav.faa.gov/d-tpp/2611/09216AD.PDF"])
        #expect(!FileManager.default.fileExists(atPath: oldCycle.path))

        network.setResponder(FakeNetwork.offline)
        let cached = try await service.pdfURL(for: chart)
        #expect(cached == url)
        #expect(network.urls.count == 1)
    }

    @Test func rejectsNonPdfPayloadAndErrorStatus() async throws {
        let dir = try Self.tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let network = FakeNetwork { _ in (200, Data("<html>not found</html>".utf8)) }
        let service = Self.makeService(directory: dir, network: network)
        let chart = TerminalChart(chartCode: "IAP", name: "RNAV (GPS) RWY 31", pdfName: "09216R31.PDF", cycle: "2611")

        await #expect(throws: EFBError.self) { _ = try await service.pdfURL(for: chart) }

        network.setResponder { _ in (404, Self.pdfBytes) }
        await #expect(throws: EFBError.self) { _ = try await service.pdfURL(for: chart) }

        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("2611/09216R31.PDF").path))
    }

    @Test func pdfNameCannotEscapeCycleFolder() async throws {
        let dir = try Self.tempDirectory()
        defer { try? FileManager.default.removeItem(at: dir) }
        let network = FakeNetwork { _ in (200, Self.pdfBytes) }
        let chart = TerminalChart(chartCode: "IAP", name: "EVIL", pdfName: "../../evil.PDF", cycle: "2611")
        let url = try await Self.makeService(directory: dir, network: network).pdfURL(for: chart)
        #expect(url == dir.appendingPathComponent("2611/evil.PDF"))
        #expect(network.urls == ["https://aeronav.faa.gov/d-tpp/2611/evil.PDF"])
    }
}
