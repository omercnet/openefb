//
//  caai-apd: georeference the official CAAI aerodrome diagrams (eAIP AD 2.24, domestic AIP chapters)
//  with the app's own AirportDiagramGeoreferencer core (same file the iPad app and tools/apd-georef compile).
//
//  Israeli diagrams have no lat/lon graticule, so only the runway method applies. The core fits scale
//  and rotation from drawn runway polygons and picks the translation from a single runway; this wrapper
//  then refits scale and translation by least squares over ALL matched runways and applies the same
//  50 ft gate (and the 5% length gate) as the US pipeline. A diagram with fewer than two independently
//  matched runways, or any runway outside the gate, is "sheet only". Never misplaced.
//
//  Output (tools/caai-apd/out/<edition>/): <ICAO>.png + <ICAO>.json per accepted aerodrome (JSON is the
//  AirportDiagramGeoreference the app's overlay decodes), manifest.json (product il-diagrams, published
//  false) and results.json (every aerodrome, accepted or not, with the reason).
//
//  Build: tools/caai-apd/build.sh   Run (repo root): tools/caai-apd/caai-apd [--only LLBG,LLHA] [--inspect]
//

import Foundation
import CoreGraphics
import CryptoKit
import ImageIO
import SQLite3
import PDFKit

// MARK: - Control file

struct Control: Codable {
    struct Entry: Codable {
        let icao: String
        let pdf: String                  // file name under input/
        let chartTitle: String           // as printed, e.g. "AD 2 LLBG ADC-1"
        let language: String
        let scale: String                // printed scale or "bar only"
        let source: String               // URL the PDF came from
        let rotationDegrees: Int?        // page "up" relative to true north when the north arrow is read by hand
        let clipRect: [Double]?          // x, y, width, height in PDF points (user space): the map area
        let maskRects: [[Double]]?       // x, y, width, height rects punched out of the image (tables, insets)
        let note: String?
    }
    let edition: String                  // file-safe id
    let editionLabel: String
    let aipDate: String
    let entries: [Entry]
}

struct Result: Codable {
    let icao: String
    let chart: String
    let georeferenced: Bool
    let reason: String
    let runwaysMatched: Int
    let worstResidualFeet: Double?
    let worstLengthErrorPercent: Double?
    let feetPerPoint: Double?
    let files: [String]
}

// MARK: - Arguments

var only: Set<String> = []
var inspect = false
var devToleranceFeet: Double?   // DEV ONLY: loosened gate for wiring/visual proof; the manifest is then marked not passed
var controlPath = "tools/caai-apd/control.json"
var dbPath = "efb-212/Resources/israel-aviation.sqlite"
var inputDir = "tools/caai-apd/input"
var outRoot = "tools/caai-apd/out"
var args = Array(CommandLine.arguments.dropFirst())
while !args.isEmpty {
    let a = args.removeFirst()
    switch a {
    case "--only": only = Set(args.removeFirst().split(separator: ",").map(String.init))
    case "--inspect": inspect = true
    case "--dev-runway-tolerance": devToleranceFeet = Double(args.removeFirst())
    case "--control": controlPath = args.removeFirst()
    case "--db": dbPath = args.removeFirst()
    case "--input": inputDir = args.removeFirst()
    case "--out": outRoot = args.removeFirst()
    default: print("unknown argument \(a)"); exit(2)
    }
}

// MARK: - Database

var db: OpaquePointer?
guard sqlite3_open_v2("file:\(dbPath)?immutable=1", &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, nil) == SQLITE_OK else {
    print("cannot open \(dbPath)"); exit(1)
}
let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

func reference(_ icao: String) -> AirportDiagramReference? {
    var st: OpaquePointer?
    defer { sqlite3_finalize(st) }
    guard sqlite3_prepare_v2(db, "SELECT lat, lon FROM aerodromes WHERE code = ?1", -1, &st, nil) == SQLITE_OK else { return nil }
    sqlite3_bind_text(st, 1, icao, -1, transient)
    guard sqlite3_step(st) == SQLITE_ROW else { return nil }
    return AirportDiagramReference(latitude: sqlite3_column_double(st, 0), longitude: sqlite3_column_double(st, 1))
}

/// CAAI GIS runway ends. `length_m` is metres; the core wants feet.
func runways(_ icao: String) -> [AirportDiagramRunway] {
    var st: OpaquePointer?
    defer { sqlite3_finalize(st) }
    guard sqlite3_prepare_v2(db, "SELECT rwy_name, length_m, width_m, a_lat, a_lon, b_lat, b_lon FROM runways WHERE aerodrome = ?1", -1, &st, nil) == SQLITE_OK else { return [] }
    sqlite3_bind_text(st, 1, icao, -1, transient)
    var out: [AirportDiagramRunway] = []
    while sqlite3_step(st) == SQLITE_ROW {
        out.append(AirportDiagramRunway(
            identifier: String(cString: sqlite3_column_text(st, 0)),
            lengthFeet: sqlite3_column_double(st, 1) * AirportDiagramGeoreferencer.feetPerMetre,   // feet
            widthFeet: sqlite3_column_double(st, 2) * AirportDiagramGeoreferencer.feetPerMetre,    // feet
            baseLatitude: sqlite3_column_double(st, 3), baseLongitude: sqlite3_column_double(st, 4),
            reciprocalLatitude: sqlite3_column_double(st, 5), reciprocalLongitude: sqlite3_column_double(st, 6)))
    }
    return out
}

// MARK: - Refit

enum Reject: Error, CustomStringConvertible {
    case message(String)
    var description: String { if case .message(let m) = self { return m }; return "" }
}

typealias G = AirportDiagramGeoreferencer

/// Least-squares scale and translation (fixed rotation) over every matched runway: pairs of drawn
/// midpoints and database midpoints, plus the two ends along the drawn axis weighted lightly.
func refit(_ fit: G.SimilarityFit, matches: [G.RunwayMatch]) -> G.SimilarityFit? {
    guard matches.count >= 2 else { return nil }
    // ground = s * R(p) + t. Unknowns s, tx, ty. Each pair gives two equations.
    var ata = [[Double]](repeating: [0, 0, 0], count: 3), atb = [Double](repeating: 0, count: 3)
    func add(_ row: [Double], _ y: Double) {
        for i in 0..<3 { for j in 0..<3 { ata[i][j] += row[i] * row[j] }; atb[i] += row[i] * y }
    }
    for m in matches {
        let r = fit.rotate(m.shape.midpoint)
        add([Double(r.x), 1, 0], Double(m.groundMidpoint.x))
        add([Double(r.y), 0, 1], Double(m.groundMidpoint.y))
    }
    guard let x = G.solve3(ata, atb) else { return nil }
    return G.SimilarityFit(scale: x[0], rotationDegrees: fit.rotationDegrees, translation: CGPoint(x: x[1], y: x[2]))
}

func georeference(_ entry: Control.Entry, pdfData: Data) throws -> (AirportDiagramGeoreference, [G.RunwayMatch]) {
    guard let ref = reference(entry.icao) else { throw Reject.message("aerodrome not in israel-aviation.sqlite") }
    let dbRunways = runways(entry.icao).filter(\.hasCoordinates)
    guard dbRunways.count >= 2 else {
        throw Reject.message("\(dbRunways.count) runway in the database: a single runway cannot give an independent position check (sheet only)")
    }
    guard let document = PDFDocument(data: pdfData), let page = document.page(at: 0), let cgPage = page.pageRef else {
        throw Reject.message("unreadable PDF")
    }
    let pageBox = page.bounds(for: .mediaBox)
    let vectors = PDFVectorScanner.scan(page: cgPage)
    let drawn = vectors.runwayShapes()
    guard drawn.count >= 2 else { throw Reject.message("\(drawn.count) runway polygons found in the vector stream") }
    let metres = AirportDiagramGeoreference.metresPerDegree(latitude: ref.latitude)
    let local: (Double, Double) -> CGPoint = { lat, lon in
        CGPoint(x: (lon - ref.longitude) * metres.lon, y: (lat - ref.latitude) * metres.lat)
    }
    let solution: G.FitSolution
    do { solution = try G.fit(labels: [], drawn: drawn, database: dbRunways, local: local) }
    catch { throw Reject.message("no runway hypothesis: \(error)") }
    var current = solution.fit
    if let forced = entry.rotationDegrees, forced != current.rotationDegrees {
        throw Reject.message("fit rotation \(current.rotationDegrees) disagrees with north arrow \(forced)")
    }
    var matches = solution.matches
    // Two refit passes: matches can change once the translation moves.
    for _ in 0..<2 {
        guard let better = refit(current, matches: matches) else {
            throw Reject.message("only \(matches.count) runway(s) matched the drawn polygons")
        }
        current = better
        matches = G.matchRunways(fit: current, drawn: drawn, database: dbRunways, local: local)
    }
    if inspect {
        print("  \(entry.icao): rotation \(current.rotationDegrees) scale \(current.scale) m/pt, \(drawn.count) drawn, \(matches.count) matched")
        for m in matches {
            print("    \(m.runway.identifier): residual \(Int(m.residualFeet)) ft, midpoint \(Int(m.midpointFeet)) ft, cross-track \(Int(m.crossTrackFeet)) ft, length \(String(format: "%.1f", m.lengthError * 100))%")
        }
    }
    guard matches.count >= 2 else { throw Reject.message("only \(matches.count) runway(s) matched after refit") }
    let tolerances = devToleranceFeet.map { G.Tolerances(runwayFeet: $0) } ?? G.Tolerances.standard
    if let worst = matches.map(\.residualFeet).max(), worst > tolerances.runwayFeet {
        throw Reject.message("runway cross-check failed: worst runway error \(Int(worst)) ft (gate \(Int(tolerances.runwayFeet)) ft)")
    }
    if let worst = matches.map(\.midpointFeet).max(), worst > tolerances.runwayFeet {
        throw Reject.message("runway midpoint check failed: worst midpoint error \(Int(worst)) ft (gate \(Int(tolerances.runwayFeet)) ft)")
    }
    if let worst = matches.map(\.lengthError).max(), worst > tolerances.runwayLength {
        throw Reject.message("runway length check failed: \(String(format: "%.1f", worst * 100))% (gate 5%)")
    }
    let feetPerPoint = current.scale * G.feetPerMetre
    guard G.feetPerPointRange.contains(feetPerPoint) else { throw Reject.message("implausible scale \(feetPerPoint) ft/pt") }

    let clip = entry.clipRect.map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
        ?? vectors.neatline(pageBox: pageBox, gridLines: vectors.gridLines())
    let t = current.transform
    let g = AirportDiagramGeoreference(
        a: Double(t.a), b: Double(t.b), c: Double(t.c), d: Double(t.d), tx: Double(t.tx), ty: Double(t.ty),
        reference: .init(pageBox), referenceLatitude: ref.latitude, referenceLongitude: ref.longitude,
        pageBox: .init(pageBox), clipBox: .init(clip), masks: [],
        diagnostics: .init(
            method: .runway, labelSource: .none, latitudeLabels: 0, longitudeLabels: 0,
            rotationDegrees: current.rotationDegrees, feetPerPoint: feetPerPoint, scaleRatio: nil,
            runwaysMatched: matches.count, runwayResidualFeet: matches.map(\.residualFeet).max(),
            runwayMidpointFeet: matches.map(\.midpointFeet).max(), runwayEndFeet: matches.map(\.endFeet).max(),
            runwayBestMidpointFeet: matches.map(\.midpointFeet).min(),
            runwayMedianMidpointFeet: G.median(matches.map(\.midpointFeet)),
            maskedInsets: entry.maskRects?.count ?? 0))
    return (g, matches)
}

/// Renders the clip box with the core, then clears the hand-picked table and inset rectangles.
func render(_ entry: Control.Entry, pdfData: Data, georeference g: AirportDiagramGeoreference, scale: CGFloat) -> Data? {
    guard let image = G.renderImage(pdfData: pdfData, georeference: g, scale: scale) else { return nil }
    let clip = g.clipBox.cgRect
    guard let context = CGContext(
        data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return nil }
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    context.setBlendMode(.clear)
    for r in entry.maskRects ?? [] {
        // Context rows run bottom-up like the page: pixel = (point - clip.min) * scale.
        context.fill(CGRect(x: (r[0] - clip.minX) * scale, y: (r[1] - clip.minY) * scale, width: r[2] * scale, height: r[3] * scale))
    }
    guard let masked = context.makeImage() else { return nil }
    return G.pngData(masked)
}

func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }

// MARK: - Run

let control = try JSONDecoder().decode(Control.self, from: Data(contentsOf: URL(fileURLWithPath: controlPath)))
let outDir = URL(fileURLWithPath: outRoot).appendingPathComponent(devToleranceFeet == nil ? control.edition : "dev-\(control.edition)", isDirectory: true)
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
var results: [Result] = []
var manifestFiles: [[String: Any]] = []
var worstOverall = 0.0

for entry in control.entries where only.isEmpty || only.contains(entry.icao) {
    let pdfURL = URL(fileURLWithPath: inputDir).appendingPathComponent(entry.pdf)
    guard let pdfData = try? Data(contentsOf: pdfURL) else {
        results.append(Result(icao: entry.icao, chart: entry.chartTitle, georeferenced: false, reason: "chart PDF not downloaded", runwaysMatched: 0, worstResidualFeet: nil, worstLengthErrorPercent: nil, feetPerPoint: nil, files: []))
        continue
    }
    // Every chart ships as a sheet PDF (the "sheet only" fallback); georeferenced ones also get PNG + JSON.
    try pdfData.write(to: outDir.appendingPathComponent("\(entry.icao).pdf"))
    manifestFiles.append(["name": "\(entry.icao).pdf", "bytes": pdfData.count, "sha256": sha256(pdfData)])
    do {
        let (g, matches) = try georeference(entry, pdfData: pdfData)
        guard let png = render(entry, pdfData: pdfData, georeference: g, scale: 3) else { throw Reject.message("render failed") }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let json = try encoder.encode(g)
        try png.write(to: outDir.appendingPathComponent("\(entry.icao).png"))
        try json.write(to: outDir.appendingPathComponent("\(entry.icao).json"))
        for (name, data) in [("\(entry.icao).png", png), ("\(entry.icao).json", json)] {
            manifestFiles.append(["name": name, "bytes": data.count, "sha256": sha256(data)])
        }
        let worst = matches.map(\.residualFeet).max() ?? 0
        worstOverall = max(worstOverall, worst)
        results.append(Result(icao: entry.icao, chart: entry.chartTitle, georeferenced: true, reason: "accepted", runwaysMatched: matches.count,
                              worstResidualFeet: worst, worstLengthErrorPercent: (matches.map(\.lengthError).max() ?? 0) * 100,
                              feetPerPoint: g.diagnostics.feetPerPoint, files: ["\(entry.icao).png", "\(entry.icao).json"]))
        print("\(entry.icao): georeferenced, \(matches.count) runways, worst \(Int(worst)) ft")
    } catch {
        results.append(Result(icao: entry.icao, chart: entry.chartTitle, georeferenced: false, reason: "\(error)", runwaysMatched: 0, worstResidualFeet: nil, worstLengthErrorPercent: nil, feetPerPoint: nil, files: []))
        print("\(entry.icao): sheet only: \(error)")
    }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
try encoder.encode(results).write(to: outDir.appendingPathComponent("results.json"))

// index.json: what the app reads first. One record per aerodrome; georeferenced ones name their image and JSON.
struct IndexRecord: Codable {
    let chart: String
    let language: String
    let scale: String
    let georeferenced: Bool
    let reason: String
    let sheet: String
    let image: String?
    let georeference: String?
}
struct Index: Codable {
    let product: String
    let edition: String
    let editionLabel: String
    let aipDate: String
    let aerodromes: [String: IndexRecord]
}
var records: [String: IndexRecord] = [:]
for entry in control.entries {
    guard let r = results.first(where: { $0.icao == entry.icao }), r.reason != "chart PDF not downloaded" else { continue }
    records[entry.icao] = IndexRecord(
        chart: entry.chartTitle, language: entry.language, scale: entry.scale, georeferenced: r.georeferenced, reason: r.reason,
        sheet: "\(entry.icao).pdf", image: r.georeferenced ? "\(entry.icao).png" : nil, georeference: r.georeferenced ? "\(entry.icao).json" : nil)
}
let indexData = try encoder.encode(Index(product: "il-diagrams", edition: control.edition, editionLabel: control.editionLabel, aipDate: control.aipDate, aerodromes: records))
try indexData.write(to: outDir.appendingPathComponent("index.json"))
manifestFiles.append(["name": "index.json", "bytes": indexData.count, "sha256": sha256(indexData)])

// Pipeline manifest in the IL-9 wire format (web/charts/publish.sh --manifest). Never published here.
let now = ISO8601DateFormatter().string(from: Date())
let manifest: [String: Any] = [
    "product": "il-diagrams",
    "edition": control.edition,
    "edition_label": control.editionLabel,
    "published": false,
    "validated_at": now,
    "validation": ["passed": devToleranceFeet == nil && results.contains { $0.georeferenced }, "max_m": worstOverall / G.feetPerMetre],
    "files": manifestFiles,
]
try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted, .sortedKeys]).write(to: outDir.appendingPathComponent("manifest.json"))
print("coverage: \(results.filter(\.georeferenced).count) of \(results.count) georeferenced; wrote \(outDir.path)")
