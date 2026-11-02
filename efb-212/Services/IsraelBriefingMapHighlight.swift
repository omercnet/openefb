//
//  IsraelBriefingMapHighlight.swift
//  efb-212
//
//  "Show on map" for a briefing NOTAM (IL-BRIEF): draws the NOTAM's area (E) polygon, circle, or the
//  Q-line circle) and any closed chains on the map in one dedicated source, and frames it. Kept out of
//  MapService and IsraelChartOverlay so those files stay untouched; the source is replaced on each call.
//

import CoreLocation
import MapLibre
import UIKit

nonisolated enum IsraelBriefingGeometry {

    /// Ring approximating a circle -- `radiusNM` nautical miles around `centre`.
    static func circleRing(centre: IsraelLatLon, radiusNM: Double, points: Int = 72) -> [CLLocationCoordinate2D] {
        let latStep = radiusNM / 60
        let lonStep = radiusNM / (60 * max(0.1, cos(centre.lat * .pi / 180)))
        return (0..<points).map { i in
            let angle = Double(i) / Double(points) * 2 * .pi
            return CLLocationCoordinate2D(latitude: centre.lat + latStep * sin(angle), longitude: centre.lon + lonStep * cos(angle))
        }
    }

    /// Areas (closed rings) and lines (chains) to draw for a NOTAM.
    static func shapes(
        for notam: IsraelNotam, pointLookup: (String) -> IsraelLatLon?
    ) -> (rings: [[CLLocationCoordinate2D]], lines: [[CLLocationCoordinate2D]]) {
        var rings: [[CLLocationCoordinate2D]] = []
        var qLineFallback = false
        if let polygon = notam.geometry.polygon, polygon.count >= 3 {
            rings.append(polygon.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) })
        } else if let circle = notam.geometry.circle {
            rings.append(circleRing(centre: circle.centre, radiusNM: circle.radiusNM))
            qLineFallback = true   // the relay copies the Q-line circle here for route closures
        } else if let centre = notam.q?.centre, let radius = notam.q?.radiusNM, radius < 100 {
            // A Q-line circle of 100 NM or more is a FIR-wide placeholder, not a place.
            rings.append(circleRing(centre: centre, radiusNM: radius))
            qLineFallback = true
        }
        var lines: [[CLLocationCoordinate2D]] = []
        for closure in notam.closures {
            let coordinates = closure.chain.compactMap(pointLookup).map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon) }
            if coordinates.count >= 2 { lines.append(coordinates) }
        }
        // A route closure is the chain itself. The Q-line circle is only the NOTAM's scope (tens of NM wide), and
        // drawn filled it read as "this whole area is closed" (UX-IL).
        if qLineFallback, !lines.isEmpty { rings = [] }
        return (rings, lines)
    }
}

@MainActor
enum IsraelBriefingMapHighlight {
    private static let sourceID = "il-brief-highlight"
    private static let fillID = "il-brief-highlight-fill"
    private static let lineID = "il-brief-highlight-line"

    /// Draw and frame the NOTAM. Returns false when it has nothing drawable or the map isn't ready.
    @discardableResult
    static func show(
        _ notam: IsraelNotam, color: UIColor, on mapService: MapService?,
        database: (any IsraelAviationDatabaseProtocol)? = try? IsraelAviationDatabase.bundled()
    ) -> Bool {
        guard let mapView = mapService?.mapView, let style = mapView.style else { return false }
        let lookup: (String) -> IsraelLatLon? = { code in
            (try? database?.reportingPoint(code: code)).flatMap { $0 }.map { IsraelLatLon(lat: $0.latitude, lon: $0.longitude) }
                ?? (try? database?.aerodrome(code: code)).flatMap { $0 }.map { IsraelLatLon(lat: $0.latitude, lon: $0.longitude) }
        }
        let (rings, lines) = IsraelBriefingGeometry.shapes(for: notam, pointLookup: lookup)
        guard !rings.isEmpty || !lines.isEmpty else { return false }

        var shapes: [MLNShape] = []
        for ring in rings {
            var coordinates = ring
            shapes.append(MLNPolygonFeature(coordinates: &coordinates, count: UInt(coordinates.count)))
        }
        for line in lines {
            var coordinates = line
            shapes.append(MLNPolylineFeature(coordinates: &coordinates, count: UInt(coordinates.count)))
        }
        let collection = MLNShapeCollectionFeature(shapes: shapes)

        if let source = style.source(withIdentifier: sourceID) as? MLNShapeSource {
            source.shape = collection
        } else {
            let source = MLNShapeSource(identifier: sourceID, shape: collection, options: nil)
            style.addSource(source)
            let fill = MLNFillStyleLayer(identifier: fillID, source: source)
            fill.fillOpacity = NSExpression(forConstantValue: 0.22)
            style.addLayer(fill)
            let line = MLNLineStyleLayer(identifier: lineID, source: source)
            line.lineWidth = NSExpression(forConstantValue: 4)
            line.lineCap = NSExpression(forConstantValue: "round")
            line.lineJoin = NSExpression(forConstantValue: "round")
            style.addLayer(line)
        }
        (style.layer(withIdentifier: fillID) as? MLNFillStyleLayer)?.fillColor = NSExpression(forConstantValue: color)
        (style.layer(withIdentifier: lineID) as? MLNLineStyleLayer)?.lineColor = NSExpression(forConstantValue: color)

        let all = rings.flatMap { $0 } + lines.flatMap { $0 }
        if let first = all.first {
            var south = first.latitude, north = first.latitude, west = first.longitude, east = first.longitude
            for c in all {
                south = min(south, c.latitude); north = max(north, c.latitude)
                west = min(west, c.longitude); east = max(east, c.longitude)
            }
            let bounds = MLNCoordinateBounds(
                sw: CLLocationCoordinate2D(latitude: south, longitude: west),
                ne: CLLocationCoordinate2D(latitude: north, longitude: east))
            mapView.setVisibleCoordinateBounds(bounds, edgePadding: UIEdgeInsets(top: 100, left: 100, bottom: 100, right: 100), animated: true, completionHandler: nil)
        }
        return true
    }

    static func clear(on mapService: MapService?) {
        guard let style = mapService?.mapView?.style,
              let source = style.source(withIdentifier: sourceID) as? MLNShapeSource else { return }
        source.shape = MLNShapeCollectionFeature(shapes: [])
    }
}
