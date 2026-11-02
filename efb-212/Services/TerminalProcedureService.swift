//
//  TerminalProcedureService.swift
//  efb-212
//
//  FAA d-TPP (Digital Terminal Procedures Publication) client.
//  Resolves the current 28-day chart cycle, streams the ~16 MB d-TPP metafile once per cycle
//  into a compact per-airport index persisted as JSON, and downloads chart PDFs on demand.
//  Everything is cached under Application Support/efb-212/dtpp/{cycle}/ so charts work offline.
//

import Foundation
import os

// MARK: - Protocol

protocol TerminalProcedureServiceProtocol: Sendable {
    /// Charts published for an airport in the current (or newest cached) cycle, in metafile order.
    func charts(for airport: Airport) async throws -> [TerminalChart]

    /// Local file URL of the chart PDF, downloading it if it isn't cached yet.
    func pdfURL(for chart: TerminalChart) async throws -> URL

    /// The cycle of the chart index currently in use (may be expired when offline).
    func currentCycle() async throws -> DTPPCycle
}

// MARK: - Models

/// Grouping used by the airport sheet, in display order.
nonisolated enum TerminalChartCategory: String, Codable, Sendable, CaseIterable, Comparable {
    case diagram
    case approach
    case departure
    case arrival
    case minimums
    case other

    /// Maps a d-TPP `chart_code` (APD, IAP, DP, ODP, STR, MIN, HOT, LAH, DAU, ...) to a category.
    init(chartCode: String) {
        switch chartCode.trimmingCharacters(in: .whitespaces).uppercased() {
        case "APD": self = .diagram
        case "IAP": self = .approach
        case "DP", "ODP": self = .departure
        case "STR", "STAR": self = .arrival
        case "MIN": self = .minimums
        default: self = .other  // HOT (hot spots), LAH (land and hold short), DAU, ...
        }
    }

    var title: String {
        switch self {
        case .diagram: return "Airport Diagram"
        case .approach: return "Approaches"
        case .departure: return "Departures"
        case .arrival: return "Arrivals"
        case .minimums: return "Minimums"
        case .other: return "Other"
        }
    }

    private var sortOrder: Int {
        Self.allCases.firstIndex(of: self) ?? Self.allCases.count
    }

    static func < (lhs: TerminalChartCategory, rhs: TerminalChartCategory) -> Bool {
        lhs.sortOrder < rhs.sortOrder
    }
}

/// One terminal procedure chart (one PDF) from the d-TPP metafile.
nonisolated struct TerminalChart: Codable, Sendable, Identifiable, Hashable {
    /// Several records can share a PDF (e.g. TAKEOFF MINIMUMS and DIVERSE VECTOR AREA), so the name is part of the id.
    var id: String { "\(cycle)/\(pdfName)/\(name)" }
    let chartCode: String       // d-TPP chart_code, e.g. "APD", "IAP"
    let name: String            // d-TPP chart_name, e.g. "RNAV (GPS) RWY 31"
    let pdfName: String         // d-TPP pdf_name, e.g. "09216AD.PDF"
    let cycle: String           // YYNN, e.g. "2611"
    let category: TerminalChartCategory

    nonisolated init(chartCode: String, name: String, pdfName: String, cycle: String) {
        self.chartCode = chartCode
        self.name = name
        self.pdfName = pdfName
        self.cycle = cycle
        self.category = TerminalChartCategory(chartCode: chartCode)
    }
}

/// A 28-day d-TPP publication cycle. Charts become effective at 0901Z on the effective date.
nonisolated struct DTPPCycle: Codable, Sendable, Hashable {
    let code: String            // YYNN, e.g. "2611"
    let effectiveDate: Date     // 0901Z on the first day of the cycle
    let expirationDate: Date    // 0901Z on the first day of the next cycle

    nonisolated init(code: String, effectiveDate: Date, expirationDate: Date) {
        self.code = code
        self.effectiveDate = effectiveDate
        self.expirationDate = expirationDate
    }

    func isExpired(at date: Date = Date()) -> Bool { date >= expirationDate }

    func isCurrent(at date: Date = Date()) -> Bool { date >= effectiveDate && date < expirationDate }
}

/// Compact per-airport chart index distilled from the d-TPP metafile.
nonisolated struct DTPPIndex: Codable, Sendable, Equatable {
    let cycle: DTPPCycle
    /// Keyed by ICAO ident, or FAA ident when the airport has no ICAO ident.
    let airports: [String: [TerminalChart]]
    /// FAA ident (apt_ident) -> key in `airports`.
    let faaIdents: [String: String]

    nonisolated init(cycle: DTPPCycle, airports: [String: [TerminalChart]], faaIdents: [String: String]) {
        self.cycle = cycle
        self.airports = airports
        self.faaIdents = faaIdents
    }

    /// Matches on ICAO ident first, then FAA ident.
    func charts(icao: String, faaID: String?) -> [TerminalChart] {
        let icao = icao.uppercased()
        if let charts = airports[icao] { return charts }
        for ident in [faaID?.uppercased(), icao].compactMap({ $0 }) {
            if let key = faaIdents[ident], let charts = airports[key] { return charts }
        }
        return []
    }
}

// MARK: - Service

actor TerminalProcedureService: TerminalProcedureServiceProtocol {

    // MARK: - Properties

    nonisolated static let infoURL = "https://external-api.faa.gov/apra/dtpp/info"
    nonisolated static let baseURL = "https://aeronav.faa.gov/d-tpp"
    nonisolated static let indexFileName = "index.json"

    private let session: URLSession
    private let baseDirectory: URL
    private let now: @Sendable () -> Date
    private var index: DTPPIndex?
    private var loadTask: Task<DTPPIndex, Error>?

    private let logger = Logger(subsystem: "quartermint.efb-212", category: "TerminalProcedureService")

    // MARK: - Init

    /// - Parameters:
    ///   - session: Override for tests; defaults to a session with generous timeouts for the 16 MB metafile.
    ///   - baseDirectory: Cache root; defaults to Application Support/efb-212/dtpp.
    ///   - now: Clock override for tests.
    init(session: URLSession? = nil, baseDirectory: URL? = nil, now: @escaping @Sendable () -> Date = { Date() }) {
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 30
            config.timeoutIntervalForResource = 300
            config.waitsForConnectivity = false
            self.session = URLSession(configuration: config)
        }
        self.baseDirectory = baseDirectory ?? Self.defaultBaseDirectory()
        self.now = now
    }

    nonisolated private static func defaultBaseDirectory() -> URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return root.appendingPathComponent("efb-212", isDirectory: true)
            .appendingPathComponent("dtpp", isDirectory: true)
    }

    // MARK: - Public API

    func charts(for airport: Airport) async throws -> [TerminalChart] {
        try await loadIndex().charts(icao: airport.icao, faaID: airport.faaID)
    }

    func currentCycle() async throws -> DTPPCycle {
        try await loadIndex().cycle
    }

    func pdfURL(for chart: TerminalChart) async throws -> URL {
        // pdf_name is a bare file name; never let it escape the cycle folder.
        let fileName = (chart.pdfName as NSString).lastPathComponent
        guard !fileName.isEmpty, fileName.uppercased().hasSuffix(".PDF") else {
            throw EFBError.chartDownloadFailed(chart.name)
        }
        let folder = cycleDirectory(chart.cycle)
        let destination = folder.appendingPathComponent(fileName)
        if FileManager.default.fileExists(atPath: destination.path) {
            if Self.isPDF(at: destination) { return destination }
            // A truncated or corrupt cached file is never trusted: drop it and download again.
            try? FileManager.default.removeItem(at: destination)
        }

        guard let url = URL(string: "\(Self.baseURL)/\(chart.cycle)/\(fileName)") else {
            throw EFBError.chartDownloadFailed(chart.name)
        }

        let downloaded: (URL, URLResponse)
        do {
            downloaded = try await session.download(from: url)
        } catch {
            logger.error("Chart download failed for \(fileName, privacy: .public): \(error.localizedDescription, privacy: .public)")
            throw EFBError.chartDownloadFailed(chart.name)
        }
        let (tempURL, response) = downloaded
        defer { try? FileManager.default.removeItem(at: tempURL) }

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              Self.isPDF(at: tempURL) else {
            throw EFBError.chartDownloadFailed(chart.name)
        }

        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: tempURL, to: destination)
        } catch {
            throw EFBError.chartDownloadFailed(chart.name)
        }

        purgeCycles(olderThan: chart.cycle)
        return destination
    }

    // MARK: - Index Loading

    /// Returns the in-use index: memory, then a current on-disk cycle, then a fresh download,
    /// falling back to the newest cached (possibly expired) cycle when offline.
    private func loadIndex() async throws -> DTPPIndex {
        let date = now()
        if let index, index.cycle.isCurrent(at: date) {
            return index
        }
        if let loadTask {
            return try await loadTask.value
        }

        let task = Task { try await self.resolveIndex(at: date) }
        loadTask = task
        defer { loadTask = nil }

        let resolved = try await task.value
        index = resolved
        return resolved
    }

    private func resolveIndex(at date: Date) async throws -> DTPPIndex {
        let cached = cachedIndexes()
        if let current = cached.first(where: { $0.cycle.isCurrent(at: date) }) {
            return current
        }

        do {
            let cycle = await resolveCycle(at: date)
            let fresh = try await downloadIndex(for: cycle)
            do {
                try persist(fresh)
            } catch {
                logger.error("Failed to persist d-TPP index: \(error.localizedDescription, privacy: .public)")
            }
            purgeCycles(olderThan: fresh.cycle.code)
            return fresh
        } catch {
            logger.error("d-TPP index refresh failed: \(error.localizedDescription, privacy: .public)")
            if let newest = cached.first {
                return newest  // Offline: serve the newest cycle we have; UI flags it expired.
            }
            if error is EFBError { throw error }
            throw EFBError.chartDownloadFailed("FAA terminal procedures")
        }
    }

    /// Current cycle from the FAA APRA info endpoint, or computed from the 28-day schedule.
    private func resolveCycle(at date: Date) async -> DTPPCycle {
        let computed = Self.cycle(containing: date)
        guard let url = URL(string: Self.infoURL) else { return computed }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return computed
            }
            return try Self.parseCycleInfo(data)
        } catch {
            logger.notice("d-TPP info endpoint unavailable, using computed cycle \(computed.code, privacy: .public)")
            return computed
        }
    }

    private func downloadIndex(for cycle: DTPPCycle) async throws -> DTPPIndex {
        guard let url = URL(string: "\(Self.baseURL)/\(cycle.code)/xml_data/d-tpp_Metafile.xml") else {
            throw EFBError.chartDownloadFailed("FAA terminal procedures")
        }
        let (tempURL, response) = try await session.download(from: url)
        defer { try? FileManager.default.removeItem(at: tempURL) }

        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw EFBError.chartDownloadFailed("FAA terminal procedures")
        }
        guard let stream = InputStream(url: tempURL) else {
            throw EFBError.chartCorrupted("FAA terminal procedures")
        }
        return try Self.parseMetafile(XMLParser(stream: stream), fallbackCycle: cycle)
    }

    // MARK: - Disk Cache

    private func cycleDirectory(_ code: String) -> URL {
        baseDirectory.appendingPathComponent(code, isDirectory: true)
    }

    private func persist(_ index: DTPPIndex) throws {
        let folder = cycleDirectory(index.cycle.code)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(index)
        try data.write(to: folder.appendingPathComponent(Self.indexFileName), options: .atomic)
    }

    /// Cached indexes on disk, newest cycle first.
    private func cachedIndexes() -> [DTPPIndex] {
        let folders = (try? FileManager.default.contentsOfDirectory(
            at: baseDirectory, includingPropertiesForKeys: nil
        )) ?? []
        return folders
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
            .compactMap { folder -> DTPPIndex? in
                guard let data = try? Data(contentsOf: folder.appendingPathComponent(Self.indexFileName)) else {
                    return nil
                }
                return try? JSONDecoder().decode(DTPPIndex.self, from: data)
            }
    }

    /// Deletes cycle folders older than `code` (YYNN codes sort chronologically).
    private func purgeCycles(olderThan code: String) {
        let folders = (try? FileManager.default.contentsOfDirectory(
            at: baseDirectory, includingPropertiesForKeys: nil
        )) ?? []
        for folder in folders where Self.isCycleCode(folder.lastPathComponent) && folder.lastPathComponent < code {
            try? FileManager.default.removeItem(at: folder)
        }
    }

    // MARK: - Pure Helpers

    nonisolated static func isCycleCode(_ string: String) -> Bool {
        string.count == 4 && string.allSatisfy(\.isNumber)
    }

    nonisolated private static func isPDF(at url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        let magic = (try? handle.read(upToCount: 4)) ?? Data()
        return magic == Data("%PDF".utf8)
    }

    nonisolated private static var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? .current
        return calendar
    }

    /// 28 days in seconds.
    nonisolated static let cycleLength: TimeInterval = 28 * 86_400

    /// d-TPP cycle 2001 became effective 2020-01-02 at 0901Z; every cycle since is exactly 28 days.
    nonisolated static var referenceEffectiveDate: Date {
        utcCalendar.date(from: DateComponents(year: 2020, month: 1, day: 2, hour: 9, minute: 1))
            ?? Date(timeIntervalSince1970: 1_577_955_660)
    }

    /// Computes the 28-day cycle containing `date`. Code is YYNN where NN is the cycle's
    /// ordinal within the year its effective date falls in (e.g. 10/29/2026 -> "2611").
    nonisolated static func cycle(containing date: Date) -> DTPPCycle {
        let reference = referenceEffectiveDate
        let elapsed = (date.timeIntervalSince(reference) / cycleLength).rounded(.down)
        let effective = reference.addingTimeInterval(elapsed * cycleLength)
        let calendar = utcCalendar
        let year = calendar.component(.year, from: effective)
        let jan1 = calendar.date(from: DateComponents(year: year, month: 1, day: 1)) ?? effective
        let firstOfYear = (jan1.timeIntervalSince(reference) / cycleLength).rounded(.up)
        let number = Int(elapsed - firstOfYear) + 1
        let code = String(format: "%02d%02d", year % 100, number)
        return DTPPCycle(code: code, effectiveDate: effective, expirationDate: effective.addingTimeInterval(cycleLength))
    }

    /// The cycle with `code` (YYNN) among the cycles within a year of `date`; nil for an unknown code.
    /// Used to date a chart from its own cycle, not from the newest cycle the device happens to know.
    nonisolated static func cycle(code: String, near date: Date) -> DTPPCycle? {
        for offset in -13...13 {
            let candidate = cycle(containing: date.addingTimeInterval(Double(offset) * cycleLength))
            if candidate.code == code { return candidate }
        }
        return nil
    }

    /// Parses the FAA APRA `dtpp/info` JSON:
    /// `{"edition":[{"editionName":"CURRENT","editionDate":"10/29/2026","editionNumber":11}]}`.
    nonisolated static func parseCycleInfo(_ data: Data) throws -> DTPPCycle {
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let editions = json["edition"] as? [[String: Any]] else {
            throw EFBError.chartCorrupted("FAA terminal procedures")
        }
        let edition = editions.first { ($0["editionName"] as? String)?.uppercased() == "CURRENT" } ?? editions.first
        let number: Int?
        if let value = edition?["editionNumber"] as? Int {
            number = value
        } else if let value = edition?["editionNumber"] as? String {
            number = Int(value)
        } else {
            number = nil
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "MM/dd/yyyy"
        guard let number, (1...14).contains(number),
              let dateString = edition?["editionDate"] as? String,
              let day = formatter.date(from: dateString) else {
            throw EFBError.chartCorrupted("FAA terminal procedures")
        }
        let effective = day.addingTimeInterval(9 * 3600 + 60)  // 0901Z
        let year = utcCalendar.component(.year, from: effective)
        return DTPPCycle(
            code: String(format: "%02d%02d", year % 100, number),
            effectiveDate: effective,
            expirationDate: effective.addingTimeInterval(cycleLength)
        )
    }

    /// Parses metafile dates like `"0901Z  10/29/26"` (UTC).
    nonisolated static func parseMetafileDate(_ string: String) -> Date? {
        let normalized = string.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "HHmm'Z' MM/dd/yy"
        return formatter.date(from: normalized)
    }

    nonisolated static func parseMetafile(data: Data, fallbackCycle: DTPPCycle? = nil) throws -> DTPPIndex {
        try parseMetafile(XMLParser(data: data), fallbackCycle: fallbackCycle)
    }

    /// Streams the metafile, keeping only chart records that point at a live PDF.
    nonisolated static func parseMetafile(_ parser: XMLParser, fallbackCycle: DTPPCycle? = nil) throws -> DTPPIndex {
        let delegate = DTPPMetafileParser()
        parser.delegate = delegate
        guard parser.parse() else {
            throw EFBError.chartCorrupted(parser.parserError?.localizedDescription ?? "FAA terminal procedures")
        }

        let code = delegate.cycleCode ?? fallbackCycle?.code
        guard let code, isCycleCode(code) else {
            throw EFBError.chartCorrupted("FAA terminal procedures")
        }
        let computed = fallbackCycle?.code == code ? fallbackCycle : nil
        guard let effective = delegate.fromDate.flatMap(parseMetafileDate) ?? computed?.effectiveDate,
              let expiration = delegate.toDate.flatMap(parseMetafileDate) ?? computed?.expirationDate else {
            throw EFBError.chartCorrupted("FAA terminal procedures")
        }

        let airports = delegate.airports.mapValues { records in
            records.map { TerminalChart(chartCode: $0.code, name: $0.name, pdfName: $0.pdf, cycle: code) }
        }
        return DTPPIndex(
            cycle: DTPPCycle(code: code, effectiveDate: effective, expirationDate: expiration),
            airports: airports,
            faaIdents: delegate.faaIdents
        )
    }
}

// MARK: - XML Delegate

/// SAX delegate for d-TPP metafile:
/// `<digital_tpp cycle from_edate to_edate>` > `<state_code>` > `<city_name>` >
/// `<airport_name apt_ident icao_ident>` > `<record>` { chart_code, chart_name, useraction, pdf_name }.
nonisolated private final class DTPPMetafileParser: NSObject, XMLParserDelegate {
    nonisolated struct Record {
        var code = ""
        var name = ""
        var pdf = ""
        var action = ""
    }

    private(set) var cycleCode: String?
    private(set) var fromDate: String?
    private(set) var toDate: String?
    private(set) var airports: [String: [Record]] = [:]
    private(set) var faaIdents: [String: String] = [:]

    private var airportKey: String?
    private var record: Record?
    private var text = ""

    func parser(
        _ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
        qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]
    ) {
        text = ""
        switch elementName {
        case "digital_tpp":
            cycleCode = attributeDict["cycle"]?.trimmingCharacters(in: .whitespaces)
            fromDate = attributeDict["from_edate"]
            toDate = attributeDict["to_edate"]
        case "airport_name":
            let icao = (attributeDict["icao_ident"] ?? "").trimmingCharacters(in: .whitespaces).uppercased()
            let faa = (attributeDict["apt_ident"] ?? "").trimmingCharacters(in: .whitespaces).uppercased()
            let key = icao.isEmpty ? faa : icao
            airportKey = key.isEmpty ? nil : key
            if !faa.isEmpty, !key.isEmpty {
                faaIdents[faa] = key
            }
        case "record":
            record = Record()
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if record != nil { text += string }
    }

    func parser(
        _ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?
    ) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch elementName {
        case "chart_code": record?.code = value
        case "chart_name": record?.name = value
        case "pdf_name": record?.pdf = value
        case "useraction": record?.action = value
        case "record":
            if let current = record, let airportKey, Self.isLive(current) {
                airports[airportKey, default: []].append(current)
            }
            record = nil
        case "airport_name":
            airportKey = nil
        default:
            break
        }
        text = ""
    }

    /// Skips deleted records (useraction D, DELETED_JOB.PDF) and anything that isn't a PDF.
    private static func isLive(_ record: Record) -> Bool {
        let pdf = record.pdf.uppercased()
        return record.action.uppercased() != "D"
            && pdf.hasSuffix(".PDF")
            && !pdf.hasPrefix("DELETED")
            && !record.code.isEmpty
    }
}
