//
//  main.swift
//  apd-georef
//
//  Batch georeferencing of every FAA airport diagram (APD) in a d-TPP cycle, using the same core the
//  app uses (efb-212/Services/AirportDiagramGeoreferencer.swift). Downloads the metafile and PDFs
//  into a cache, reads airport reference points and runway thresholds from the bundled aviation.sqlite,
//  runs the georeferencer over all diagrams in parallel, and writes a markdown report plus a JSON
//  dump of every result. See README.md.
//

import Foundation
import CoreGraphics
import ImageIO
import SQLite3

setvbuf(stdout, nil, _IONBF, 0)

// MARK: - Arguments

struct Options {
    var cycle: String?
    var databasePath = "efb-212/Resources/aviation.sqlite"
    var cacheRoot = "/tmp/apd-cache"
    var reportPath = "docs/design/apd-georef-report.md"
    var jsonPath: String?
    var renderDirectory: String?
    var only: Set<String> = []
    var limit: Int?
    var jobs = max(2, ProcessInfo.processInfo.activeProcessorCount - 1)
    var verbose = false
    var inspect = false
    var tolerances = AirportDiagramGeoreferencer.Tolerances.standard
}

func usage() -> Never {
    print("""
    usage: apd-georef [--cycle YYNN] [--db aviation.sqlite] [--cache DIR] [--report FILE.md] [--json FILE.json]
                      [--render DIR] [--only KPAO,KBOS,...] [--limit N] [--jobs N] [--verbose] [--inspect] [--runway-tolerance FEET]
    """)
    exit(2)
}

var options = Options()
var arguments = Array(CommandLine.arguments.dropFirst())
while !arguments.isEmpty {
    let flag = arguments.removeFirst()
    func value() -> String {
        if arguments.isEmpty { usage() }
        return arguments.removeFirst()
    }
    switch flag {
    case "--cycle": options.cycle = value()
    case "--db": options.databasePath = value()
    case "--cache": options.cacheRoot = value()
    case "--report": options.reportPath = value()
    case "--json": options.jsonPath = value()
    case "--render": options.renderDirectory = value()
    case "--only": options.only = Set(value().split(separator: ",").map { $0.uppercased() })
    case "--limit": options.limit = Int(value())
    case "--jobs": options.jobs = Int(value()) ?? options.jobs
    case "--verbose": options.verbose = true
    case "--inspect": options.inspect = true
    case "--runway-tolerance": options.tolerances.runwayFeet = Double(value()) ?? options.tolerances.runwayFeet
    default: usage()
    }
}

// MARK: - Cycle

/// d-TPP cycle 2001 became effective 2020-01-02 0901Z; every cycle since is exactly 28 days.
func computedCycle(at date: Date = Date()) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    let reference = calendar.date(from: DateComponents(year: 2020, month: 1, day: 2, hour: 9, minute: 1)) ?? date
    let length = 28.0 * 86_400
    let elapsed = (date.timeIntervalSince(reference) / length).rounded(.down)
    let effective = reference.addingTimeInterval(elapsed * length)
    let year = calendar.component(.year, from: effective)
    let jan1 = calendar.date(from: DateComponents(year: year, month: 1, day: 1)) ?? effective
    let firstOfYear = (jan1.timeIntervalSince(reference) / length).rounded(.up)
    return String(format: "%02d%02d", year % 100, Int(elapsed - firstOfYear) + 1)
}

let cycle = options.cycle ?? computedCycle()
let cacheDirectory = URL(fileURLWithPath: options.cacheRoot).appendingPathComponent(cycle, isDirectory: true)
try FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
print("cycle \(cycle), cache \(cacheDirectory.path)")

// MARK: - Download helpers

let session: URLSession = {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 60
    config.timeoutIntervalForResource = 600
    return URLSession(configuration: config)
}()

func download(_ url: URL, to destination: URL) -> Bool {
    if let size = try? FileManager.default.attributesOfItem(atPath: destination.path)[.size] as? Int, size > 0 { return true }
    let semaphore = DispatchSemaphore(value: 0)
    var ok = false
    let task = session.downloadTask(with: url) { temp, response, _ in
        defer { semaphore.signal() }
        guard let temp, let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else { return }
        try? FileManager.default.removeItem(at: destination)
        ok = (try? FileManager.default.moveItem(at: temp, to: destination)) != nil
    }
    task.resume()
    semaphore.wait()
    return ok
}

// MARK: - Metafile

struct APDRecord {
    let pdfName: String
    let faaIdent: String
    let icaoIdent: String
}

final class MetafileParser: NSObject, XMLParserDelegate {
    var records: [APDRecord] = []
    private var faa = "", icao = "", code = "", pdf = "", text = ""

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes: [String: String] = [:]) {
        text = ""
        if elementName == "airport_name" {
            faa = (attributes["apt_ident"] ?? "").trimmingCharacters(in: .whitespaces).uppercased()
            icao = (attributes["icao_ident"] ?? "").trimmingCharacters(in: .whitespaces).uppercased()
        } else if elementName == "record" {
            code = ""; pdf = ""
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { text += string }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        switch elementName {
        case "chart_code": code = text.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        case "pdf_name": pdf = text.trimmingCharacters(in: .whitespacesAndNewlines)
        case "record":
            if code == "APD", !pdf.isEmpty { records.append(APDRecord(pdfName: pdf, faaIdent: faa, icaoIdent: icao)) }
        default: break
        }
    }
}

let metafileURL = cacheDirectory.appendingPathComponent("d-tpp_Metafile.xml")
guard let remoteMetafile = URL(string: "https://aeronav.faa.gov/d-tpp/\(cycle)/xml_data/d-tpp_Metafile.xml"),
      download(remoteMetafile, to: metafileURL) else {
    print("failed to download the d-TPP metafile for cycle \(cycle)")
    exit(1)
}
let metafileParser = MetafileParser()
guard let xmlParser = XMLParser(contentsOf: metafileURL) else { print("cannot open metafile"); exit(1) }
xmlParser.delegate = metafileParser
guard xmlParser.parse() else { print("metafile parse error: \(xmlParser.parserError?.localizedDescription ?? "?")"); exit(1) }
var records = metafileParser.records
// One record per PDF (a few airports list the diagram twice).
var seenPDFs = Set<String>()
records = records.filter { seenPDFs.insert($0.pdfName).inserted }
print("APD records: \(records.count)")

// MARK: - Database

final class AviationDB {
    private var db: OpaquePointer?

    init(path: String) throws {
        let uri = "file:\(path)?immutable=1"
        guard sqlite3_open_v2(uri, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI, nil) == SQLITE_OK else {
            throw NSError(domain: "apd-georef", code: 1, userInfo: [NSLocalizedDescriptionKey: "cannot open \(path)"])
        }
    }

    deinit { sqlite3_close(db) }

    func airport(icao: String, faa: String) -> (icao: String, reference: AirportDiagramReference)? {
        let sql = "SELECT icao, latitude, longitude FROM airports WHERE icao = ?1 OR (?2 != '' AND faa_id = ?2) ORDER BY (icao = ?1) DESC LIMIT 1"
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, (icao as NSString).utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        sqlite3_bind_text(statement, 2, (faa as NSString).utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        guard sqlite3_step(statement) == SQLITE_ROW, let text = sqlite3_column_text(statement, 0) else { return nil }
        return (String(cString: text), AirportDiagramReference(latitude: sqlite3_column_double(statement, 1), longitude: sqlite3_column_double(statement, 2)))
    }

    func runways(icao: String) -> [AirportDiagramRunway] {
        let sql = """
            SELECT id, length, width, base_end_latitude, base_end_longitude, reciprocal_end_latitude, reciprocal_end_longitude
            FROM runways WHERE airport_icao = ?1
            """
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, (icao as NSString).utf8String, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self))
        var out: [AirportDiagramRunway] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            let id = sqlite3_column_text(statement, 0).map { String(cString: $0) } ?? "?"
            out.append(AirportDiagramRunway(
                identifier: id,
                lengthFeet: sqlite3_column_double(statement, 1), widthFeet: sqlite3_column_double(statement, 2),
                baseLatitude: sqlite3_column_double(statement, 3), baseLongitude: sqlite3_column_double(statement, 4),
                reciprocalLatitude: sqlite3_column_double(statement, 5), reciprocalLongitude: sqlite3_column_double(statement, 6)
            ))
        }
        return out
    }
}

let database = try AviationDB(path: options.databasePath)

// MARK: - Work items

struct Job {
    let record: APDRecord
    let icao: String
    let reference: AirportDiagramReference
    let runways: [AirportDiagramRunway]
    let pdfURL: URL
}

struct Outcome: Codable {
    let pdfName: String
    let icao: String
    let ok: Bool
    let reason: String?
    let category: String?
    let seconds: Double
    let diagnostics: AirportDiagramGeoreference.Diagnostics?
    let georeference: AirportDiagramGeoreference?
}

var jobs: [Job] = []
var noAirport: [APDRecord] = []
for record in records {
    let key = record.icaoIdent.isEmpty ? record.faaIdent : record.icaoIdent
    if !options.only.isEmpty, !options.only.contains(record.icaoIdent), !options.only.contains(record.faaIdent), !options.only.contains(key) { continue }
    guard let airport = database.airport(icao: key, faa: record.faaIdent)
            ?? (record.faaIdent.isEmpty ? nil : database.airport(icao: "K" + record.faaIdent, faa: record.faaIdent)) else {
        noAirport.append(record)
        continue
    }
    jobs.append(Job(
        record: record, icao: airport.icao, reference: airport.reference,
        runways: database.runways(icao: airport.icao),
        pdfURL: cacheDirectory.appendingPathComponent((record.pdfName as NSString).lastPathComponent)
    ))
}
if let limit = options.limit { jobs = Array(jobs.prefix(limit)) }

print("jobs: \(jobs.count) (no airport in DB: \(noAirport.count))")

// MARK: - Download PDFs

let downloadLock = NSLock()
var downloadFailures: [String] = []
let downloadSemaphore = DispatchSemaphore(value: 8)
DispatchQueue.concurrentPerform(iterations: jobs.count) { index in
    let job = jobs[index]
    downloadSemaphore.wait()
    defer { downloadSemaphore.signal() }
    guard let url = URL(string: "https://aeronav.faa.gov/d-tpp/\(cycle)/\(job.record.pdfName)") else { return }
    if !download(url, to: job.pdfURL) {
        downloadLock.lock(); downloadFailures.append(job.record.pdfName); downloadLock.unlock()
    }
}
print("downloaded (failures: \(downloadFailures.count))")

// MARK: - Georeference

func markerImage(_ image: CGImage, georeference: AirportDiagramGeoreference, runways: [AirportDiagramRunway], scale: CGFloat) -> CGImage? {
    guard let context = CGContext(
        data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }
    context.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
    context.fill(CGRect(x: 0, y: 0, width: image.width, height: image.height))
    context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    let clip = georeference.clipBox.cgRect
    context.setFillColor(red: 1, green: 0, blue: 0, alpha: 0.8)
    for runway in runways where runway.hasCoordinates {
        for (lat, lon) in [(runway.baseLatitude, runway.baseLongitude), (runway.reciprocalLatitude, runway.reciprocalLongitude)] {
            let p = georeference.pagePoint(latitude: lat, longitude: lon)
            let x = (p.x - clip.minX) * scale, y = (p.y - clip.minY) * scale
            context.fillEllipse(in: CGRect(x: x - 6, y: y - 6, width: 12, height: 12))
        }
    }
    context.setFillColor(red: 0, green: 0.4, blue: 1, alpha: 0.8)
    let arp = georeference.pagePoint(latitude: georeference.referenceLatitude, longitude: georeference.referenceLongitude)
    context.fillEllipse(in: CGRect(x: (arp.x - clip.minX) * scale - 7, y: (arp.y - clip.minY) * scale - 7, width: 14, height: 14))
    return context.makeImage()
}

func writePNG(_ image: CGImage, to url: URL) {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { return }
    CGImageDestinationAddImage(destination, image, nil)
    CGImageDestinationFinalize(destination)
}

let outcomesLock = NSLock()
var outcomes = [Outcome?](repeating: nil, count: jobs.count)
var completed = 0
let renderDirectory = options.renderDirectory.map { URL(fileURLWithPath: $0, isDirectory: true) }
if let renderDirectory { try FileManager.default.createDirectory(at: renderDirectory, withIntermediateDirectories: true) }

let jobSemaphore = DispatchSemaphore(value: options.jobs)
let start = Date()
DispatchQueue.concurrentPerform(iterations: jobs.count) { index in
    jobSemaphore.wait()
    defer { jobSemaphore.signal() }
    let job = jobs[index]
    let began = Date()
    var outcome: Outcome
    guard let data = try? Data(contentsOf: job.pdfURL), !data.isEmpty else {
        outcome = Outcome(pdfName: job.record.pdfName, icao: job.icao, ok: false, reason: "download failed", category: "download", seconds: 0, diagnostics: nil, georeference: nil)
        outcomesLock.lock(); outcomes[index] = outcome; outcomesLock.unlock()
        return
    }
    if options.inspect {
        let dump = AirportDiagramGeoreferencer.inspect(pdfData: data, reference: job.reference, runways: job.runways)
        outcomesLock.lock(); print("== \(job.icao) \(job.record.pdfName)\n\(dump)"); outcomesLock.unlock()
    }
    do {
        let georeference = try AirportDiagramGeoreferencer.georeference(pdfData: data, reference: job.reference, runways: job.runways, tolerances: options.tolerances)
        outcome = Outcome(pdfName: job.record.pdfName, icao: job.icao, ok: true, reason: nil, category: nil,
                          seconds: Date().timeIntervalSince(began), diagnostics: georeference.diagnostics, georeference: georeference)
        if let renderDirectory, let image = AirportDiagramGeoreferencer.renderImage(pdfData: data, georeference: georeference, scale: 2),
           let marked = markerImage(image, georeference: georeference, runways: job.runways, scale: 2) {
            writePNG(marked, to: renderDirectory.appendingPathComponent("\(job.icao)-\(job.record.pdfName).png"))
        }
    } catch let error as AirportDiagramGeoreferenceError {
        outcome = Outcome(pdfName: job.record.pdfName, icao: job.icao, ok: false, reason: error.description, category: error.category,
                          seconds: Date().timeIntervalSince(began), diagnostics: nil, georeference: nil)
    } catch {
        outcome = Outcome(pdfName: job.record.pdfName, icao: job.icao, ok: false, reason: "\(error)", category: "other",
                          seconds: Date().timeIntervalSince(began), diagnostics: nil, georeference: nil)
    }
    outcomesLock.lock()
    outcomes[index] = outcome
    completed += 1
    let done = completed
    outcomesLock.unlock()
    if options.verbose || done % 50 == 0 {
        let d = outcome.diagnostics
        print(String(format: "[%4d/%d] %@ %@ %@ %.1fs %@", done, jobs.count, job.icao, job.record.pdfName, outcome.ok ? "OK  " : "FAIL", outcome.seconds,
                     outcome.ok ? "\(d?.method.rawValue ?? "") \(d?.labelSource.rawValue ?? "") rot=\(d?.rotationDegrees ?? 0) ftpt=\(String(format: "%.1f", d?.feetPerPoint ?? 0)) ratio=\(d?.scaleRatio.map { String(format: "%.3f", $0) } ?? "-") rwy=\(d?.runwaysMatched ?? 0) res=\(d?.runwayResidualFeet.map { String(format: "%.0f", $0) } ?? "-")ft" : (outcome.reason ?? "")))
    }
}
let elapsed = Date().timeIntervalSince(start)
let results = outcomes.compactMap { $0 }

// MARK: - Report

let passed = results.filter(\.ok)
let failed = results.filter { !$0.ok }
let total = results.count
func percent(_ n: Int, _ d: Int) -> String { d == 0 ? "0%" : String(format: "%.1f%%", 100 * Double(n) / Double(d)) }

var categories: [String: Int] = [:]
for f in failed { categories[f.category ?? "other", default: 0] += 1 }
var methods: [String: Int] = [:], sources: [String: Int] = [:], rotations: [Int: Int] = [:]
var residuals: [Double] = []
var insets = 0
for p in passed {
    guard let d = p.diagnostics else { continue }
    methods[d.method.rawValue, default: 0] += 1
    sources[d.labelSource.rawValue, default: 0] += 1
    rotations[d.rotationDegrees, default: 0] += 1
    if let r = d.runwayResidualFeet { residuals.append(r) }
    if d.maskedInsets > 0 { insets += 1 }
}
let bins: [(String, ClosedRange<Double>)] = [("0-10 ft", 0...10), ("10-20 ft", 10.0001...20), ("20-30 ft", 20.0001...30), ("30-40 ft", 30.0001...40), ("40-50 ft", 40.0001...50), ("50-75 ft", 50.0001...75), ("75-100 ft", 75.0001...100), ("100-150 ft", 100.0001...150), ("150-300 ft", 150.0001...300), ("over 300 ft", 300.0001...1e9)]
let times = results.map(\.seconds).sorted()
let median = times.isEmpty ? 0 : times[times.count / 2]
let p95 = times.isEmpty ? 0 : times[min(times.count - 1, Int(Double(times.count) * 0.95))]

let formatter = DateFormatter()
formatter.dateFormat = "yyyy-MM-dd HH:mm 'UTC'"
formatter.timeZone = TimeZone(identifier: "UTC")

var report = """
# FAA airport diagram georeferencing report

Generated \(formatter.string(from: Date())) by `tools/apd-georef` over d-TPP cycle \(cycle).
Core: `efb-212/Services/AirportDiagramGeoreferencer.swift` (same code the app runs on device).

## Summary

| Metric | Value |
|---|---|
| APD records in the metafile | \(records.count) |
| Airports not in the bundled database (skipped) | \(noAirport.count) |
| PDFs that failed to download | \(downloadFailures.count) |
| Diagrams processed | \(total) |
| Georeferenced and validated | \(passed.count) (\(percent(passed.count, total))) |
| Rejected | \(failed.count) (\(percent(failed.count, total))) |
| Validated with the runway cross-check | \(methods["gridRunwayChecked", default: 0] + methods["runway", default: 0]) |
| Diagrams with masked insets | \(insets) |
| Wall time | \(String(format: "%.0f s", elapsed)) (\(options.jobs) jobs); per diagram median \(String(format: "%.2f s", median)), p95 \(String(format: "%.2f s", p95)) |

Acceptance gates applied to every accepted fit: E-W vs N-S scale within \(Int(AirportDiagramGeoreferencer.conformalTolerance * 100))% (when both
axes have two grid values), predicted runway centrelines and midpoints within \(Int(options.tolerances.runwayFeet)) ft of the drawn runways
whenever the database has threshold coordinates, chart scale between \(Int(AirportDiagramGeoreferencer.feetPerPointRange.lowerBound)) and \(Int(AirportDiagramGeoreferencer.feetPerPointRange.upperBound)) ft per PDF point.

## Method and label source (accepted fits)

| Method | Count |
|---|---|

"""
for (k, v) in methods.sorted(by: { $0.value > $1.value }) { report += "| \(k) | \(v) |\n" }
report += "\n| Label source | Count |\n|---|---|\n"
for (k, v) in sources.sorted(by: { $0.value > $1.value }) { report += "| \(k) | \(v) |\n" }
report += "\n| Page rotation (page up vs true north) | Count |\n|---|---|\n"
for (k, v) in rotations.sorted(by: { $0.key < $1.key }) { report += "| \(k) deg | \(v) |\n" }

report += "\n## Accuracy vs database runway thresholds (accepted fits)\n\nWorst predicted-threshold error per diagram, over all matched runways.\n\n| Error | Diagrams |\n|---|---|\n"
for (name, range) in bins { report += "| \(name) | \(residuals.filter { range.contains($0) }.count) |\n" }
if !residuals.isEmpty {
    let sorted = residuals.sorted()
    report += "\nMedian \(String(format: "%.1f", sorted[sorted.count / 2])) ft, p95 \(String(format: "%.1f", sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.95))])) ft, max \(String(format: "%.1f", sorted[sorted.count - 1])) ft.\n"
}

report += "\n## Failure reasons\n\n| Reason | Diagrams |\n|---|---|\n"
for (k, v) in categories.sorted(by: { $0.value > $1.value }) { report += "| \(k) | \(v) |\n" }

report += "\n## Rejected diagrams\n\n| Airport | PDF | Reason |\n|---|---|---|\n"
for f in failed.sorted(by: { $0.icao < $1.icao }) { report += "| \(f.icao) | \(f.pdfName) | \(f.reason ?? "") |\n" }
if !noAirport.isEmpty {
    report += "\n## Not in the bundled database\n\n"
    report += noAirport.map { "\($0.icaoIdent.isEmpty ? $0.faaIdent : $0.icaoIdent) (\($0.pdfName))" }.joined(separator: ", ") + "\n"
}

let reportURL = URL(fileURLWithPath: options.reportPath)
try FileManager.default.createDirectory(at: reportURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try report.write(to: reportURL, atomically: true, encoding: .utf8)
if let jsonPath = options.jsonPath {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(results).write(to: URL(fileURLWithPath: jsonPath))
}
print("\(passed.count)/\(total) accepted (\(percent(passed.count, total))) in \(String(format: "%.0f", elapsed)) s; report: \(reportURL.path)")
for (k, v) in categories.sorted(by: { $0.value > $1.value }) { print("  \(k): \(v)") }
