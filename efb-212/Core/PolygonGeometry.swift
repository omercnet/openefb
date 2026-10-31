//
//  PolygonGeometry.swift
//  efb-212
//
//  Point-in-polygon and distance-to-edge for [[lat, lon]] rings (TFRs, advisories).
//  Distances use a local equirectangular projection centered on the query point,
//  accurate to well under 1% at TFR/advisory scales (tens of NM).
//

import Foundation
import CoreLocation

nonisolated enum PolygonGeometry {

    static let nmPerDegreeLatitude: Double = 60.0  // nautical miles per degree of latitude

    /// Ray-casting containment test. `ring` is [[lat, lon]]; closing vertex optional.
    static func contains(_ point: CLLocationCoordinate2D, ring: [[Double]]) -> Bool {
        let vertices = ring.filter { $0.count >= 2 }
        guard vertices.count >= 3 else { return false }

        var inside = false
        var j = vertices.count - 1
        for i in 0..<vertices.count {
            let latI = vertices[i][0], lonI = vertices[i][1]
            let latJ = vertices[j][0], lonJ = vertices[j][1]
            let crossesLatitude = (latI > point.latitude) != (latJ > point.latitude)
            if crossesLatitude {
                let lonAtCrossing = lonI + (point.latitude - latI) / (latJ - latI) * (lonJ - lonI)
                if point.longitude < lonAtCrossing {
                    inside.toggle()
                }
            }
            j = i
        }
        return inside
    }

    /// Shortest distance in nautical miles from `point` to any edge of `ring`.
    /// Returns nil for rings with fewer than two vertices.
    static func distanceToEdgeNM(from point: CLLocationCoordinate2D, ring: [[Double]]) -> Double? {
        let vertices = ring.filter { $0.count >= 2 }
        guard vertices.count >= 2 else { return nil }

        // Local planar coordinates in NM, origin at the query point
        let cosLat = cos(point.latitude * .pi / 180.0)
        func project(_ vertex: [Double]) -> (x: Double, y: Double) {
            let x = (vertex[1] - point.longitude) * nmPerDegreeLatitude * cosLat
            let y = (vertex[0] - point.latitude) * nmPerDegreeLatitude
            return (x, y)
        }

        var best = Double.greatestFiniteMagnitude
        for i in 0..<vertices.count {
            let a = project(vertices[i])
            let b = project(vertices[(i + 1) % vertices.count])
            best = min(best, distanceFromOriginToSegment(a, b))
        }
        return best
    }

    /// Distance in nautical miles from `point` to the polygon: 0 when inside, else distance to nearest edge.
    static func distanceNM(from point: CLLocationCoordinate2D, ring: [[Double]]) -> Double? {
        if contains(point, ring: ring) { return 0 }
        return distanceToEdgeNM(from: point, ring: ring)
    }

    /// Vertex-average centroid of a ring (closing vertex excluded). Nil for empty rings.
    static func centroid(of ring: [[Double]]) -> CLLocationCoordinate2D? {
        var vertices = ring.filter { $0.count >= 2 }
        if vertices.count > 1, let first = vertices.first, let last = vertices.last, first == last {
            vertices.removeLast()
        }
        guard !vertices.isEmpty else { return nil }
        let lat = vertices.reduce(0) { $0 + $1[0] } / Double(vertices.count)
        let lon = vertices.reduce(0) { $0 + $1[1] } / Double(vertices.count)
        return CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    private static func distanceFromOriginToSegment(_ a: (x: Double, y: Double), _ b: (x: Double, y: Double)) -> Double {
        let dx = b.x - a.x
        let dy = b.y - a.y
        let lengthSquared = dx * dx + dy * dy
        guard lengthSquared > 0 else { return hypot(a.x, a.y) }
        // Parameter of the origin's projection onto the segment, clamped to the segment
        let t = max(0, min(1, -(a.x * dx + a.y * dy) / lengthSquared))
        return hypot(a.x + t * dx, a.y + t * dy)
    }
}
