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
    /// True while at least one diagram is on screen (enabled, zoomed in far enough); drives the Israel badge.
    private(set) var isShowing = false

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

    /// Region the map shows. Israel draws the CAAI diagrams from the downloaded `il-diagrams` pack (IL-13);
    /// the US fits FAA d-TPP diagrams. Switching clears what is drawn.
    var region: Region = .us {
        didSet {
            guard region != oldValue else { return }
            removeAll()
            unavailable = []
            refresh(force: true)
        }
    }

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
        if region == .israel, !entries.isEmpty { raiseAboveIsraelFills() }  // IL-3 may re-add its fills at any time
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
        isShowing = visible && !entries.isEmpty
        for entry in entries.values {
            style?.layer(withIdentifier: entry.layerID)?.isVisible = visible
            style?.layer(withIdentifier: entry.backingLayerID)?.isVisible = visible
        }
        guard isEnabled, zoomedIn else { return }
        if region == .israel {
            refreshIsrael(mapView: mapView)
            return
        }
        guard let databaseService else { return }

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
                add(icao: airport.icao, georeference: georeference, image: image)
            }
        } catch {
            logger.error("APD \(airport.icao, privacy: .public) failed: \(error.localizedDescription, privacy: .public)")
            unavailable.insert(airport.icao)
        }
    }

    // MARK: - Israel (IL-13)

    /// Aerodromes near the camera whose diagram is georeferenced in the installed pack, nearest first.
    /// Nothing is drawn without an installed, servable edition.
    private func refreshIsrael(mapView: MLNMapView) {
        raiseAboveIsraelFills()
        guard let pack = IsraelDiagramStore.shared.pack else { return }
        let center = mapView.centerCoordinate
        let wanted = Self.georeferencedAerodromes(pack: pack, near: center, limit: Self.maximumAirports)
        for icao in wanted where entries[icao] == nil && !loading.contains(icao) && !unavailable.contains(icao) {
            loading.insert(icao)
            Task { [weak self] in await self?.loadIsrael(icao: icao, pack: pack) }
        }
    }

    /// Pack aerodromes with a drawable diagram, closest to `center` first.
    nonisolated static func georeferencedAerodromes(pack: IsraelDiagramPack, near center: CLLocationCoordinate2D, limit: Int) -> [String] {
        let origin = CLLocation(latitude: center.latitude, longitude: center.longitude)
        let database = try? IsraelAviationDatabase.bundled()
        let located: [(icao: String, distance: Double)] = pack.georeferencedICAOs.compactMap { icao in
            guard let aerodrome = (try? database?.aerodrome(code: icao)) ?? nil else { return nil }
            return (icao, origin.distance(from: CLLocation(latitude: aerodrome.latitude, longitude: aerodrome.longitude)))
        }
        return located.sorted { $0.distance < $1.distance }.prefix(limit).map(\.icao)
    }

    private func loadIsrael(icao: String, pack: IsraelDiagramPack) async {
        defer { loading.remove(icao) }
        guard case .georeferenced(let record) = pack.availability(for: icao),
              let imageName = record.image, let jsonName = record.georeference,
              let imageURL = pack.fileURL(imageName), let jsonURL = pack.fileURL(jsonName) else {
            unavailable.insert(icao)
            return
        }
        let decoded: (AirportDiagramGeoreference, UIImage)? = await Task.detached(priority: .utility) {
            guard let data = try? Data(contentsOf: jsonURL),
                  let georeference = try? IsraelDiagramPack.decodeGeoreference(data),
                  let image = UIImage(contentsOfFile: imageURL.path) else { return nil }
            return (georeference, image)
        }.value
        guard let (georeference, image) = decoded else {
            logger.error("IL diagram \(icao, privacy: .public) unreadable")
            unavailable.insert(icao)
            return
        }
        add(icao: icao, georeference: georeference, image: image)
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

    private func add(icao: String, georeference: AirportDiagramGeoreference, image: UIImage) {
        guard let style, entries[icao] == nil else { return }
        let corners = georeference.clipCorners
        guard corners.count == 4 else { return }
        let quad = MLNCoordinateQuad(
            topLeft: CLLocationCoordinate2D(latitude: corners[0].latitude, longitude: corners[0].longitude),
            bottomLeft: CLLocationCoordinate2D(latitude: corners[1].latitude, longitude: corners[1].longitude),
            bottomRight: CLLocationCoordinate2D(latitude: corners[2].latitude, longitude: corners[2].longitude),
            topRight: CLLocationCoordinate2D(latitude: corners[3].latitude, longitude: corners[3].longitude)
        )
        let sourceID = "apd-source-\(icao)", layerID = "apd-layer-\(icao)"
        let backingSourceID = "apd-backing-source-\(icao)", backingLayerID = "apd-backing-\(icao)"
        let visible = isEnabled && (mapView?.zoomLevel ?? 0) >= Self.minimumZoom

        let backing: MLNStyleLayer
        if region == .israel {
            // A solid-colour raster, not a fill polygon: the fill was not rendered where IL-3's airspace fills
            // are drawn, while rasters follow the style order. Opaque.
            let backingSource = MLNImageSource(identifier: backingSourceID, coordinateQuad: quad, image: Self.solidImage(isNight ? Self.nightBackingColor : Self.dayBackingColor))
            style.addSource(backingSource)
            let solid = MLNRasterStyleLayer(identifier: backingLayerID, source: backingSource)
            solid.rasterOpacity = NSExpression(forConstantValue: 1.0)
            solid.minimumZoomLevel = Float(Self.minimumZoom)
            solid.isVisible = visible
            backing = solid
        } else {
            var ring = corners.map { CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude) }
            let backingSource = MLNShapeSource(identifier: backingSourceID, shape: MLNPolygon(coordinates: &ring, count: UInt(ring.count)), options: nil)
            style.addSource(backingSource)
            let fill = MLNFillStyleLayer(identifier: backingLayerID, source: backingSource)
            fill.fillOpacity = NSExpression(
                forMLNInterpolating: .zoomLevelVariable, curveType: .linear, parameters: nil,
                stops: NSExpression(forConstantValue: Self.backingOpacityByZoom)
            )
            fill.minimumZoomLevel = Float(Self.minimumZoom)
            fill.isVisible = visible
            backing = fill
        }

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
        entries[icao] = Entry(
            sourceID: sourceID, layerID: layerID,
            backingSourceID: backingSourceID, backingLayerID: backingLayerID, georeference: georeference
        )
        shownAirports = entries.keys.sorted()
        if region == .israel {
            // IL-3 adds its airspace fills below ownship as its data loads, which can land them above the diagram.
            raiseAboveIsraelFills()
            Task { [weak self] in
                for seconds in [2, 3] {
                    try? await Task.sleep(for: .seconds(seconds))
                    self?.raiseAboveIsraelFills()
                }
            }
        }
        logger.notice("APD \(icao, privacy: .public) drawn: \(georeference.diagnostics.method.rawValue, privacy: .public), \(georeference.diagnostics.feetPerPoint, format: .fixed(precision: 1), privacy: .public) ft/pt")
    }

    /// IL-3 airspace fills (`il-as-fill-*`) must sit below the diagram (a CTR tint over a diagram hides it) and
    /// the diagram below ownship. Re-inserts each diagram's backing and raster directly above the topmost fill
    /// when they are out of that order.
    private func raiseAboveIsraelFills() {
        guard region == .israel, let style else { return }
        let fills = ["il-as-fill-civil", "il-as-fill-restricted"]
        func index(_ id: String) -> Int? { style.layers.firstIndex { $0.identifier == id } }
        for entry in entries.values {
            guard let topFill = style.layers.last(where: { fills.contains($0.identifier) }),
                  let fillIndex = index(topFill.identifier),
                  let backingIndex = index(entry.backingLayerID), let rasterIndex = index(entry.layerID) else { continue }
            let ownshipIndex = index("ownship-symbol")
            let belowFill = min(backingIndex, rasterIndex) < fillIndex
            let aboveOwnship = ownshipIndex.map { max(backingIndex, rasterIndex) > $0 } ?? false
            guard belowFill || aboveOwnship else { continue }
            guard let backing = style.layer(withIdentifier: entry.backingLayerID),
                  let raster = style.layer(withIdentifier: entry.layerID) else { continue }
            style.removeLayer(backing)
            style.removeLayer(raster)
            style.insertLayer(backing, above: topFill)
            style.insertLayer(raster, above: backing)
        }
        // MapService's airspace tint (`airspace-fill`) sits above ownship in the style; a CTR tint over a diagram
        // washes it out (at night the dark backing turns mid-grey). Put it below the lowest diagram.
        if let lowest = entries.values.compactMap({ index($0.backingLayerID) }).min(),
           let tintIndex = index("airspace-fill"), tintIndex > lowest,
           let tint = style.layer(withIdentifier: "airspace-fill") {
            let anchor = style.layers[lowest]
            style.removeLayer(tint)
            style.insertLayer(tint, below: anchor)
        }
    }

    /// A 4 x 4 image of one colour (the Israel backing, stretched over the diagram quad).
    private static func solidImage(_ color: UIColor) -> UIImage {
        let size = CGSize(width: 4, height: 4)
        return UIGraphicsImageRenderer(size: size).image { context in
            color.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
    }

    /// Day: black ink on a white backing. Night: dark backing, ink lifted to light grey (no white slab).
    private static func style(backing: MLNStyleLayer, diagram: MLNRasterStyleLayer, night: Bool) {
        if let fill = backing as? MLNFillStyleLayer {
            fill.fillColor = NSExpression(forConstantValue: night ? nightBackingColor : dayBackingColor)
        }
        diagram.minimumRasterBrightness = NSExpression(forConstantValue: night ? nightInkBrightnessMin : 0.0)
        diagram.maximumRasterBrightness = NSExpression(forConstantValue: night ? nightInkBrightnessMax : 1.0)
    }

    /// Switches drawn diagrams between the day and night rendering; later diagrams follow suit.
    func applyDisplayMode(night: Bool) {
        isNight = night
        guard let style else { return }
        for entry in entries.values {
            guard let backing = style.layer(withIdentifier: entry.backingLayerID),
                  let diagram = style.layer(withIdentifier: entry.layerID) as? MLNRasterStyleLayer else { continue }
            Self.style(backing: backing, diagram: diagram, night: night)
            if let solid = style.source(withIdentifier: entry.backingSourceID) as? MLNImageSource {
                solid.image = Self.solidImage(night ? Self.nightBackingColor : Self.dayBackingColor)
            }
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
