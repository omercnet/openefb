//
//  AirportDiagramGeoreferencer.swift
//  efb-212
//
//  Georeferences FAA d-TPP airport diagram (APD) PDFs so they can be drawn on the moving map.
//  FAA APDs carry no georeferencing dictionaries, so the transform is recovered from the page itself:
//
//  1. Grid method: lat/lon grid labels ("37°28'N", "122°06.5'W") from the PDF text layer, with
//     Vision OCR as a fallback when labels are vector outlines. Each label is snapped to the vector
//     grid line or tick that ends at it, and a similarity transform (uniform scale, rotation limited to
//     multiples of 90 degrees) is fitted by least squares with outlier rejection.
//  2. Runway method: long, thin, dark filled polygons are extracted from the vector stream and matched
//     to the database runway thresholds. Used as a fallback when the grid is insufficient and as an
//     independent cross-check of the grid fit.
//
//  A fit is accepted only when the N-S and E-W scales agree within 3% (conformal gate) and, whenever the
//  database has runway coordinates, the predicted thresholds land on the drawn runways. A wrong overlay
//  is worse than none.
//
//  This file compiles in the app and in the macOS batch tool (tools/apd-georef): PDFKit, CoreGraphics
//  and Vision only, no UIKit/AppKit, everything nonisolated.
//

import Foundation
import CoreGraphics
import ImageIO
import PDFKit
import Vision

// MARK: - Inputs

/// Airport reference point used to validate label plausibility and as the origin of the local frame.
nonisolated struct AirportDiagramReference: Sendable, Equatable {
    let latitude: Double    // degrees
    let longitude: Double   // degrees

    nonisolated init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// A runway from the bundled database. Ends without coordinates (0, 0) are ignored for matching.
nonisolated struct AirportDiagramRunway: Sendable, Equatable {
    let identifier: String          // e.g. "13/31"
    let lengthFeet: Double          // feet
    let widthFeet: Double           // feet
    let baseLatitude: Double        // degrees, physical runway end
    let baseLongitude: Double       // degrees
    let reciprocalLatitude: Double  // degrees, physical runway end
    let reciprocalLongitude: Double // degrees

    nonisolated init(
        identifier: String, lengthFeet: Double, widthFeet: Double,
        baseLatitude: Double, baseLongitude: Double,
        reciprocalLatitude: Double, reciprocalLongitude: Double
    ) {
        self.identifier = identifier
        self.lengthFeet = lengthFeet
        self.widthFeet = widthFeet
        self.baseLatitude = baseLatitude
        self.baseLongitude = baseLongitude
        self.reciprocalLatitude = reciprocalLatitude
        self.reciprocalLongitude = reciprocalLongitude
    }

    var hasCoordinates: Bool {
        abs(baseLatitude) > 0.01 && abs(baseLongitude) > 0.01
            && abs(reciprocalLatitude) > 0.01 && abs(reciprocalLongitude) > 0.01
            && (baseLatitude != reciprocalLatitude || baseLongitude != reciprocalLongitude)
    }
}

// MARK: - Output

/// A validated page-to-ground transform for one airport diagram.
nonisolated struct AirportDiagramGeoreference: Codable, Sendable, Equatable {

    nonisolated struct Rect: Codable, Sendable, Equatable {
        let x: Double, y: Double, width: Double, height: Double  // PDF points, user space
        nonisolated init(_ rect: CGRect) {
            x = Double(rect.minX); y = Double(rect.minY); width = Double(rect.width); height = Double(rect.height)
        }
        var cgRect: CGRect { CGRect(x: x, y: y, width: width, height: height) }
    }

    nonisolated struct Circle: Codable, Sendable, Equatable {
        let centerX: Double, centerY: Double, radius: Double  // PDF points, user space
    }

    nonisolated enum Method: String, Codable, Sendable {
        case grid               // grid labels, runway cross-check not available
        case gridRunwayChecked  // grid labels, cross-checked against runway thresholds
        case runway             // runway polygons set scale and orientation
    }

    nonisolated enum LabelSource: String, Codable, Sendable {
        case text, ocr, none
    }

    nonisolated struct Diagnostics: Codable, Sendable, Equatable {
        let method: Method
        let labelSource: LabelSource
        let latitudeLabels: Int
        let longitudeLabels: Int
        let rotationDegrees: Int        // 0, 90, 180, 270: page "up" relative to true north
        let feetPerPoint: Double        // feet per PDF point
        let scaleRatio: Double?         // E-W scale / N-S scale from independent 1-D fits (conformal gate)
        let runwaysMatched: Int
        let runwayResidualFeet: Double? // worst centreline/midpoint error over matched runways, feet
        let runwayMidpointFeet: Double? // worst midpoint-only error, feet
        let runwayEndFeet: Double?      // worst threshold-to-drawn-end error, feet (database ends are noisy)
        let runwayBestMidpointFeet: Double?    // best (smallest) midpoint error over matched runways, feet
        let runwayMedianMidpointFeet: Double?  // median midpoint error over matched runways, feet
        let maskedInsets: Int
    }

    /// Affine page point (PDF user space, points) -> local metres east (x) and north (y) of the reference.
    let a: Double, b: Double, c: Double, d: Double, tx: Double, ty: Double
    let reference: Rect  // unused for geometry; kept for Codable symmetry of the page frame
    let referenceLatitude: Double   // degrees
    let referenceLongitude: Double  // degrees
    let pageBox: Rect               // media box, user space
    let clipBox: Rect               // neatline: the part of the page that belongs on the map
    let masks: [Circle]             // magnified insets to blank out
    let diagnostics: Diagnostics

    nonisolated var transform: CGAffineTransform {
        CGAffineTransform(a: a, b: b, c: c, d: d, tx: tx, ty: ty)
    }

    /// Metres per degree of latitude / longitude at the reference latitude (WGS-84 series).
    nonisolated static func metresPerDegree(latitude: Double) -> (lat: Double, lon: Double) {
        let phi = latitude * .pi / 180
        let lat = 111_132.954 - 559.822 * cos(2 * phi) + 1.175 * cos(4 * phi)
        let lon = 111_412.84 * cos(phi) - 93.5 * cos(3 * phi) + 0.118 * cos(5 * phi)
        return (lat, lon)
    }

    /// Ground position of a page point.
    nonisolated func coordinate(forPagePoint point: CGPoint) -> (latitude: Double, longitude: Double) {
        let local = point.applying(transform)
        let m = Self.metresPerDegree(latitude: referenceLatitude)
        return (referenceLatitude + Double(local.y) / m.lat, referenceLongitude + Double(local.x) / m.lon)
    }

    /// Page point of a ground position.
    nonisolated func pagePoint(latitude: Double, longitude: Double) -> CGPoint {
        let m = Self.metresPerDegree(latitude: referenceLatitude)
        let local = CGPoint(x: (longitude - referenceLongitude) * m.lon, y: (latitude - referenceLatitude) * m.lat)
        return local.applying(transform.inverted())
    }

    /// Ground corners of the clip box, in the order MapLibre's MLNCoordinateQuad expects:
    /// top-left, bottom-left, bottom-right, top-right of the rendered image.
    nonisolated var clipCorners: [(latitude: Double, longitude: Double)] {
        let r = clipBox.cgRect
        return [
            coordinate(forPagePoint: CGPoint(x: r.minX, y: r.maxY)),
            coordinate(forPagePoint: CGPoint(x: r.minX, y: r.minY)),
            coordinate(forPagePoint: CGPoint(x: r.maxX, y: r.minY)),
            coordinate(forPagePoint: CGPoint(x: r.maxX, y: r.maxY)),
        ]
    }
}

/// Why a diagram was not georeferenced. Every case is a safe "draw nothing".
nonisolated enum AirportDiagramGeoreferenceError: Error, Equatable, CustomStringConvertible, Sendable {
    case unreadablePDF
    case insufficientLabels(latitude: Int, longitude: Int)
    case labelsNotSnapped(latitude: Int, longitude: Int)
    case scaleUndetermined
    case orientationAmbiguous
    case conformalGateFailed(ratio: Double)
    case runwayCrossCheckFailed(residualFeet: Double)
    case runwaysNotMatched
    case implausibleScale(feetPerPoint: Double)

    nonisolated var description: String {
        switch self {
        case .unreadablePDF: return "unreadable PDF"
        case .insufficientLabels(let la, let lo): return "insufficient labels (lat \(la), lon \(lo))"
        case .labelsNotSnapped(let la, let lo): return "labels not snapped to grid lines (lat \(la), lon \(lo))"
        case .scaleUndetermined: return "scale undetermined"
        case .orientationAmbiguous: return "orientation ambiguous"
        case .conformalGateFailed(let r): return String(format: "conformal gate failed (E-W/N-S = %.3f)", r)
        case .runwayCrossCheckFailed(let ft): return String(format: "runway cross-check failed (%.0f ft)", ft)
        case .runwaysNotMatched: return "no drawn runway matched the database runways"
        case .implausibleScale(let f): return String(format: "implausible scale (%.1f ft/pt)", f)
        }
    }

    /// Short machine-friendly category for reports.
    nonisolated var category: String {
        switch self {
        case .unreadablePDF: return "unreadable"
        case .insufficientLabels: return "insufficient-labels"
        case .labelsNotSnapped: return "labels-not-snapped"
        case .scaleUndetermined: return "scale-undetermined"
        case .orientationAmbiguous: return "orientation-ambiguous"
        case .conformalGateFailed: return "conformal-gate"
        case .runwayCrossCheckFailed: return "runway-cross-check"
        case .runwaysNotMatched: return "runways-not-matched"
        case .implausibleScale: return "implausible-scale"
        }
    }
}

// MARK: - Georeferencer

nonisolated enum AirportDiagramGeoreferencer {

    // MARK: Tunables

    /// Validation gates. The defaults are what the app uses.
    nonisolated struct Tolerances: Sendable, Equatable {
        /// Maximum allowed disagreement between E-W and N-S scale (conformal gate).
        var conformal = 0.03
        /// Predicted runway centrelines/midpoints must agree with the drawn runways this closely (feet).
        var runwayFeet = 50.0
        /// Drawn runway length times the fitted scale must agree with the database length this closely.
        var runwayLength = 0.05

        nonisolated init(conformal: Double = 0.03, runwayFeet: Double = 50, runwayLength: Double = 0.05) {
            self.conformal = conformal
            self.runwayFeet = runwayFeet
            self.runwayLength = runwayLength
        }

        static let standard = Tolerances()
    }

    static let conformalTolerance = Tolerances.standard.conformal
    static let runwayToleranceFeet = Tolerances.standard.runwayFeet
    static let runwayLengthTolerance = Tolerances.standard.runwayLength
    /// Labels further than this from the airport reference point are noise (degrees).
    static let labelPlausibilityDegrees = 0.5
    /// Plausible chart scales for an APD (feet per PDF point). KPAO is ~10, large hubs ~30.
    static let feetPerPointRange = 3.0...80.0
    static let feetPerMetre = 3.280_839_895

    // MARK: Entry Point

    /// Georeferences the first page of `pdfData`.
    static func georeference(
        pdfData: Data,
        reference: AirportDiagramReference,
        runways: [AirportDiagramRunway],
        tolerances: Tolerances = .standard
    ) throws -> AirportDiagramGeoreference {
        guard let document = PDFDocument(data: pdfData), let page = document.page(at: 0), let cgPage = page.pageRef else {
            throw AirportDiagramGeoreferenceError.unreadablePDF
        }
        let pageBox = page.bounds(for: .mediaBox)
        let vectors = PDFVectorScanner.scan(page: cgPage)
        let lines = vectors.gridLines()
        let clip = vectors.neatline(pageBox: pageBox, gridLines: lines)

        // 1. Labels: text layer first, OCR of the chart edges when the text layer is insufficient.
        let collected = collectLabels(document: document, page: page, pageBox: pageBox, neatline: clip, reference: reference)
        let labels = collected.labels
        let latCount = labels.filter(\.isLatitude).count, lonCount = labels.filter { !$0.isLatitude }.count

        // 2. Snap labels to grid lines / ticks.
        let snapped = snapLabels(labels, to: lines)

        // 3. Drawn runways and database runways in the local metric frame.
        let drawnRunways = vectors.runwayShapes()
        let dbRunways = runways.filter(\.hasCoordinates)
        let metres = AirportDiagramGeoreference.metresPerDegree(latitude: reference.latitude)
        let local: (Double, Double) -> CGPoint = { lat, lon in
            CGPoint(x: (lon - reference.longitude) * metres.lon, y: (lat - reference.latitude) * metres.lat)
        }

        // 4. Fit: hypotheses from label pairs and runway lengths, inlier voting, least-squares refinement.
        if snapped.isEmpty, drawnRunways.isEmpty || dbRunways.isEmpty {
            if labels.isEmpty { throw AirportDiagramGeoreferenceError.insufficientLabels(latitude: latCount, longitude: lonCount) }
            throw AirportDiagramGeoreferenceError.labelsNotSnapped(latitude: latCount, longitude: lonCount)
        }
        let solution = try fit(labels: snapped, drawn: drawnRunways, database: dbRunways, local: local)
        let best = solution.fit

        // 5. Gates.
        let feetPerPoint = best.scale * feetPerMetre
        guard feetPerPointRange.contains(feetPerPoint) else {
            throw AirportDiagramGeoreferenceError.implausibleScale(feetPerPoint: feetPerPoint)
        }
        let ratio = conformalRatio(solution.inlierLabels, reference: reference)
        if let ratio, abs(ratio - 1) > tolerances.conformal {
            throw AirportDiagramGeoreferenceError.conformalGateFailed(ratio: ratio)
        }
        var method: AirportDiagramGeoreference.Method = solution.fromRunways ? .runway : .grid
        if !dbRunways.isEmpty, !drawnRunways.isEmpty {
            guard !solution.matches.isEmpty else { throw AirportDiagramGeoreferenceError.runwaysNotMatched }
            // A fit whose scale or position came from runways needs independent agreement: a second
            // runway, or two grid labels.
            if solution.fromRunways, solution.matches.count < 2, solution.inlierLabels.count < 2 {
                throw AirportDiagramGeoreferenceError.orientationAmbiguous
            }
            if let worst = solution.matches.map(\.residualFeet).max(), worst > tolerances.runwayFeet {
                throw AirportDiagramGeoreferenceError.runwayCrossCheckFailed(residualFeet: worst)
            }
            if let worstLength = solution.matches.map(\.lengthError).max(), worstLength > tolerances.runwayLength {
                throw AirportDiagramGeoreferenceError.runwayCrossCheckFailed(residualFeet: worstLength * 10_000)
            }
            if method == .grid { method = .gridRunwayChecked }
        } else if method == .grid, ratio == nil {
            // One axis had a single value and no runway confirmed the scale: not good enough.
            throw AirportDiagramGeoreferenceError.scaleUndetermined
        }
        let latInliers = solution.inlierLabels.filter(\.isLatitude).count
        let lonInliers = solution.inlierLabels.count - latInliers
        if solution.matches.isEmpty, (latInliers == 0 || lonInliers == 0) {
            throw AirportDiagramGeoreferenceError.insufficientLabels(latitude: latInliers, longitude: lonInliers)
        }

        // 6. Masks.
        let masks = insetMasks(document: document, page: page, vectors: vectors)

        let t = best.transform
        return AirportDiagramGeoreference(
            a: Double(t.a), b: Double(t.b), c: Double(t.c), d: Double(t.d), tx: Double(t.tx), ty: Double(t.ty),
            reference: .init(pageBox),
            referenceLatitude: reference.latitude, referenceLongitude: reference.longitude,
            pageBox: .init(pageBox), clipBox: .init(clip),
            masks: masks.map { .init(centerX: Double($0.center.x), centerY: Double($0.center.y), radius: Double($0.radius)) },
            diagnostics: .init(
                method: method, labelSource: collected.source,
                latitudeLabels: latInliers, longitudeLabels: lonInliers,
                rotationDegrees: best.rotationDegrees, feetPerPoint: feetPerPoint,
                scaleRatio: ratio, runwaysMatched: solution.matches.count,
                runwayResidualFeet: solution.matches.map(\.residualFeet).max(),
                runwayMidpointFeet: solution.matches.map(\.midpointFeet).max(),
                runwayEndFeet: solution.matches.map(\.endFeet).max(),
                runwayBestMidpointFeet: solution.matches.map(\.midpointFeet).min(),
                runwayMedianMidpointFeet: median(solution.matches.map(\.midpointFeet)),
                maskedInsets: masks.count
            )
        )
    }

    /// Text-layer labels, plus OCR of the chart edges when either axis lacks two distinct values.
    static func collectLabels(
        document: PDFDocument, page: PDFPage, pageBox: CGRect, neatline: CGRect, reference: AirportDiagramReference
    ) -> (labels: [GridLabel], source: AirportDiagramGeoreference.LabelSource) {
        let text = textLabels(document: document, page: page).filter { isPlausible($0, reference: reference) }
        if distinctValues(text, latitude: true) >= 2, distinctValues(text, latitude: false) >= 2 {
            return (text, .text)
        }
        let ocr = ocrLabels(page: page, pageBox: pageBox, neatline: neatline).filter { isPlausible($0, reference: reference) }
        let merged = merge(text, with: ocr)
        if merged.isEmpty { return ([], .none) }
        return (merged, ocr.isEmpty ? .text : .ocr)
    }

    // MARK: - Inspection

    /// Human-readable trace of every stage, for the batch tool's --inspect flag and for debugging tests.
    static func inspect(pdfData: Data, reference: AirportDiagramReference, runways: [AirportDiagramRunway]) -> String {
        guard let document = PDFDocument(data: pdfData), let page = document.page(at: 0), let cgPage = page.pageRef else {
            return "unreadable PDF"
        }
        let pageBox = page.bounds(for: .mediaBox)
        let vectors = PDFVectorScanner.scan(page: cgPage)
        let lines = vectors.gridLines()
        var out = "pageBox \(pageBox) segments \(vectors.segments.count) gridLines \(lines.count) polygons \(vectors.polygons.count)\n"
        let text = textLabels(document: document, page: page)
        out += "text labels (\(text.count)):\n"
        for l in text { out += String(format: "  %@ %.4f rect=(%.1f,%.1f %.1fx%.1f)%@\n", l.isLatitude ? "lat" : "lon", l.value, l.rect.minX, l.rect.minY, l.rect.width, l.rect.height, isPlausible(l, reference: reference) ? "" : " IMPLAUSIBLE") }
        let plausible = text.filter { isPlausible($0, reference: reference) }
        var labels = plausible
        let neatline = vectors.neatline(pageBox: pageBox, gridLines: lines)
        if distinctValues(plausible, latitude: true) < 2 || distinctValues(plausible, latitude: false) < 2 {
            let ocr = ocrLabels(page: page, pageBox: pageBox, neatline: neatline)
            out += "ocr labels (\(ocr.count)):\n"
            for l in ocr { out += String(format: "  %@ %.4f rect=(%.1f,%.1f %.1fx%.1f)%@\n", l.isLatitude ? "lat" : "lon", l.value, l.rect.minX, l.rect.minY, l.rect.width, l.rect.height, isPlausible(l, reference: reference) ? "" : " IMPLAUSIBLE") }
            labels = merge(plausible, with: ocr.filter { isPlausible($0, reference: reference) })
        }
        let snapped = snapLabels(labels, to: lines)
        out += "snapped (\(snapped.count)):\n"
        for s in snapped { out += String(format: "  %@ %.4f on %@ line at %.2f\n", s.isLatitude ? "lat" : "lon", s.value, s.horizontal ? "horizontal" : "vertical", s.position) }
        let drawn = vectors.runwayShapes()
        out += "drawn runways (\(drawn.count)):\n"
        for r in drawn { out += String(format: "  (%.1f,%.1f)-(%.1f,%.1f) length %.1f width %.1f\n", r.start.x, r.start.y, r.end.x, r.end.y, r.length, r.widthPoints) }
        out += "database runways with coordinates: \(runways.filter(\.hasCoordinates).map(\.identifier))\n"
        let metres = AirportDiagramGeoreference.metresPerDegree(latitude: reference.latitude)
        let local: (Double, Double) -> CGPoint = { lat, lon in
            CGPoint(x: (lon - reference.longitude) * metres.lon, y: (lat - reference.latitude) * metres.lat)
        }
        let dbRunways = runways.filter(\.hasCoordinates)
        let candidates = hypotheses(labels: snapped, drawn: drawn, database: dbRunways, local: local)
        out += "hypotheses (\(candidates.count)): " + candidates.prefix(12).map { String(format: "%.1fft/pt@%d%@", $0.scale * feetPerMetre, $0.rotation, $0.fromRunways ? "r" : "") }.joined(separator: " ") + "\n"
        if let solution = try? fit(labels: snapped, drawn: drawn, database: dbRunways, local: local) {
            let fit = solution.fit
            out += String(format: "fit: rotation %d scale %.3f m/pt (%.1f ft/pt) translation (%.1f, %.1f) inliers %d fromRunways %@\n", fit.rotationDegrees, fit.scale, fit.scale * feetPerMetre, fit.translation.x, fit.translation.y, solution.inlierLabels.count, solution.fromRunways ? "yes" : "no")
            if let ratio = conformalRatio(solution.inlierLabels, reference: reference) { out += String(format: "conformal ratio %.4f\n", ratio) }
            for runway in dbRunways {
                for (lat, lon, name) in [(runway.baseLatitude, runway.baseLongitude, "base"), (runway.reciprocalLatitude, runway.reciprocalLongitude, "recip")] {
                    let p = local(lat, lon).applying(fit.transform.inverted())
                    out += String(format: "  %@ %@ -> page (%.1f, %.1f)\n", runway.identifier, name, p.x, p.y)
                }
            }
            for m in solution.matches {
                out += String(format: "  match %@: residual %.0f ft, midpoint %.0f ft, cross-track %.0f ft, ends %.0f ft, bearing %.1f deg, length %.1f%%\n", m.runway.identifier, m.residualFeet, m.midpointFeet, m.crossTrackFeet, m.endFeet, m.bearingErrorDegrees, m.lengthError * 100)
                let drawnMid = fit.apply(m.shape.midpoint)
                let lat = reference.latitude + Double(drawnMid.y) / metres.lat, lon = reference.longitude + Double(drawnMid.x) / metres.lon
                let dbLat = (m.runway.baseLatitude + m.runway.reciprocalLatitude) / 2, dbLon = (m.runway.baseLongitude + m.runway.reciprocalLongitude) / 2
                out += String(format: "    drawn midpoint %.6f,%.6f  db midpoint %.6f,%.6f\n", lat, lon, dbLat, dbLon)
            }
        } else {
            out += "fit: none\n"
        }
        out += "neatline \(vectors.neatline(pageBox: pageBox, gridLines: lines)) masks \(insetMasks(document: document, page: page, vectors: vectors).count)\n"
        do {
            let result = try georeference(pdfData: pdfData, reference: reference, runways: runways)
            out += "RESULT ok: \(result.diagnostics)\n"
        } catch {
            out += "RESULT rejected: \(error)\n"
        }
        return out
    }

    // MARK: - Labels

    nonisolated struct GridLabel: Equatable {
        let isLatitude: Bool
        let value: Double   // signed degrees
        let rect: CGRect    // page user space
    }

    /// "37°28'N", "122°06.5'W", OCR variants with ° misread as º/*/o and ' as ’/′/`.
    static let labelPattern = #"(\d{1,3})\s*[°º˚*o]\s*(\d{1,2}(?:[.,]\d+)?)\s*['’′`]?\s*([NSEW])\b"#

    nonisolated static func parseLabel(_ string: String) -> (isLatitude: Bool, value: Double)? {
        guard let regex = try? NSRegularExpression(pattern: labelPattern) else { return nil }
        let ns = string as NSString
        guard let m = regex.firstMatch(in: string, range: NSRange(location: 0, length: ns.length)) else { return nil }
        guard let degrees = Double(ns.substring(with: m.range(at: 1))),
              let minutes = Double(ns.substring(with: m.range(at: 2)).replacingOccurrences(of: ",", with: ".")),
              minutes < 60 else { return nil }
        let hemisphere = ns.substring(with: m.range(at: 3))
        let isLatitude = hemisphere == "N" || hemisphere == "S"
        if isLatitude, degrees > 90 { return nil }
        if !isLatitude, degrees > 180 { return nil }
        var value = degrees + minutes / 60
        if hemisphere == "S" || hemisphere == "W" { value = -value }
        return (isLatitude, value)
    }

    /// Labels from the PDF text layer. `findString` gives reliable bounds; character indices don't.
    static func textLabels(document: PDFDocument, page: PDFPage) -> [GridLabel] {
        guard let text = page.string, let regex = try? NSRegularExpression(pattern: labelPattern) else { return [] }
        let ns = text as NSString
        var out: [GridLabel] = []
        var seen = Set<String>()
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let literal = ns.substring(with: match.range)
            guard seen.insert(literal).inserted, let parsed = parseLabel(literal) else { continue }
            for selection in document.findString(literal, withOptions: []) where selection.pages.first == page {
                let rect = selection.bounds(for: page)
                guard !rect.isNull, !rect.isEmpty, rect.width < 120, rect.height < 120 else { continue }
                out.append(GridLabel(isLatitude: parsed.isLatitude, value: parsed.value, rect: rect))
            }
        }
        return out
    }

    /// Vision OCR of the four chart edges (the only place grid labels live), rendered at high
    /// resolution, trying up/left/right orientations for rotated labels. Each hit is re-read from a tight
    /// crop and kept only when both readings agree, which removes most digit misreads.
    static func ocrLabels(page: PDFPage, pageBox: CGRect, neatline: CGRect) -> [GridLabel] {
        guard let cgPage = page.pageRef else { return [] }
        let band: CGFloat = 46  // points inside the neatline that contain the labels
        let frame = neatline.insetBy(dx: -6, dy: -6).intersection(pageBox)
        let strips = [
            CGRect(x: frame.minX, y: frame.minY, width: frame.width, height: band),           // bottom
            CGRect(x: frame.minX, y: frame.maxY - band, width: frame.width, height: band),    // top
            CGRect(x: frame.minX, y: frame.minY, width: band, height: frame.height),          // left
            CGRect(x: frame.maxX - band, y: frame.minY, width: band, height: frame.height),   // right
        ]
        var out: [GridLabel] = []
        for strip in strips {
            for hit in recognizeLabels(cgPage: cgPage, region: strip, scale: 8) {
                // Verify by re-reading a tight crop at higher resolution.
                let crop = hit.rect.insetBy(dx: -4, dy: -4)
                let confirmations = recognizeLabels(cgPage: cgPage, region: crop, scale: 12, orientations: [hit.orientation])
                guard confirmations.contains(where: { $0.isLatitude == hit.isLatitude && abs($0.value - hit.value) < 1e-6 }) else { continue }
                let duplicate = out.contains { $0.isLatitude == hit.isLatitude && abs($0.value - hit.value) < 1e-6 && $0.rect.intersects(hit.rect) }
                if !duplicate { out.append(GridLabel(isLatitude: hit.isLatitude, value: hit.value, rect: hit.rect)) }
            }
        }
        return out
    }

    nonisolated struct OCRHit {
        let isLatitude: Bool
        let value: Double
        let rect: CGRect
        let orientation: CGImagePropertyOrientation
    }

    /// Renders `region` of the page at `scale` px/pt and runs text recognition in each orientation.
    static func recognizeLabels(
        cgPage: CGPDFPage, region: CGRect, scale: CGFloat,
        orientations: [CGImagePropertyOrientation] = [.up, .left, .right]
    ) -> [OCRHit] {
        let width = Int((region.width * scale).rounded()), height = Int((region.height * scale).rounded())
        guard width > 8, height > 8,
              let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
              ) else { return [] }
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -region.minX, y: -region.minY)
        context.drawPDFPage(cgPage)
        guard let image = context.makeImage(), let regex = try? NSRegularExpression(pattern: labelPattern) else { return [] }

        var out: [OCRHit] = []
        for orientation in orientations {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            let handler = VNImageRequestHandler(cgImage: image, orientation: orientation)
            guard (try? handler.perform([request])) != nil else { continue }
            for observation in request.results ?? [] {
                guard let candidate = observation.topCandidates(1).first else { continue }
                let string = candidate.string
                let ns = string as NSString
                for match in regex.matches(in: string, range: NSRange(location: 0, length: ns.length)) {
                    guard let parsed = parseLabel(ns.substring(with: match.range)) else { continue }
                    var box = observation.boundingBox
                    if let range = Range(match.range, in: string), let tight = try? candidate.boundingBox(for: range)?.boundingBox {
                        box = tight
                    }
                    // Normalised box in the oriented image -> normalised box in the upright region.
                    let upright: CGRect
                    switch orientation {
                    case .left:  upright = CGRect(x: 1 - box.maxY, y: box.minX, width: box.height, height: box.width)
                    case .right: upright = CGRect(x: box.minY, y: 1 - box.maxX, width: box.height, height: box.width)
                    default:     upright = box
                    }
                    let rect = CGRect(
                        x: region.minX + upright.minX * region.width,
                        y: region.minY + upright.minY * region.height,
                        width: upright.width * region.width,
                        height: upright.height * region.height
                    )
                    guard rect.width < 80, rect.height < 80 else { continue }
                    out.append(OCRHit(isLatitude: parsed.isLatitude, value: parsed.value, rect: rect, orientation: orientation))
                }
            }
        }
        return out
    }

    static func isPlausible(_ label: GridLabel, reference: AirportDiagramReference) -> Bool {
        let delta = label.isLatitude ? abs(label.value - reference.latitude) : abs(label.value - reference.longitude)
        return delta < labelPlausibilityDegrees
    }

    static func distinctValues(_ labels: [GridLabel], latitude: Bool) -> Int {
        Set(labels.filter { $0.isLatitude == latitude }.map { Int(($0.value * 600).rounded()) }).count
    }

    /// Adds OCR labels that don't duplicate a text-layer label (same value, overlapping box).
    static func merge(_ text: [GridLabel], with ocr: [GridLabel]) -> [GridLabel] {
        var out = text
        for label in ocr {
            let duplicate = text.contains {
                $0.isLatitude == label.isLatitude && abs($0.value - label.value) < 1e-6
                    && $0.rect.insetBy(dx: -8, dy: -8).intersects(label.rect)
            }
            if !duplicate { out.append(label) }
        }
        return out
    }

    // MARK: - Snapping

    nonisolated struct SnappedLabel: Equatable {
        let isLatitude: Bool
        let value: Double
        let horizontal: Bool   // orientation of the grid line the label sits on
        let position: CGFloat  // y of a horizontal line, x of a vertical line (page points)
    }

    /// Distance from the nearer end of a line to a rect (0 when inside).
    static func endGap(_ line: GridLine, _ rect: CGRect) -> CGFloat {
        line.endpoints.map { p in
            hypot(max(rect.minX - p.x, 0, p.x - rect.maxX), max(rect.minY - p.y, 0, p.y - rect.maxY))
        }.min() ?? .greatestFiniteMagnitude
    }

    static func offset(_ line: GridLine, _ rect: CGRect) -> CGFloat {
        line.horizontal ? abs(line.position - rect.midY) : abs(line.position - rect.midX)
    }

    /// Long grid line ending at the label: ends within 10 pt, perpendicular offset under 20 pt.
    static func snapLine(_ label: GridLabel, _ lines: [GridLine]) -> GridLine? {
        let inner = label.rect.insetBy(dx: 2, dy: 2)
        return lines.filter { line in
            guard line.length >= 8, !line.endpoints.contains(where: { inner.contains($0) }) else { return false }
            return offset(line, label.rect) < 20 && endGap(line, label.rect) < 10
        }.min { score($0, label.rect) < score($1, label.rect) }
    }

    /// Short tick (under 8 pt) at the label in a known orientation: offset under 4 pt, gap under 4 pt.
    static func snapTick(_ label: GridLabel, _ lines: [GridLine], horizontal: Bool) -> GridLine? {
        let inner = label.rect.insetBy(dx: 2, dy: 2)
        return lines.filter { line in
            guard line.horizontal == horizontal, line.length < 8,
                  !line.endpoints.contains(where: { inner.contains($0) }) else { return false }
            return offset(line, label.rect) < 4 && endGap(line, label.rect) < 4
        }.min { endGap($0, label.rect) < endGap($1, label.rect) }
    }

    private static func score(_ line: GridLine, _ rect: CGRect) -> CGFloat {
        endGap(line, rect) + offset(line, rect) * 0.2 - min(line.length, 200) * 0.01
    }

    static func snapLabels(_ labels: [GridLabel], to lines: [GridLine]) -> [SnappedLabel] {
        var out: [SnappedLabel] = []
        var unsnapped: [GridLabel] = []
        for label in labels {
            if let line = snapLine(label, lines) {
                out.append(SnappedLabel(isLatitude: label.isLatitude, value: label.value, horizontal: line.horizontal, position: line.position))
            } else {
                unsnapped.append(label)
            }
        }
        // Orientation established by the long lines: latitude on horizontal lines means north-up.
        let northUpVotes = out.filter { $0.isLatitude == $0.horizontal }.count
        let rotatedVotes = out.count - northUpVotes
        let latitudeHorizontal = northUpVotes >= rotatedVotes
        for label in unsnapped {
            let wantHorizontal = label.isLatitude ? latitudeHorizontal : !latitudeHorizontal
            if let tick = snapTick(label, lines, horizontal: wantHorizontal) {
                out.append(SnappedLabel(isLatitude: label.isLatitude, value: label.value, horizontal: tick.horizontal, position: tick.position))
            }
        }
        // Keep only the dominant orientation; the minority are mis-snaps.
        let keep = out.filter { ($0.isLatitude == $0.horizontal) == latitudeHorizontal }
        return keep
    }

    // MARK: - Similarity Fit

    /// local = scale * R(rotation) * page + translation, rotation a multiple of 90 degrees.
    nonisolated struct SimilarityFit: Equatable {
        var scale: Double          // metres per point
        var rotationDegrees: Int   // 0, 90, 180, 270
        var translation: CGPoint   // metres

        /// Rotation matrix columns for page x and page y.
        nonisolated var basis: (x: CGPoint, y: CGPoint) {
            switch rotationDegrees {
            case 90:  return (CGPoint(x: 0, y: 1), CGPoint(x: -1, y: 0))
            case 180: return (CGPoint(x: -1, y: 0), CGPoint(x: 0, y: -1))
            case 270: return (CGPoint(x: 0, y: -1), CGPoint(x: 1, y: 0))
            default:  return (CGPoint(x: 1, y: 0), CGPoint(x: 0, y: 1))
            }
        }

        nonisolated var transform: CGAffineTransform {
            let b = basis
            return CGAffineTransform(
                a: b.x.x * scale, b: b.x.y * scale, c: b.y.x * scale, d: b.y.y * scale,
                tx: translation.x, ty: translation.y
            )
        }

        nonisolated func apply(_ p: CGPoint) -> CGPoint { p.applying(transform) }

        /// Rotated (unscaled, untranslated) page point.
        nonisolated func rotate(_ p: CGPoint) -> CGPoint {
            let b = basis
            return CGPoint(x: b.x.x * p.x + b.y.x * p.y, y: b.x.y * p.x + b.y.y * p.y)
        }
    }

    /// Everything the gates need to know about the chosen fit.
    nonisolated struct FitSolution {
        let fit: SimilarityFit
        let inlierLabels: [SnappedLabel]
        let matches: [RunwayMatch]
        let fromRunways: Bool   // scale came from a runway length, not from label spacing
    }

    nonisolated struct Equation {
        let coefficient: Double  // multiplies the scale
        let axis: Int            // 0 = east, 1 = north
        let target: Double       // metres
        let weight: Double
    }

    /// One snapped label gives one equation: target = scale * coefficient + translation[axis].
    static func equation(for label: SnappedLabel, rotation: Int, local: (Double, Double) -> CGPoint) -> Equation {
        let fit = SimilarityFit(scale: 1, rotationDegrees: rotation, translation: .zero)
        let page = label.horizontal ? CGPoint(x: 0, y: label.position) : CGPoint(x: label.position, y: 0)
        let rotated = fit.rotate(page)
        if label.isLatitude {
            return Equation(coefficient: Double(rotated.y), axis: 1, target: Double(local(label.value, 0).y), weight: 1)
        } else {
            return Equation(coefficient: Double(rotated.x), axis: 0, target: Double(local(0, label.value).x), weight: 1)
        }
    }

    /// Weighted least squares for (scale, tx, ty) from equations target = scale*coefficient + t[axis].
    static func solve(_ equations: [Equation], fixedScale: Double? = nil) -> (scale: Double, translation: CGPoint, rms: Double)? {
        var ata = [[Double]](repeating: [0, 0, 0], count: 3)
        var atb = [Double](repeating: 0, count: 3)
        var axes = Set<Int>()
        for eq in equations {
            let row = [eq.coefficient, eq.axis == 0 ? 1.0 : 0.0, eq.axis == 1 ? 1.0 : 0.0]
            axes.insert(eq.axis)
            for i in 0..<3 {
                atb[i] += eq.weight * row[i] * eq.target
                for j in 0..<3 { ata[i][j] += eq.weight * row[i] * row[j] }
            }
        }
        if let fixedScale {
            // Pin the scale with a heavy prior.
            ata[0][0] += 1e9
            atb[0] += 1e9 * fixedScale
        }
        for axis in 0..<2 where !axes.contains(axis) { ata[axis + 1][axis + 1] = 1 }
        guard let x = solve3(ata, atb), x[0] > 0, x[0].isFinite else { return nil }
        var sse = 0.0, weightSum = 0.0
        for eq in equations {
            let predicted = x[0] * eq.coefficient + (eq.axis == 0 ? x[1] : x[2])
            sse += eq.weight * (predicted - eq.target) * (predicted - eq.target)
            weightSum += eq.weight
        }
        let rms = weightSum == 0 ? 0 : (sse / weightSum).squareRoot()
        return (x[0], CGPoint(x: x[1], y: x[2]), rms)
    }

    /// Gaussian elimination with partial pivoting for a 3x3 system.
    static func solve3(_ a: [[Double]], _ b: [Double]) -> [Double]? {
        var m = a, v = b
        for col in 0..<3 {
            var pivot = col
            for r in col..<3 where abs(m[r][col]) > abs(m[pivot][col]) { pivot = r }
            guard abs(m[pivot][col]) > 1e-12 else { return nil }
            if pivot != col { m.swapAt(pivot, col); v.swapAt(pivot, col) }
            for r in 0..<3 where r != col {
                let f = m[r][col] / m[col][col]
                for c in col..<3 { m[r][c] -= f * m[col][c] }
                v[r] -= f * v[col]
            }
        }
        return (0..<3).map { v[$0] / m[$0][$0] }
    }

    nonisolated struct Hypothesis {
        let scale: Double         // metres per point
        let rotation: Int
        let fromRunways: Bool
    }

    /// Scale/rotation hypotheses from every pair of labels with distinct values on one axis and from
    /// every drawn-runway/database-runway pairing whose orientation agrees.
    static func hypotheses(
        labels: [SnappedLabel], drawn: [RunwayShape], database: [AirportDiagramRunway],
        local: (Double, Double) -> CGPoint
    ) -> [Hypothesis] {
        var out: [Hypothesis] = []
        let latitudeHorizontal = labels.first.map { $0.isLatitude == $0.horizontal } ?? true
        let labelRotations = latitudeHorizontal ? [0, 180] : [90, 270]
        for axis in [true, false] {
            let axisLabels = labels.filter { $0.isLatitude == axis }
            for i in 0..<axisLabels.count {
                for j in (i + 1)..<axisLabels.count {
                    let a = axisLabels[i], b = axisLabels[j]
                    let dp = Double(abs(a.position - b.position))
                    let ga = axis ? local(a.value, 0).y : local(0, a.value).x
                    let gb = axis ? local(b.value, 0).y : local(0, b.value).x
                    guard dp > 5, abs(ga - gb) > 1 else { continue }
                    for rotation in labelRotations {
                        out.append(Hypothesis(scale: abs(ga - gb) / dp, rotation: rotation, fromRunways: false))
                    }
                }
            }
        }
        for shape in drawn {
            for runway in database {
                let base = local(runway.baseLatitude, runway.baseLongitude)
                let reciprocal = local(runway.reciprocalLatitude, runway.reciprocalLongitude)
                let groundLength = distance(base, reciprocal)
                guard shape.length > 0, groundLength > 0 else { continue }
                // The database length is more accurate than its end coordinates; prefer it for the scale.
                let lengthMetres = runway.lengthFeet > 0 ? runway.lengthFeet / feetPerMetre : groundLength
                let groundAngle = atan2(reciprocal.y - base.y, reciprocal.x - base.x)
                for rotation in [0, 90, 180, 270] {
                    let trial = SimilarityFit(scale: 1, rotationDegrees: rotation, translation: .zero)
                    let s = trial.rotate(shape.start), e = trial.rotate(shape.end)
                    guard angleDifference(atan2(e.y - s.y, e.x - s.x), groundAngle) < 4 * .pi / 180 else { continue }
                    out.append(Hypothesis(scale: lengthMetres / Double(shape.length), rotation: rotation, fromRunways: true))
                }
            }
        }
        // Dedupe hypotheses within 0.5% scale and equal rotation; label-derived first.
        var unique: [Hypothesis] = []
        for h in out.sorted(by: { !$0.fromRunways && $1.fromRunways }) {
            if !unique.contains(where: { $0.rotation == h.rotation && abs($0.scale - h.scale) / h.scale < 0.005 }) {
                unique.append(h)
            }
        }
        return unique
    }

    /// Smallest difference between two directions, ignoring sense (mod 180 degrees).
    static func angleDifference(_ a: Double, _ b: Double) -> Double {
        var d = abs(a - b).truncatingRemainder(dividingBy: .pi)
        d = min(d, .pi - d)
        return d
    }

    /// Chooses the hypothesis supported by the most labels and runways, then refines it.
    static func fit(
        labels: [SnappedLabel], drawn: [RunwayShape], database: [AirportDiagramRunway],
        local: (Double, Double) -> CGPoint
    ) throws -> FitSolution {
        let candidates = hypotheses(labels: labels, drawn: drawn, database: database, local: local)
        guard !candidates.isEmpty else {
            if labels.isEmpty { throw AirportDiagramGeoreferenceError.runwaysNotMatched }
            throw AirportDiagramGeoreferenceError.scaleUndetermined
        }
        var best: (solution: FitSolution, score: Double)?
        var runnerUp: (solution: FitSolution, score: Double)?
        for hypothesis in candidates {
            guard let candidate = evaluate(hypothesis, labels: labels, drawn: drawn, database: database, local: local) else { continue }
            let latIn = candidate.inlierLabels.filter(\.isLatitude).count, lonIn = candidate.inlierLabels.count - latIn
            let score = Double(latIn + lonIn) + Double(candidate.matches.count)
                - candidate.matches.map(\.residualFeet).reduce(0, +) / 1000
            if best == nil || score > best?.score ?? 0 {
                runnerUp = best
                best = (candidate, score)
            } else if runnerUp == nil || score > runnerUp?.score ?? 0 {
                runnerUp = (candidate, score)
            }
        }
        guard let chosen = best else { throw AirportDiagramGeoreferenceError.scaleUndetermined }
        // A single runway and no label can't tell a page from its 180-degree twin.
        if let second = runnerUp, second.score == chosen.score,
           abs(second.solution.fit.rotationDegrees - chosen.solution.fit.rotationDegrees) == 180,
           chosen.solution.inlierLabels.isEmpty {
            throw AirportDiagramGeoreferenceError.orientationAmbiguous
        }
        return chosen.solution
    }

    /// Translation candidates for a hypothesis come from label clusters and from runway pairings;
    /// the best translation is refined by least squares over its inliers.
    static func evaluate(
        _ hypothesis: Hypothesis, labels: [SnappedLabel], drawn: [RunwayShape], database: [AirportDiagramRunway],
        local: (Double, Double) -> CGPoint
    ) -> FitSolution? {
        let scale = hypothesis.scale, rotation = hypothesis.rotation
        let tolerance = max(2.5 * scale, 8.0)   // metres: 2.5 pt of drafting slack
        let equations = labels.map { equation(for: $0, rotation: rotation, local: local) }
        // Implied translation per label.
        let implied = equations.map { ($0.axis, $0.target - scale * $0.coefficient) }
        let candidates = translationCandidates(implied: implied, tolerance: tolerance)
            + runwayTranslationCandidates(scale: scale, rotation: rotation, drawn: drawn, database: database, local: local)
        var best: (FitSolution, Double)?
        for translation in candidates {
            var fit = SimilarityFit(scale: scale, rotationDegrees: rotation, translation: translation)
            var inliers = zip(labels, implied).filter { _, imp in
                abs(imp.1 - (imp.0 == 0 ? Double(translation.x) : Double(translation.y))) <= tolerance
            }.map(\.0)
            var matches = matchRunways(fit: fit, drawn: drawn, database: database, local: local)
            guard !inliers.isEmpty || !matches.isEmpty else { continue }
            // Refine: labels, runway midpoints, and (when labels can't fix the scale) runway ends.
            let scaleFromLabels = Set(inliers.filter(\.isLatitude).map { Int(($0.value * 600).rounded()) }).count >= 2
                || Set(inliers.filter { !$0.isLatitude }.map { Int(($0.value * 600).rounded()) }).count >= 2
            var refineEquations = inliers.map { equation(for: $0, rotation: rotation, local: local) }
            // Runway midpoints only fix axes the labels can't, so the runway cross-check stays an
            // independent test of a label-determined fit.
            let latFixed = inliers.contains(where: \.isLatitude), lonFixed = inliers.contains { !$0.isLatitude }
            for match in matches {
                let r = fit.rotate(match.shape.midpoint)
                if !lonFixed { refineEquations.append(Equation(coefficient: Double(r.x), axis: 0, target: Double(match.groundMidpoint.x), weight: 1)) }
                if !latFixed { refineEquations.append(Equation(coefficient: Double(r.y), axis: 1, target: Double(match.groundMidpoint.y), weight: 1)) }
            }
            if let solved = solve(refineEquations, fixedScale: scaleFromLabels ? nil : scale) {
                fit = SimilarityFit(scale: solved.scale, rotationDegrees: rotation, translation: solved.translation)
                inliers = zip(labels, equations).filter { _, eq in
                    let predicted = fit.scale * eq.coefficient + (eq.axis == 0 ? Double(fit.translation.x) : Double(fit.translation.y))
                    return abs(predicted - eq.target) <= tolerance
                }.map(\.0)
                matches = matchRunways(fit: fit, drawn: drawn, database: database, local: local)
            }
            let latIn = inliers.filter(\.isLatitude).count, lonIn = inliers.count - latIn
            let score = Double(latIn + lonIn) + Double(matches.count) - matches.map(\.residualFeet).reduce(0, +) / 1000
            if best == nil || score > best?.1 ?? 0 {
                best = (FitSolution(fit: fit, inlierLabels: inliers, matches: matches, fromRunways: hypothesis.fromRunways && !scaleFromLabels), score)
            }
        }
        return best?.0
    }

    /// Clusters implied translations per axis; every (east, north) combination of cluster centres is
    /// a candidate. An axis without labels contributes "unknown" (0), to be fixed by runway matches.
    static func translationCandidates(implied: [(Int, Double)], tolerance: Double) -> [CGPoint] {
        func clusters(_ values: [Double]) -> [Double] {
            let sorted = values.sorted()
            var out: [Double] = []
            var i = 0
            while i < sorted.count {
                var j = i
                while j + 1 < sorted.count, sorted[j + 1] - sorted[i] <= tolerance { j += 1 }
                out.append(sorted[i...j].reduce(0, +) / Double(j - i + 1))
                i = j + 1
            }
            return out
        }
        let east = clusters(implied.filter { $0.0 == 0 }.map(\.1)), north = clusters(implied.filter { $0.0 == 1 }.map(\.1))
        var out: [CGPoint] = []
        for e in east.isEmpty ? [0] : east {
            for n in north.isEmpty ? [0] : north { out.append(CGPoint(x: e, y: n)) }
        }
        return east.isEmpty && north.isEmpty ? [] : out
    }

    /// Translations that put a drawn runway's midpoint on a database runway's midpoint, for every
    /// pairing whose orientation and length agree under the hypothesis.
    static func runwayTranslationCandidates(
        scale: Double, rotation: Int, drawn: [RunwayShape], database: [AirportDiagramRunway],
        local: (Double, Double) -> CGPoint
    ) -> [CGPoint] {
        let fit = SimilarityFit(scale: scale, rotationDegrees: rotation, translation: .zero)
        var out: [CGPoint] = []
        for shape in drawn {
            let s = fit.apply(shape.start), e = fit.apply(shape.end)
            let drawnAngle = atan2(e.y - s.y, e.x - s.x), drawnLength = distance(s, e)
            for runway in database {
                let base = local(runway.baseLatitude, runway.baseLongitude)
                let reciprocal = local(runway.reciprocalLatitude, runway.reciprocalLongitude)
                let expected = runway.lengthFeet > 0 ? runway.lengthFeet / feetPerMetre : distance(base, reciprocal)
                guard angleDifference(drawnAngle, atan2(reciprocal.y - base.y, reciprocal.x - base.x)) < 4 * .pi / 180,
                      abs(drawnLength - expected) / expected < 0.2 else { continue }
                let mid = CGPoint(x: (s.x + e.x) / 2, y: (s.y + e.y) / 2)
                let groundMid = CGPoint(x: (base.x + reciprocal.x) / 2, y: (base.y + reciprocal.y) / 2)
                out.append(CGPoint(x: groundMid.x - mid.x, y: groundMid.y - mid.y))
            }
        }
        return out
    }

    /// E-W over N-S scale from independent 1-D fits (needs two distinct values per axis).
    static func conformalRatio(_ labels: [SnappedLabel], reference: AirportDiagramReference) -> Double? {
        let lat = labels.filter(\.isLatitude).map { (Double($0.position), $0.value) }
        let lon = labels.filter { !$0.isLatitude }.map { (Double($0.position), $0.value) }
        guard let a = slope(lat), let c = slope(lon) else { return nil }
        let metres = AirportDiagramGeoreference.metresPerDegree(latitude: reference.latitude)
        let northSouth = abs(a) * metres.lat, eastWest = abs(c) * metres.lon
        guard northSouth > 0 else { return nil }
        return eastWest / northSouth
    }

    static func slope(_ points: [(Double, Double)]) -> Double? {
        guard Set(points.map { Int(($0.1 * 600).rounded()) }).count >= 2 else { return nil }
        let n = Double(points.count)
        let sx = points.reduce(0) { $0 + $1.0 }, sy = points.reduce(0) { $0 + $1.1 }
        let sxx = points.reduce(0) { $0 + $1.0 * $1.0 }, sxy = points.reduce(0) { $0 + $1.0 * $1.1 }
        let denominator = n * sxx - sx * sx
        guard abs(denominator) > 1e-9 else { return nil }
        return (n * sxy - sx * sy) / denominator
    }

    // MARK: - Runways

    nonisolated struct RunwayShape: Equatable {
        let start: CGPoint   // one end of the long axis, page points
        let end: CGPoint
        let widthPoints: CGFloat
        var length: CGFloat { hypot(end.x - start.x, end.y - start.y) }
        var midpoint: CGPoint { CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2) }
    }

    nonisolated struct RunwayMatch {
        let runway: AirportDiagramRunway
        let shape: RunwayShape
        let groundMidpoint: CGPoint  // metres
        /// Worst of: cross-track distance of the predicted thresholds from the drawn centreline, and
        /// along-track offset between predicted and drawn midpoints. Database end coordinates are only
        /// good to ~100 ft along the runway, so ends are not compared directly.
        let residualFeet: Double
        /// |drawn length * scale - database length| / database length.
        let lengthError: Double
        let midpointFeet: Double     // predicted vs drawn midpoint distance
        let crossTrackFeet: Double   // worst predicted threshold distance from the drawn centreline
        let endFeet: Double          // worst predicted threshold distance from the drawn end (database ends are noisy)
        let bearingErrorDegrees: Double
    }

    /// Drawn-runway matching tolerance: midpoint/centreline agreement within this many feet or 5% of the length.
    static let matchToleranceFeet = 300.0

    /// Matches database runways to drawn runways under `fit`: parallel within 4 degrees, lengths within
    /// 20%, position within `matchToleranceFeet`. One-to-one, best residual first, so parallel runways
    /// can't both claim the same drawn shape.
    static func matchRunways(
        fit: SimilarityFit, drawn: [RunwayShape], database: [AirportDiagramRunway],
        local: (Double, Double) -> CGPoint
    ) -> [RunwayMatch] {
        var candidates: [(runwayIndex: Int, shapeIndex: Int, match: RunwayMatch)] = []
        for (runwayIndex, runway) in database.enumerated() {
            let base = local(runway.baseLatitude, runway.baseLongitude)
            let reciprocal = local(runway.reciprocalLatitude, runway.reciprocalLongitude)
            let groundMid = CGPoint(x: (base.x + reciprocal.x) / 2, y: (base.y + reciprocal.y) / 2)
            let expected = runway.lengthFeet > 0 ? runway.lengthFeet / feetPerMetre : distance(base, reciprocal)
            let groundAngle = atan2(reciprocal.y - base.y, reciprocal.x - base.x)
            for (shapeIndex, shape) in drawn.enumerated() {
                let s = fit.apply(shape.start), e = fit.apply(shape.end)
                let axis = CGPoint(x: e.x - s.x, y: e.y - s.y)
                let drawnLength = distance(s, e)
                guard drawnLength > 0, angleDifference(atan2(axis.y, axis.x), groundAngle) < 4 * .pi / 180 else { continue }
                let lengthError = abs(drawnLength - expected) / expected
                guard lengthError < 0.2 else { continue }
                let unit = CGPoint(x: axis.x / drawnLength, y: axis.y / drawnLength)
                let mid = CGPoint(x: (s.x + e.x) / 2, y: (s.y + e.y) / 2)
                func crossTrack(_ p: CGPoint) -> Double { abs(Double((p.x - s.x) * unit.y - (p.y - s.y) * unit.x)) }
                let along = abs(Double((groundMid.x - mid.x) * unit.x + (groundMid.y - mid.y) * unit.y))
                let midpoint = distance(groundMid, mid)
                let ends = min(max(distance(s, base), distance(e, reciprocal)), max(distance(s, reciprocal), distance(e, base)))
                let residual = max(crossTrack(base), crossTrack(reciprocal), along)
                guard residual <= max(expected * 0.05, matchToleranceFeet / feetPerMetre) else { continue }
                let bearingError = angleDifference(atan2(axis.y, axis.x), groundAngle) * 180 / .pi
                let match = RunwayMatch(
                    runway: runway, shape: shape, groundMidpoint: groundMid, residualFeet: residual * feetPerMetre, lengthError: lengthError,
                    midpointFeet: midpoint * feetPerMetre, crossTrackFeet: max(crossTrack(base), crossTrack(reciprocal)) * feetPerMetre,
                    endFeet: ends * feetPerMetre, bearingErrorDegrees: bearingError
                )
                candidates.append((runwayIndex, shapeIndex, match))
            }
        }
        var usedRunways = Set<Int>(), usedShapes = Set<Int>()
        var matches: [RunwayMatch] = []
        for candidate in candidates.sorted(by: { $0.match.residualFeet < $1.match.residualFeet }) {
            guard !usedRunways.contains(candidate.runwayIndex), !usedShapes.contains(candidate.shapeIndex) else { continue }
            usedRunways.insert(candidate.runwayIndex)
            usedShapes.insert(candidate.shapeIndex)
            matches.append(candidate.match)
        }
        return matches
    }

    static func distance(_ a: CGPoint, _ b: CGPoint) -> Double { Double(hypot(a.x - b.x, a.y - b.y)) }

    static func median(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        return sorted.count % 2 == 1 ? sorted[sorted.count / 2] : (sorted[sorted.count / 2 - 1] + sorted[sorted.count / 2]) / 2
    }

    // MARK: - Insets

    nonisolated struct InsetMask: Equatable {
        let center: CGPoint
        let radius: CGFloat
    }

    /// Magnified "SEE INSET" circles are drawn at a different scale. The circle containing the
    /// "INSET" label marks the real location and stays; every other large circle is masked.
    static func insetMasks(document: PDFDocument, page: PDFPage, vectors: PDFVectorScanner.Result) -> [InsetMask] {
        let circles = vectors.circles(minimumRadius: 40)
        guard !circles.isEmpty, let text = page.string, text.uppercased().contains("INSET") else { return [] }
        let labelRects = document.findString("INSET", withOptions: [.caseInsensitive])
            .filter { $0.pages.first == page }
            .map { $0.bounds(for: page) }
        return circles.filter { circle in
            !labelRects.contains { rect in
                hypot(rect.midX - circle.center.x, rect.midY - circle.center.y) <= circle.radius
            }
        }.map { InsetMask(center: $0.center, radius: $0.radius) }
    }

    // MARK: - Rendering

    /// Renders the clip box to a transparent RGBA image at `scale` pixels per point. White becomes
    /// clear (subtractive), inset masks are punched out, and rows run top-down (image row 0 = page maxY).
    static func renderImage(pdfData: Data, georeference: AirportDiagramGeoreference, scale: CGFloat = 4) -> CGImage? {
        guard let document = PDFDocument(data: pdfData), let page = document.page(at: 0), let cgPage = page.pageRef else {
            return nil
        }
        let clip = georeference.clipBox.cgRect
        let width = Int((clip.width * scale).rounded()), height = Int((clip.height * scale).rounded())
        guard width > 0, height > 0,
              let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
              ) else { return nil }
        context.clear(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: -clip.minX, y: -clip.minY)
        context.clip(to: clip)
        context.drawPDFPage(cgPage)

        // Punch out insets.
        context.setBlendMode(.clear)
        for mask in georeference.masks {
            let r = CGFloat(mask.radius) + 1
            context.fillEllipse(in: CGRect(x: CGFloat(mask.centerX) - r, y: CGFloat(mask.centerY) - r, width: 2 * r, height: 2 * r))
        }
        context.setBlendMode(.normal)

        // White -> clear: subtract the common white component (premultiplied, so this is exact).
        if let data = context.data {
            let bytesPerRow = context.bytesPerRow
            let pixels = data.bindMemory(to: UInt8.self, capacity: bytesPerRow * height)
            for row in 0..<height {
                var offset = row * bytesPerRow
                for _ in 0..<width {
                    let alpha = pixels[offset + 3]
                    if alpha > 0 {
                        let white = min(pixels[offset], pixels[offset + 1], pixels[offset + 2])
                        pixels[offset] -= white
                        pixels[offset + 1] -= white
                        pixels[offset + 2] -= white
                        pixels[offset + 3] = alpha - min(white, alpha)
                    }
                    offset += 4
                }
            }
        }
        return context.makeImage()
    }

    /// PNG encoding without UIKit/AppKit.
    static func pngData(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }
}

// MARK: - Grid Lines

/// An axis-aligned straight segment from the vector stream.
nonisolated struct GridLine: Equatable {
    let horizontal: Bool
    let position: CGFloat   // y for horizontal, x for vertical
    let low: CGFloat        // extent along the line
    let high: CGFloat
    var length: CGFloat { high - low }
    var endpoints: [CGPoint] {
        horizontal
            ? [CGPoint(x: low, y: position), CGPoint(x: high, y: position)]
            : [CGPoint(x: position, y: low), CGPoint(x: position, y: high)]
    }
}

// MARK: - Vector Scanner

/// Walks the page content stream (and Form XObjects) collecting straight segments, dark filled
/// polygons, stroked circles and stroked rectangles in page user space.
nonisolated enum PDFVectorScanner {

    nonisolated struct Polygon: Equatable {
        let points: [CGPoint]
        let curves: Int
        let filled: Bool
        let stroked: Bool
        let darkFill: Bool
        let lineWidth: CGFloat

        var bounds: CGRect {
            guard let first = points.first else { return .null }
            return points.dropFirst().reduce(CGRect(origin: first, size: .zero)) { $0.union(CGRect(origin: $1, size: .zero)) }
        }
    }

    nonisolated struct Result {
        let segments: [(CGPoint, CGPoint)]
        let polygons: [Polygon]

        /// Axis-aligned straight pieces longer than 3 pt.
        func gridLines() -> [GridLine] {
            segments.compactMap { a, b in
                if abs(a.y - b.y) < 0.3, abs(a.x - b.x) > 3 {
                    return GridLine(horizontal: true, position: (a.y + b.y) / 2, low: min(a.x, b.x), high: max(a.x, b.x))
                }
                if abs(a.x - b.x) < 0.3, abs(a.y - b.y) > 3 {
                    return GridLine(horizontal: false, position: (a.x + b.x) / 2, low: min(a.y, b.y), high: max(a.y, b.y))
                }
                return nil
            }
        }

        /// Long, thin, dark filled polygons: runway pavement. Returns their long axes.
        func runwayShapes() -> [AirportDiagramGeoreferencer.RunwayShape] {
            polygons.compactMap { polygon in
                guard polygon.filled, polygon.darkFill, polygon.curves == 0, polygon.points.count >= 4, polygon.points.count <= 80 else { return nil }
                guard let box = Self.orientedBox(polygon.points) else { return nil }
                guard box.length >= 40, box.width >= 1.5, box.width <= 40, box.length / box.width >= 5 else { return nil }
                // Pavement fills its box; notched outlines (EMAS, arrows) still cover most of it.
                let area = abs(Self.area(polygon.points))
                guard area >= 0.55 * Double(box.length * box.width) else { return nil }
                return .init(start: box.start, end: box.end, widthPoints: box.width)
            }
        }

        /// Stroked near-circular curve paths of at least `minimumRadius`.
        func circles(minimumRadius: CGFloat) -> [(center: CGPoint, radius: CGFloat)] {
            polygons.compactMap { polygon in
                guard polygon.stroked, polygon.curves >= 4 else { return nil }
                let b = polygon.bounds
                guard b.width >= 2 * minimumRadius, abs(b.width - b.height) <= 0.08 * b.width else { return nil }
                let center = CGPoint(x: b.midX, y: b.midY), radius = (b.width + b.height) / 4
                // Every vertex should sit on the circle.
                let onCircle = polygon.points.allSatisfy { abs(hypot($0.x - center.x, $0.y - center.y) - radius) < 0.08 * radius }
                return onCircle ? (center, radius) : nil
            }
        }

        /// The chart neatline: the largest stroked axis-aligned rectangle covering most of the page.
        /// Falls back to the extent of the long grid lines, then to the page inset by 18 pt.
        func neatline(pageBox: CGRect, gridLines: [GridLine]) -> CGRect {
            var best: CGRect?
            for polygon in polygons where polygon.stroked && polygon.curves == 0 && (4...5).contains(polygon.points.count) {
                let b = polygon.bounds
                guard b.width >= 0.6 * pageBox.width, b.height >= 0.6 * pageBox.height,
                      b.width < pageBox.width - 1, b.height < pageBox.height - 1 else { continue }
                let axisAligned = polygon.points.allSatisfy { p in
                    (abs(p.x - b.minX) < 0.5 || abs(p.x - b.maxX) < 0.5) && (abs(p.y - b.minY) < 0.5 || abs(p.y - b.maxY) < 0.5)
                }
                guard axisAligned else { continue }
                if best == nil || b.width * b.height > (best?.width ?? 0) * (best?.height ?? 0) { best = b }
            }
            if let best { return best }
            let long = gridLines.filter { $0.length > 0.3 * min(pageBox.width, pageBox.height) }
            if long.count >= 2 {
                let xs = long.flatMap { $0.horizontal ? [$0.low, $0.high] : [$0.position] }
                let ys = long.flatMap { $0.horizontal ? [$0.position] : [$0.low, $0.high] }
                if let minX = xs.min(), let maxX = xs.max(), let minY = ys.min(), let maxY = ys.max(), maxX - minX > 100, maxY - minY > 100 {
                    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY).insetBy(dx: -4, dy: -4).intersection(pageBox)
                }
            }
            return pageBox.insetBy(dx: 18, dy: 18)
        }

        /// Minimum-area oriented box of a polygon via its edge directions. Returns the long axis.
        static func orientedBox(_ points: [CGPoint]) -> (start: CGPoint, end: CGPoint, length: CGFloat, width: CGFloat)? {
            guard points.count >= 3 else { return nil }
            var best: (angle: CGFloat, area: CGFloat, minU: CGFloat, maxU: CGFloat, minV: CGFloat, maxV: CGFloat)?
            for i in 0..<points.count {
                let p = points[i], q = points[(i + 1) % points.count]
                let edge = hypot(q.x - p.x, q.y - p.y)
                guard edge > 1 else { continue }
                let angle = atan2(q.y - p.y, q.x - p.x)
                let cosA = cos(angle), sinA = sin(angle)
                var minU = CGFloat.greatestFiniteMagnitude, maxU = -CGFloat.greatestFiniteMagnitude
                var minV = CGFloat.greatestFiniteMagnitude, maxV = -CGFloat.greatestFiniteMagnitude
                for r in points {
                    let u = r.x * cosA + r.y * sinA, v = -r.x * sinA + r.y * cosA
                    minU = min(minU, u); maxU = max(maxU, u); minV = min(minV, v); maxV = max(maxV, v)
                }
                let area = (maxU - minU) * (maxV - minV)
                if best == nil || area < best?.area ?? .infinity { best = (angle, area, minU, maxU, minV, maxV) }
            }
            guard let b = best else { return nil }
            let cosA = cos(b.angle), sinA = sin(b.angle)
            let du = b.maxU - b.minU, dv = b.maxV - b.minV
            let midV = (b.minV + b.maxV) / 2, midU = (b.minU + b.maxU) / 2
            func point(u: CGFloat, v: CGFloat) -> CGPoint { CGPoint(x: u * cosA - v * sinA, y: u * sinA + v * cosA) }
            if du >= dv {
                return (point(u: b.minU, v: midV), point(u: b.maxU, v: midV), du, dv)
            } else {
                return (point(u: midU, v: b.minV), point(u: midU, v: b.maxV), dv, du)
            }
        }

        static func area(_ points: [CGPoint]) -> Double {
            var sum = 0.0
            for i in 0..<points.count {
                let p = points[i], q = points[(i + 1) % points.count]
                sum += Double(p.x * q.y - q.x * p.y)
            }
            return sum / 2
        }
    }

    /// Mutable scan state handed to the C callbacks through the scanner's info pointer.
    nonisolated final class State {
        var ctm = CGAffineTransform.identity
        var stack: [CGAffineTransform] = []
        var lineWidth: CGFloat = 1
        var fillDark = true          // default fill colour is black
        var current: [CGPoint] = []
        var curvesInCurrent = 0
        var subpaths: [([CGPoint], Int)] = []
        var segments: [(CGPoint, CGPoint)] = []
        var polygons: [Polygon] = []
        var pendingSegments: [(CGPoint, CGPoint)] = []
        var last: CGPoint?
        var contentStream: CGPDFContentStreamRef?
        var depth = 0
        var resourceStack: [CGPDFContentStreamRef] = []
    }

    static func state(_ info: UnsafeMutableRawPointer?) -> State? {
        guard let info else { return nil }
        return Unmanaged<State>.fromOpaque(info).takeUnretainedValue()
    }

    static func number(_ scanner: CGPDFScannerRef) -> CGFloat {
        var value: CGPDFReal = 0
        CGPDFScannerPopNumber(scanner, &value)
        return CGFloat(value)
    }

    static func moveTo(_ s: State, _ p: CGPoint) {
        closeCurrent(s, implicit: true)
        s.current = [p]
        s.curvesInCurrent = 0
        s.last = p
    }

    static func lineTo(_ s: State, _ p: CGPoint) {
        if let last = s.last { s.pendingSegments.append((last, p)) }
        s.current.append(p)
        s.last = p
    }

    static func curveTo(_ s: State, _ p: CGPoint) {
        s.current.append(p)
        s.curvesInCurrent += 1
        s.last = p
    }

    static func closeCurrent(_ s: State, implicit: Bool) {
        guard !s.current.isEmpty else { return }
        if !implicit, let first = s.current.first, let last = s.last, first != last { s.pendingSegments.append((last, first)) }
        s.subpaths.append((s.current, s.curvesInCurrent))
        s.current = []
        s.curvesInCurrent = 0
    }

    static func paint(_ s: State, fill: Bool, stroke: Bool) {
        closeCurrent(s, implicit: true)
        for (points, curves) in s.subpaths {
            s.polygons.append(Polygon(points: points, curves: curves, filled: fill, stroked: stroke, darkFill: s.fillDark, lineWidth: s.lineWidth))
        }
        if fill || stroke { s.segments += s.pendingSegments }
        s.subpaths = []
        s.pendingSegments = []
        s.last = nil
    }

    static func makeTable() -> CGPDFOperatorTableRef? {
        guard let table = CGPDFOperatorTableCreate() else { return nil }
        CGPDFOperatorTableSetCallback(table, "q") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            s.stack.append(s.ctm)
        }
        CGPDFOperatorTableSetCallback(table, "Q") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            if let top = s.stack.popLast() { s.ctm = top }
        }
        CGPDFOperatorTableSetCallback(table, "cm") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            let f = PDFVectorScanner.number(scanner), e = PDFVectorScanner.number(scanner), d = PDFVectorScanner.number(scanner), c = PDFVectorScanner.number(scanner), b = PDFVectorScanner.number(scanner), a = PDFVectorScanner.number(scanner)
            s.ctm = CGAffineTransform(a: a, b: b, c: c, d: d, tx: e, ty: f).concatenating(s.ctm)
        }
        CGPDFOperatorTableSetCallback(table, "w") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            s.lineWidth = PDFVectorScanner.number(scanner)
        }
        CGPDFOperatorTableSetCallback(table, "g") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            s.fillDark = PDFVectorScanner.number(scanner) < 0.4
        }
        CGPDFOperatorTableSetCallback(table, "rg") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            let b = PDFVectorScanner.number(scanner), g = PDFVectorScanner.number(scanner), r = PDFVectorScanner.number(scanner)
            s.fillDark = max(r, g, b) < 0.4
        }
        CGPDFOperatorTableSetCallback(table, "k") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            let k = PDFVectorScanner.number(scanner)
            _ = PDFVectorScanner.number(scanner); _ = PDFVectorScanner.number(scanner); _ = PDFVectorScanner.number(scanner)
            s.fillDark = k > 0.6
        }
        CGPDFOperatorTableSetCallback(table, "sc") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            s.fillDark = PDFVectorScanner.darkFromOperands(scanner)
        }
        CGPDFOperatorTableSetCallback(table, "scn") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            s.fillDark = PDFVectorScanner.darkFromOperands(scanner)
        }
        CGPDFOperatorTableSetCallback(table, "m") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            let y = PDFVectorScanner.number(scanner), x = PDFVectorScanner.number(scanner)
            PDFVectorScanner.moveTo(s, CGPoint(x: x, y: y).applying(s.ctm))
        }
        CGPDFOperatorTableSetCallback(table, "l") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            let y = PDFVectorScanner.number(scanner), x = PDFVectorScanner.number(scanner)
            PDFVectorScanner.lineTo(s, CGPoint(x: x, y: y).applying(s.ctm))
        }
        CGPDFOperatorTableSetCallback(table, "c") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            let y3 = PDFVectorScanner.number(scanner), x3 = PDFVectorScanner.number(scanner)
            _ = PDFVectorScanner.number(scanner); _ = PDFVectorScanner.number(scanner); _ = PDFVectorScanner.number(scanner); _ = PDFVectorScanner.number(scanner)
            PDFVectorScanner.curveTo(s, CGPoint(x: x3, y: y3).applying(s.ctm))
        }
        CGPDFOperatorTableSetCallback(table, "v") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            let y3 = PDFVectorScanner.number(scanner), x3 = PDFVectorScanner.number(scanner)
            _ = PDFVectorScanner.number(scanner); _ = PDFVectorScanner.number(scanner)
            PDFVectorScanner.curveTo(s, CGPoint(x: x3, y: y3).applying(s.ctm))
        }
        CGPDFOperatorTableSetCallback(table, "y") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            let y3 = PDFVectorScanner.number(scanner), x3 = PDFVectorScanner.number(scanner)
            _ = PDFVectorScanner.number(scanner); _ = PDFVectorScanner.number(scanner)
            PDFVectorScanner.curveTo(s, CGPoint(x: x3, y: y3).applying(s.ctm))
        }
        CGPDFOperatorTableSetCallback(table, "h") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.closeCurrent(s, implicit: false)
        }
        CGPDFOperatorTableSetCallback(table, "re") { scanner, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            let h = PDFVectorScanner.number(scanner), w = PDFVectorScanner.number(scanner), y = PDFVectorScanner.number(scanner), x = PDFVectorScanner.number(scanner)
            let corners = [CGPoint(x: x, y: y), CGPoint(x: x + w, y: y), CGPoint(x: x + w, y: y + h), CGPoint(x: x, y: y + h)]
                .map { $0.applying(s.ctm) }
            PDFVectorScanner.closeCurrent(s, implicit: true)
            for i in 0..<4 { s.pendingSegments.append((corners[i], corners[(i + 1) % 4])) }
            s.subpaths.append((corners, 0))
            s.last = nil
        }
        CGPDFOperatorTableSetCallback(table, "f") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.paint(s, fill: true, stroke: false)
        }
        CGPDFOperatorTableSetCallback(table, "F") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.paint(s, fill: true, stroke: false)
        }
        CGPDFOperatorTableSetCallback(table, "f*") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.paint(s, fill: true, stroke: false)
        }
        CGPDFOperatorTableSetCallback(table, "B") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.paint(s, fill: true, stroke: true)
        }
        CGPDFOperatorTableSetCallback(table, "B*") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.paint(s, fill: true, stroke: true)
        }
        CGPDFOperatorTableSetCallback(table, "b") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.closeCurrent(s, implicit: false); PDFVectorScanner.paint(s, fill: true, stroke: true)
        }
        CGPDFOperatorTableSetCallback(table, "b*") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.closeCurrent(s, implicit: false); PDFVectorScanner.paint(s, fill: true, stroke: true)
        }
        CGPDFOperatorTableSetCallback(table, "S") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.paint(s, fill: false, stroke: true)
        }
        CGPDFOperatorTableSetCallback(table, "s") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.closeCurrent(s, implicit: false); PDFVectorScanner.paint(s, fill: false, stroke: true)
        }
        CGPDFOperatorTableSetCallback(table, "n") { _, info in
            guard let s = PDFVectorScanner.state(info) else { return }
            PDFVectorScanner.paint(s, fill: false, stroke: false)
        }
        CGPDFOperatorTableSetCallback(table, "Do") { scanner, info in
            guard let s = PDFVectorScanner.state(info), s.depth < 4, let stream = s.contentStream else { return }
            var namePointer: UnsafePointer<CChar>? = nil
            guard CGPDFScannerPopName(scanner, &namePointer), let namePointer,
                  let object = CGPDFContentStreamGetResource(stream, "XObject", namePointer) else { return }
            var xobject: CGPDFStreamRef? = nil
            guard CGPDFObjectGetValue(object, .stream, &xobject), let xobject,
                  let dictionary = CGPDFStreamGetDictionary(xobject) else { return }
            var subtype: UnsafePointer<CChar>? = nil
            guard CGPDFDictionaryGetName(dictionary, "Subtype", &subtype), let subtype, String(cString: subtype) == "Form" else { return }
            // Form space -> user space: /Matrix then the current CTM.
            var matrix = CGAffineTransform.identity
            var array: CGPDFArrayRef? = nil
            if CGPDFDictionaryGetArray(dictionary, "Matrix", &array), let array, CGPDFArrayGetCount(array) == 6 {
                var values = [CGFloat](repeating: 0, count: 6)
                for i in 0..<6 { var v: CGPDFReal = 0; CGPDFArrayGetNumber(array, i, &v); values[i] = CGFloat(v) }
                matrix = CGAffineTransform(a: values[0], b: values[1], c: values[2], d: values[3], tx: values[4], ty: values[5])
            }
            let saved = (s.ctm, s.stack, s.lineWidth, s.fillDark, s.contentStream)
            s.ctm = matrix.concatenating(s.ctm)
            s.stack = []
            s.depth += 1
            let inner = CGPDFContentStreamCreateWithStream(xobject, dictionary, stream)
            s.contentStream = inner
            if let table = PDFVectorScanner.makeTable(), let innerScanner = Optional(CGPDFScannerCreate(inner, table, info)) {
                CGPDFScannerScan(innerScanner)
                CGPDFScannerRelease(innerScanner)
                CGPDFOperatorTableRelease(table)
            }
            s.depth -= 1
            (s.ctm, s.stack, s.lineWidth, s.fillDark, s.contentStream) = saved
        }
        return table
    }

    /// `sc`/`scn` with 1, 3 or 4 numeric operands (pattern names pop as 0 numbers: assume dark).
    static func darkFromOperands(_ scanner: CGPDFScannerRef) -> Bool {
        var values: [CGFloat] = []
        var value: CGPDFReal = 0
        while CGPDFScannerPopNumber(scanner, &value) { values.append(CGFloat(value)) }
        switch values.count {
        case 1: return values[0] < 0.4
        case 3: return values.max() ?? 0 < 0.4
        case 4: return values[0] > 0.6
        default: return true
        }
    }

    static func scan(page: CGPDFPage) -> Result {
        let s = State()
        let content = CGPDFContentStreamCreateWithPage(page)
        s.contentStream = content
        guard let table = makeTable() else { return Result(segments: [], polygons: []) }
        let scanner = CGPDFScannerCreate(content, table, Unmanaged.passUnretained(s).toOpaque())
        CGPDFScannerScan(scanner)
        CGPDFScannerRelease(scanner)
        CGPDFOperatorTableRelease(table)
        CGPDFContentStreamRelease(content)
        paint(s, fill: false, stroke: false)
        return Result(segments: s.segments, polygons: s.polygons)
    }
}
