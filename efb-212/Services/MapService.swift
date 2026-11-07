//
//  MapService.swift
//  efb-212
//
//  MapLibre layer management -- GeoJSON sources, style layers, ownship, base map style.
//  Runs on MainActor because MLNMapView is UIKit (main thread only).
//

import UIKit
import MapLibre

@MainActor
final class MapService {

    // MARK: - Properties

    weak var mapView: MLNMapView?

    private var airportSource: MLNShapeSource?
    private var navaidSource: MLNShapeSource?
    private var airspaceSource: MLNShapeSource?
    private var weatherSource: MLNShapeSource?
    private var tfrSource: MLNShapeSource?
    private var advisorySource: MLNShapeSource?
    private var ownshipSource: MLNShapeSource?
    private var routeSource: MLNShapeSource?
    private var routeAnnotations: [MLNAnnotation] = []
    private var replayTrackSource: MLNShapeSource?
    private var replayMarkerSource: MLNShapeSource?
    /// Georeferenced FAA airport diagrams (T11); drawn below the airport layer at zoom >= 14.
    let airportDiagramOverlay = AirportDiagramOverlay()
    /// Israel CVFR chart (IL-3): routes, points, airspace, runways, NOTAM closures. Active only in Israel.
    let israelChart = IsraelChartOverlay()
    /// Israel sport-aviation (LSA) network: shown when the Layers panel or an LSA plan asks for it. Active only in Israel.
    let israelLSA = IsraelLSAOverlay()
    /// Official CAAI CVFR chart raster from the downloaded pack (IL-9); the base chart in Israel.
    let israelOfficialChart = IsraelOfficialChartLayer()

    // MARK: - Configuration

    /// Bundled base style. The style document itself is local so it loads with no connectivity:
    /// every flight layer is added from `onStyleLoaded`, which only runs after the style loads,
    /// and an iPad in flight is typically offline. Its raster basemap tiles are fetched (and
    /// cached by MapLibre) when online; offline, the plain background shows beneath the layers.
    static let baseStyleURL: URL? = Bundle.main.url(forResource: "base-style", withExtension: "json")

    /// Store reference to map view, load the bundled style, and set the initial camera
    /// (default CONUS: 39N, 98W, zoom 5; pass the region's home view otherwise).
    func configure(
        mapView: MLNMapView,
        center: CLLocationCoordinate2D = CLLocationCoordinate2D(latitude: 39.0, longitude: -98.0),
        zoom: Double = 5.0
    ) {
        self.mapView = mapView
        #if DEBUG
        OfflineBlockingURLProtocol.installIfRequested()
        #endif
        if let styleURL = Self.baseStyleURL {
            mapView.styleURL = styleURL
        }
        mapView.setCenter(center, zoomLevel: zoom, animated: false)
    }

    // MARK: - Style Loaded

    /// Called when map style finishes loading. Creates all GeoJSON sources and style layers.
    func onStyleLoaded(style: MLNStyle) {
        appliedMapStyle = nil  // fresh style: base layers back to their JSON defaults
        appliedNight = nil
        addOwnshipLayer(to: style)
        addAirportLayer(to: style)
        addNavaidLayer(to: style)
        addAirspaceLayer(to: style)
        addWeatherDotLayer(to: style)
        addTFRLayer(to: style)
        addAdvisoryLayer(to: style)
        addRouteLayer(to: style)
        addTrackRulerLayers(to: style)
        if let mapView { airportDiagramOverlay.attach(style: style, mapView: mapView) }
        israelChart.attach(style: style)
        israelLSA.attach(style: style)
        israelOfficialChart.attach(style: style)
    }

    // MARK: - Ownship Layer

    private func addOwnshipLayer(to style: MLNStyle) {
        // Create chevron icons programmatically (32x32pt aviation triangle): blue for a live
        // fix, grey when the last fix is stale (F5) so a frozen position never looks current.
        style.setImage(createOwnshipChevron(fill: MapColor.ownship), forName: Self.ownshipLiveIcon)
        style.setImage(createOwnshipChevron(fill: MapColor.ownshipStale), forName: Self.ownshipStaleIcon)

        // Ownship exists only once there is a fix. Before that the source is empty: a chevron at
        // a placeholder position would read as the aircraft's live position (it used to sit in
        // Kansas). A style reload re-seeds from the last fix.
        let seed: MLNPointFeature?
        if let location = lastOwnshipLocation {
            let point = MLNPointFeature()
            point.coordinate = location.coordinate
            point.attributes = [
                "heading": lastOwnshipHeading,
                "icon": ownshipStale ? Self.ownshipStaleIcon : Self.ownshipLiveIcon
            ]
            seed = point
        } else {
            seed = nil
        }

        let source = MLNShapeSource(identifier: "ownship", shape: seed, options: nil)
        style.addSource(source)
        self.ownshipSource = source

        let layer = MLNSymbolStyleLayer(identifier: "ownship-symbol", source: source)
        layer.iconImageName = NSExpression(forKeyPath: "icon")
        layer.iconRotation = NSExpression(forKeyPath: "heading")
        layer.iconAllowsOverlap = NSExpression(forConstantValue: true)
        layer.iconIgnoresPlacement = NSExpression(forConstantValue: true)
        layer.iconScale = NSExpression(forConstantValue: 1.0)
        layer.iconRotationAlignment = NSExpression(forConstantValue: "map")
        style.addLayer(layer)
    }

    static let ownshipLiveIcon = "ownship-chevron"
    static let ownshipStaleIcon = "ownship-chevron-stale"

    /// Last ownship fix drawn, so the icon can be swapped when staleness changes.
    private var lastOwnshipLocation: CLLocation?
    private var lastOwnshipHeading: Double = 0   // degrees true
    private var ownshipStale: Bool = false

    /// Create a 32x32pt aviation chevron icon using UIGraphicsImageRenderer
    private func createOwnshipChevron(fill: UIColor) -> UIImage {
        let size = CGSize(width: 32, height: 32)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { context in
            let ctx = context.cgContext
            let path = CGMutablePath()
            path.move(to: CGPoint(x: 16, y: 3))      // top center (nose)
            path.addLine(to: CGPoint(x: 26, y: 28))   // bottom right
            path.addLine(to: CGPoint(x: 16, y: 22))   // center notch
            path.addLine(to: CGPoint(x: 6, y: 28))    // bottom left
            path.closeSubpath()

            // Dark halo first (outer ring), then fill, then a thin white inner edge: reads on
            // yellow city tint, blue water and dark terrain alike (F13)
            ctx.setLineJoin(.round)
            ctx.setStrokeColor(UIColor(white: 0.05, alpha: 1).cgColor)
            ctx.setLineWidth(4.0)
            ctx.addPath(path)
            ctx.strokePath()

            ctx.setFillColor(fill.cgColor)
            ctx.addPath(path)
            ctx.fillPath()

            ctx.setStrokeColor(UIColor.white.cgColor)
            ctx.setLineWidth(1.5)
            ctx.addPath(path)
            ctx.strokePath()
        }
    }

    // MARK: - Airport Layer

    private func addAirportLayer(to style: MLNStyle) {
        let source = MLNShapeSource(
            identifier: "airports",
            shape: MLNShapeCollectionFeature(shapes: []),
            options: nil
        )
        style.addSource(source)
        self.airportSource = source

        let circleLayer = MLNCircleStyleLayer(identifier: "airport-circles", source: source)
        circleLayer.circleRadius = NSExpression(forConstantValue: 6.5)
        circleLayer.circleColor = NSExpression(forConstantValue: UIColor.systemCyan)
        // Dark ring: cyan on the sectional's yellow city tint needs a contrasting outline (F13)
        circleLayer.circleStrokeWidth = NSExpression(forConstantValue: 2.5)
        circleLayer.circleStrokeColor = NSExpression(forConstantValue: UIColor(white: 0.08, alpha: 1))

        // All airports visible — zoom-dependent filtering deferred to future optimization
        circleLayer.circleOpacity = NSExpression(forConstantValue: 1.0)

        style.addLayer(circleLayer)
    }

    // MARK: - Navaid Layer

    private func addNavaidLayer(to style: MLNStyle) {
        let source = MLNShapeSource(
            identifier: "navaids",
            shape: MLNShapeCollectionFeature(shapes: []),
            options: nil
        )
        style.addSource(source)
        self.navaidSource = source

        let circleLayer = MLNCircleStyleLayer(identifier: "navaid-circles", source: source)
        circleLayer.circleRadius = NSExpression(forConstantValue: 5)
        circleLayer.circleColor = NSExpression(forConstantValue: UIColor.systemPurple)
        // Dark ring: legible over the yellow city tint of the sectional (F13)
        circleLayer.circleStrokeWidth = NSExpression(forConstantValue: 2)
        circleLayer.circleStrokeColor = NSExpression(forConstantValue: UIColor(white: 0.08, alpha: 1))
        style.addLayer(circleLayer)
    }

    // MARK: - Airspace Layer

    private func addAirspaceLayer(to style: MLNStyle) {
        let source = MLNShapeSource(
            identifier: "airspaces",
            shape: MLNShapeCollectionFeature(shapes: []),
            options: nil
        )
        style.addSource(source)
        self.airspaceSource = source

        // Fill layer for airspace polygons
        let fillLayer = MLNFillStyleLayer(identifier: "airspace-fill", source: source)
        // Simplified: blue fill at 10% opacity for all airspace classes
        // TODO: Data-driven Class B/C/D colors — requires MapLibre match expression
        fillLayer.fillColor = NSExpression(forConstantValue: MapColor.airspace)
        fillLayer.fillOpacity = NSExpression(forConstantValue: 0.10)
        style.addLayer(fillLayer)

        // Line layer for airspace borders
        let lineLayer = MLNLineStyleLayer(identifier: "airspace-border", source: source)
        // Simplified: blue borders at 2pt for all airspace
        // TODO: Data-driven Charlie purple vs B/D blue — requires MapLibre match expression
        lineLayer.lineColor = NSExpression(forConstantValue: MapColor.airspace)
        lineLayer.lineWidth = NSExpression(forConstantValue: 2.0)
        style.addLayer(lineLayer)

        // Symbol layer for floor/ceiling labels
        let labelLayer = MLNSymbolStyleLayer(identifier: "airspace-labels", source: source)
        labelLayer.text = NSExpression(forKeyPath: "label")
        labelLayer.textFontNames = NSExpression(forConstantValue: ["Noto Sans Regular"])  // must exist on the style's glyph server
        labelLayer.textFontSize = NSExpression(forConstantValue: 10)
        labelLayer.textColor = NSExpression(forConstantValue: UIColor.secondaryLabel)
        labelLayer.textAllowsOverlap = NSExpression(forConstantValue: false)
        style.addLayer(labelLayer)
    }

    // MARK: - Weather Dot Layer

    private func addWeatherDotLayer(to style: MLNStyle) {
        let source = MLNShapeSource(
            identifier: "weather-dots",
            shape: MLNShapeCollectionFeature(shapes: []),
            options: nil
        )
        style.addSource(source)
        self.weatherSource = source

        let circleLayer = MLNCircleStyleLayer(identifier: "weather-circles", source: source)
        circleLayer.circleRadius = NSExpression(forConstantValue: 8)
        circleLayer.circleStrokeWidth = NSExpression(forConstantValue: 1)
        circleLayer.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)

        // Simplified: green weather dots for all categories
        // TODO: Data-driven VFR/MVFR/IFR/LIFR colors — requires MapLibre match expression
        circleLayer.circleColor = NSExpression(forConstantValue: MapColor.weatherDot)
        style.addLayer(circleLayer)
    }

    // MARK: - TFR Layer

    private func addTFRLayer(to style: MLNStyle) {
        let source = MLNShapeSource(
            identifier: "tfrs",
            shape: MLNShapeCollectionFeature(shapes: []),
            options: nil
        )
        style.addSource(source)
        self.tfrSource = source

        // Red fill: 25% for TFRs in effect now, 8% for published-but-not-yet-active ones
        let fillLayer = MLNFillStyleLayer(identifier: "tfr-fill", source: source)
        fillLayer.fillColor = NSExpression(forConstantValue: MapColor.tfr)
        fillLayer.fillOpacity = NSExpression(forKeyPath: "opacity")
        style.addLayer(fillLayer)

        // 2pt solid red border for current data; dashed for a stale snapshot (marked "OLD" in the badge stack)
        let lineLayer = MLNLineStyleLayer(identifier: "tfr-border", source: source)
        lineLayer.lineColor = NSExpression(forConstantValue: MapColor.tfr)
        lineLayer.lineWidth = NSExpression(forConstantValue: 2.0)
        lineLayer.predicate = NSPredicate(format: "stale == 0")
        style.addLayer(lineLayer)

        let staleLineLayer = MLNLineStyleLayer(identifier: "tfr-border-stale", source: source)
        staleLineLayer.lineColor = NSExpression(forConstantValue: MapColor.tfr)
        staleLineLayer.lineWidth = NSExpression(forConstantValue: 2.0)
        staleLineLayer.lineDashPattern = NSExpression(forConstantValue: [2, 2])
        staleLineLayer.predicate = NSPredicate(format: "stale == 1")
        style.addLayer(staleLineLayer)
    }

    // MARK: - Advisory Layer (AIRMET / SIGMET / G-AIRMET)

    /// Fill + outline colored per feature ("color" hex attribute from `AdvisoryStyle`).
    /// Inserted below ownship (the lowest flight-data layer) so airports, TFRs and the
    /// ownship chevron stay readable on top of large advisory areas.
    private func addAdvisoryLayer(to style: MLNStyle) {
        let source = MLNShapeSource(
            identifier: "advisories",
            shape: MLNShapeCollectionFeature(shapes: []),
            options: nil
        )
        style.addSource(source)
        self.advisorySource = source

        let fillLayer = MLNFillStyleLayer(identifier: "advisory-fill", source: source)
        fillLayer.fillColor = NSExpression(forKeyPath: "color")
        fillLayer.fillOpacity = NSExpression(forKeyPath: "opacity")  // 0.15 current, 0.06 stale

        let lineLayer = MLNLineStyleLayer(identifier: "advisory-border", source: source)
        lineLayer.lineColor = NSExpression(forKeyPath: "color")
        lineLayer.lineWidth = NSExpression(forConstantValue: 1.5)
        lineLayer.lineDashPattern = NSExpression(forConstantValue: [4, 2])
        lineLayer.predicate = NSPredicate(format: "stale == 0")

        // Stale snapshot: sparser dots, so it reads differently from a current advisory outline.
        let staleLineLayer = MLNLineStyleLayer(identifier: "advisory-border-stale", source: source)
        staleLineLayer.lineColor = NSExpression(forKeyPath: "color")
        staleLineLayer.lineWidth = NSExpression(forConstantValue: 1.5)
        staleLineLayer.lineDashPattern = NSExpression(forConstantValue: [1, 3])
        staleLineLayer.predicate = NSPredicate(format: "stale == 1")

        if let ownship = style.layer(withIdentifier: "ownship-symbol") {
            style.insertLayer(fillLayer, below: ownship)
            style.insertLayer(lineLayer, below: ownship)
            style.insertLayer(staleLineLayer, below: ownship)
        } else {
            style.addLayer(fillLayer)
            style.addLayer(lineLayer)
            style.addLayer(staleLineLayer)
        }
    }

    // MARK: - Update Methods

    /// Update ownship GeoJSON point with new coordinates and heading (degrees true).
    func updateOwnship(location: CLLocation, heading: Double) {
        lastOwnshipLocation = location
        lastOwnshipHeading = heading
        redrawOwnship()
    }

    /// Grey the chevron when the last fix is older than the stale limit (F5), blue when live.
    func setOwnshipStale(_ stale: Bool) {
        guard stale != ownshipStale else { return }
        ownshipStale = stale
        redrawOwnship()
    }

    private func redrawOwnship() {
        guard let location = lastOwnshipLocation else { return }
        let point = MLNPointFeature()
        point.coordinate = location.coordinate
        point.attributes = [
            "heading": lastOwnshipHeading,
            "icon": ownshipStale ? Self.ownshipStaleIcon : Self.ownshipLiveIcon
        ]
        ownshipSource?.shape = point
    }

    /// Build GeoJSON FeatureCollection from airport array and update source.
    func updateAirports(_ airports: [Airport]) {
        let features = airports.map { airport -> MLNPointFeature in
            let feature = MLNPointFeature()
            feature.coordinate = airport.coordinate
            feature.attributes = [
                "icao": airport.icao,
                "name": airport.name,
                "type": airport.type.rawValue,
                "isTowered": airport.frequencies.contains { $0.type == .tower }
            ]
            return feature
        }
        let collection = MLNShapeCollectionFeature(shapes: features)
        airportSource?.shape = collection
    }

    /// Build GeoJSON FeatureCollection from navaid array and update source.
    func updateNavaids(_ navaids: [Navaid]) {
        let features = navaids.map { navaid -> MLNPointFeature in
            let feature = MLNPointFeature()
            feature.coordinate = navaid.coordinate
            feature.attributes = [
                "id": navaid.id,
                "name": navaid.name,
                "type": navaid.type.rawValue
            ]
            return feature
        }
        let collection = MLNShapeCollectionFeature(shapes: features)
        navaidSource?.shape = collection
    }

    /// Build GeoJSON FeatureCollection with Polygon geometries from airspace coordinates.
    func updateAirspaces(_ airspaces: [Airspace]) {
        let features: [MLNShape] = airspaces.compactMap { airspace in
            switch airspace.geometry {
            case .polygon(let coordinates):
                guard coordinates.count >= 3 else { return nil }
                var coords = coordinates.map {
                    CLLocationCoordinate2D(latitude: $0[0], longitude: $0[1])
                }
                let polygon = MLNPolygonFeature(coordinates: &coords, count: UInt(coords.count))
                polygon.attributes = [
                    "name": airspace.name,
                    "airspaceClass": airspace.classification.rawValue,
                    "floorAltitude": airspace.floor,
                    "ceilingAltitude": airspace.ceiling,
                    "label": "\(airspace.floor)/\(airspace.ceiling)"
                ]
                return polygon

            case .circle(let center, let radiusNM):
                guard center.count >= 2 else { return nil }
                // Approximate circle as 36-point polygon
                let centerCoord = CLLocationCoordinate2D(latitude: center[0], longitude: center[1])
                let radiusMeters = radiusNM * 1852.0
                var coords = (0..<36).map { i -> CLLocationCoordinate2D in
                    let angle = Double(i) * (360.0 / 36.0) * .pi / 180.0
                    let lat = centerCoord.latitude + (radiusMeters / 111320.0) * cos(angle)
                    let lon = centerCoord.longitude + (radiusMeters / (111320.0 * cos(centerCoord.latitude * .pi / 180.0))) * sin(angle)
                    return CLLocationCoordinate2D(latitude: lat, longitude: lon)
                }
                let polygon = MLNPolygonFeature(coordinates: &coords, count: UInt(coords.count))
                polygon.attributes = [
                    "name": airspace.name,
                    "airspaceClass": airspace.classification.rawValue,
                    "floorAltitude": airspace.floor,
                    "ceilingAltitude": airspace.ceiling,
                    "label": "\(airspace.floor)/\(airspace.ceiling)"
                ]
                return polygon
            }
        }
        let collection = MLNShapeCollectionFeature(shapes: features)
        airspaceSource?.shape = collection
    }

    /// Build GeoJSON FeatureCollection from weather cache for map dots.
    /// Requires a coordinate lookup dictionary mapping station IDs to airport coordinates.
    func updateWeatherDots(_ weather: [WeatherCache], stationCoordinates: [String: CLLocationCoordinate2D]) {
        let features = weather.compactMap { wx -> MLNPointFeature? in
            guard let coordinate = stationCoordinates[wx.stationID] else {
                // Weather data without coordinates -- skip (no matching airport in DB)
                return nil
            }
            let feature = MLNPointFeature()
            feature.coordinate = coordinate
            feature.attributes = [
                "stationID": wx.stationID,
                "flightCategory": wx.flightCategory.rawValue
            ]
            return feature
        }
        let collection = MLNShapeCollectionFeature(shapes: features)
        weatherSource?.shape = collection
    }

    /// Draw TFR polygons. In-effect TFRs get a stronger fill than upcoming ones; expired
    /// TFRs (possible when serving a stale cache) are skipped. A stale snapshot (`stale`) is drawn
    /// with a fainter fill and a dashed border; the caller passes no TFRs at all once the snapshot
    /// is past its useful life (it is never drawn as current).
    func updateTFRs(_ tfrs: [TFR], now: Date = Date(), stale: Bool = false) {
        let features: [MLNShape] = tfrs.compactMap { tfr -> MLNShape? in
            if let expiration = tfr.expirationDate, expiration < now { return nil }
            guard let polygon = Self.polygonFeature(tfr.boundaries) else { return nil }
            let opacity = tfr.isActive(at: now) ? 0.25 : 0.08
            polygon.attributes = [
                "id": tfr.id,
                "notam": tfr.notamID,
                "type": tfr.type.rawValue,
                "altitudes": tfr.altitudeDescription,
                "opacity": stale ? opacity * 0.5 : opacity,
                "stale": stale ? 1 : 0
            ]
            return polygon
        }
        tfrSource?.shape = MLNShapeCollectionFeature(shapes: features)
    }

    /// Draw advisory polygons, colored by hazard. Callers pass only currently valid advisories,
    /// and none once the snapshot is past its useful life. `stale` draws a fainter, sparser-dashed style.
    func updateAdvisories(_ advisories: [AviationAdvisory], stale: Bool = false) {
        let features: [MLNShape] = advisories.compactMap { advisory -> MLNShape? in
            guard let polygon = Self.polygonFeature(advisory.boundaries) else { return nil }
            polygon.attributes = [
                "id": advisory.id,
                "kind": advisory.kind.rawValue,
                "hazard": advisory.hazardCode,
                "color": advisory.colorHex,
                "opacity": stale ? 0.06 : 0.15,
                "stale": stale ? 1 : 0
            ]
            return polygon
        }
        advisorySource?.shape = MLNShapeCollectionFeature(shapes: features)
    }

    /// Polygon feature from a [lat, lon] ring; nil for degenerate rings.
    private static func polygonFeature(_ ring: [[Double]]) -> MLNPolygonFeature? {
        var coords = ring.compactMap { point -> CLLocationCoordinate2D? in
            point.count >= 2 ? CLLocationCoordinate2D(latitude: point[0], longitude: point[1]) : nil
        }
        guard coords.count >= 3 else { return nil }
        return MLNPolygonFeature(coordinates: &coords, count: UInt(coords.count))
    }

    // MARK: - Route Layer

    private func addRouteLayer(to style: MLNStyle) {
        // GeoJSON source for the flight plan route line — start empty
        let source = MLNShapeSource(identifier: "route-line", shape: MLNShapeCollectionFeature(shapes: []), options: nil)
        style.addSource(source)
        self.routeSource = source

        // Aviation magenta 3pt line with rounded caps/joins; `applyDisplayMode` swaps the night tint.
        let lineLayer = MLNLineStyleLayer(identifier: "route-line-layer", source: source)
        lineLayer.lineColor = NSExpression(forConstantValue: Palette.routeLineDay)
        lineLayer.lineWidth = NSExpression(forConstantValue: 3.0)
        lineLayer.lineCap = NSExpression(forConstantValue: "round")
        lineLayer.lineJoin = NSExpression(forConstantValue: "round")
        style.addLayer(lineLayer)
    }

    /// Draw a great-circle route line between departure and destination.
    func updateRoute(departure: CLLocationCoordinate2D, destination: CLLocationCoordinate2D) {
        let coords = CLLocationCoordinate2D.greatCirclePoints(from: departure, to: destination, count: 100)
        var mutableCoords = coords
        let polyline = MLNPolylineFeature(coordinates: &mutableCoords, count: UInt(coords.count))
        routeSource?.shape = polyline
    }

    /// Draw a routed path along its own vertices (Israel CVFR route).
    func updateRoute(path: [CLLocationCoordinate2D]) {
        guard path.count >= 2 else { return }
        var coords = path
        routeSource?.shape = MLNPolylineFeature(coordinates: &coords, count: UInt(coords.count))
        raiseRouteLayer()
    }

    /// The Israel chart's route lines are added after the route layer and would hide it; put the route and the
    /// track ruler back on top (below ownship).
    private func raiseRouteLayer() {
        guard let style = mapView?.style else { return }
        for id in ["route-line-layer"] + Self.trackRulerLayerIDs {
            guard let layer = style.layer(withIdentifier: id) else { continue }
            style.removeLayer(layer)
            if let ownship = style.layer(withIdentifier: "ownship-symbol") {
                style.insertLayer(layer, below: ownship)
            } else {
                style.addLayer(layer)
            }
        }
    }

    /// Clear the route line from the map.
    func clearRoute() {
        routeSource?.shape = MLNShapeCollectionFeature(shapes: [])

        // Remove route annotations (departure/destination pins)
        if !routeAnnotations.isEmpty {
            mapView?.removeAnnotations(routeAnnotations)
            routeAnnotations.removeAll()
        }
    }

    /// Add departure and destination pin annotations for the route.
    func addRoutePins(departure: CLLocationCoordinate2D, destination: CLLocationCoordinate2D) {
        // Remove previous route annotations
        if !routeAnnotations.isEmpty {
            mapView?.removeAnnotations(routeAnnotations)
            routeAnnotations.removeAll()
        }

        let depAnnotation = MLNPointAnnotation()
        depAnnotation.coordinate = departure
        depAnnotation.title = "DEP"

        let destAnnotation = MLNPointAnnotation()
        destAnnotation.coordinate = destination
        destAnnotation.title = "DEST"

        routeAnnotations = [depAnnotation, destAnnotation]
        mapView?.addAnnotations(routeAnnotations)
    }

    // MARK: - Track Ruler

    /// Minutes ahead marked on the ruler; the line runs to the last one.
    private static let trackRulerMinutes: [Double] = [1, 2, 3, 5, 10]
    private static let trackRulerLayerIDs = ["track-ruler-line", "track-ruler-ticks"]
    private static let trackRulerTickIcon = "track-ruler-tick"

    private var trackRulerLineSource: MLNShapeSource?
    private var trackRulerTickSource: MLNShapeSource?
    /// Last ruler inputs, so a style reload re-seeds the ruler.
    private var lastTrackRuler: (origin: CLLocationCoordinate2D?, trackTrue: Double, groundSpeedKnots: Double)?

    private func addTrackRulerLayers(to style: MLNStyle) {
        // 2 x 12 pt bar drawn across the track; a template image is an SDF icon, so `iconColor` tints it.
        let tick = UIGraphicsImageRenderer(size: CGSize(width: 12, height: 2)).image { ctx in
            UIColor.black.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 12, height: 2))
        }.withRenderingMode(.alwaysTemplate)
        style.setImage(tick, forName: Self.trackRulerTickIcon)

        let lineSource = MLNShapeSource(identifier: "track-ruler-line", shape: nil, options: nil)
        let tickSource = MLNShapeSource(identifier: "track-ruler-ticks", shape: nil, options: nil)
        style.addSource(lineSource)
        style.addSource(tickSource)
        trackRulerLineSource = lineSource
        trackRulerTickSource = tickSource

        let line = MLNLineStyleLayer(identifier: "track-ruler-line", source: lineSource)
        line.lineColor = NSExpression(forConstantValue: MapColor.trackRulerDay)
        line.lineWidth = NSExpression(forConstantValue: 2.0)

        let ticks = MLNSymbolStyleLayer(identifier: "track-ruler-ticks", source: tickSource)
        ticks.iconImageName = NSExpression(forConstantValue: Self.trackRulerTickIcon)
        ticks.iconColor = NSExpression(forConstantValue: MapColor.trackRulerDay)
        ticks.iconRotation = NSExpression(forKeyPath: "track")
        ticks.iconRotationAlignment = NSExpression(forConstantValue: "map")
        ticks.iconAllowsOverlap = NSExpression(forConstantValue: true)
        ticks.iconIgnoresPlacement = NSExpression(forConstantValue: true)
        ticks.text = NSExpression(forKeyPath: "label")
        ticks.textFontNames = NSExpression(forConstantValue: ["Noto Sans Regular"])
        ticks.textFontSize = NSExpression(forConstantValue: 12)
        ticks.textColor = NSExpression(forConstantValue: MapColor.trackRulerDay)
        ticks.textHaloColor = NSExpression(forConstantValue: MapColor.trackRulerHaloDay)
        ticks.textHaloWidth = NSExpression(forConstantValue: 1.5)
        ticks.textAnchor = NSExpression(forKeyPath: "anchor")
        ticks.textOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0.7, dy: 0.7)))
        ticks.textAllowsOverlap = NSExpression(forConstantValue: true)

        if let ownship = style.layer(withIdentifier: "ownship-symbol") {
            style.insertLayer(line, below: ownship)
            style.insertLayer(ticks, below: ownship)
        } else {
            style.addLayer(line)
            style.addLayer(ticks)
        }

        if let last = lastTrackRuler {
            updateTrackRuler(origin: last.origin, trackTrue: last.trackTrue, groundSpeedKnots: last.groundSpeedKnots)
        }
    }

    /// Straight line from ownship along `trackTrue` (degrees true) to the 10-minute point at `groundSpeedKnots`,
    /// ticked and labelled at 1, 2, 3, 5 and 10 minutes. A nil origin (no fix or a stale fix) or a ground speed
    /// below 30 kt clears it: a ruler from a frozen or taxiing position would mislead.
    func updateTrackRuler(origin: CLLocationCoordinate2D?, trackTrue: Double, groundSpeedKnots: Double) {
        lastTrackRuler = (origin, trackTrue, groundSpeedKnots)
        guard let origin, groundSpeedKnots >= 30 else {
            trackRulerLineSource?.shape = nil
            trackRulerTickSource?.shape = nil
            return
        }
        // Labels sit beside the ruler: right of a line that runs up/down the screen, below one that runs across.
        let screenAngle = (trackTrue - (mapView?.direction ?? 0)).degreesToRadians
        let anchor = abs(sin(screenAngle)) > 0.707 ? "top" : "left"
        let ticks = Self.trackRulerMinutes.map { minutes -> MLNPointFeature in
            let tick = MLNPointFeature()
            // NM = knots * minutes / 60
            tick.coordinate = origin.destination(distanceNM: groundSpeedKnots * minutes / 60, bearingDegrees: trackTrue)
            tick.attributes = [
                "track": trackTrue,
                "anchor": anchor,
                "label": minutes == 1 ? "1 min" : minutes == 10 ? "10 min" : String(Int(minutes))
            ]
            return tick
        }
        var line = [origin, ticks.last?.coordinate ?? origin]
        trackRulerLineSource?.shape = MLNPolylineFeature(coordinates: &line, count: UInt(line.count))
        trackRulerTickSource?.shape = MLNShapeCollectionFeature(shapes: ticks)
    }

    // MARK: - Replay Layers (on-demand, not in onStyleLoaded)

    /// Add replay track polyline and position marker layers to the map style.
    /// Called when entering replay mode -- NOT in onStyleLoaded to avoid replay artifacts during navigation.
    func addReplayLayers(to style: MLNStyle) {
        // Replay track polyline -- orange 3pt line (distinct from magenta route line)
        let trackSource = MLNShapeSource(
            identifier: "replay-track",
            shape: MLNShapeCollectionFeature(shapes: []),
            options: nil
        )
        style.addSource(trackSource)
        self.replayTrackSource = trackSource

        let lineLayer = MLNLineStyleLayer(identifier: "replay-track-line", source: trackSource)
        lineLayer.lineColor = NSExpression(forConstantValue: MapColor.replay)
        lineLayer.lineWidth = NSExpression(forConstantValue: 3.0)
        lineLayer.lineCap = NSExpression(forConstantValue: "round")
        lineLayer.lineJoin = NSExpression(forConstantValue: "round")
        style.addLayer(lineLayer)

        // Replay marker icon -- 24pt orange circle with white center dot
        let markerIcon = createReplayMarkerIcon()
        style.setImage(markerIcon, forName: "replay-marker")

        // Replay position marker -- single point that moves along the track
        let markerPoint = MLNPointFeature()
        markerPoint.coordinate = CLLocationCoordinate2D(latitude: 0, longitude: 0)
        markerPoint.attributes = ["heading": 0]

        let markerSource = MLNShapeSource(identifier: "replay-marker", shape: markerPoint, options: nil)
        style.addSource(markerSource)
        self.replayMarkerSource = markerSource

        let symbolLayer = MLNSymbolStyleLayer(identifier: "replay-marker-symbol", source: markerSource)
        symbolLayer.iconImageName = NSExpression(forConstantValue: "replay-marker")
        symbolLayer.iconRotation = NSExpression(forKeyPath: "heading")
        symbolLayer.iconAllowsOverlap = NSExpression(forConstantValue: true)
        symbolLayer.iconIgnoresPlacement = NSExpression(forConstantValue: true)
        symbolLayer.iconScale = NSExpression(forConstantValue: 1.0)
        symbolLayer.iconRotationAlignment = NSExpression(forConstantValue: "map")
        style.addLayer(symbolLayer)
    }

    /// Create a 24x24pt orange circle with white center dot for replay position marker.
    /// Distinct from the blue ownship chevron -- indicates replayed position, not live.
    private func createReplayMarkerIcon() -> UIImage {
        let size = CGSize(width: 24, height: 24)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { context in
            let ctx = context.cgContext
            let center = CGPoint(x: 12, y: 12)

            // Filled orange circle
            ctx.setFillColor(MapColor.replay.cgColor)
            ctx.addEllipse(in: CGRect(x: 0, y: 0, width: 24, height: 24))
            ctx.fillPath()

            // White outline for contrast
            ctx.setStrokeColor(UIColor.white.cgColor)
            ctx.setLineWidth(1.5)
            ctx.addEllipse(in: CGRect(x: 0.75, y: 0.75, width: 22.5, height: 22.5))
            ctx.strokePath()

            // White center dot (4pt diameter)
            ctx.setFillColor(UIColor.white.cgColor)
            ctx.addEllipse(in: CGRect(x: center.x - 2, y: center.y - 2, width: 4, height: 4))
            ctx.fillPath()
        }
    }

    /// Set the replay track polyline from track point coordinates.
    /// Called ONCE when loading a flight for replay.
    func updateReplayTrack(_ trackPoints: [TrackPointRecord]) {
        var coords = trackPoints.map {
            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        }
        guard !coords.isEmpty else {
            replayTrackSource?.shape = MLNShapeCollectionFeature(shapes: [])
            return
        }
        let polyline = MLNPolylineFeature(coordinates: &coords, count: UInt(coords.count))
        replayTrackSource?.shape = polyline
    }

    /// Update the replay position marker to the current interpolated coordinate.
    /// Called at 20Hz from ReplayEngine tick during playback.
    func updateReplayMarker(coordinate: CLLocationCoordinate2D, heading: Double) {
        let point = MLNPointFeature()
        point.coordinate = coordinate
        point.attributes = ["heading": heading]
        replayMarkerSource?.shape = point
    }

    /// Remove all replay layers and sources from the map style.
    /// Called when exiting replay mode to clean up.
    func removeReplayLayers() {
        guard let style = mapView?.style else { return }

        // Remove layers first, then sources (layers reference sources)
        if let _ = style.layer(withIdentifier: "replay-track-line") {
            style.removeLayer(style.layer(withIdentifier: "replay-track-line")!)
        }
        if let _ = style.layer(withIdentifier: "replay-marker-symbol") {
            style.removeLayer(style.layer(withIdentifier: "replay-marker-symbol")!)
        }
        if let _ = style.source(withIdentifier: "replay-track") {
            style.removeSource(style.source(withIdentifier: "replay-track")!)
        }
        if let _ = style.source(withIdentifier: "replay-marker") {
            style.removeSource(style.source(withIdentifier: "replay-marker")!)
        }

        replayTrackSource = nil
        replayMarkerSource = nil
    }

    /// Fit the map view to show the entire replay track with padding.
    /// Called when replay view first opens to show the full flight track.
    func fitMapToTrack(_ trackPoints: [TrackPointRecord]) {
        guard !trackPoints.isEmpty else { return }

        var minLat = trackPoints[0].latitude
        var maxLat = trackPoints[0].latitude
        var minLon = trackPoints[0].longitude
        var maxLon = trackPoints[0].longitude

        for point in trackPoints {
            minLat = min(minLat, point.latitude)
            maxLat = max(maxLat, point.latitude)
            minLon = min(minLon, point.longitude)
            maxLon = max(maxLon, point.longitude)
        }

        let sw = CLLocationCoordinate2D(latitude: minLat, longitude: minLon)
        let ne = CLLocationCoordinate2D(latitude: maxLat, longitude: maxLon)
        let bounds = MLNCoordinateBounds(sw: sw, ne: ne)
        let padding = UIEdgeInsets(top: 50, left: 50, bottom: 50, right: 50)

        mapView?.setVisibleCoordinateBounds(bounds, edgePadding: padding, animated: true, completionHandler: nil)
    }

    /// Center the map on a specific coordinate.
    /// Used by auto-follow mode during replay playback.
    func centerOnCoordinate(_ coordinate: CLLocationCoordinate2D, animated: Bool = true) {
        mapView?.setCenter(coordinate, animated: animated)
    }

    // MARK: - Layer Visibility

    /// Toggle style layer visibility by MapLayer enum.
    func setLayerVisibility(_ layer: MapLayer, visible: Bool) {
        if layer == .lsaRoutes {
            israelLSA.setLayerVisible(visible)
            return
        }
        if layer.isCVFRChart {
            israelChart.setVisible(layer, visible: visible)
            return
        }
        guard let style = mapView?.style else { return }
        let layerIDs = layerIdentifiers(for: layer)
        for id in layerIDs {
            style.layer(withIdentifier: id)?.isVisible = visible
        }
    }

    /// Map MapLayer enum to MapLibre style layer identifiers.
    private func layerIdentifiers(for layer: MapLayer) -> [String] {
        switch layer {
        case .airports: return ["airport-circles"]
        case .navaids: return ["navaid-circles"]
        case .airspace: return ["airspace-fill", "airspace-border", "airspace-labels"]
        case .weatherDots: return ["weather-circles"]
        case .tfrs: return ["tfr-fill", "tfr-border", "tfr-border-stale"]
        case .advisories: return ["advisory-fill", "advisory-border", "advisory-border-stale"]
        case .ownship: return ["ownship-symbol"]
        case .sectional: return []  // the sectional is a base-style.json layer driven by `setMapStyle`
        // The route line is shown by having a route in its source, never hidden by the layer sync:
        // `.route` is not in `visibleLayers`, so the sync would hide a drawn route on its next pass.
        case .route: return []
        case .cvfrRoutes, .cvfrPoints, .cvfrAirspace, .cvfrRunways, .cvfrClosures: return []  // drawn by `israelChart`
        case .lsaRoutes: return []  // drawn by `israelLSA`
        }
    }

    // MARK: - Base Map Style

    /// Base map and sectional state last applied to the current style; nil until applied after a style load.
    private var appliedMapStyle: MapStyle?
    private var appliedSectional: Bool?

    /// Show the base-style.json layers for `mapStyle`, hide the rest, and show the FAA sectional
    /// over any base map when `sectional` is true (F17: the sectional is an overlay, not a base).
    /// `.vfrSectional` is the legacy "street" base. Toggles visibility instead of swapping styles,
    /// so the flight data layers added in `onStyleLoaded` survive.
    func setMapStyle(_ mapStyle: MapStyle, sectional: Bool) {
        guard mapStyle != appliedMapStyle || sectional != appliedSectional,
              let style = mapView?.style else { return }

        let showStreet = mapStyle == .street || mapStyle == .vfrSectional
        for layer in style.layers where layer.identifier.hasPrefix("street-") {
            layer.isVisible = showStreet
        }
        style.layer(withIdentifier: "base-vfr-sectional")?.isVisible = sectional
        appliedMapStyle = mapStyle
        appliedSectional = sectional
    }

    // MARK: - Sectional Opacity

    /// Update raster opacity of the FAA sectional base layer.
    func setSectionalOpacity(_ opacity: Double) {
        let value = NSExpression(forConstantValue: opacity)
        (mapView?.style?.layer(withIdentifier: "base-vfr-sectional") as? MLNRasterStyleLayer)?.rasterOpacity = value
    }

    // MARK: - Night Dimming

    /// Night state last applied to the current style; nil until applied after a style load.
    private var appliedNight: Bool?

    /// Dim (night) or restore (day) the raster base layer: the sectional.
    /// Brightness ceiling + desaturation keep the chart readable without washing out night vision.
    func applyDisplayMode(night: Bool) {
        guard night != appliedNight, let style = mapView?.style else { return }
        for id in ["base-vfr-sectional"] {
            guard let layer = style.layer(withIdentifier: id) as? MLNRasterStyleLayer else { continue }
            layer.maximumRasterBrightness = NSExpression(
                forConstantValue: night ? NightPalette.rasterBrightnessMax : 1.0
            )
            layer.rasterSaturation = NSExpression(
                forConstantValue: night ? NightPalette.rasterSaturation : 0.0
            )
        }
        // Symbol dots: bright cyan/purple glare against the dimmed chart, so mute them at night.
        if let airports = style.layer(withIdentifier: "airport-circles") as? MLNCircleStyleLayer {
            airports.circleColor = NSExpression(
                forConstantValue: night ? NightPalette.airportDot : UIColor.systemCyan
            )
        }
        if let navaids = style.layer(withIdentifier: "navaid-circles") as? MLNCircleStyleLayer {
            navaids.circleColor = NSExpression(
                forConstantValue: night ? NightPalette.navaidDot : UIColor.systemPurple
            )
        }
        if let route = style.layer(withIdentifier: "route-line-layer") as? MLNLineStyleLayer {
            route.lineColor = NSExpression(forConstantValue: night ? Palette.routeLineNight : Palette.routeLineDay)
        }
        for id in Self.trackRulerLayerIDs {
            let ink = night ? MapColor.trackRulerNight : MapColor.trackRulerDay
            if let line = style.layer(withIdentifier: id) as? MLNLineStyleLayer {
                line.lineColor = NSExpression(forConstantValue: ink)
            } else if let ticks = style.layer(withIdentifier: id) as? MLNSymbolStyleLayer {
                ticks.iconColor = NSExpression(forConstantValue: ink)
                ticks.textColor = NSExpression(forConstantValue: ink)
                ticks.textHaloColor = NSExpression(forConstantValue: night ? MapColor.trackRulerHaloNight : MapColor.trackRulerHaloDay)
            }
        }
        airportDiagramOverlay.applyDisplayMode(night: night)
        israelChart.applyDisplayMode(night: night)
        israelOfficialChart.applyDisplayMode(night: night)
        appliedNight = night
    }

    // MARK: - Animation

    /// Animate map to a location with zoom level.
    func animateToLocation(_ coordinate: CLLocationCoordinate2D, zoom: Double) {
        mapView?.setCenter(coordinate, zoomLevel: zoom, direction: mapView?.direction ?? 0, animated: true)
    }

    // MARK: - Camera (follow ownship / track-up)

    /// Move the camera. Nil `center` keeps the current centre; nil `zoom` keeps the current
    /// zoom; `direction` is degrees clockwise from north (0 = north-up, GPS track for
    /// track-up). Always a plain camera move: MapLibre's user-tracking mode is never used
    /// because it draws the system location puck next to our chevron (F4).
    func setCamera(center: CLLocationCoordinate2D?, zoom: Double?, direction: Double, animated: Bool) {
        guard let mapView else { return }
        mapView.setCenter(
            center ?? mapView.centerCoordinate,
            zoomLevel: zoom ?? mapView.zoomLevel,
            direction: direction,
            animated: animated
        )
    }

    /// Current map rotation in degrees clockwise from north.
    var currentDirection: Double { mapView?.direction ?? 0 }

}
