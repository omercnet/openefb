//
//  IsraelChartManifest.swift
//  efb-212
//
//  Wire models for the official CAAI CVFR chart pack that we convert, validate and host ourselves (IL-9).
//  Hosting layout (Cloudflare R2, written by web/charts/publish.sh):
//    <base>/israel-cvfr/manifest.json            product index: latest published edition + all editions
//    <base>/israel-cvfr/<edition>/manifest.json  edition manifest: pipeline fields + published + files[]
//    <base>/israel-cvfr/<edition>/<file>         the MBTiles pack
//  The chart is © CAAI, base map © Mapa Ltd.
//

import Foundation

/// Product index the app polls.
nonisolated struct IsraelChartIndex: Codable, Equatable, Sendable {
    struct Entry: Codable, Equatable, Sendable {
        let edition: String
        let published: Bool
        let publishedAt: String?
        let validatedAt: String?
    }

    let product: String
    let updatedAt: String?
    /// Newest published edition id, nil when nothing is published.
    let latest: String?
    let editions: [Entry]
}

/// One edition's manifest: the pipeline's fields plus the hosting fields.
nonisolated struct IsraelChartManifest: Codable, Equatable, Sendable {
    struct File: Codable, Equatable, Sendable {
        let name: String
        let bytes: Int          // bytes
        let sha256: String      // lowercase hex
        let path: String?       // relative to the public base, e.g. "israel-cvfr/2025-02/<name>"
        let url: String?        // absolute URL when the host supplies one
    }

    struct Validation: Codable, Equatable, Sendable {
        let passed: Bool
        let medianM: Double?    // metres
        let p95M: Double?       // metres
        let maxM: Double?       // metres

        enum CodingKeys: String, CodingKey {
            case passed
            case medianM = "median_m"
            case p95M = "p95_m"
            case maxM = "max_m"
        }
    }

    let product: String
    let edition: String             // file-safe id, e.g. "2025-02"
    let editionLabel: String?       // as printed on the sheet, e.g. "Update 2/25 (October 2025)"
    let published: Bool
    let publishedAt: String?
    let validatedAt: String?
    let validation: Validation?
    let bounds: [Double]?           // west, south, east, north in degrees; chart packs only
    let minZoom: Int?
    let maxZoom: Int?
    let files: [File]

    enum CodingKeys: String, CodingKey {
        case product, edition, published, publishedAt, validation, bounds, files
        case editionLabel = "edition_label"
        case validatedAt = "validated_at"
        case minZoom = "min_zoom"
        case maxZoom = "max_zoom"
    }

    /// The MBTiles file of a chart pack.
    var pack: File? { files.first { $0.name.hasSuffix(".mbtiles") } }

    /// Human label, falling back to the edition id.
    var label: String { editionLabel ?? edition }

    /// Pilots only ever get a published edition whose validation gate passed; a developer setting
    /// can override that to try a build before it is approved.
    func isServable(allowUnpublished: Bool) -> Bool {
        guard !files.isEmpty else { return false }
        if allowUnpublished { return true }
        return published && validation?.passed == true
    }

    /// Download size of all files.
    var totalBytes: Int { files.reduce(0) { $0 + $1.bytes } }
}

/// What is on the device for one product.
nonisolated struct ChartPackInstalled: Codable, Equatable, Sendable {
    struct File: Codable, Equatable, Sendable {
        let name: String
        let bytes: Int          // bytes
        let sha256: String
    }

    let product: String
    let edition: String
    let editionLabel: String
    let files: [File]
    let installedAt: Date

    var totalBytes: Int { files.reduce(0) { $0 + $1.bytes } }
}

/// What the chart badge and the download row show.
nonisolated enum IsraelChartStatus: Equatable, Sendable {
    /// No pack on the device: the street base is shown.
    case notDownloaded
    case installed(edition: String, label: String)
    case updateAvailable(installedEdition: String, installedLabel: String, latestEdition: String, latestLabel: String)

    /// Official pack present, so the base chart can be drawn from it.
    var isPresent: Bool {
        if case .notDownloaded = self { return false }
        return true
    }

    /// Resolve from what is installed and the latest servable edition (nil when offline or none).
    static func resolve(installed: ChartPackInstalled?, latest: IsraelChartManifest?) -> IsraelChartStatus {
        guard let installed else { return .notDownloaded }
        if let latest, latest.edition != installed.edition, Self.isNewer(latest.edition, than: installed.edition) {
            return .updateAvailable(installedEdition: installed.edition, installedLabel: installed.editionLabel,
                                    latestEdition: latest.edition, latestLabel: latest.label)
        }
        return .installed(edition: installed.edition, label: installed.editionLabel)
    }

    /// Edition ids sort as year then amendment ("2025-02" < "2026-01"); numeric-aware compare.
    static func isNewer(_ a: String, than b: String) -> Bool {
        a.compare(b, options: .numeric) == .orderedDescending
    }

    /// Badge copy. Never implies currency the app cannot prove.
    var badgeText: String {
        switch self {
        case .notDownloaded: return "Official chart not downloaded"
        case .installed(_, let label): return "CAAI CVFR (official) \(label)"
        case .updateAvailable(_, let label, _, _): return "CAAI CVFR (official) \(label), newer edition available"
        }
    }
}
