//
//  IsraelLSAOverlay.swift
//  efb-212
//
//  The Israeli sport-aviation (LSA) route network on the map: lines per route and dots per point, in a style
//  that cannot be mistaken for the CVFR chart (purple; dashed = weekend-only, dotted = special conditions,
//  solid = all week). Drawn when the Layers panel turns it on or when the planned route is an LSA route.
//
//  Kept apart from `IsraelChartOverlay`, which draws the CVFR network: the two networks share point codes
//  and must never mix. Nothing is installed outside Israel or while neither switch is on.
//

import Foundation
import CoreLocation
import MapLibre
import UIKit
import OSLog

@MainActor
final class IsraelLSAOverlay {

    // MARK: Look

    /// Purple: not used by the CVFR chart (green routes, blue military, amber requests).
    static let routeColor = UIColor(red: 0.55, green: 0.22, blue: 0.78, alpha: 1)

    private enum ID {
        static let routesSource = "il-lsa-routes"
        static let pointsSource = "il-lsa-points"
        static let routeAllWeek = "il-lsa-route-allweek"
        static let routeWeekend = "il-lsa-route-weekend"
        static let routeOther = "il-lsa-route-other"
        static let pointCircles = "il-lsa-point-circles"
        static let pointLabels = "il-lsa-point-labels"
        static let layers = [routeAllWeek, routeWeekend, routeOther, pointCircles, pointLabels]
        static let sources = [routesSource, pointsSource]
    }

    private enum Zoom {
        static let points: Float = 8.5
        static let labels: Float = 10.0
    }

    // MARK: State
    private let databaseProvider: @Sendable () throws -> any IsraelAviationDatabaseProtocol
    private let logger = Logger(subsystem: "quartermint.efb-212", category: "IsraelLSAOverlay")

    private var style: MLNStyle?
    private var israelActive = false
    private var layerOn = false
    private var planOn = false
    private var installed = false
    private var loaded: (segments: [IsraelRouteSegment], points: [IsraelReportingPoint])?

    /// Whether the network is on the map right now.
    var isShown: Bool { israelActive && (layerOn || planOn) }
    /// Whether the network is installed in the current style (for tests and the layer panel).
    var isInstalled: Bool { installed }

    init(databaseProvider: @escaping @Sendable () throws -> any IsraelAviationDatabaseProtocol = { try IsraelAviationDatabase.bundled() }) {
        self.databaseProvider = databaseProvider
    }

    // MARK: Switches

    /// A fresh style finished loading: everything of the old one is gone.
    func attach(style: MLNStyle) {
        self.style = style
        installed = false
        refresh()
    }

    /// The map is showing Israel.
    func setActive(_ active: Bool) {
        guard active != israelActive else { return }
        israelActive = active
        if !active { loaded = nil }
        refresh()
    }

    /// The Layers panel switch.
    func setLayerVisible(_ visible: Bool) {
        guard visible != layerOn else { return }
        layerOn = visible
        refresh()
    }

    /// The planner has an LSA route on screen.
    func setPlanUsesLSA(_ uses: Bool) {
        guard uses != planOn else { return }
        planOn = uses
        refresh()
    }

    private func refresh() {
        if isShown { install() } else { uninstall() }
    }

    // MARK: Install

    private func install() {
        guard !installed, let style else { return }
        guard let data = loadIfNeeded() else { return }
        installed = true

        var lines: [MLNShape] = []
        for segment in data.segments {
            var coordinates = segment.polyline
            guard coordinates.count >= 2 else { continue }
            let line = MLNPolylineFeature(coordinates: &coordinates, count: UInt(coordinates.count))
            line.attributes = ["id": segment.id, "activity": segment.activity.rawValue]
            lines.append(line)
        }
        let routes = MLNShapeSource(identifier: ID.routesSource, shape: MLNShapeCollectionFeature(shapes: lines), options: nil)
        style.addSource(routes)

        var dots: [MLNShape] = []
        for point in data.points {
            let feature = MLNPointFeature()
            feature.coordinate = point.coordinate
            feature.attributes = ["code": point.code, "kind": point.kind.rawValue]
            dots.append(feature)
        }
        let points = MLNShapeSource(identifier: ID.pointsSource, shape: MLNShapeCollectionFeature(shapes: dots), options: nil)
        style.addSource(points)

        let width = NSExpression(
            format: "mgl_interpolate:withCurveType:parameters:stops:($zoomLevel, 'linear', nil, %@)",
            [6: 1.4, 9: 2.4, 13: 4.0] as [Int: Double]
        )
        let styles: [(String, NSPredicate, [Double]?)] = [
            (ID.routeAllWeek, NSPredicate(format: "activity == %@", IsraelRouteActivity.allWeek.rawValue), nil),
            (ID.routeWeekend, NSPredicate(format: "activity == %@", IsraelRouteActivity.weekend.rawValue), [3, 2]),
            (ID.routeOther, NSPredicate(format: "activity != %@ AND activity != %@",
                                        IsraelRouteActivity.allWeek.rawValue, IsraelRouteActivity.weekend.rawValue), [0.6, 2])
        ]
        for (id, predicate, dash) in styles {
            let layer = MLNLineStyleLayer(identifier: id, source: routes)
            layer.predicate = predicate
            layer.lineColor = NSExpression(forConstantValue: Self.routeColor)
            layer.lineWidth = width
            layer.lineCap = NSExpression(forConstantValue: "round")
            layer.lineJoin = NSExpression(forConstantValue: "round")
            layer.lineOpacity = NSExpression(forConstantValue: 0.9)
            if let dash { layer.lineDashPattern = NSExpression(forConstantValue: dash) }
            style.addLayer(layer)
        }

        let circles = MLNCircleStyleLayer(identifier: ID.pointCircles, source: points)
        circles.minimumZoomLevel = Zoom.points
        circles.circleRadius = NSExpression(forConstantValue: 3.5)
        circles.circleColor = NSExpression(forConstantValue: Self.routeColor)
        circles.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
        circles.circleStrokeWidth = NSExpression(forConstantValue: 1.2)
        style.addLayer(circles)

        // Labels use the same glyph server as the street base map; they are absent without it.
        let labels = MLNSymbolStyleLayer(identifier: ID.pointLabels, source: points)
        labels.minimumZoomLevel = Zoom.labels
        labels.text = NSExpression(forKeyPath: "code")
        labels.textFontNames = NSExpression(forConstantValue: ["Noto Sans Regular"])
        labels.textFontSize = NSExpression(forConstantValue: 11)
        labels.textColor = NSExpression(forConstantValue: Self.routeColor)
        labels.textHaloColor = NSExpression(forConstantValue: UIColor.white)
        labels.textHaloWidth = NSExpression(forConstantValue: 1.5)
        labels.textOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0, dy: 1.1)))
        labels.textAnchor = NSExpression(forConstantValue: "top")
        style.addLayer(labels)
    }

    private func uninstall() {
        defer { installed = false }
        guard let style, installed else { return }
        for id in ID.layers {
            if let layer = style.layer(withIdentifier: id) { style.removeLayer(layer) }
        }
        for id in ID.sources {
            if let source = style.source(withIdentifier: id) { style.removeSource(source) }
        }
    }

    private func loadIfNeeded() -> (segments: [IsraelRouteSegment], points: [IsraelReportingPoint])? {
        if let loaded { return loaded }
        do {
            let database = try databaseProvider()
            let data = (
                segments: try database.routeSegments(in: .wholeCountry, network: .lsa),
                points: try database.reportingPoints(in: .wholeCountry, network: .lsa)
            )
            loaded = data
            return data
        } catch {
            logger.error("LSA network not loaded: \(error.localizedDescription)")
            return nil
        }
    }
}
