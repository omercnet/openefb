//
//  IsraelChartServiceTests.swift
//  efb-212Tests
//
//  IL-9: hosted CAAI CVFR chart pack. Manifest decoding, checksum verification, the published/validated
//  rule, resume, edition-update detection and the fallback state.
//

import Testing
import Foundation
import CryptoKit
@testable import efb_212

@Suite("Israel chart pack service")
struct IsraelChartServiceTests {

    // MARK: Fixtures

    private static func sha(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static let packBytes = Data((0..<4000).map { UInt8(truncatingIfNeeded: $0 &* 31 &+ 7) })

    private static func manifestJSON(edition: String = "2025-02", published: Bool = true, validated: Bool = true,
                                     sha256: String? = nil, bytes: Int? = nil) -> String {
        """
        {"product":"israel-cvfr","edition":"\(edition)","edition_label":"Update 2/25 (October 2025)",
         "published":\(published),"publishedAt":"2026-11-02T08:00:00Z","validated_at":"2026-11-01T12:00:00Z",
         "validation":{"passed":\(validated),"median_m":56.0,"p95_m":187.0,"max_m":329.0,"failures":[]},
         "bounds":[34.2,29.4,36.0,33.4],"min_zoom":7,"max_zoom":12,"size_bytes":\(bytes ?? packBytes.count),
         "files":[{"name":"israel-cvfr-\(edition).mbtiles","bytes":\(bytes ?? packBytes.count),
                   "sha256":"\(sha256 ?? sha(packBytes))","path":"israel-cvfr/\(edition)/israel-cvfr-\(edition).mbtiles"}]}
        """
    }

    private static func indexJSON(latest: String?, editions: [(String, Bool)]) -> String {
        let latestText = latest.map { "\"\($0)\"" } ?? "null"
        let list = editions.map { "{\"edition\":\"\($0.0)\",\"published\":\($0.1),\"publishedAt\":null,\"validatedAt\":\"2026-11-01T12:00:00Z\"}" }
        return "{\"product\":\"israel-cvfr\",\"updatedAt\":\"2026-11-02T08:00:00Z\",\"latest\":\(latestText),\"editions\":[\(list.joined(separator: ","))]}"
    }

    private static func tempRoot() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("chart-pack-tests-\(UUID().uuidString)", isDirectory: true)
    }

    private static func decode(_ json: String) throws -> IsraelChartManifest {
        try JSONDecoder().decode(IsraelChartManifest.self, from: Data(json.utf8))
    }

    private static let base = URL(string: "https://charts.example.test")!

    /// Serves the index, edition manifests and the pack from a dictionary of URL path -> (status, body).
    private static func service(root: URL, routes: @escaping @Sendable (URLRequest) -> (Int, Data)) -> ChartPackService {
        let session = StubURLProtocol.session { routes($0) }
        return ChartPackService(product: "israel-cvfr", baseURL: base, rootDirectory: root, session: session)
    }

    // MARK: Manifest decode

    @Test func decodesTheEditionManifestWrittenByThePipelineAndHost() throws {
        let manifest = try Self.decode(Self.manifestJSON())
        #expect(manifest.edition == "2025-02")
        #expect(manifest.label == "Update 2/25 (October 2025)")
        #expect(manifest.published)
        #expect(manifest.validation?.passed == true)
        #expect(manifest.validation?.p95M == 187.0)
        #expect(manifest.bounds == [34.2, 29.4, 36.0, 33.4])
        #expect(manifest.minZoom == 7 && manifest.maxZoom == 12)
        #expect(manifest.pack?.name == "israel-cvfr-2025-02.mbtiles")
        #expect(manifest.totalBytes == Self.packBytes.count)
    }

    @Test func decodesTheProductIndexAndAManifestWithoutChartFields() throws {
        let index = try JSONDecoder().decode(IsraelChartIndex.self, from: Data(Self.indexJSON(latest: "2025-02", editions: [("2025-02", true)]).utf8))
        #expect(index.latest == "2025-02")
        #expect(index.editions.first?.published == true)
        // Another product (diagrams) has no bounds, zooms or label.
        let bare = #"{"product":"il-diagrams","edition":"2026-11","published":true,"validation":{"passed":true},"files":[{"name":"a.png","bytes":1,"sha256":"00"}]}"#
        let manifest = try Self.decode(bare)
        #expect(manifest.bounds == nil && manifest.minZoom == nil)
        #expect(manifest.label == "2026-11")
        #expect(manifest.isServable(allowUnpublished: false))
    }

    // MARK: Published / validated rule

    @Test func unpublishedOrUnvalidatedEditionsAreNeverServedToPilots() throws {
        #expect(try Self.decode(Self.manifestJSON(published: false)).isServable(allowUnpublished: false) == false)
        #expect(try Self.decode(Self.manifestJSON(validated: false)).isServable(allowUnpublished: false) == false)
        #expect(try Self.decode(Self.manifestJSON(published: false, validated: false)).isServable(allowUnpublished: true))
    }

    @Test func latestServableIgnoresAnUnpublishedEdition() async throws {
        let index = Self.indexJSON(latest: nil, editions: [("2025-02", false)])
        let manifest = Self.manifestJSON(published: false)
        let service = Self.service(root: Self.tempRoot()) { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/israel-cvfr/manifest.json") { return (200, Data(index.utf8)) }
            if path.hasSuffix("/israel-cvfr/2025-02/manifest.json") { return (200, Data(manifest.utf8)) }
            return (404, Data())
        }
        #expect(try await service.latestServable(allowUnpublished: false) == nil)
        #expect(try await service.latestServable(allowUnpublished: true)?.edition == "2025-02")
    }

    @Test func publishedButFailedValidationIsIgnored() async throws {
        let index = Self.indexJSON(latest: "2025-02", editions: [("2025-02", true)])
        let manifest = Self.manifestJSON(published: true, validated: false)
        let service = Self.service(root: Self.tempRoot()) { request in
            let path = request.url?.path ?? ""
            if path.hasSuffix("/israel-cvfr/manifest.json") { return (200, Data(index.utf8)) }
            return (200, Data(manifest.utf8))
        }
        #expect(try await service.latestServable(allowUnpublished: false) == nil)
    }

    // MARK: Download, checksum, resume

    @Test func downloadInstallsAVerifiedPack() async throws {
        let root = Self.tempRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let manifest = try Self.decode(Self.manifestJSON())
        let service = Self.service(root: root) { request in
            #expect(request.url?.path == "/israel-cvfr/2025-02/israel-cvfr-2025-02.mbtiles")
            return (200, Self.packBytes)
        }
        let record = try await service.download(manifest) { _ in }
        #expect(record.edition == "2025-02")
        let url = try #require(service.fileURL("israel-cvfr-2025-02.mbtiles"))
        #expect(try Data(contentsOf: url) == Self.packBytes)
        #expect(service.installed()?.editionLabel == "Update 2/25 (October 2025)")
    }

    @Test func checksumMismatchIsRejectedAndNothingIsInstalled() async throws {
        let root = Self.tempRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let wrong = String(repeating: "0", count: 64)
        let manifest = try Self.decode(Self.manifestJSON(sha256: wrong))
        let service = Self.service(root: root) { _ in (200, Self.packBytes) }
        await #expect(throws: EFBError.self) {
            _ = try await service.download(manifest) { _ in }
        }
        #expect(service.installed() == nil)
        #expect(service.fileURL("israel-cvfr-2025-02.mbtiles") == nil)
    }

    @Test func aShortDownloadIsNotInstalled() async throws {
        let root = Self.tempRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let manifest = try Self.decode(Self.manifestJSON())
        let service = Self.service(root: root) { _ in (200, Self.packBytes.prefix(1000)) }
        await #expect(throws: EFBError.self) {
            _ = try await service.download(manifest) { _ in }
        }
        #expect(service.installed() == nil)
    }

    @Test func downloadResumesFromAPartialFileWithARangeRequest() async throws {
        let root = Self.tempRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let partial = root.appendingPathComponent("israel-cvfr/.partial-2025-02", isDirectory: true)
        try FileManager.default.createDirectory(at: partial, withIntermediateDirectories: true)
        try Self.packBytes.prefix(1500).write(to: partial.appendingPathComponent("israel-cvfr-2025-02.mbtiles"))

        let manifest = try Self.decode(Self.manifestJSON())
        let seenRange = LockedBox<String?>(nil)
        let service = Self.service(root: root) { request in
            seenRange.set(request.value(forHTTPHeaderField: "Range"))
            return (206, Data(Self.packBytes.dropFirst(1500)))
        }
        _ = try await service.download(manifest) { _ in }
        #expect(seenRange.get() == "bytes=1500-")
        let url = try #require(service.fileURL("israel-cvfr-2025-02.mbtiles"))
        #expect(try Data(contentsOf: url) == Self.packBytes)
    }

    @Test func installingANewEditionRemovesTheOldOne() async throws {
        let root = Self.tempRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        for edition in ["2025-02", "2026-01"] {
            let manifest = try Self.decode(Self.manifestJSON(edition: edition))
            let service = Self.service(root: root) { _ in (200, Self.packBytes) }
            _ = try await service.download(manifest) { _ in }
        }
        let contents = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("israel-cvfr").path).sorted()
        #expect(contents == ["2026-01", "installed.json"])
    }

    // MARK: Edition status and fallback

    private func installed(_ edition: String) -> ChartPackInstalled {
        ChartPackInstalled(product: "israel-cvfr", edition: edition, editionLabel: "Update \(edition)",
                           files: [.init(name: "x.mbtiles", bytes: 1, sha256: "00")], installedAt: Date())
    }

    @Test func nothingInstalledFallsBackToTheStreetBaseWithAnHonestBadge() throws {
        let status = IsraelChartStatus.resolve(installed: nil, latest: try Self.decode(Self.manifestJSON()))
        #expect(status == .notDownloaded)
        #expect(status.isPresent == false)
        #expect(status.badgeText == "Official chart not downloaded")
    }

    @Test func aNewerServableEditionIsReportedAsAnUpdate() throws {
        let newer = try Self.decode(Self.manifestJSON(edition: "2025-10"))
        let status = IsraelChartStatus.resolve(installed: installed("2025-02"), latest: newer)
        guard case .updateAvailable(let have, _, let latest, _) = status else {
            Issue.record("expected updateAvailable, got \(status)")
            return
        }
        #expect(have == "2025-02" && latest == "2025-10")  // numeric compare: 10 > 02
        #expect(status.isPresent)
    }

    @Test func theSameOrAnOlderEditionIsNotAnUpdate() throws {
        let same = try Self.decode(Self.manifestJSON(edition: "2025-02"))
        #expect(IsraelChartStatus.resolve(installed: installed("2025-02"), latest: same) == .installed(edition: "2025-02", label: "Update 2025-02"))
        let older = try Self.decode(Self.manifestJSON(edition: "2025-01"))
        #expect(IsraelChartStatus.resolve(installed: installed("2025-02"), latest: older) == .installed(edition: "2025-02", label: "Update 2025-02"))
        #expect(IsraelChartStatus.resolve(installed: installed("2025-02"), latest: nil) == .installed(edition: "2025-02", label: "Update 2025-02"))
    }
}

/// Thread-safe capture for stub handlers, which run off the test's task.
private final class LockedBox<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: T
    init(_ value: T) { self.value = value }
    func set(_ new: T) { lock.withLock { value = new } }
    func get() -> T { lock.withLock { value } }
}
