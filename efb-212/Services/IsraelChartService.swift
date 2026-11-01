//
//  IsraelChartService.swift
//  efb-212
//
//  Downloads, verifies and stores a hosted chart pack (IL-9). Used for the official CAAI CVFR chart
//  (product "israel-cvfr") and any other product on the same R2 layout, e.g. airport diagrams.
//
//  Host layout:  <base>/<product>/manifest.json           index with the latest published edition
//                <base>/<product>/<edition>/manifest.json  edition manifest with files[] and sha256
//  On disk:      Application Support/ChartPacks/<product>/<edition>/<file> and .../<product>/installed.json
//
//  The app only ever installs a published edition whose validation gate passed (`isServable`);
//  a DEBUG-only developer setting allows trying an unpublished build.
//

import Foundation
import CryptoKit

// MARK: - Config

nonisolated enum IsraelChartConfig {
    static let product = "israel-cvfr"
    static let baseURLKey = "israelChartBaseURL"
    static let allowUnpublishedKey = "israelChartAllowUnpublished"
    /// Public base of the Cloudflare R2 bucket `openefb-charts` (dev URL; a custom domain may replace it).
    /// Override with the `israelChartBaseURL` default (e.g. launch argument `-israelChartBaseURL
    /// http://127.0.0.1:8000` for a locally staged tree) or the `ISRAEL_CHART_BASE_URL` Info.plist key.
    static let defaultBaseURL = "https://pub-cdfb51548498487fa9fdb9794192c8ef.r2.dev"

    static var baseURL: URL {
        let defaults = UserDefaults.standard
        let candidates = [
            defaults.string(forKey: baseURLKey),
            Bundle.main.object(forInfoDictionaryKey: "ISRAEL_CHART_BASE_URL") as? String,
            defaultBaseURL,
        ]
        for candidate in candidates {
            if let text = candidate?.trimmingCharacters(in: .whitespaces), !text.isEmpty, let url = URL(string: text) {
                return url
            }
        }
        return URL(fileURLWithPath: "/")
    }

    /// Developer setting; never honoured in release builds.
    static var allowUnpublished: Bool {
        #if DEBUG
        return UserDefaults.standard.bool(forKey: allowUnpublishedKey)
        #else
        return false
        #endif
    }
}

// MARK: - Protocol

nonisolated protocol ChartPackServiceProtocol: Sendable {
    var product: String { get }
    func fetchIndex() async throws -> IsraelChartIndex
    func fetchManifest(edition: String) async throws -> IsraelChartManifest
    /// The edition the pilot should have: the index's latest published edition, if it is servable.
    func latestServable(allowUnpublished: Bool) async throws -> IsraelChartManifest?
    /// Downloads (resuming a partial download), verifies every file's SHA-256 and installs the edition.
    func download(_ manifest: IsraelChartManifest, progress: @escaping @Sendable (Double) -> Void) async throws -> ChartPackInstalled
    func installed() -> ChartPackInstalled?
    /// Location of an installed file; nil when nothing is installed or the file is missing.
    func fileURL(_ name: String) -> URL?
    func remove()
}

// MARK: - Service

actor ChartPackService: ChartPackServiceProtocol {
    nonisolated let product: String
    private let baseURL: URL
    private let productDirectory: URL
    private let session: URLSession

    static var defaultRoot: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return support.appendingPathComponent("ChartPacks", isDirectory: true)
    }

    init(product: String, baseURL: URL, rootDirectory: URL? = nil, session: URLSession = .shared) {
        self.product = product
        self.baseURL = baseURL
        self.productDirectory = (rootDirectory ?? Self.defaultRoot).appendingPathComponent(product, isDirectory: true)
        self.session = session
    }

    // MARK: Network

    private func productURL(_ components: String...) -> URL {
        var url = baseURL.appendingPathComponent(product)
        for c in components { url = url.appendingPathComponent(c) }
        return url
    }

    private func getJSON<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(from: url)
        } catch {
            throw EFBError.networkUnavailable
        }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw EFBError.chartDownloadFailed(Self.regionName(product))
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw EFBError.chartDownloadFailed(Self.regionName(product))
        }
    }

    func fetchIndex() async throws -> IsraelChartIndex {
        try await getJSON(IsraelChartIndex.self, from: productURL("manifest.json"))
    }

    func fetchManifest(edition: String) async throws -> IsraelChartManifest {
        try await getJSON(IsraelChartManifest.self, from: productURL(edition, "manifest.json"))
    }

    func latestServable(allowUnpublished: Bool) async throws -> IsraelChartManifest? {
        let index = try await fetchIndex()
        let edition: String?
        if allowUnpublished {
            edition = index.editions.map(\.edition).max { $0.compare($1, options: .numeric) == .orderedAscending } ?? index.latest
        } else {
            edition = index.latest
        }
        guard let edition else { return nil }
        let manifest = try await fetchManifest(edition: edition)
        return manifest.isServable(allowUnpublished: allowUnpublished) ? manifest : nil
    }

    // MARK: Install state (disk)

    nonisolated func installed() -> ChartPackInstalled? {
        let recordURL = productDirectory.appendingPathComponent("installed.json")
        guard let data = try? Data(contentsOf: recordURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let record = try? decoder.decode(ChartPackInstalled.self, from: data), record.product == product else { return nil }
        let dir = productDirectory.appendingPathComponent(record.edition, isDirectory: true)
        for file in record.files {
            let attrs = try? FileManager.default.attributesOfItem(atPath: dir.appendingPathComponent(file.name).path)
            guard let size = attrs?[.size] as? NSNumber, size.intValue == file.bytes else { return nil }
        }
        return record
    }

    nonisolated func fileURL(_ name: String) -> URL? {
        guard let record = installed(), record.files.contains(where: { $0.name == name }) else { return nil }
        return productDirectory.appendingPathComponent(record.edition, isDirectory: true).appendingPathComponent(name)
    }

    nonisolated func remove() {
        try? FileManager.default.removeItem(at: productDirectory)
    }

    // MARK: Download

    func download(_ manifest: IsraelChartManifest, progress: @escaping @Sendable (Double) -> Void) async throws -> ChartPackInstalled {
        let fm = FileManager.default
        let region = Self.regionName(product)
        guard !manifest.files.isEmpty else { throw EFBError.chartDownloadFailed(region) }
        try fm.createDirectory(at: productDirectory, withIntermediateDirectories: true)
        let stage = productDirectory.appendingPathComponent(".partial-\(manifest.edition)", isDirectory: true)
        try fm.createDirectory(at: stage, withIntermediateDirectories: true)

        let total = max(1, manifest.totalBytes)
        var done = 0
        for file in manifest.files {
            let destination = stage.appendingPathComponent(file.name)
            let base = done
            try await fetch(file, edition: manifest.edition, to: destination) { fileBytes in
                progress(min(1, Double(base + fileBytes) / Double(total)))
            }
            // Verify before the file can ever be used. A bad file is deleted so a retry starts clean.
            guard let digest = try? Self.sha256(of: destination), digest == file.sha256.lowercased() else {
                try? fm.removeItem(at: destination)
                throw EFBError.chartCorrupted(region)
            }
            done += file.bytes
            progress(min(1, Double(done) / Double(total)))
        }

        let final = productDirectory.appendingPathComponent(manifest.edition, isDirectory: true)
        try? fm.removeItem(at: final)
        try fm.moveItem(at: stage, to: final)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true  // re-downloadable
        var mutableFinal = final
        try? mutableFinal.setResourceValues(values)

        let record = ChartPackInstalled(
            product: product, edition: manifest.edition, editionLabel: manifest.label,
            files: manifest.files.map { .init(name: $0.name, bytes: $0.bytes, sha256: $0.sha256.lowercased()) },
            installedAt: Date())
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(record).write(to: productDirectory.appendingPathComponent("installed.json"), options: .atomic)
        // One edition on disk: drop every other one now that the new one verified.
        let keep: Set<String> = [manifest.edition, "installed.json"]
        for entry in (try? fm.contentsOfDirectory(atPath: productDirectory.path)) ?? [] where !keep.contains(entry) {
            try? fm.removeItem(at: productDirectory.appendingPathComponent(entry))
        }
        return record
    }

    private func resolve(_ file: IsraelChartManifest.File, edition: String) -> URL {
        if let text = file.url, let url = URL(string: text) { return url }
        if let path = file.path {
            let root = baseURL.absoluteString.hasSuffix("/") ? baseURL : baseURL.appendingPathComponent("")
            if let url = URL(string: path, relativeTo: root)?.absoluteURL { return url }
        }
        return productURL(edition, file.name)
    }

    /// Streams `file` to `destination`, resuming from a partial file with a Range request.
    private func fetch(_ file: IsraelChartManifest.File, edition: String, to destination: URL,
                       onBytes: @Sendable (Int) -> Void) async throws {
        let fm = FileManager.default
        let region = Self.regionName(product)
        var existing = (try? fm.attributesOfItem(atPath: destination.path)[.size] as? NSNumber)?.intValue ?? 0
        if existing > file.bytes { try? fm.removeItem(at: destination); existing = 0 }
        if existing == file.bytes { onBytes(existing); return }

        var request = URLRequest(url: resolve(file, edition: edition))
        if existing > 0 { request.setValue("bytes=\(existing)-", forHTTPHeaderField: "Range") }
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch {
            throw EFBError.networkUnavailable
        }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 || http.statusCode == 206 else {
            throw EFBError.chartDownloadFailed(region)
        }
        if http.statusCode == 200 { existing = 0 }  // server ignored Range: start over
        if existing == 0 { fm.createFile(atPath: destination.path, contents: nil) }
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }
        if existing > 0 { try handle.seekToEnd() } else { try handle.truncate(atOffset: 0) }

        var received = existing
        var buffer = [UInt8]()
        buffer.reserveCapacity(1 << 18)
        do {
            for try await byte in bytes {
                buffer.append(byte)
                if buffer.count >= 1 << 18 {
                    try handle.write(contentsOf: buffer)
                    received += buffer.count
                    buffer.removeAll(keepingCapacity: true)
                    onBytes(received)
                }
            }
            if !buffer.isEmpty {
                try handle.write(contentsOf: buffer)
                received += buffer.count
                onBytes(received)
            }
        } catch is CancellationError {
            // Keep the partial file for the next attempt.
            try? handle.write(contentsOf: buffer)
            throw CancellationError()
        } catch {
            try? handle.write(contentsOf: buffer)
            throw EFBError.networkUnavailable
        }
        guard received == file.bytes else { throw EFBError.chartDownloadFailed(region) }
    }

    // MARK: Helpers

    nonisolated static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    nonisolated static func regionName(_ product: String) -> String {
        product == IsraelChartConfig.product ? "Israel CVFR" : "Israel \(product)"
    }
}
