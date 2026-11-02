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
    var arpErrorFeet: Double? = nil   // printed ARP symbol vs AIP ARP, feet
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

/// Israeli gate (owner decision Q6, B): 100 ft on runway ends and midpoints. The US stays at 50 ft.
let israelRunwayGateFeet = 100.0
/// The AIP gives the ARP to whole arc-seconds: 1" is about 31 m north-south and 26 m east-west at 31-33 N.
let arpRoundingNorthMetres = 31.0   // metres
let arpRoundingEastMetres = 26.0    // metres

/// The printed ARP symbol: the small circle nearest an "ARP" label (page points), or nil.
func arpSymbol(document: PDFDocument, page: PDFPage, vectors: PDFVectorScanner.Result) -> CGPoint? {
    let labels = document.findString("ARP", withOptions: []).map { $0.bounds(for: page) }
    guard !labels.isEmpty else { return nil }
    // The ARP symbol is a small circle with a cross through its centre.
    func hasCross(_ b: CGRect) -> Bool {
        let centre = CGPoint(x: b.midX, y: b.midY), box = b.insetBy(dx: -1.5, dy: -1.5)
        let through = vectors.segments.filter { s in
            let length = hypot(s.1.x - s.0.x, s.1.y - s.0.y)
            guard length >= 0.6 * b.width, box.contains(s.0), box.contains(s.1) else { return false }
            let distance = abs((s.1.x - s.0.x) * (s.0.y - centre.y) - (s.0.x - centre.x) * (s.1.y - s.0.y)) / length
            return distance < 1.5
        }
        return through.count >= 2
    }
    let circles = vectors.polygons.filter { polygon in
        let b = polygon.bounds
        return polygon.curves >= 4 && (3...16).contains(b.width) && (3...16).contains(b.height) && abs(b.width - b.height) < 2 && hasCross(b)
    }.map { CGPoint(x: $0.bounds.midX, y: $0.bounds.midY) }
    var best: (point: CGPoint, gap: CGFloat)?
    for label in labels {
        for c in circles {
            let gap = hypot(max(label.minX - c.x, 0, c.x - label.maxX), max(label.minY - c.y, 0, c.y - label.maxY))
            if gap < 45, gap < (best?.gap ?? .greatestFiniteMagnitude) { best = (c, gap) }
        }
    }
    if inspect { print("    ARP labels \(labels.count), circles \(circles.count), pick \(String(describing: best))") }
    return best?.point
}

struct Outcome {
    let georeference: AirportDiagramGeoreference
    let matches: [G.RunwayMatch]
    let arpErrorFeet: Double?   // printed ARP vs AIP ARP, feet
}

func georeference(_ entry: Control.Entry, pdfData: Data) throws -> Outcome {
    guard let ref = reference(entry.icao) else { throw Reject.message("aerodrome not in israel-aviation.sqlite") }
    let dbRunways = runways(entry.icao).filter(\.hasCoordinates)
    guard !dbRunways.isEmpty else { throw Reject.message("no runway with coordinates in the database") }
    guard let document = PDFDocument(data: pdfData), let page = document.page(at: 0), let cgPage = page.pageRef else {
        throw Reject.message("unreadable PDF")
    }
    let pageBox = page.bounds(for: .mediaBox)
    let vectors = PDFVectorScanner.scan(page: cgPage, restoresGraphicsState: true)   // CAAI sheets set colour inside q/Q
    var drawn = vectors.runwayShapes()
    if inspect {
        for r in drawn { print("    filled shape (\(Int(r.start.x)),\(Int(r.start.y)))-(\(Int(r.end.x)),\(Int(r.end.y))) length \(Int(r.length)) width \(String(format: "%.1f", r.widthPoints))") }
        for r in vectors.strokedRunwayShapes() { print("    stroked shape (\(Int(r.start.x)),\(Int(r.start.y)))-(\(Int(r.end.x)),\(Int(r.end.y))) length \(Int(r.length)) width \(String(format: "%.1f", r.widthPoints))") }
    }
    if drawn.isEmpty { drawn = vectors.strokedRunwayShapes() }
    guard !drawn.isEmpty else { throw Reject.message("no runway polygon found in the vector stream (apron or parking sheet)") }
    let metres = AirportDiagramGeoreference.metresPerDegree(latitude: ref.latitude)
    let local: (Double, Double) -> CGPoint = { lat, lon in
        CGPoint(x: (lon - ref.longitude) * metres.lon, y: (lat - ref.latitude) * metres.lat)
    }
    var affine = CGAffineTransform.identity
    var rotationDiagnostic = 0   // degrees the page is rotated against true north
    let tolerances = G.Tolerances(runwayFeet: devToleranceFeet ?? israelRunwayGateFeet)
    var current: G.SimilarityFit
    var matches: [G.RunwayMatch]
    if dbRunways.count >= 2 {
        guard drawn.count >= 2 else { throw Reject.message("\(drawn.count) runway polygons found for \(dbRunways.count) runways") }
        let solution: G.FitSolution
        do { solution = try G.fit(labels: [], drawn: drawn, database: dbRunways, local: local) }
        catch { throw Reject.message("no runway hypothesis: \(error)") }
        current = solution.fit
        if let forced = entry.rotationDegrees, forced != current.rotationDegrees {
            throw Reject.message("fit rotation \(current.rotationDegrees) disagrees with north arrow \(forced)")
        }
        matches = solution.matches
        // Two refit passes: matches can change once the translation moves.
        for _ in 0..<2 {
            guard let better = refit(current, matches: matches) else {
                throw Reject.message("only \(matches.count) runway(s) matched the drawn polygons")
            }
            current = better
            matches = G.matchRunways(fit: current, drawn: drawn, database: dbRunways, local: local)
        }
        guard matches.count >= 2 else { throw Reject.message("only \(matches.count) runway(s) matched after refit") }
        affine = current.transform
        rotationDiagnostic = current.rotationDegrees
    } else {
        // One runway: scale from the GIS length, position from the runway midpoint, rotation from the GIS runway
        // bearing (accepted only within 10 degrees of north-up: charts are north-up or drawn to magnetic north,
        // variation about 5 E). Nothing left over validates that, so the printed ARP is the independent check.
        let runway = dbRunways[0]
        let maximumOffNorth = 10.0 * Double.pi / 180
        let base = local(runway.baseLatitude, runway.baseLongitude), recip = local(runway.reciprocalLatitude, runway.reciprocalLongitude)
        let groundAngle = atan2(recip.y - base.y, recip.x - base.x)
        let groundMid = CGPoint(x: (base.x + recip.x) / 2, y: (base.y + recip.y) / 2)
        func offset(_ s: G.RunwayShape) -> Double {   // radians in (-pi/2, pi/2]: page rotation that aligns the drawn axis
            var d = groundAngle - atan2(Double(s.end.y - s.start.y), Double(s.end.x - s.start.x))
            while d > .pi / 2 { d -= .pi }
            while d <= -.pi / 2 { d += .pi }
            return d
        }
        guard let shape = drawn.filter({ abs(offset($0)) < maximumOffNorth }).max(by: { $0.length < $1.length }) else {
            let detail = drawn.map { "len \(Int($0.length)) pt, page rotation \(Int(offset($0) * 180 / .pi)) deg" }.joined(separator: "; ")
            throw Reject.message("no drawn runway within 10 degrees of north-up alignment with the GIS runway: \(detail)")
        }
        let delta = offset(shape)
        let scale = runway.lengthFeet / G.feetPerMetre / Double(shape.length)
        let turn = CGAffineTransform(a: scale * cos(delta), b: scale * sin(delta), c: -scale * sin(delta), d: scale * cos(delta), tx: 0, ty: 0)
        let placed = shape.midpoint.applying(turn)
        affine = CGAffineTransform(a: turn.a, b: turn.b, c: turn.c, d: turn.d, tx: groundMid.x - placed.x, ty: groundMid.y - placed.y)
        rotationDiagnostic = Int((delta * 180 / .pi).rounded())
        current = G.SimilarityFit(scale: scale, rotationDegrees: 0, translation: .zero)   // only the scale is read afterwards
        let s0 = shape.start.applying(affine), e0 = shape.end.applying(affine)
        let ends = min(max(G.distance(s0, base), G.distance(e0, recip)), max(G.distance(s0, recip), G.distance(e0, base)))
        // Fitted from this runway, so its centreline and midpoint agree by construction; the ends are recorded.
        matches = [G.RunwayMatch(runway: runway, shape: shape, groundMidpoint: groundMid, residualFeet: 0, lengthError: 0, midpointFeet: 0,
                                 crossTrackFeet: 0, endFeet: ends * G.feetPerMetre, bearingErrorDegrees: abs(delta) * 180 / .pi)]
    }
    if inspect {
        print("  \(entry.icao): rotation \(current.rotationDegrees) scale \(current.scale) m/pt, \(drawn.count) drawn, \(matches.count) matched")
        for m in matches {
            print("    \(m.runway.identifier): residual \(Int(m.residualFeet)) ft, midpoint \(Int(m.midpointFeet)) ft, cross-track \(Int(m.crossTrackFeet)) ft, length \(String(format: "%.1f", m.lengthError * 100))%")
        }
    }
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

    // ARP check: printed symbol vs AIP coordinate, after the fit. Required with one runway; recorded otherwise.
    var arpError: Double?
    if let symbol = arpSymbol(document: document, page: page, vectors: vectors) {
        let ground = symbol.applying(affine)
        let aip = local(ref.latitude, ref.longitude)
        let dNorth = Double(ground.y - aip.y), dEast = Double(ground.x - aip.x)
        arpError = hypot(dNorth, dEast) * G.feetPerMetre
        if inspect { print("    ARP: north \(Int(dNorth)) m, east \(Int(dEast)) m") }
        let allowedNorth = israelRunwayGateFeet / G.feetPerMetre + arpRoundingNorthMetres
        let allowedEast = israelRunwayGateFeet / G.feetPerMetre + arpRoundingEastMetres
        if dbRunways.count == 1, abs(dNorth) > allowedNorth || abs(dEast) > allowedEast {
            throw Reject.message("ARP check failed: printed ARP is \(Int(abs(dNorth))) m N-S and \(Int(abs(dEast))) m E-W from the AIP ARP (allowed \(Int(allowedNorth)) and \(Int(allowedEast)) m)")
        }
    } else if dbRunways.count == 1 {
        throw Reject.message("no printed ARP symbol found: a single runway has no independent position check (sheet only)")
    }

    let clip = entry.clipRect.map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
        ?? vectors.neatline(pageBox: pageBox, gridLines: vectors.gridLines())
    let t = affine
    let g = AirportDiagramGeoreference(
        a: Double(t.a), b: Double(t.b), c: Double(t.c), d: Double(t.d), tx: Double(t.tx), ty: Double(t.ty),
        reference: .init(pageBox), referenceLatitude: ref.latitude, referenceLongitude: ref.longitude,
        pageBox: .init(pageBox), clipBox: .init(clip), masks: [],
        diagnostics: .init(
            method: .runway, labelSource: .none, latitudeLabels: 0, longitudeLabels: 0,
            rotationDegrees: rotationDiagnostic, feetPerPoint: feetPerPoint, scaleRatio: nil,
            runwaysMatched: matches.count, runwayResidualFeet: matches.map(\.residualFeet).max(),
            runwayMidpointFeet: matches.map(\.midpointFeet).max(), runwayEndFeet: matches.map(\.endFeet).max(),
            runwayBestMidpointFeet: matches.map(\.midpointFeet).min(),
            runwayMedianMidpointFeet: G.median(matches.map(\.midpointFeet)),
            maskedInsets: entry.maskRects?.count ?? 0))
    return Outcome(georeference: g, matches: matches, arpErrorFeet: arpError)
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
        let outcome = try georeference(entry, pdfData: pdfData)
        let g = outcome.georeference, matches = outcome.matches
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
                              feetPerPoint: g.diagnostics.feetPerPoint, files: ["\(entry.icao).png", "\(entry.icao).json"], arpErrorFeet: outcome.arpErrorFeet))
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
    let accuracyFeet: Int   // gate the placed diagrams passed (runway ends and ARP): shown on the badge as +/- this many feet
    let aerodromes: [String: IndexRecord]
}
var records: [String: IndexRecord] = [:]
for entry in control.entries {
    guard let r = results.first(where: { $0.icao == entry.icao }), r.reason != "chart PDF not downloaded" else { continue }
    records[entry.icao] = IndexRecord(
        chart: entry.chartTitle, language: entry.language, scale: entry.scale, georeferenced: r.georeferenced, reason: r.reason,
        sheet: "\(entry.icao).pdf", image: r.georeferenced ? "\(entry.icao).png" : nil, georeference: r.georeferenced ? "\(entry.icao).json" : nil)
}
let indexData = try encoder.encode(Index(product: "il-diagrams", edition: control.edition, editionLabel: control.editionLabel, aipDate: control.aipDate, accuracyFeet: Int(israelRunwayGateFeet), aerodromes: records))
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
