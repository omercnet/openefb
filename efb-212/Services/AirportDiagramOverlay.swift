//
//  AirportDiagramOverlay.swift
//  efb-212
//
//  Draws validated FAA airport diagrams (d-TPP APD PDFs) on the moving map, anchored at their real
//  position and aligned to true north, so the pilot can follow ownship along the taxiways.
//
//  Flow: when the map is zoomed to `minimumZoom` or closer, the airports in view are looked up; for
//  each (nearest first, at most `maximumAirports`) the APD PDF comes from TerminalProcedureService,
//  AirportDiagramGeoreferencer fits and validates a page-to-ground transform off the main actor, the
//  page is rendered to a transparent PNG, and an MLNImageSource + MLNRasterStyleLayer is inserted
//  below the airport and ownship layers. Fits and rejections are cached per chart cycle under
//  Application Support/efb-212/dtpp/{cycle}/georef/ so this works offline after the first load.
//
//  Diagrams that fail validation are never drawn: a wrong overlay is worse than none. The overlay is
//  advisory; the layer toggle says so.
//

import UIKit
import MapLibre
import os

@MainActor
@Observable
final class AirportDiagramOverlay {

    // MARK: - Configuration

    /// UserDefaults key for the layer toggle (default on).
    nonisolated static let enabledDefaultsKey = "showAirportDiagrams"
    /// Diagrams appear at this zoom and closer.
    nonisolated static let minimumZoom = 14.0
    /// Airports drawn at once, nearest to the map centre first.
    nonisolated static let maximumAirports = 3
    /// Rendered pixels per PDF point (3 px/pt is about 1 m/px at a typical 10 ft/pt chart scale).
    nonisolated static let renderScale: CGFloat = 3
    /// Raster opacity on the map.
    nonisolated static let opacity = 0.85
    /// Backing fill under the diagram quad: hides the sectional, which is upscaled past its native zoom 12
    /// into blurry blocks and would otherwise sit behind the black taxiway ink. Opacity by zoom: still
    /// translucent at 14 so the chart context stays visible, nearly solid once the pilot is taxiing.
    nonisolated static let backingOpacityByZoom: [Double: Double] = [14.0: 0.85, 15.0: 0.97]
    /// Day backing: paper white (the diagram ink is black).
    nonisolated static let dayBackingColor = UIColor(white: 1.0, alpha: 1)
    /// Night backing: near-black, no bright slab in the cockpit.
    nonisolated static let nightBackingColor = UIColor(white: 0.10, alpha: 1)
    /// Night ink: raster-brightness-min lifts the black ink to this luminance (the PNG background is
    /// transparent, so only the ink changes), giving a light-on-dark diagram capped below white.
    nonisolated static let nightInkBrightnessMin = 0.72
    nonisolated static let nightInkBrightnessMax = 0.82
    /// Bump when the georeferencing algorithm changes so cached fits are recomputed.
    nonisolated static let cacheVersion = 2
    /// Polling interval for camera changes (the map delegate belongs to the map view wrapper).
    nonisolated static let cameraPollInterval: TimeInterval = 0.75

    // MARK: - State

    /// Layer toggle, persisted. Diagrams are advisory: the pilot must verify against the charted diagram.
    var isEnabled: Bool {
        didSet {
            UserDefaults.standard.set(isEnabled, forKey: Self.enabledDefaultsKey)
            refresh(force: true)
        }
    }

    /// ICAO idents of the airports whose diagram is currently drawn (for tests and the layer panel).
    private(set) var shownAirports: [String] = []

    private weak var mapView: MLNMapView?
    private weak var style: MLNStyle?
    private var chartService: (any TerminalProcedureServiceProtocol)?
    private var databaseService: (any DatabaseServiceProtocol)?

    private struct Entry {
        let sourceID: String
        let layerID: String
        let backingSourceID: String
        let backingLayerID: String
        let georeference: AirportDiagramGeoreference
    }

    /// Night palette applied to drawn diagrams; set by `MapService.applyDisplayMode`.
    private(set) var isNight = false

    private var entries: [String: Entry] = [:]          // ICAO -> drawn diagram
    private var loading: Set<String> = []                // ICAO being fetched / fitted
    private var unavailable: Set<String> = []            // ICAO with no usable diagram this session
    private var pollTimer: Timer?
    private var lastCamera: (latitude: Double, longitude: Double, zoom: Double)?
    private let logger = Logger(subsystem: "quartermint.efb-212", category: "AirportDiagramOverlay")

    // MARK: - Init

    init() {
        let defaults = UserDefaults.standard
        isEnabled = defaults.object(forKey: Self.enabledDefaultsKey) == nil ? true : defaults.bool(forKey: Self.enabledDefaultsKey)
    }

    // MARK: - Attach

    /// Services arrive from MapContainerView once; the style arrives on every style load.
    func configure(chartService: any TerminalProcedureServiceProtocol, databaseService: any DatabaseServiceProtocol) {
        self.chartService = chartService
        self.databaseService = databaseService
        refresh(force: true)
    }

    /// Called from `MapService.onStyleLoaded`. A fresh style has no layers, so the drawn set is reset.
    func attach(style: MLNStyle, mapView: MLNMapView) {
        self.style = style
        self.mapView = mapView
        entries = [:]
        shownAirports = []
        lastCamera = nil
        pollTimer?.invalidate()
        pollTimer = Timer.scheduledTimer(withTimeInterval: Self.cameraPollInterval, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.pollCamera() }
        }
        refresh(force: true)
    }

    /// Re-evaluates on camera changes. Cheap: three property reads per tick.
    private func pollCamera() {
        guard let mapView else { return }
        let center = mapView.centerCoordinate
        let camera = (center.latitude, center.longitude, mapView.zoomLevel)
        if let last = lastCamera,
           abs(last.latitude - camera.0) < 1e-5, abs(last.longitude - camera.1) < 1e-5, abs(last.zoom - camera.2) < 0.01 {
            return
        }
        lastCamera = camera
        refresh(force: false)
    }

    // MARK: - Refresh

    /// Shows or hides diagrams for the current camera and starts loads for airports newly in view.
    func refresh(force: Bool) {
        guard let mapView, style != nil else { return }
        let zoomedIn = mapView.zoomLevel >= Self.minimumZoom - 0.5  // start loading slightly before 14
        let visible = isEnabled && mapView.zoomLevel >= Self.minimumZoom
        for entry in entries.values {
            style?.layer(withIdentifier: entry.layerID)?.isVisible = visible
            style?.layer(withIdentifier: entry.backingLayerID)?.isVisible = visible
        }
        guard isEnabled, zoomedIn, let databaseService else { return }

        let bounds = mapView.visibleCoordinateBounds
        let center = mapView.centerCoordinate
        let span = CLLocation(latitude: bounds.sw.latitude, longitude: bounds.sw.longitude)
            .distance(from: CLLocation(latitude: bounds.ne.latitude, longitude: bounds.ne.longitude))
        let radiusNM = max(1, span / 2 / 1852)  // half the diagonal, nautical miles
        let candidates: [Airport]
        do {
            candidates = try databaseService.airports(near: center, radiusNM: radiusNM)
        } catch {
            return
        }
        let origin = CLLocation(latitude: center.latitude, longitude: center.longitude)
        let wanted = candidates
            .filter { $0.type == .airport && !unavailable.contains($0.icao) }
            .sorted { origin.distance(from: CLLocation(latitude: $0.latitude, longitude: $0.longitude))
                    < origin.distance(from: CLLocation(latitude: $1.latitude, longitude: $1.longitude)) }
            .prefix(Self.maximumAirports)
        for airport in wanted where entries[airport.icao] == nil && !loading.contains(airport.icao) {
            loading.insert(airport.icao)
            Task { [weak self] in await self?.load(airport) }
        }
    }

    // MARK: - Loading

    private func load(_ airport: Airport) async {
        defer { loading.remove(airport.icao) }
        guard let chartService, let databaseService else { return }
        do {
            let charts = try await chartService.charts(for: airport)
            guard let diagram = charts.first(where: { $0.category == .diagram }) else {
                unavailable.insert(airport.icao)
                return
            }
            let pdfURL = try await chartService.pdfURL(for: diagram)
            let full = try databaseService.airport(byICAO: airport.icao) ?? airport
            let reference = AirportDiagramReference(latitude: full.latitude, longitude: full.longitude)
            let runways = full.runways.map {
                AirportDiagramRunway(
                    identifier: $0.id, lengthFeet: Double($0.length), widthFeet: Double($0.width),
                    baseLatitude: $0.baseEndLatitude, baseLongitude: $0.baseEndLongitude,
                    reciprocalLatitude: $0.reciprocalEndLatitude, reciprocalLongitude: $0.reciprocalEndLongitude
                )
            }
            let cacheDirectory = pdfURL.deletingLastPathComponent().appendingPathComponent("georef", isDirectory: true)
            let baseName = pdfURL.deletingPathExtension().lastPathComponent
            let result = try await Self.georeferenceAndRender(
                pdfURL: pdfURL, reference: reference, runways: runways,
                cacheJSON: cacheDirectory.appendingPathComponent("\(baseName).json"),
                cachePNG: cacheDirectory.appendingPathComponent("\(baseName).png")
            )
            switch result {
            case .rejected(let reason):
                logger.notice("APD \(airport.icao, privacy: .public) not drawn: \(reason, privacy: .public)")
                unavailable.insert(airport.icao)
            case .accepted(let georeference, let image):
                add(airport: airport, georeference: georeference, image: image)
            }
        } catch {
            logger.error("APD \(airport.icao, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            unavailable.insert(airport.icao)
        }
    }

    enum GeoreferenceOutcome {
        case accepted(AirportDiagramGeoreference, UIImage)
        case rejected(String)
    }

    /// Cached per-cycle record: a validated fit or a rejection reason.
    nonisolated struct CacheRecord: Codable {
        let version: Int
        let georeference: AirportDiagramGeoreference?
        let rejection: String?
    }

    /// Runs the (slow) fit and render off the main actor, reading and writing the per-cycle cache.
    nonisolated static func georeferenceAndRender(
        pdfURL: URL, reference: AirportDiagramReference, runways: [AirportDiagramRunway],
        cacheJSON: URL, cachePNG: URL
    ) async throws -> GeoreferenceOutcome {
        try await Task.detached(priority: .utility) {
            let fileManager = FileManager.default
            if let data = try? Data(contentsOf: cacheJSON),
               let record = try? JSONDecoder().decode(CacheRecord.self, from: data),
               record.version == cacheVersion {
                if let rejection = record.rejection { return .rejected(rejection) }
                if let georeference = record.georeference, let image = UIImage(contentsOfFile: cachePNG.path) {
                    return .accepted(georeference, image)
                }
            }
            let pdfData = try Data(contentsOf: pdfURL)
            try fileManager.createDirectory(at: cacheJSON.deletingLastPathComponent(), withIntermediateDirectories: true)
            let georeference: AirportDiagramGeoreference
            do {
                georeference = try AirportDiagramGeoreferencer.georeference(pdfData: pdfData, reference: reference, runways: runways)
            } catch let error as AirportDiagramGeoreferenceError {
                let record = CacheRecord(version: cacheVersion, georeference: nil, rejection: error.description)
                try? JSONEncoder().encode(record).write(to: cacheJSON, options: .atomic)
                return .rejected(error.description)
            }
            guard let cgImage = AirportDiagramGeoreferencer.renderImage(pdfData: pdfData, georeference: georeference, scale: renderScale),
                  let png = AirportDiagramGeoreferencer.pngData(cgImage) else {
                throw EFBError.chartCorrupted(pdfURL.lastPathComponent)
            }
            try png.write(to: cachePNG, options: .atomic)
            let record = CacheRecord(version: cacheVersion, georeference: georeference, rejection: nil)
            try JSONEncoder().encode(record).write(to: cacheJSON, options: .atomic)
            return .accepted(georeference, UIImage(cgImage: cgImage))
        }.value
    }

    // MARK: - Map Layers

    private func add(airport: Airport, georeference: AirportDiagramGeoreference, image: UIImage) {
        guard let style, entries[airport.icao] == nil else { return }
        let corners = georeference.clipCorners
        guard corners.count == 4 else { return }
        let quad = MLNCoordinateQuad(
            topLeft: CLLocationCoordinate2D(latitude: corners[0].latitude, longitude: corners[0].longitude),
            bottomLeft: CLLocationCoordinate2D(latitude: corners[1].latitude, longitude: corners[1].longitude),
            bottomRight: CLLocationCoordinate2D(latitude: corners[2].latitude, longitude: corners[2].longitude),
            topRight: CLLocationCoordinate2D(latitude: corners[3].latitude, longitude: corners[3].longitude)
        )
        let sourceID = "apd-source-\(airport.icao)", layerID = "apd-layer-\(airport.icao)"
        let backingSourceID = "apd-backing-source-\(airport.icao)", backingLayerID = "apd-backing-\(airport.icao)"
        let visible = isEnabled && (mapView?.zoomLevel ?? 0) >= Self.minimumZoom

        var ring = corners.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
        let backingSource = MLNShapeSource(identifier: backingSourceID, shape: MLNPolygon(coordinates: &ring, count: UInt(ring.count)), options: nil)
        style.addSource(backingSource)
        let backing = MLNFillStyleLayer(identifier: backingLayerID, source: backingSource)
        backing.fillOpacity = NSExpression(
            forMLNInterpolating: .zoomLevelVariable, curveType: .linear, parameters: nil,
            stops: NSExpression(forConstantValue: Self.backingOpacityByZoom)
        )
        backing.minimumZoomLevel = Float(Self.minimumZoom)
        backing.isVisible = visible

        let source = MLNImageSource(identifier: sourceID, coordinateQuad: quad, image: image)
        style.addSource(source)
        let layer = MLNRasterStyleLayer(identifier: layerID, source: source)
        layer.rasterOpacity = NSExpression(forConstantValue: Self.opacity)
        layer.minimumZoomLevel = Float(Self.minimumZoom)
        layer.isVisible = visible
        Self.style(backing: backing, diagram: layer, night: isNight)
        // Below the airport dots (and therefore below ownship, routes, weather), above the sectional.
        if let airports = style.layer(withIdentifier: "airport-circles") {
            style.insertLayer(backing, below: airports)
            style.insertLayer(layer, below: airports)
        } else if let ownship = style.layer(withIdentifier: "ownship-symbol") {
            style.insertLayer(backing, below: ownship)
            style.insertLayer(layer, below: ownship)
        } else {
            style.addLayer(backing)
            style.addLayer(layer)
        }
        entries[airport.icao] = Entry(
            sourceID: sourceID, layerID: layerID,
            backingSourceID: backingSourceID, backingLayerID: backingLayerID, georeference: georeference
        )
        shownAirports = entries.keys.sorted()
        logger.notice("APD \(airport.icao, privacy: .public) drawn: \(georeference.diagnostics.method.rawValue, privacy: .public), \(georeference.diagnostics.feetPerPoint, format: .fixed(precision: 1), privacy: .public) ft/pt")
    }

    /// Day: black ink on a white backing. Night: dark backing, ink lifted to light grey (no white slab).
    private static func style(backing: MLNFillStyleLayer, diagram: MLNRasterStyleLayer, night: Bool) {
        backing.fillColor = NSExpression(forConstantValue: night ? nightBackingColor : dayBackingColor)
        diagram.minimumRasterBrightness = NSExpression(forConstantValue: night ? nightInkBrightnessMin : 0.0)
        diagram.maximumRasterBrightness = NSExpression(forConstantValue: night ? nightInkBrightnessMax : 1.0)
    }

    /// Switches drawn diagrams between the day and night rendering; later diagrams follow suit.
    func applyDisplayMode(night: Bool) {
        isNight = night
        guard let style else { return }
        for entry in entries.values {
            guard let backing = style.layer(withIdentifier: entry.backingLayerID) as? MLNFillStyleLayer,
                  let diagram = style.layer(withIdentifier: entry.layerID) as? MLNRasterStyleLayer else { continue }
            Self.style(backing: backing, diagram: diagram, night: night)
        }
    }

    /// Removes every drawn diagram (used when the style is replaced or in tests).
    func removeAll() {
        guard let style else { return }
        for entry in entries.values {
            for layerID in [entry.layerID, entry.backingLayerID] {
                if let layer = style.layer(withIdentifier: layerID) { style.removeLayer(layer) }
            }
            for sourceID in [entry.sourceID, entry.backingSourceID] {
                if let source = style.source(withIdentifier: sourceID) { style.removeSource(source) }
            }
        }
        entries = [:]
        shownAirports = []
    }
}
