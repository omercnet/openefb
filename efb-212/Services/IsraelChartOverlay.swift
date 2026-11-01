//
//  IsraelChartOverlay.swift
//  efb-212
//
//  Draws the Israel CVFR chart (IL-3) from the bundled CAAI data over the street base map:
//  route segments with per-direction altitude labels, reporting points, airspace, runways and
//  NOTAM closures. Active only while the region is Israel. The data (about 650 KB) is loaded once
//  per activation and kept in memory as GeoJSON-style shape sources, so panning costs nothing.
//
//  Offline: everything here is local. Labels and symbols are sprites (see IsraelChartStyle), so no
//  glyph server is needed. The street base map underneath is online (offline base map is out of scope).
//
//  Owned by `MapService` like `AirportDiagramOverlay`; `MapViewModel` toggles it per region.
//

import UIKit
import MapLibre
import Observation
import OSLog

// MARK: - Loaded data

/// Everything the chart draws and the tap sheets read, loaded once.
nonisolated struct IsraelChartData: Sendable {
    let points: [IsraelReportingPoint]
    let segments: [IsraelRouteSegment]
    let airspaces: [IsraelAirspace]
    let runways: [IsraelRunway]
    /// Curated aerodromes (IL-4), foreign fields excluded.
    let aerodromes: [IsraelAerodrome]
    let network: IsraelChartNetwork

    static func load(from database: any IsraelAviationDatabaseProtocol) throws -> IsraelChartData {
        let bounds = IsraelGeoBounds.wholeCountry
        let points = try database.reportingPoints(in: bounds)
        let segments = try database.routeSegments(in: bounds)
        var airspaces: [IsraelAirspace] = []
        for kind in IsraelAirspaceKind.allCases where kind != .fir {
            airspaces += try database.airspaces(ofKind: kind)
        }
        let runways = try database.runways(in: bounds)
        let aerodromes = try database.aerodromes(in: bounds).filter { $0.use != .foreign }
        return IsraelChartData(
            points: points, segments: segments, airspaces: airspaces, runways: runways, aerodromes: aerodromes,
            network: IsraelChartNetwork(points: points, segments: segments)
        )
    }
}

/// What the layer panel says about the NOTAM closures layer.
enum IsraelClosureStatus: Equatable {
    /// No feed has been loaded (no relay URL, offline at first launch): nothing is drawn.
    case noFeed
    /// A feed was loaded. `drawn` is false when it is too old to draw.
    case loaded(generatedAt: Date, level: FreshnessLevel, closedSegments: Int)
}

// MARK: - Overlay

@Observable
@MainActor
final class IsraelChartOverlay {

    // MARK: Observable state

    /// Tapped point or airspace; the map container presents its sheet.
    var selection: IsraelChartSelection?
    private(set) var closureStatus: IsraelClosureStatus = .noFeed

    // MARK: Dependencies

    @ObservationIgnored private let databaseProvider: @Sendable () throws -> any IsraelAviationDatabaseProtocol
    @ObservationIgnored private let notamFetcher: @Sendable () async throws -> IsraelNotamReport
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let logger = Logger(subsystem: "quartermint.efb-212", category: "IsraelChartOverlay")

    // MARK: State

    @ObservationIgnored private var style: MLNStyle?
    @ObservationIgnored private var active = false
    @ObservationIgnored private var installed = false
    @ObservationIgnored private var data: IsraelChartData?
    @ObservationIgnored private var segmentFeatures: [IsraelChartSegmentFeature] = []
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var visibility: [MapLayer: Bool] = [:]
    @ObservationIgnored private var night = false
    @ObservationIgnored private var officialChartPresent = false
    /// Sprite name -> what to draw, so a display-mode change can redraw every sprite.
    @ObservationIgnored private var labelSprites: [String: (kind: IsraelChartLabelKind, text: String)] = [:]
    @ObservationIgnored private var closureSource: MLNShapeSource?
    @ObservationIgnored private var closureLabelSource: MLNShapeSource?
    @ObservationIgnored private var report: IsraelNotamReport?
    @ObservationIgnored private var lastFetchAttempt: Date?
    @ObservationIgnored private var fetchTask: Task<Void, Never>?
    @ObservationIgnored private var appliedClosureKey: [Int: String] = [:]

    /// Re-fetch interval for the NOTAM feed while the closures layer is on (the relay caches 5 min).
    static let fetchInterval: TimeInterval = 300

    init(
        databaseProvider: @escaping @Sendable () throws -> any IsraelAviationDatabaseProtocol = { try IsraelAviationDatabase.bundled() },
        notamFetcher: (@Sendable () async throws -> IsraelNotamReport)? = nil,
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.databaseProvider = databaseProvider
        self.now = now
        if let notamFetcher {
            self.notamFetcher = notamFetcher
        } else {
            let service = IsraelNotamService()
            self.notamFetcher = {
                if let override = try await Self.debugFeedOverride() { return override }
                return try await service.fetchFeed(forceRefresh: false)
            }
        }
    }

    // MARK: Identifiers

    private enum ID {
        static let routesSource = "il-routes"
        static let routeLabelsSource = "il-route-labels"
        static let pointsSource = "il-points"
        static let airspaceSource = "il-airspace"
        static let airspaceLabelsSource = "il-airspace-labels"
        static let runwaysSource = "il-runways"
        static let closuresSource = "il-closures"
        static let closureLabelsSource = "il-closure-labels"

        static let routeCivil = "il-route-civil"
        static let routeRequest = "il-route-request"
        static let routeMilitary = "il-route-military"
        static let routeAltLabels = "il-route-alt-labels"
        static let pointIcons = "il-point-icons"
        static let pointIconsRequest = "il-point-icons-request"
        static let pointLabelsCompulsory = "il-point-labels-compulsory"
        static let pointLabelsRequest = "il-point-labels-request"
        static let pointLabelsARP = "il-point-labels-arp"
        static let airspaceFillCivil = "il-as-fill-civil"
        static let airspaceLineCivil = "il-as-line-civil"
        static let airspaceFillRestricted = "il-as-fill-restricted"
        static let airspaceLineRestricted = "il-as-line-restricted"
        static let airspaceLabelsTMA = "il-as-labels-tma"
        static let airspaceLabelsOther = "il-as-labels-other"
        static let runways = "il-runway-lines"
        static let closureCasing = "il-closure-casing"
        static let closureLabels = "il-closure-label-symbols"
        static let aerodromesSource = "il-aerodromes"
        static let aerodromeIcons = "il-aerodrome-icons"
        static let aerodromeLabels = "il-aerodrome-labels"

        static let all: [MapLayer: [String]] = [
            .cvfrRoutes: [routeCivil, routeRequest, routeMilitary, routeAltLabels],
            .cvfrPoints: [pointIcons, pointIconsRequest, pointLabelsCompulsory, pointLabelsRequest, pointLabelsARP,
                          aerodromeIcons, aerodromeLabels],
            .cvfrAirspace: [airspaceFillCivil, airspaceLineCivil, airspaceFillRestricted, airspaceLineRestricted,
                            airspaceLabelsTMA, airspaceLabelsOther],
            .cvfrRunways: [runways],
            .cvfrClosures: [closureCasing, closureLabels]
        ]
    }

    /// Zoom at which each element appears. Below these the chart thins out: at country zoom only
    /// the route lines, aerodromes, compulsory points and TMAs are drawn, so labels never pile up.
    private enum Zoom {
        static let altitudeLabels: Float = 9.0
        static let compulsoryIcons: Float = 7.0
        static let compulsoryLabels: Float = 9.0
        static let requestIcons: Float = 9.0
        static let requestLabels: Float = 10.5
        static let arpLabels: Float = 8.5
        static let tmaLabels: Float = 7.5
        static let airspaceLabels: Float = 8.5
        static let runways: Float = 9.0
    }

    // MARK: Lifecycle

    /// A fresh style finished loading: every layer of the old one is gone.
    func attach(style: MLNStyle) {
        self.style = style
        installed = false
        closureSource = nil
        closureLabelSource = nil
        appliedClosureKey = [:]
        installIfReady()
    }

    /// Region switch: load the data and draw (Israel), or remove everything (elsewhere). Data is
    /// loaded once per activation; leaving the region frees it.
    func setActive(_ newValue: Bool) {
        guard newValue != active else { return }
        active = newValue
        if newValue {
            loadData()
        } else {
            loadTask?.cancel()
            fetchTask?.cancel()
            uninstall()
            data = nil
            segmentFeatures = []
            report = nil
            lastFetchAttempt = nil
            selection = nil
            closureStatus = .noFeed
            labelSprites = [:]
        }
    }

    private func loadData() {
        loadTask?.cancel()
        let provider = databaseProvider
        loadTask = Task { [weak self] in
            let loaded: Result<IsraelChartData, Error> = await Task.detached(priority: .userInitiated) {
                Result { try IsraelChartData.load(from: provider()) }
            }.value
            guard let self, !Task.isCancelled else { return }
            switch loaded {
            case .success(let value):
                self.data = value
                self.segmentFeatures = IsraelChartFeatureBuilder.segmentFeatures(value.segments)
                self.installIfReady()
            case .failure(let error):
                // Region.israel data errors surface through RegionStore's banner; draw nothing.
                self.logger.error("Israel chart data failed to load: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    // MARK: Visibility and display mode

    func setVisible(_ layer: MapLayer, visible: Bool) {
        guard layer.isCVFRChart else { return }
        let changed = visibility[layer] != visible
        visibility[layer] = visible
        applyVisibility(layer)
        if layer == .cvfrClosures, visible, changed { refreshClosures(force: true) }
    }

    private func applyVisibility(_ layer: MapLayer) {
        guard let style, installed else { return }
        let visible = visibility[layer] ?? false
        for id in ID.all[layer] ?? [] {
            style.layer(withIdentifier: id)?.isVisible = visible
        }
        applyOfficial()
    }

    // MARK: Official chart present

    /// The official CAAI chart is the base map (IL-9 calls this when it is shown or removed). It already
    /// prints routes, points and airspace, so this overlay then draws only NOTAM closures; reporting
    /// points and airspace stay as invisible tap targets. Route lines, altitude labels, airspace fills and
    /// runways are off by default (`IsraelChartDefaults`) and still toggleable. Without it (street base),
    /// the full drawing is the fallback.
    func setOfficialChartPresent(_ present: Bool) {
        guard present != officialChartPresent else { return }
        officialChartPresent = present
        for layer in MapLayer.cvfrChart { applyVisibility(layer) }
        applyPalette()
    }

    private func applyOfficial() {
        guard let style, installed else { return }
        let p = palette
        let airspaceOn = visibility[.cvfrAirspace] ?? false
        let pointsOn = visibility[.cvfrPoints] ?? false
        for id in [ID.airspaceFillCivil, ID.airspaceFillRestricted] {
            guard let fill = style.layer(withIdentifier: id) as? MLNFillStyleLayer else { continue }
            let base = id == ID.airspaceFillRestricted ? p.airspaceFillOpacity + 0.05 : p.airspaceFillOpacity
            if officialChartPresent {
                fill.isVisible = true  // tap target even when the fill is "off"
                fill.fillOpacity = NSExpression(forConstantValue: airspaceOn ? base : 0.01)
            } else {
                fill.fillOpacity = NSExpression(forConstantValue: base)
            }
        }
        for id in [ID.pointIcons, ID.pointIconsRequest, ID.aerodromeIcons] {
            guard let icons = style.layer(withIdentifier: id) as? MLNSymbolStyleLayer else { continue }
            icons.iconOpacity = NSExpression(forConstantValue: officialChartPresent ? 0.02 : 1.0)
            if officialChartPresent { icons.isVisible = pointsOn }
        }
        if officialChartPresent {
            for id in [ID.pointLabelsCompulsory, ID.pointLabelsRequest, ID.pointLabelsARP, ID.aerodromeLabels] {
                style.layer(withIdentifier: id)?.isVisible = false
            }
        }
    }

    func applyDisplayMode(night newNight: Bool) {
        guard newNight != night else { return }
        night = newNight
        guard installed else { return }
        registerSymbols()
        for (name, sprite) in labelSprites {
            style?.setImage(
                IsraelChartRenderer.labelImage(kind: sprite.kind, text: sprite.text, palette: palette),
                forName: name
            )
        }
        applyPalette()
    }

    private var palette: IsraelChartPalette { IsraelChartPalette.palette(night: night) }

    // MARK: Install

    private func installIfReady() {
        guard active, !installed, let style, let data else { return }
        installed = true
        registerSymbols()
        addAreaLayers(style: style, data: data)
        addRunwayLayers(style: style, data: data)
        addAerodromeLayers(style: style, data: data)
        addRouteLayers(style: style)
        addClosureLayers(style: style)
        addPointLayers(style: style, data: data)
        for layer in MapLayer.cvfrChart { applyVisibility(layer) }
        applyPalette()
        // Closures are drawn from whatever report is held; fetch if the layer is on.
        applyClosures(at: now(), force: true)
        if visibility[.cvfrClosures] == true { refreshClosures(force: false) }
    }

    private func uninstall() {
        defer { installed = false; closureSource = nil; closureLabelSource = nil; appliedClosureKey = [:] }
        guard let style, installed else { return }
        let layerIDs = ID.all.values.flatMap { $0 }
        for id in layerIDs {
            if let layer = style.layer(withIdentifier: id) { style.removeLayer(layer) }
        }
        for id in [ID.routesSource, ID.routeLabelsSource, ID.pointsSource, ID.airspaceSource, ID.airspaceLabelsSource,
                   ID.runwaysSource, ID.closuresSource, ID.closureLabelsSource, ID.aerodromesSource] {
            if let source = style.source(withIdentifier: id) { style.removeSource(source) }
        }
    }

    private func registerSymbols() {
        guard let style else { return }
        for symbol in IsraelChartSymbol.allCases {
            style.setImage(IsraelChartRenderer.symbolImage(symbol, palette: palette), forName: symbol.rawValue)
        }
    }

    /// Adds the sprite for a label (once) and returns its name.
    @discardableResult
    private func sprite(_ kind: IsraelChartLabelKind, _ text: String) -> String {
        let name = IsraelChartRenderer.labelName(kind: kind, text: text)
        if labelSprites[name] == nil {
            labelSprites[name] = (kind, text)
            style?.setImage(IsraelChartRenderer.labelImage(kind: kind, text: text, palette: palette), forName: name)
        }
        return name
    }

    /// Insert below ownship and the flight-plan route, above the base map and other data.
    private func place(_ layer: MLNStyleLayer, in style: MLNStyle) {
        if let ownship = style.layer(withIdentifier: "ownship-symbol") {
            style.insertLayer(layer, below: ownship)
        } else {
            style.addLayer(layer)
        }
    }

    // MARK: Airspace

    private func addAreaLayers(style: MLNStyle, data: IsraelChartData) {
        let features = IsraelChartFeatureBuilder.airspaceFeatures(data.airspaces)
        var shapes: [MLNShape] = []
        var labels: [MLNShape] = []
        for feature in features {
            let attributes: [String: Any] = [
                "id": feature.id, "kind": feature.kind.rawValue, "restricted": feature.isRestricted
            ]
            for polygon in feature.polygons {
                guard var outer = polygon.first, outer.count >= 3 else { continue }
                let holes: [MLNPolygon] = polygon.dropFirst().compactMap { ring in
                    var ring = ring
                    return ring.count >= 3 ? MLNPolygon(coordinates: &ring, count: UInt(ring.count)) : nil
                }
                let shape = MLNPolygonFeature(coordinates: &outer, count: UInt(outer.count), interiorPolygons: holes)
                shape.attributes = attributes
                shapes.append(shape)
            }
            let kind: IsraelChartLabelKind = feature.isRestricted ? .airspaceRestricted : .airspace
            let text = feature.limits.isEmpty ? feature.title : feature.title + "\n" + feature.limits
            let label = MLNPointFeature()
            label.coordinate = feature.labelCoordinate
            label.attributes = ["icon": sprite(kind, text), "kind": feature.kind.rawValue]
            labels.append(label)
        }
        let source = MLNShapeSource(identifier: ID.airspaceSource, shape: MLNShapeCollectionFeature(shapes: shapes), options: nil)
        style.addSource(source)
        let labelSource = MLNShapeSource(identifier: ID.airspaceLabelsSource, shape: MLNShapeCollectionFeature(shapes: labels), options: nil)
        style.addSource(labelSource)

        for restricted in [false, true] {
            let predicate = NSPredicate(format: "restricted == %@", NSNumber(value: restricted))
            let fill = MLNFillStyleLayer(identifier: restricted ? ID.airspaceFillRestricted : ID.airspaceFillCivil, source: source)
            fill.predicate = predicate
            place(fill, in: style)
            let line = MLNLineStyleLayer(identifier: restricted ? ID.airspaceLineRestricted : ID.airspaceLineCivil, source: source)
            line.predicate = predicate
            line.lineWidth = NSExpression(forConstantValue: restricted ? 2.0 : 1.6)
            line.lineJoin = NSExpression(forConstantValue: "round")
            if !restricted { line.lineDashPattern = NSExpression(forConstantValue: [4, 2]) }
            place(line, in: style)
        }

        let tma = NSPredicate(format: "kind == %@", IsraelAirspaceKind.tma.rawValue)
        let other = NSPredicate(format: "kind != %@", IsraelAirspaceKind.tma.rawValue)
        for (id, predicate, zoom) in [(ID.airspaceLabelsTMA, tma, Zoom.tmaLabels), (ID.airspaceLabelsOther, other, Zoom.airspaceLabels)] {
            let layer = MLNSymbolStyleLayer(identifier: id, source: labelSource)
            layer.predicate = predicate
            layer.minimumZoomLevel = zoom
            layer.iconImageName = NSExpression(forKeyPath: "icon")
            layer.iconAllowsOverlap = NSExpression(forConstantValue: false)
            layer.iconPadding = NSExpression(forConstantValue: 4)
            place(layer, in: style)
        }
    }

    // MARK: Runways

    private func addRunwayLayers(style: MLNStyle, data: IsraelChartData) {
        let shapes: [MLNShape] = IsraelChartFeatureBuilder.runwayFeatures(data.runways).map { runway in
            var coords = [runway.endA, runway.endB]
            let line = MLNPolylineFeature(coordinates: &coords, count: 2)
            line.attributes = ["aerodrome": runway.aerodrome ?? ""]
            return line
        }
        let source = MLNShapeSource(identifier: ID.runwaysSource, shape: MLNShapeCollectionFeature(shapes: shapes), options: nil)
        style.addSource(source)
        let layer = MLNLineStyleLayer(identifier: ID.runways, source: source)
        layer.minimumZoomLevel = Zoom.runways
        layer.lineCap = NSExpression(forConstantValue: "butt")
        layer.lineWidth = NSExpression(
            format: "mgl_interpolate:withCurveType:parameters:stops:($zoomLevel, 'linear', nil, %@)",
            [9: 2.5, 12: 4.5, 15: 8] as [Int: Double]
        )
        place(layer, in: style)
    }

    // MARK: Routes

    private func addRouteLayers(style: MLNStyle) {
        var lines: [MLNShape] = []
        var labels: [MLNShape] = []
        for segment in segmentFeatures {
            var coords = segment.polyline
            let line = MLNPolylineFeature(coordinates: &coords, count: UInt(coords.count))
            line.attributes = ["id": segment.id, "style": segment.style.rawValue]
            lines.append(line)
            if let label = segment.label {
                let kind: IsraelChartLabelKind = segment.style == .military ? .altitudeMilitary : .altitude
                let point = MLNPointFeature()
                point.coordinate = label.coordinate
                point.attributes = ["icon": sprite(kind, label.text), "rot": label.rotationDegrees]
                labels.append(point)
            }
        }
        let source = MLNShapeSource(identifier: ID.routesSource, shape: MLNShapeCollectionFeature(shapes: lines), options: nil)
        style.addSource(source)
        let labelSource = MLNShapeSource(identifier: ID.routeLabelsSource, shape: MLNShapeCollectionFeature(shapes: labels), options: nil)
        style.addSource(labelSource)

        let width = NSExpression(
            format: "mgl_interpolate:withCurveType:parameters:stops:($zoomLevel, 'linear', nil, %@)",
            [6: 1.6, 9: 2.6, 13: 4.5] as [Int: Double]
        )
        for (id, style_) in [(ID.routeCivil, IsraelRouteStyle.civil), (ID.routeRequest, .byRequest), (ID.routeMilitary, .military)] {
            let layer = MLNLineStyleLayer(identifier: id, source: source)
            layer.predicate = NSPredicate(format: "style == %@", style_.rawValue)
            layer.lineWidth = width
            layer.lineCap = NSExpression(forConstantValue: "round")
            layer.lineJoin = NSExpression(forConstantValue: "round")
            if style_ == .byRequest { layer.lineDashPattern = NSExpression(forConstantValue: [2.2, 1.6]) }
            place(layer, in: style)
        }

        let altitude = MLNSymbolStyleLayer(identifier: ID.routeAltLabels, source: labelSource)
        altitude.minimumZoomLevel = Zoom.altitudeLabels
        altitude.iconImageName = NSExpression(forKeyPath: "icon")
        altitude.iconRotation = NSExpression(forKeyPath: "rot")
        altitude.iconRotationAlignment = NSExpression(forConstantValue: "map")
        altitude.iconAllowsOverlap = NSExpression(forConstantValue: false)
        altitude.iconPadding = NSExpression(forConstantValue: 3)
        place(altitude, in: style)
    }

    // MARK: Closures

    private func addClosureLayers(style: MLNStyle) {
        let source = MLNShapeSource(identifier: ID.closuresSource, shape: MLNShapeCollectionFeature(shapes: []), options: nil)
        style.addSource(source)
        closureSource = source
        let labelSource = MLNShapeSource(identifier: ID.closureLabelsSource, shape: MLNShapeCollectionFeature(shapes: []), options: nil)
        style.addSource(labelSource)
        closureLabelSource = labelSource

        // Red hatch over the closed leg: a wide dashed casing reads as "struck through" even at country zoom.
        let casing = MLNLineStyleLayer(identifier: ID.closureCasing, source: source)
        casing.lineWidth = NSExpression(
            format: "mgl_interpolate:withCurveType:parameters:stops:($zoomLevel, 'linear', nil, %@)",
            [6: 4, 9: 6, 13: 9] as [Int: Double]
        )
        casing.lineCap = NSExpression(forConstantValue: "butt")
        casing.lineDashPattern = NSExpression(forConstantValue: [1.2, 1.0])
        place(casing, in: style)

        let label = MLNSymbolStyleLayer(identifier: ID.closureLabels, source: labelSource)
        label.iconImageName = NSExpression(forKeyPath: "icon")
        label.iconRotation = NSExpression(forKeyPath: "rot")
        label.iconRotationAlignment = NSExpression(forConstantValue: "map")
        // A closure must never be hidden by label collision.
        label.iconAllowsOverlap = NSExpression(forConstantValue: true)
        label.iconIgnoresPlacement = NSExpression(forConstantValue: true)
        label.iconOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0, dy: -13)))
        place(label, in: style)
    }

    /// Re-evaluate closures at `date` from the held report; pushes to the map only when the set changed.
    /// A report that has aged past the NOTAM limit draws nothing, so an old closure set never reads as current.
    func applyClosures(at date: Date, force: Bool = false) {
        guard installed, let data else { return }
        let set = IsraelChartFeatureBuilder.closures(from: report, network: data.network, now: date)
        if let generatedAt = set.generatedAt {
            closureStatus = .loaded(generatedAt: generatedAt, level: set.freshness, closedSegments: set.marks.count)
        } else {
            closureStatus = .noFeed
        }
        let key = set.marks.mapValues(\.text)
        guard force || key != appliedClosureKey else { return }
        appliedClosureKey = key

        let features = IsraelChartFeatureBuilder.closureFeatures(segmentFeatures, marks: set.marks)
        var lines: [MLNShape] = []
        var labels: [MLNShape] = []
        for feature in features {
            var coords = feature.polyline
            lines.append(MLNPolylineFeature(coordinates: &coords, count: UInt(coords.count)))
            let point = MLNPointFeature()
            point.coordinate = feature.labelCoordinate
            point.attributes = ["icon": sprite(.closure, feature.mark.text), "rot": feature.rotationDegrees]
            labels.append(point)
        }
        closureSource?.shape = MLNShapeCollectionFeature(shapes: lines)
        closureLabelSource?.shape = MLNShapeCollectionFeature(shapes: labels)
    }

    /// Called about once a second from the map update: re-evaluates freshness and refreshes the feed
    /// when the closures layer is on and the last attempt is older than `fetchInterval`.
    func tick() {
        guard active, installed else { return }
        let date = now()
        applyClosures(at: date)
        if visibility[.cvfrClosures] == true { refreshClosures(force: false) }
    }

    func refreshClosures(force: Bool) {
        guard active, fetchTask == nil else { return }
        let date = now()
        if !force, let last = lastFetchAttempt, date.timeIntervalSince(last) < Self.fetchInterval { return }
        lastFetchAttempt = date
        let fetcher = notamFetcher
        fetchTask = Task { [weak self] in
            let result: IsraelNotamReport?
            do {
                result = try await fetcher()
            } catch {
                // Expected when no relay URL is set or the device is offline with nothing cached.
                self?.logger.info("Israel NOTAM feed unavailable: \(error.localizedDescription, privacy: .public)")
                result = nil
            }
            guard let self else { return }
            self.fetchTask = nil
            guard !Task.isCancelled, self.active else { return }
            // A failed fetch keeps whatever report is held: its age keeps counting.
            if let result { self.report = result }
            self.applyClosures(at: self.now(), force: true)
        }
    }

    // MARK: Points

    private func addPointLayers(style: MLNStyle, data: IsraelChartData) {
        var shapes: [MLNShape] = []
        for point in IsraelChartFeatureBuilder.pointFeatures(data.points) {
            let feature = MLNPointFeature()
            feature.coordinate = point.coordinate
            feature.attributes = [
                "id": point.id, "code": point.code, "kind": point.kind.rawValue,
                "symbol": IsraelChartSymbol(point.kind).rawValue,
                "icon": sprite(.pointCode, point.code)
            ]
            shapes.append(feature)
        }
        let source = MLNShapeSource(identifier: ID.pointsSource, shape: MLNShapeCollectionFeature(shapes: shapes), options: nil)
        style.addSource(source)

        let notRequest = NSPredicate(format: "kind != %@", IsraelPointKind.onRequest.rawValue)
        let request = NSPredicate(format: "kind == %@", IsraelPointKind.onRequest.rawValue)
        for (id, predicate, zoom) in [(ID.pointIcons, notRequest, Zoom.compulsoryIcons), (ID.pointIconsRequest, request, Zoom.requestIcons)] {
            let layer = MLNSymbolStyleLayer(identifier: id, source: source)
            layer.predicate = predicate
            layer.minimumZoomLevel = zoom
            layer.iconImageName = NSExpression(forKeyPath: "symbol")
            layer.iconAllowsOverlap = NSExpression(forConstantValue: true)
            layer.iconIgnoresPlacement = NSExpression(forConstantValue: true)
            place(layer, in: style)
        }

        let labelLayers: [(String, NSPredicate, Float)] = [
            (ID.pointLabelsCompulsory, NSPredicate(format: "kind == %@", IsraelPointKind.compulsory.rawValue), Zoom.compulsoryLabels),
            (ID.pointLabelsRequest, request, Zoom.requestLabels),
            (ID.pointLabelsARP, NSPredicate(format: "kind == %@", IsraelPointKind.arp.rawValue), Zoom.arpLabels)
        ]
        for (id, predicate, zoom) in labelLayers {
            let layer = MLNSymbolStyleLayer(identifier: id, source: source)
            layer.predicate = predicate
            layer.minimumZoomLevel = zoom
            layer.iconImageName = NSExpression(forKeyPath: "icon")
            layer.iconAnchor = NSExpression(forConstantValue: "top")
            layer.iconOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0, dy: 9)))
            layer.iconAllowsOverlap = NSExpression(forConstantValue: false)
            layer.iconPadding = NSExpression(forConstantValue: 2)
            place(layer, in: style)
        }
    }

    // MARK: Aerodromes (IL-4)

    /// Airstrips and helipads that have no ARP reporting point on the chart. Foreign fields are not
    /// drawn. Unreviewed entries carry "*" after the code (`IsraelChartFeatureBuilder.aerodromeLabel`).
    private func addAerodromeLayers(style: MLNStyle, data: IsraelChartData) {
        var shapes: [MLNShape] = []
        for aerodrome in IsraelChartFeatureBuilder.aerodromesWithoutPoint(data.aerodromes, points: data.points) {
            let feature = MLNPointFeature()
            feature.coordinate = aerodrome.coordinate
            feature.attributes = [
                "code": aerodrome.code,
                "symbol": IsraelChartSymbol(aerodrome.type).rawValue,
                "icon": sprite(.pointCode, IsraelChartFeatureBuilder.aerodromeLabel(aerodrome))
            ]
            shapes.append(feature)
        }
        let source = MLNShapeSource(identifier: ID.aerodromesSource, shape: MLNShapeCollectionFeature(shapes: shapes), options: nil)
        style.addSource(source)

        let icons = MLNSymbolStyleLayer(identifier: ID.aerodromeIcons, source: source)
        icons.minimumZoomLevel = Zoom.requestIcons
        icons.iconImageName = NSExpression(forKeyPath: "symbol")
        icons.iconAllowsOverlap = NSExpression(forConstantValue: true)
        icons.iconIgnoresPlacement = NSExpression(forConstantValue: true)
        place(icons, in: style)

        let labels = MLNSymbolStyleLayer(identifier: ID.aerodromeLabels, source: source)
        labels.minimumZoomLevel = Zoom.requestLabels
        labels.iconImageName = NSExpression(forKeyPath: "icon")
        labels.iconAnchor = NSExpression(forConstantValue: "top")
        labels.iconOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0, dy: 9)))
        labels.iconAllowsOverlap = NSExpression(forConstantValue: false)
        labels.iconPadding = NSExpression(forConstantValue: 2)
        place(labels, in: style)
    }

    // MARK: Palette

    private func applyPalette() {
        guard let style, installed else { return }
        let p = palette
        func line(_ id: String) -> MLNLineStyleLayer? { style.layer(withIdentifier: id) as? MLNLineStyleLayer }
        func fill(_ id: String) -> MLNFillStyleLayer? { style.layer(withIdentifier: id) as? MLNFillStyleLayer }
        line(ID.routeCivil)?.lineColor = NSExpression(forConstantValue: p.civilRoute)
        line(ID.routeRequest)?.lineColor = NSExpression(forConstantValue: p.civilRoute)
        line(ID.routeMilitary)?.lineColor = NSExpression(forConstantValue: p.militaryRoute)
        line(ID.airspaceLineCivil)?.lineColor = NSExpression(forConstantValue: p.airspace)
        line(ID.airspaceLineRestricted)?.lineColor = NSExpression(forConstantValue: p.restricted)
        fill(ID.airspaceFillCivil)?.fillColor = NSExpression(forConstantValue: p.airspace)
        fill(ID.airspaceFillCivil)?.fillOpacity = NSExpression(forConstantValue: p.airspaceFillOpacity)
        fill(ID.airspaceFillRestricted)?.fillColor = NSExpression(forConstantValue: p.restricted)
        fill(ID.airspaceFillRestricted)?.fillOpacity = NSExpression(forConstantValue: p.airspaceFillOpacity + 0.05)
        line(ID.runways)?.lineColor = NSExpression(forConstantValue: p.runway)
        line(ID.closureCasing)?.lineColor = NSExpression(forConstantValue: p.closure)
        applyOfficial()
    }

    // MARK: Tap

    /// The nearest aerodrome or reporting point within a fingertip of `point`, else the airspaces
    /// under it. An aerodrome (own symbol, or an ARP point that IL-4 has a record for) opens the
    /// airport sheet; other points open the CVFR point sheet.
    func hitTest(in mapView: MLNMapView, at point: CGPoint) -> IsraelChartSelection? {
        guard active, installed, let data else { return nil }
        let reach: CGFloat = 26  // half of a 52 pt target
        let rect = CGRect(x: point.x - reach, y: point.y - reach, width: reach * 2, height: reach * 2)
        let layers: Set<String> = [ID.pointIcons, ID.pointIconsRequest, ID.aerodromeIcons]
        let nearest = mapView.visibleFeatures(in: rect, styleLayerIdentifiers: layers)
            .compactMap { feature -> (feature: MLNFeature, distance: CGFloat)? in
                guard let point2D = feature as? MLNPointFeature else { return nil }
                let screen = mapView.convert(point2D.coordinate, toPointTo: mapView)
                return (feature, hypot(screen.x - point.x, screen.y - point.y))
            }
            .min { $0.distance < $1.distance }
        if let nearest {
            let code = nearest.feature.attribute(forKey: "code") as? String
            let id = (nearest.feature.attribute(forKey: "id") as? NSNumber)?.intValue
            if let id, let found = data.points.first(where: { $0.id == id }) {
                if found.kind == .arp, data.aerodromes.contains(where: { $0.code == found.code }) {
                    return .aerodrome(code: found.code)
                }
                return .point(IsraelChartDetails.point(found, segments: data.segments, closures: closureMarks()))
            }
            if let code { return .aerodrome(code: code) }
        }

        let areaFeatures = mapView.visibleFeatures(at: point, styleLayerIdentifiers: [ID.airspaceFillCivil, ID.airspaceFillRestricted])
        let ids = Set(areaFeatures.compactMap { ($0.attribute(forKey: "id") as? NSNumber)?.intValue })
        guard !ids.isEmpty else { return nil }
        let hits = data.airspaces.filter { ids.contains($0.id) }
        return hits.isEmpty ? nil : .airspaces(IsraelChartDetails.airspaces(hits))
    }

    /// Closure marks currently drawn, for the point sheet.
    private func closureMarks() -> [Int: IsraelChartClosureMark] {
        guard let data else { return [:] }
        return IsraelChartFeatureBuilder.closures(from: report, network: data.network, now: now()).marks
    }

    // MARK: Debug

    /// DEBUG: a notams.json at the path given by the `IsraelChartDebugNotamsPath` launch argument
    /// stands in for the relay, for screenshots and UI tests. Never compiled into release builds.
    nonisolated private static func debugFeedOverride() async throws -> IsraelNotamReport? {
        #if DEBUG
        guard let path = UserDefaults.standard.string(forKey: "IsraelChartDebugNotamsPath") else { return nil }
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let feed = try IsraelNotamService.decoder.decode(IsraelNotamFeed.self, from: data)
        return IsraelNotamReport(feed: feed, fetchedAt: Date(), refreshFailed: false)
        #else
        return nil
        #endif
    }
}
