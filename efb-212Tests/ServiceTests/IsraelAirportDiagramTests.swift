//
//  IsraelAirportDiagramTests.swift
//  efb-212Tests
//
//  CAAI aerodrome diagram pack (IL-13): index handling, "sheet only" for failed gates, region gating,
//  edition gating, and the shared georeference decode.
//

import Testing
import Foundation
import CoreLocation
import CoreGraphics
@testable import efb_212

@Suite("Israel airport diagrams")
struct IsraelAirportDiagramTests {

    // MARK: - Fixtures

    /// Minimal ChartPackService stand-in over a temp directory.
    private struct StubPackService: ChartPackServiceProtocol {
        let product = IsraelDiagramPack.product
        let directory: URL
        let installedPack: ChartPackInstalled?

        func fetchIndex() async throws -> IsraelChartIndex { throw EFBError.chartCorrupted("stub") }
        func fetchManifest(edition: String) async throws -> IsraelChartManifest { throw EFBError.chartCorrupted("stub") }
        func latestServable(allowUnpublished: Bool) async throws -> IsraelChartManifest? { nil }
        func download(_ manifest: IsraelChartManifest, progress: @escaping @Sendable (Double) -> Void) async throws -> ChartPackInstalled {
            throw EFBError.chartCorrupted("stub")
        }
        func installed() -> ChartPackInstalled? { installedPack }
        func fileURL(_ name: String) -> URL? {
            let url = directory.appendingPathComponent(name)
            return FileManager.default.fileExists(atPath: url.path) ? url : nil
        }
        func remove() {}
    }

    private static func record(_ icao: String, georeferenced: Bool, reason: String = "accepted") -> IsraelDiagramIndex.Record {
        IsraelDiagramIndex.Record(
            chart: "AD 2 \(icao) ADC", language: "en", scale: "bar only", georeferenced: georeferenced, reason: reason,
            sheet: "\(icao).pdf", image: georeferenced ? "\(icao).png" : nil, georeference: georeferenced ? "\(icao).json" : nil)
    }

    private static func index(edition: String = "2026-08", _ records: [String: IsraelDiagramIndex.Record]) -> IsraelDiagramIndex {
        IsraelDiagramIndex(product: "il-diagrams", edition: edition, editionLabel: "AIRAC AMDT 001/2026 (06 AUG 2026)",
                           aipDate: "2026-08-06", accuracyFeet: 100, aerodromes: records)
    }

    private static func tempDirectory(files: [String]) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("il-diagrams-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        for name in files { try Data("x".utf8).write(to: url.appendingPathComponent(name)) }
        return url
    }

    private static func pack(_ index: IsraelDiagramIndex, files: [String]) throws -> IsraelDiagramPack {
        let directory = try tempDirectory(files: files)
        return IsraelDiagramPack(index: index, fileURL: { name in
            let url = directory.appendingPathComponent(name)
            return FileManager.default.fileExists(atPath: url.path) ? url : nil
        })
    }

    /// A georeference placed at LLBG: 6.78 m per PDF point, north-up, page 1000 x 700 pt.
    private static func georeference() -> AirportDiagramGeoreference {
        let page = CGRect(x: 0, y: 0, width: 1000, height: 700)
        return AirportDiagramGeoreference(
            a: 6.78, b: 0, c: 0, d: 6.78, tx: -3390, ty: -2373,
            reference: .init(page), referenceLatitude: 32.0094, referenceLongitude: 34.8856,
            pageBox: .init(page), clipBox: .init(page), masks: [],
            diagnostics: .init(
                method: .runway, labelSource: .none, latitudeLabels: 0, longitudeLabels: 0, rotationDegrees: 0,
                feetPerPoint: 22.2, scaleRatio: nil, runwaysMatched: 3, runwayResidualFeet: 31, runwayMidpointFeet: 30,
                runwayEndFeet: 90, runwayBestMidpointFeet: 12, runwayMedianMidpointFeet: 25, maskedInsets: 0))
    }

    // MARK: - Availability

    @Test("A georeferenced aerodrome with its files is drawable; ICAO lookup ignores case")
    func georeferencedAvailable() throws {
        let pack = try Self.pack(Self.index(["LLBG": Self.record("LLBG", georeferenced: true)]),
                                 files: ["LLBG.png", "LLBG.json", "LLBG.pdf"])
        guard case .georeferenced(let record) = pack.availability(for: "llbg") else {
            Issue.record("expected georeferenced"); return
        }
        #expect(record.chart == "AD 2 LLBG ADC")
        #expect(pack.georeferencedICAOs == ["LLBG"])
    }

    @Test("A diagram that failed the gate is sheet only: never drawn, still viewable")
    func failedGateIsSheetOnly() throws {
        let failed = Self.record("LLHZ", georeferenced: false, reason: "runway cross-check failed: worst runway error 72 ft")
        let pack = try Self.pack(Self.index(["LLHZ": failed]), files: ["LLHZ.pdf"])
        #expect(pack.availability(for: "LLHZ") == .sheetOnly(failed))
        #expect(pack.georeferencedICAOs.isEmpty)
        #expect(pack.sheetURL(for: "LLHZ") != nil)
    }

    @Test("A georeferenced record whose image is missing degrades to the sheet, not to a guess")
    func missingImageDegradesToSheet() throws {
        let record = Self.record("LLBG", georeferenced: true)
        let pack = try Self.pack(Self.index(["LLBG": record]), files: ["LLBG.json", "LLBG.pdf"])
        #expect(pack.availability(for: "LLBG") == .sheetOnly(record))
        #expect(pack.georeferencedICAOs.isEmpty)
    }

    @Test("Unknown aerodrome, or a record with no files at all, has no diagram")
    func noDiagram() throws {
        let pack = try Self.pack(Self.index(["LLBG": Self.record("LLBG", georeferenced: false)]), files: [])
        #expect(pack.availability(for: "LLBG") == .none)
        #expect(pack.availability(for: "LLKS") == .none)
    }

    // MARK: - Same decode as the US overlay

    @Test("Georeference JSON from the pack decodes through the shared decoder and places the clip box at the airport")
    func decodesSharedGeoreference() throws {
        let original = Self.georeference()
        let decoded = try IsraelDiagramPack.decodeGeoreference(JSONEncoder().encode(original))
        #expect(decoded == original)
        let corners = decoded.clipCorners
        #expect(corners.count == 4)
        // Page centre lands within 50 m of the reference point; the chart spans about 6.8 km east-west.
        let centre = decoded.coordinate(forPagePoint: CGPoint(x: 500, y: 350))
        let here = CLLocation(latitude: centre.latitude, longitude: centre.longitude)
        let reference = CLLocation(latitude: 32.0094, longitude: 34.8856)
        #expect(here.distance(from: reference) < 50)
        let width = CLLocation(latitude: corners[0].latitude, longitude: corners[0].longitude)
            .distance(from: CLLocation(latitude: corners[3].latitude, longitude: corners[3].longitude))
        #expect(abs(width - 6780) < 100)
    }

    @Test("Index JSON written by tools/caai-apd decodes")
    func decodesIndex() throws {
        let json = """
        {"product":"il-diagrams","edition":"2026-08","editionLabel":"AIRAC AMDT 001/2026 (06 AUG 2026)","aipDate":"2026-08-06","accuracyFeet":100,
         "aerodromes":{"LLHA":{"chart":"AD 2 LLHA ADC","language":"en","scale":"bar only","georeferenced":false,
         "reason":"1 runway in the database","sheet":"LLHA.pdf"}}}
        """
        let index = try IsraelDiagramPack.decodeIndex(Data(json.utf8))
        #expect(index.aerodromes["LLHA"]?.image == nil)
        #expect(index.aerodromes["LLHA"]?.georeferenced == false)
    }

    @Test("The badge shows the edition and the accuracy the diagrams were gated to")
    func badgeShowsAccuracy() throws {
        let pack = try Self.pack(Self.index([:]), files: [])
        #expect(pack.badgeText == "CAAI aerodrome diagrams AIRAC AMDT 001/2026 (06 AUG 2026) ±100 ft")
    }

    // MARK: - Edition gating

    private func installedPack(edition: String = "2026-08") throws -> StubPackService {
        let indexData = try JSONEncoder().encode(Self.index(edition: edition, ["LLBG": Self.record("LLBG", georeferenced: false)]))
        let directory = try Self.tempDirectory(files: [])
        try indexData.write(to: directory.appendingPathComponent("index.json"))
        let installed = ChartPackInstalled(product: "il-diagrams", edition: "2026-08", editionLabel: "x", files: [], installedAt: Date())
        return StubPackService(directory: directory, installedPack: installed)
    }

    @Test("An edition that was not published and validated at download is never shown")
    func unpublishedEditionHidden() throws {
        let service = try installedPack()
        #expect(IsraelDiagramPack.load(service: service, servedEdition: nil, allowUnpublished: false) == nil)
        #expect(IsraelDiagramPack.load(service: service, servedEdition: "2025-02", allowUnpublished: false) == nil)
    }

    @Test("A served edition loads; the developer setting lifts the gate")
    func servedEditionLoads() throws {
        let service = try installedPack()
        #expect(IsraelDiagramPack.load(service: service, servedEdition: "2026-08", allowUnpublished: false)?.edition == "2026-08")
        #expect(IsraelDiagramPack.load(service: service, servedEdition: nil, allowUnpublished: true)?.edition == "2026-08")
    }

    @Test("An index that belongs to a different edition than the installed one is rejected")
    func mismatchedIndexRejected() throws {
        let service = try installedPack(edition: "2025-02")
        #expect(IsraelDiagramPack.load(service: service, servedEdition: "2026-08", allowUnpublished: false) == nil)
    }

    // MARK: - Region gating

    @Test("Israel diagrams are an Israel-only layer; the FAA diagram layer is US-only")
    func regionGating() {
        #expect(Region.israel.isAvailable(.israelDiagrams))
        #expect(!Region.us.isAvailable(.israelDiagrams))
        #expect(Region.us.isAvailable(.airportDiagrams))
        #expect(!Region.israel.isAvailable(.airportDiagrams))
    }

    @Test("The overlay offers the pack's georeferenced aerodromes nearest first, and only those")
    func nearestGeoreferencedAerodromes() throws {
        let records = [
            "LLBG": Self.record("LLBG", georeferenced: true),
            "LLHZ": Self.record("LLHZ", georeferenced: true),
            "LLHA": Self.record("LLHA", georeferenced: false),
        ]
        let pack = try Self.pack(Self.index(records), files: ["LLBG.png", "LLBG.json", "LLHZ.png", "LLHZ.json", "LLHA.pdf"])
        // Camera over Herzliya: LLHZ first, LLBG second, sheet-only LLHA never offered.
        let nearHerzliya = AirportDiagramOverlay.georeferencedAerodromes(
            pack: pack, near: CLLocationCoordinate2D(latitude: 32.18, longitude: 34.83), limit: 3)
        #expect(nearHerzliya == ["LLHZ", "LLBG"])
        let nearBenGurion = AirportDiagramOverlay.georeferencedAerodromes(
            pack: pack, near: CLLocationCoordinate2D(latitude: 32.01, longitude: 34.88), limit: 1)
        #expect(nearBenGurion == ["LLBG"])
    }
}
