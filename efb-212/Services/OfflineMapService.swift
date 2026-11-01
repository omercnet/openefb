//
//  OfflineMapService.swift
//  efb-212
//
//  Offline base maps (design finding F6, beads efb-zfm.5).
//
//  Downloads MapLibre offline packs (`MLNOfflineStorage` / `MLNTilePyramidOfflineRegion`)
//  for a region of the bundled base style, one pack per tile layer, so the moving map still
//  has the FAA sectional and the street base in the air. MapLibre serves the main map's tile
//  requests from the same offline database, so a downloaded pack is used automatically by
//  base-style.json without any change to the live style: the pack styles below reuse the
//  exact source URLs from base-style.json.
//
//  Pure model / math types are `nonisolated` so they can be unit tested without the map.
//

import Foundation
import CoreLocation
import MapLibre
import Observation

// MARK: - Bounds

/// Geographic box in degrees. `west` <= `east`; no antimeridian handling (CONUS only).
nonisolated struct OfflineRegionBounds: Codable, Equatable, Sendable {
    let south: Double   // degrees latitude
    let west: Double    // degrees longitude
    let north: Double   // degrees latitude
    let east: Double    // degrees longitude

    init(south: Double, west: Double, north: Double, east: Double) {
        self.south = min(south, north)
        self.north = max(south, north)
        self.west = min(west, east)
        self.east = max(west, east)
    }

    /// Box of `halfNM` nautical miles around a point.
    init(around center: CLLocationCoordinate2D, halfNM: Double) {
        let dLat = halfNM / 60.0                                           // 1 degree latitude = 60 NM
        let dLon = halfNM / (60.0 * max(cos(center.latitude * .pi / 180), 0.05))
        self.init(south: center.latitude - dLat, west: center.longitude - dLon,
                  north: center.latitude + dLat, east: center.longitude + dLon)
    }

    var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: (south + north) / 2, longitude: (west + east) / 2)
    }

    func contains(_ other: OfflineRegionBounds) -> Bool {
        other.south >= south && other.north <= north && other.west >= west && other.east <= east
    }

    func intersects(_ other: OfflineRegionBounds) -> Bool {
        !(other.east < west || other.west > east || other.north < south || other.south > north)
    }

    var mlnBounds: MLNCoordinateBounds {
        MLNCoordinateBounds(
            sw: CLLocationCoordinate2D(latitude: south, longitude: west),
            ne: CLLocationCoordinate2D(latitude: north, longitude: east)
        )
    }
}

// MARK: - Layers

/// One downloadable tile layer of base-style.json. Each becomes its own offline pack.
nonisolated enum OfflineLayer: String, CaseIterable, Codable, Sendable, Identifiable {
    case sectional   // FAA VFR sectional raster (public domain)
    case street      // OpenFreeMap vector tiles + Noto glyphs

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .sectional: return "VFR Sectional"
        case .street: return "Street"
        }
    }

    /// Zoom range downloaded. Sectional tiles only exist at z8-12; street z5-13 keeps
    /// the vector pack usable from CONUS overview down to airport detail.
    var zoomRange: ClosedRange<Int> {
        switch self {
        case .sectional: return 8...12
        case .street: return 5...13
        }
    }

    /// Plain-language detail level shown in place of raw zoom numbers.
    var detailDescription: String {
        switch self {
        case .sectional: return "Chart detail for planning and flying, regional view to airport view"
        case .street: return "Roads and towns, country overview down to street detail"
        }
    }

    // Satellite (Esri) and Terrain (OpenTopoMap) are not downloadable: their terms forbid
    // bulk/offline use (docs/TILE-SOURCES.md). They remain online base maps (efb-zfm.8).

    /// base-style.json source ids this layer needs.
    var styleSources: [String] {
        switch self {
        case .sectional: return ["vfr-sectional"]
        case .street: return ["openmaptiles"]
        }
    }

    /// Rough average tile size used for the pre-download estimate. Measured by hand against
    /// a few hundred tiles of each source over the SF Bay Area; actual sizes vary with terrain
    /// and city density.
    var averageTileBytes: Int {
        switch self {
        case .sectional: return 45_000
        case .street: return 60_000
        }
    }

    /// Only sectional packs age out with the FAA chart cycle.
    var expiresWithChartCycle: Bool { self == .sectional }
}

// MARK: - FAA sectional areas

/// A contiguous-US FAA sectional chart area with its approximate coverage box (degrees).
/// Boxes come from the FAA sectional index map; they overlap neighbours slightly, which is
/// what a pilot wants when flying near a chart edge.
nonisolated struct SectionalArea: Identifiable, Sendable, Equatable {
    let name: String
    let bounds: OfflineRegionBounds
    var id: String { name }

    static let contiguousUS: [SectionalArea] = [
        .init(name: "Seattle",          bounds: .init(south: 44, west: -125, north: 49, east: -117)),
        .init(name: "Great Falls",      bounds: .init(south: 44, west: -117, north: 49, east: -109)),
        .init(name: "Billings",         bounds: .init(south: 44, west: -109, north: 49, east: -101)),
        .init(name: "Twin Cities",      bounds: .init(south: 44, west: -101, north: 49, east: -93)),
        .init(name: "Green Bay",        bounds: .init(south: 44, west: -93,  north: 48, east: -85)),
        .init(name: "Lake Huron",       bounds: .init(south: 44, west: -85,  north: 48, east: -77)),
        .init(name: "Montreal",         bounds: .init(south: 44, west: -77,  north: 48, east: -69)),
        .init(name: "Halifax",          bounds: .init(south: 44, west: -69,  north: 48, east: -61)),
        .init(name: "Klamath Falls",    bounds: .init(south: 40, west: -125, north: 44, east: -117)),
        .init(name: "Salt Lake City",   bounds: .init(south: 40, west: -117, north: 44, east: -109)),
        .init(name: "Cheyenne",         bounds: .init(south: 40, west: -109, north: 44, east: -101)),
        .init(name: "Omaha",            bounds: .init(south: 40, west: -101, north: 44, east: -93)),
        .init(name: "Chicago",          bounds: .init(south: 40, west: -93,  north: 44, east: -85)),
        .init(name: "Detroit",          bounds: .init(south: 40, west: -85,  north: 44, east: -77)),
        .init(name: "New York",         bounds: .init(south: 40, west: -77,  north: 44, east: -69)),
        .init(name: "San Francisco",    bounds: .init(south: 36, west: -125, north: 40, east: -118)),
        .init(name: "Las Vegas",        bounds: .init(south: 35.75, west: -118, north: 40, east: -111)),
        .init(name: "Denver",           bounds: .init(south: 35.75, west: -111, north: 40, east: -104)),
        .init(name: "Wichita",          bounds: .init(south: 36, west: -104, north: 40, east: -97)),
        .init(name: "Kansas City",      bounds: .init(south: 36, west: -97,  north: 40, east: -90)),
        .init(name: "Cincinnati",       bounds: .init(south: 36, west: -90,  north: 40, east: -83)),
        .init(name: "Washington",       bounds: .init(south: 36, west: -83,  north: 40, east: -77)),
        .init(name: "Los Angeles",      bounds: .init(south: 32, west: -121.5, north: 36, east: -115)),
        .init(name: "Phoenix",          bounds: .init(south: 31.25, west: -115, north: 35.75, east: -109)),
        .init(name: "Albuquerque",      bounds: .init(south: 32, west: -109, north: 36, east: -102)),
        .init(name: "Dallas-Ft Worth",  bounds: .init(south: 32, west: -102, north: 36, east: -95)),
        .init(name: "Memphis",          bounds: .init(south: 32, west: -95,  north: 36, east: -88)),
        .init(name: "Atlanta",          bounds: .init(south: 32, west: -88,  north: 36, east: -81)),
        .init(name: "Charlotte",        bounds: .init(south: 32, west: -81,  north: 36, east: -75)),
        .init(name: "El Paso",          bounds: .init(south: 28, west: -109, north: 32, east: -103)),
        .init(name: "San Antonio",      bounds: .init(south: 28, west: -103, north: 32, east: -97)),
        .init(name: "Houston",          bounds: .init(south: 28, west: -97,  north: 32, east: -91)),
        .init(name: "New Orleans",      bounds: .init(south: 28, west: -91,  north: 32, east: -85)),
        .init(name: "Jacksonville",     bounds: .init(south: 28, west: -85,  north: 32, east: -79)),
        .init(name: "Brownsville",      bounds: .init(south: 24, west: -103, north: 28, east: -97)),
        .init(name: "Miami",            bounds: .init(south: 24, west: -83,  north: 28, east: -79)),
    ]
}

// MARK: - Sectional chart cycle

/// FAA VFR sectional charts are published on a 56-day cycle. Dates verified against the FAA
/// "Dates of Latest Editions" page on 2026-10-31: current edition 29 Oct 2026, next 24 Dec 2026.
/// Editions become effective at 0901 UTC on the cycle date.
nonisolated enum SectionalCycle {

    struct Cycle: Equatable, Sendable {
        let effective: Date
        let expires: Date      // = the next cycle's effective date
    }

    static let lengthDays = 56

    /// 2026-10-29 09:01 UTC.
    static let anchor: Date = {
        var components = DateComponents()
        components.year = 2026; components.month = 10; components.day = 29
        components.hour = 9; components.minute = 1
        components.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: components) ?? Date(timeIntervalSince1970: 1_793_264_460)
    }()

    private static let cycleSeconds: TimeInterval = TimeInterval(lengthDays) * 86_400

    /// Cycle in force at `date`.
    static func current(at date: Date = Date()) -> Cycle {
        let elapsed = date.timeIntervalSince(anchor)
        let index = floor(elapsed / cycleSeconds)
        let effective = anchor.addingTimeInterval(index * cycleSeconds)
        return Cycle(effective: effective, expires: effective.addingTimeInterval(cycleSeconds))
    }

    /// True when a chart effective on `chartEffective` is still the current edition at `date`.
    static func isCurrent(chartEffective: Date, at date: Date = Date()) -> Bool {
        chartEffective >= current(at: date).effective
    }

    /// Whole days until the current cycle expires (negative never happens: the next cycle
    /// takes over). Used by the existing chart-expiration badge.
    static func daysRemaining(at date: Date = Date()) -> Int {
        Int(floor(current(at: date).expires.timeIntervalSince(date) / 86_400))
    }
}

// MARK: - Tile math

/// Slippy-map tile counting for the pre-download estimate.
nonisolated enum OfflineTileMath {

    /// Number of tiles that cover `bounds` at every zoom in `zooms`.
    static func tileCount(bounds: OfflineRegionBounds, zooms: ClosedRange<Int>) -> Int {
        var total = 0
        for z in zooms {
            let n = Double(1 << z)
            let xMin = Int(floor((bounds.west + 180) / 360 * n))
            let xMax = Int(floor((bounds.east + 180) / 360 * n))
            let yMin = tileY(latitude: bounds.north, n: n)
            let yMax = tileY(latitude: bounds.south, n: n)
            total += (xMax - xMin + 1) * (yMax - yMin + 1)
        }
        return total
    }

    static func estimatedBytes(bounds: OfflineRegionBounds, layer: OfflineLayer) -> Int {
        tileCount(bounds: bounds, zooms: layer.zoomRange) * layer.averageTileBytes
    }

    static func estimatedBytes(bounds: OfflineRegionBounds, layers: [OfflineLayer]) -> Int {
        layers.reduce(0) { $0 + estimatedBytes(bounds: bounds, layer: $1) }
    }

    private static func tileY(latitude: Double, n: Double) -> Int {
        let clamped = min(max(latitude, -85.0511), 85.0511)
        let rad = clamped * .pi / 180
        let y = (1 - log(tan(rad) + 1 / cos(rad)) / .pi) / 2 * n
        return Int(min(max(floor(y), 0), n - 1))
    }
}

// MARK: - Pack model

/// Metadata stored in each `MLNOfflinePack.context`.
nonisolated struct OfflinePackContext: Codable, Sendable, Equatable {
    let id: UUID
    let name: String
    let layer: OfflineLayer
    let bounds: OfflineRegionBounds
    /// Sectional edition the tiles were fetched under; nil for layers without a cycle.
    let cycleEffective: Date?
    let createdAt: Date
}

nonisolated enum OfflinePackState: Sendable, Equatable {
    case downloading
    case paused
    case complete
    case failed(String)
}

/// Snapshot of one pack for the UI and the status resolver. Built from `MLNOfflinePack`
/// in production and by hand in tests.
nonisolated struct OfflinePackSummary: Identifiable, Sendable, Equatable {
    let context: OfflinePackContext
    let state: OfflinePackState
    let completedResources: Int
    let expectedResources: Int
    let completedBytes: Int

    var id: UUID { context.id }

    /// 0...1
    var fraction: Double {
        guard expectedResources > 0 else { return state == .complete ? 1 : 0 }
        return min(1, Double(completedResources) / Double(expectedResources))
    }

    /// Sectional packs fetched before the current cycle's effective date are expired.
    func isExpired(at date: Date = Date()) -> Bool {
        guard context.layer.expiresWithChartCycle, let effective = context.cycleEffective else { return false }
        return !SectionalCycle.isCurrent(chartEffective: effective, at: date)
    }
}

// MARK: - Status

/// Offline readiness of the visible map for one layer.
nonisolated enum OfflineStatus: Sendable, Equatable {
    case ready            // a complete, current pack covers the whole visible region
    case partial          // packs cover part of it, or a covering pack is still downloading
    case notDownloaded
    case expired          // the only covering pack is from a past sectional cycle

    var label: String {
        switch self {
        case .ready: return "Offline: ready"
        case .partial: return "Offline: partial"
        case .notDownloaded: return "Offline: not downloaded"
        case .expired: return "Offline: expired"
        }
    }
}

nonisolated enum OfflineStatusResolver {

    /// Layers the map draws for a base style. VFR = sectional over the street base.
    static func layers(for style: MapStyle) -> [OfflineLayer] {
        switch style {
        case .vfrSectional: return [.sectional, .street]
        case .street: return [.street]
        // Satellite and Terrain are online-only base maps: their tile providers forbid bulk download.
        case .satellite, .terrain: return []
        }
    }

    /// Status of `visible` for a single layer. Coverage is judged per pack (a region inside
    /// one pack's box is ready); two packs that only together cover the view read as partial.
    static func status(
        visible: OfflineRegionBounds,
        layer: OfflineLayer,
        packs: [OfflinePackSummary],
        at date: Date = Date()
    ) -> OfflineStatus {
        let relevant = packs.filter { $0.context.layer == layer && $0.context.bounds.intersects(visible) }
        guard !relevant.isEmpty else { return .notDownloaded }

        let current = relevant.filter { !$0.isExpired(at: date) }
        if current.contains(where: { $0.state == .complete && $0.context.bounds.contains(visible) }) {
            return .ready
        }
        if current.isEmpty {
            return .expired
        }
        return .partial
    }

    /// Status for the whole base style: the worst layer wins (ready < partial < expired < none).
    static func status(
        visible: OfflineRegionBounds,
        style: MapStyle,
        packs: [OfflinePackSummary],
        at date: Date = Date()
    ) -> OfflineStatus {
        let styleLayers = layers(for: style)
        // No offline pack can exist for an online-only base map: never read as ready.
        guard !styleLayers.isEmpty else { return .notDownloaded }
        let statuses = styleLayers.map { status(visible: visible, layer: $0, packs: packs, at: date) }
        if statuses.contains(.notDownloaded) { return .notDownloaded }
        if statuses.contains(.expired) { return .expired }
        if statuses.contains(.partial) { return .partial }
        return .ready
    }
}

// MARK: - Per-layer style documents

/// Builds a style document containing only one layer's sources, so an offline pack fetches
/// just that layer's tiles. Source definitions are copied verbatim from base-style.json so the
/// tile URLs match what the live map requests.
nonisolated enum OfflinePackStyle {

    static func styleData(for layer: OfflineLayer, base: Data) throws -> Data {
        guard var style = try JSONSerialization.jsonObject(with: base) as? [String: Any],
              let sources = style["sources"] as? [String: Any],
              let layers = style["layers"] as? [[String: Any]] else {
            throw EFBError.chartCorrupted("base-style.json")
        }
        let wanted = Set(layer.styleSources)
        style["sources"] = sources.filter { wanted.contains($0.key) }
        style["layers"] = layers.filter { entry in
            guard let source = entry["source"] as? String else { return false }
            return wanted.contains(source)
        }
        if layer != .street {
            style.removeValue(forKey: "glyphs")  // no symbol layers: no font downloads
        }
        style["name"] = "OpenEFB offline \(layer.rawValue)"
        return try JSONSerialization.data(withJSONObject: style, options: [.sortedKeys])
    }
}

// MARK: - Protocol

@MainActor
protocol OfflineMapServiceProtocol: AnyObject {
    var packs: [OfflinePackSummary] { get }
    var storageUsedBytes: Int { get }
    func download(name: String, bounds: OfflineRegionBounds, layers: [OfflineLayer]) throws
    func pause(_ pack: OfflinePackSummary)
    func resume(_ pack: OfflinePackSummary)
    func delete(_ pack: OfflinePackSummary)
    func status(visible: OfflineRegionBounds, style: MapStyle) -> OfflineStatus
}

// MARK: - Service

/// Wraps `MLNOfflineStorage`. Main-actor because MapLibre posts its pack notifications there
/// and the SwiftUI views observe `packs` directly.
@Observable
@MainActor
final class OfflineMapService: OfflineMapServiceProtocol {

    /// One instance for the app: Settings and the layer panel both observe it, and
    /// `MLNOfflineStorage.shared` is itself a singleton.
    static let shared = OfflineMapService()

    private(set) var packs: [OfflinePackSummary] = []
    private(set) var storageUsedBytes: Int = 0
    private(set) var lastError: EFBError?

    private let storage = MLNOfflineStorage.shared
    private var mlnPacks: [UUID: MLNOfflinePack] = [:]
    private var packsObservation: NSKeyValueObservation?
    private var notificationTokens: [NSObjectProtocol] = []

    init() {
        let center = NotificationCenter.default
        for name in [Notification.Name.MLNOfflinePackProgressChanged, .MLNOfflinePackError,
                     .MLNOfflinePackMaximumMapboxTilesReached] {
            notificationTokens.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                // MapLibre posts these on `queue: .main`, so `note` never leaves the main thread.
                nonisolated(unsafe) let note = note
                MainActor.assumeIsolated {
                    self?.handle(note)
                }
            })
        }
        // `packs` is nil until MapLibre finishes loading the database; KVO fires when it does.
        packsObservation = storage.observe(\.packs, options: [.initial, .new]) { [weak self] _, _ in
            Task { @MainActor [weak self] in self?.refresh() }
        }
        // Unlimited tile count: the user chose the region and sees the size estimate.
        storage.setMaximumAllowedMapboxTiles(UInt64.max)
    }

    // MARK: Downloads

    func download(name: String, bounds: OfflineRegionBounds, layers: [OfflineLayer]) throws {
        let cycle = SectionalCycle.current()
        for layer in layers {
            let styleURL = try packStyleURL(for: layer)
            let region = MLNTilePyramidOfflineRegion(
                styleURL: styleURL,
                bounds: bounds.mlnBounds,
                fromZoomLevel: Double(layer.zoomRange.lowerBound),
                toZoomLevel: Double(layer.zoomRange.upperBound)
            )
            let context = OfflinePackContext(
                id: UUID(), name: name, layer: layer, bounds: bounds,
                cycleEffective: layer.expiresWithChartCycle ? cycle.effective : nil,
                createdAt: Date()
            )
            let contextData = try JSONEncoder().encode(context)
            storage.addPack(for: region, withContext: contextData) { [weak self] pack, error in
                // MapLibre invokes this completion on the main queue; `pack` is only used there.
                nonisolated(unsafe) let pack = pack
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if let error {
                        self.lastError = .chartDownloadFailed("\(name): \(error.localizedDescription)")
                        return
                    }
                    pack?.resume()
                    self.refresh()
                }
            }
        }
    }

    func pause(_ pack: OfflinePackSummary) {
        mlnPacks[pack.id]?.suspend()
        refresh()
    }

    func resume(_ pack: OfflinePackSummary) {
        mlnPacks[pack.id]?.resume()
        refresh()
    }

    func delete(_ pack: OfflinePackSummary) {
        guard let mln = mlnPacks[pack.id] else { return }
        mlnPacks[pack.id] = nil
        packs.removeAll { $0.id == pack.id }
        storage.removePack(mln) { [weak self] error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let error {
                    self.lastError = .chartDownloadFailed("Delete failed: \(error.localizedDescription)")
                }
                self.refresh()
            }
        }
    }

    /// Delete the expired pack and download the same region again under the current cycle.
    func redownload(_ pack: OfflinePackSummary) throws {
        delete(pack)
        try download(name: pack.context.name, bounds: pack.context.bounds, layers: [pack.context.layer])
    }

    func status(visible: OfflineRegionBounds, style: MapStyle) -> OfflineStatus {
        OfflineStatusResolver.status(visible: visible, style: style, packs: packs)
    }

    // MARK: Internals

    private func handle(_ note: Notification) {
        if note.name == .MLNOfflinePackError,
           let error = note.userInfo?[MLNOfflinePackUserInfoKey.error] as? Error,
           let pack = note.object as? MLNOfflinePack,
           let context = Self.decodeContext(pack.context) {
            lastError = .chartDownloadFailed("\(context.name) (\(context.layer.displayName)): \(error.localizedDescription)")
        }
        refresh()
    }

    /// Rebuild `packs` from MapLibre's pack list.
    func refresh() {
        guard let list = storage.packs else { return }
        var summaries: [OfflinePackSummary] = []
        var byID: [UUID: MLNOfflinePack] = [:]
        for pack in list {
            guard let context = Self.decodeContext(pack.context) else { continue }
            byID[context.id] = pack
            let progress = pack.progress
            let state: OfflinePackState
            switch pack.state {
            case .complete: state = .complete
            case .active: state = .downloading
            case .inactive, .unknown: state = .paused
            case .invalid: state = .failed("Removed")
            @unknown default: state = .paused
            }
            summaries.append(OfflinePackSummary(
                context: context,
                state: state,
                completedResources: Int(progress.countOfResourcesCompleted),
                expectedResources: Int(progress.countOfResourcesExpected),
                completedBytes: Int(progress.countOfBytesCompleted)
            ))
        }
        mlnPacks = byID
        packs = summaries.sorted { $0.context.createdAt > $1.context.createdAt }
        storageUsedBytes = Int(storage.countOfBytesCompleted)
    }

    nonisolated private static func decodeContext(_ data: Data) -> OfflinePackContext? {
        try? JSONDecoder().decode(OfflinePackContext.self, from: data)
    }

    /// Per-layer style document written next to the offline database; regenerated from the
    /// bundled base style each launch so a style change in an app update is picked up.
    private var writtenStyleURLs: [OfflineLayer: URL] = [:]

    private func packStyleURL(for layer: OfflineLayer) throws -> URL {
        if let url = writtenStyleURLs[layer] { return url }
        guard let baseURL = MapService.baseStyleURL, let base = try? Data(contentsOf: baseURL) else {
            throw EFBError.chartCorrupted("base-style.json missing from bundle")
        }
        let data = try OfflinePackStyle.styleData(for: layer, base: base)
        let dir = storage.databaseURL.deletingLastPathComponent().appendingPathComponent("offline-styles", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("\(layer.rawValue).json")
        try data.write(to: url, options: .atomic)
        writtenStyleURLs[layer] = url
        return url
    }
}

// MARK: - Formatting

nonisolated enum OfflineSizeFormatter {
    static func string(bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

#if DEBUG
// MARK: - Offline verification (debug builds only)

/// Launch with `-offlineBlockNetwork YES` to make every MapLibre network request fail, so a UI
/// test can show the map renders from downloaded packs alone (the simulator has no airplane mode).
nonisolated final class OfflineBlockingURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }
    override func stopLoading() {}

    @MainActor
    static func installIfRequested() {
        guard UserDefaults.standard.bool(forKey: "offlineBlockNetwork") else { return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OfflineBlockingURLProtocol.self]
        MLNNetworkConfiguration.sharedManager.sessionConfiguration = configuration
    }
}
#endif
