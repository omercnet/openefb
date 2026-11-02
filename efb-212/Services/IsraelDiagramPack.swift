//
//  IsraelDiagramPack.swift
//  efb-212
//
//  The official CAAI aerodrome diagrams we convert, validate and host ourselves (IL-13, product
//  `il-diagrams`; tools/caai-apd builds it). Per aerodrome the pack carries the sheet PDF and, when the
//  diagram passed the 50 ft runway gate, a PNG plus the georeference JSON that
//  `AirportDiagramOverlay` already draws for FAA diagrams (same `AirportDiagramGeoreference`).
//  `index.json` says which aerodromes are georeferenced. A diagram that failed the gate is "sheet only":
//  shown in the PDF viewer, never on the map. The diagrams are (c) CAAI.
//
//  Pure, nonisolated logic (testable off the main actor). Download and install go through IL-9's
//  `ChartPackService` (a second product, not a second downloader).
//

import Foundation

/// `index.json` of an edition: one record per aerodrome that has a chart.
nonisolated struct IsraelDiagramIndex: Codable, Equatable, Sendable {
    struct Record: Codable, Equatable, Sendable {
        let chart: String            // as printed, e.g. "AD 2 LLBG ADC-1"
        let language: String
        let scale: String            // printed scale, or "bar only"
        let georeferenced: Bool
        let reason: String           // "accepted", or why the gate rejected it
        let sheet: String            // file name of the sheet PDF
        let image: String?           // file name of the transparent PNG (georeferenced only)
        let georeference: String?    // file name of the AirportDiagramGeoreference JSON (georeferenced only)
    }

    let product: String
    let edition: String              // file-safe id, e.g. "2026-08"
    let editionLabel: String         // as printed, e.g. "AIRAC AMDT 001/2026 (06 AUG 2026)"
    let aipDate: String              // yyyy-MM-dd effective date of the source charts
    let accuracyFeet: Int            // feet: the gate placed diagrams passed (runway ends, and the printed ARP for one-runway fields)
    let aerodromes: [String: Record] // ICAO -> record
}

/// What the app can show for one aerodrome.
nonisolated enum IsraelDiagramAvailability: Equatable, Sendable {
    /// Validated and drawable on the map.
    case georeferenced(IsraelDiagramIndex.Record)
    /// Chart exists but is shown only as a PDF sheet.
    case sheetOnly(IsraelDiagramIndex.Record)
    /// No chart for this aerodrome in the installed edition.
    case none
}

nonisolated struct IsraelDiagramPack: Sendable {
    static let product = "il-diagrams"
    static let indexFileName = "index.json"

    let index: IsraelDiagramIndex
    /// Location of an installed file; nil when it is missing.
    let fileURL: @Sendable (String) -> URL?

    var edition: String { index.edition }
    var editionLabel: String { index.editionLabel }

    func availability(for icao: String) -> IsraelDiagramAvailability {
        guard let record = index.aerodromes[icao.uppercased()] else { return .none }
        if record.georeferenced, let image = record.image, let json = record.georeference,
           fileURL(image) != nil, fileURL(json) != nil {
            return .georeferenced(record)
        }
        // A georeferenced record with a missing file degrades to the sheet, never to a guess.
        return fileURL(record.sheet) != nil ? .sheetOnly(record) : .none
    }

    /// ICAO ids that can be drawn on the map.
    var georeferencedICAOs: [String] {
        index.aerodromes.keys.sorted().filter {
            if case .georeferenced = availability(for: $0) { return true }
            return false
        }
    }

    func sheetURL(for icao: String) -> URL? {
        index.aerodromes[icao.uppercased()].flatMap { fileURL($0.sheet) }
    }

    /// Badge copy: edition and date of the chart on screen. Never implies currency the app cannot prove.
    var badgeText: String { "CAAI aerodrome diagrams \(index.editionLabel) ±\(index.accuracyFeet) ft" }

    /// Decodes a georeference JSON from the pack: the same decode the FAA overlay uses for its cache.
    static func decodeGeoreference(_ data: Data) throws -> AirportDiagramGeoreference {
        try JSONDecoder().decode(AirportDiagramGeoreference.self, from: data)
    }

    static func decodeIndex(_ data: Data) throws -> IsraelDiagramIndex {
        try JSONDecoder().decode(IsraelDiagramIndex.self, from: data)
    }

    /// The installed pack, or nil. Pilots only see an edition that was published and validated when it was
    /// downloaded (`servedEdition`, recorded by the store); a debug setting can lift that. The index must
    /// belong to the installed edition.
    static func load(service: any ChartPackServiceProtocol, servedEdition: String?, allowUnpublished: Bool) -> IsraelDiagramPack? {
        guard let installed = service.installed(), installed.product == product,
              allowUnpublished || servedEdition == installed.edition,
              let url = service.fileURL(indexFileName),
              let data = try? Data(contentsOf: url),
              let index = try? decodeIndex(data),
              index.product == product, index.edition == installed.edition else { return nil }
        return IsraelDiagramPack(index: index, fileURL: { service.fileURL($0) })
    }
}
