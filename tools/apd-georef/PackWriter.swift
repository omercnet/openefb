//  PackWriter.swift: writes the `us-diagrams` chart pack (M5) from the diagrams apd-georef accepted.
//
//  Per accepted airport: <ICAO>.png (transparent, ink only) and <ICAO>.json (the AirportDiagramGeoreference the app's
//  overlay decodes). Plus index.json (what the app reads first; the format of app/src/services/charts/diagramPack.ts) and
//  manifest.json (the web/charts publish format, published=false). Rejected diagrams are not in the pack: the FAA sheet
//  PDFs would add hundreds of MB, and a diagram that failed the gate is never drawn. Nothing here uploads anything.
//  Validate a built pack with tools/apd-georef/check-pack.mjs.
import CoreGraphics
import CryptoKit
import Foundation

struct PackEntry {
    let icao: String
    let chart: String            // as named in the d-TPP metafile (the PDF name)
    let pdfData: Data
    let georeference: AirportDiagramGeoreference
}

/// Effective date (UTC) of a d-TPP cycle id "YYNN": cycle 2001 began 2020-01-02 0901Z, every cycle is 28 days.
func cycleEffectiveDate(_ cycle: String) -> Date? {
    guard cycle.count == 4, let yy = Int(cycle.prefix(2)), let nn = Int(cycle.suffix(2)), nn >= 1 else { return nil }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    guard let reference = calendar.date(from: DateComponents(year: 2020, month: 1, day: 2, hour: 9, minute: 1)),
          let jan1 = calendar.date(from: DateComponents(year: 2000 + yy, month: 1, day: 1)) else { return nil }
    let length = 28.0 * 86_400
    let firstOfYear = (jan1.timeIntervalSince(reference) / length).rounded(.up)
    return reference.addingTimeInterval((firstOfYear + Double(nn - 1)) * length)
}

private func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

private struct IndexRecord: Codable {
    let chart: String
    let language: String
    let scale: String
    let georeferenced: Bool
    let reason: String
    let sheet: String            // empty: the US pack carries no sheet PDFs
    let image: String?
    let georeference: String?
}

private struct Index: Codable {
    let product: String
    let edition: String
    let editionLabel: String
    let aipDate: String
    let accuracyFeet: Int
    let aerodromes: [String: IndexRecord]
}

struct PackSummary {
    let directory: URL
    let airports: Int
    let bytes: Int
}

/// Writes <directory>/<cycle>/ and returns what it wrote. Throws when an accepted diagram cannot be rendered: a pack that
/// silently lacks airports would pass for a smaller cycle.
func writeUSDiagramPack(directory: URL, cycle: String, accuracyFeet: Int, entries: [PackEntry], scale: CGFloat) throws -> PackSummary {
    guard let effective = cycleEffectiveDate(cycle) else { throw NSError(domain: "apd-pack", code: 1, userInfo: [NSLocalizedDescriptionKey: "cycle '\(cycle)' is not YYNN"]) }
    let day = DateFormatter()
    day.dateFormat = "yyyy-MM-dd"
    day.timeZone = TimeZone(identifier: "UTC")
    let out = directory.appendingPathComponent(cycle, isDirectory: true)
    try? FileManager.default.removeItem(at: out)
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    var files: [[String: Any]] = []
    var records: [String: IndexRecord] = [:]
    var worstFeet = 0.0
    var total = 0
    func add(_ name: String, _ data: Data) throws {
        try data.write(to: out.appendingPathComponent(name))
        files.append(["name": name, "bytes": data.count, "sha256": sha256(data)])
        total += data.count
    }

    for entry in entries.sorted(by: { $0.icao < $1.icao }) where records[entry.icao] == nil {
        guard let image = AirportDiagramGeoreferencer.renderImage(pdfData: entry.pdfData, georeference: entry.georeference, scale: scale),
              let png = AirportDiagramGeoreferencer.pngData(image) else {
            throw NSError(domain: "apd-pack", code: 2, userInfo: [NSLocalizedDescriptionKey: "render failed for \(entry.icao)"])
        }
        try add("\(entry.icao).png", png)
        try add("\(entry.icao).json", try encoder.encode(entry.georeference))
        worstFeet = max(worstFeet, entry.georeference.diagnostics.runwayResidualFeet ?? 0)
        records[entry.icao] = IndexRecord(
            chart: entry.chart, language: "en", scale: "as charted", georeferenced: true, reason: "accepted",
            sheet: "", image: "\(entry.icao).png", georeference: "\(entry.icao).json")
    }

    let label = "FAA d-TPP cycle \(cycle)"
    let index = Index(product: "us-diagrams", edition: cycle, editionLabel: label, aipDate: day.string(from: effective),
                      accuracyFeet: accuracyFeet, aerodromes: records)
    try add("index.json", try encoder.encode(index))

    let manifest: [String: Any] = [
        "product": "us-diagrams",
        "edition": cycle,
        "edition_label": label,
        "published": false,
        "validated_at": ISO8601DateFormatter().string(from: Date()),
        "validation": ["passed": !records.isEmpty, "max_m": worstFeet / 3.28084],
        "files": files,
    ]
    try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys])
        .write(to: out.appendingPathComponent("manifest.json"))
    return PackSummary(directory: out, airports: records.count, bytes: total)
}
