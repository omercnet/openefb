//
//  AirportDiagramGeoreferencerTests.swift
//  efb-212Tests
//
//  Real FAA d-TPP airport diagram PDFs (cycle 2611) against the georeferencing core:
//  KPAO 09216AD (text-layer labels, one runway) and KBOS 00058AD (vector-outline labels needing OCR,
//  six runways, a magnified inset). Airport and runway values are the bundled aviation.sqlite rows.
//

import Testing
import Foundation
import CoreGraphics
@testable import efb_212

private final class GeoreferencerBundleToken {}

@Suite("Airport Diagram Georeferencer Tests")
struct AirportDiagramGeoreferencerTests {

    // MARK: - Fixtures

    static func fixture(_ name: String) throws -> Data {
        let bundle = Bundle(for: GeoreferencerBundleToken.self)
        let url = try #require(bundle.url(forResource: name, withExtension: "PDF"), "\(name).PDF is not bundled with the tests")
        return try Data(contentsOf: url)
    }

    static let kpao = AirportDiagramReference(latitude: 37.461102, longitude: -122.114998)
    // Runway ends are FAA NASR APT_RWY_END (cycle 29 Oct 2026), the same data aviation.sqlite bundles
    // (see BundledAviationDataTests), so the 50 ft cross-check runs on the app's own ends.
    static let kpaoRunways = [
        AirportDiagramRunway(identifier: "13/31", lengthFeet: 2441, widthFeet: 70,
                             baseLatitude: 37.46375061, baseLongitude: -122.11765513,
                             reciprocalLatitude: 37.45849213, reciprocalLongitude: -122.11243811),
    ]

    static let kbos = AirportDiagramReference(latitude: 42.36197, longitude: -71.0079)
    static let kbosRunways = [
        AirportDiagramRunway(identifier: "04L/22R", lengthFeet: 7864, widthFeet: 150, baseLatitude: 42.35798825, baseLongitude: -71.01433852, reciprocalLatitude: 42.37829886, reciprocalLongitude: -71.00451386),
        AirportDiagramRunway(identifier: "04R/22L", lengthFeet: 10006, widthFeet: 150, baseLatitude: 42.35105816, baseLongitude: -71.01179388, reciprocalLatitude: 42.37689997, reciprocalLongitude: -70.99929091),
        AirportDiagramRunway(identifier: "09/27", lengthFeet: 7001, widthFeet: 150, baseLatitude: 42.35575416, baseLongitude: -71.01289408, reciprocalLatitude: 42.36021575, reciprocalLongitude: -70.98770211),
        AirportDiagramRunway(identifier: "14/32", lengthFeet: 5000, widthFeet: 100, baseLatitude: 42.3565978, baseLongitude: -71.02327461, reciprocalLatitude: 42.34859902, reciprocalLongitude: -71.00824558),
        AirportDiagramRunway(identifier: "15L/33R", lengthFeet: 2557, widthFeet: 100, baseLatitude: 42.37319466, baseLongitude: -71.00861241, reciprocalLatitude: 42.36821641, reciprocalLongitude: -71.00194466),
        AirportDiagramRunway(identifier: "15R/33L", lengthFeet: 10083, widthFeet: 150, baseLatitude: 42.3742708, baseLongitude: -71.01789213, reciprocalLatitude: 42.35465077, reciprocalLongitude: -70.99158605),
    ]

    /// Ground distance in feet between a runway midpoint from the database and the fit's prediction
    /// for the page point the drawn runway occupies. Uses the fit's own inverse, so it checks the
    /// transform end to end.
    static func feet(_ a: (latitude: Double, longitude: Double), _ b: (latitude: Double, longitude: Double)) -> Double {
        let m = AirportDiagramGeoreference.metresPerDegree(latitude: a.latitude)
        return hypot((a.latitude - b.latitude) * m.lat, (a.longitude - b.longitude) * m.lon) * 3.280_839_895
    }

    // MARK: - KPAO (text-layer labels)

    @Test func kpaoFitsFromTextLabelsAndMatchesTheRunway() throws {
        let data = try Self.fixture("09216AD")
        let fit = try AirportDiagramGeoreferencer.georeference(pdfData: data, reference: Self.kpao, runways: Self.kpaoRunways)
        let d = fit.diagnostics
        #expect(d.labelSource == .text)
        #expect(d.method == .gridRunwayChecked)
        #expect(d.rotationDegrees == 0)
        #expect(abs(d.feetPerPoint - 10.4) < 0.3)                       // KPAO is drawn at ~10.4 ft per PDF point
        let ratio = try #require(d.scaleRatio)
        #expect(abs(ratio - 1) < 0.01)                                  // conformal: N-S and E-W scales agree
        #expect(d.runwaysMatched == 1)
        let residual = try #require(d.runwayResidualFeet)
        #expect(residual <= AirportDiagramGeoreferencer.runwayToleranceFeet)

        // The 13/31 midpoint from the database lands on the drawn runway's midpoint (page ~(172, 345)).
        let runway = Self.kpaoRunways[0]
        let midpoint = fit.pagePoint(
            latitude: (runway.baseLatitude + runway.reciprocalLatitude) / 2,
            longitude: (runway.baseLongitude + runway.reciprocalLongitude) / 2
        )
        #expect(abs(midpoint.x - 172) < 4, "midpoint x \(midpoint.x)")
        #expect(abs(midpoint.y - 345.5) < 4, "midpoint y \(midpoint.y)")

        // Round trip through the transform.
        let back = fit.coordinate(forPagePoint: midpoint)
        #expect(Self.feet(back, ((runway.baseLatitude + runway.reciprocalLatitude) / 2, (runway.baseLongitude + runway.reciprocalLongitude) / 2)) < 1)

        // Neatline clip excludes the page margins, and the quad is ordered top-left, bottom-left, bottom-right, top-right.
        #expect(fit.clipBox.x > 10 && fit.clipBox.y > 30 && fit.clipBox.width < fit.pageBox.width)
        let corners = fit.clipCorners
        #expect(corners[0].latitude > corners[1].latitude)      // top-left is north of bottom-left
        #expect(corners[2].longitude > corners[1].longitude)    // bottom-right is east of bottom-left
        #expect(fit.masks.isEmpty)
    }

    @Test func kpaoGridLabelsAreSnappedToGridLines() throws {
        let data = try Self.fixture("09216AD")
        let dump = AirportDiagramGeoreferencer.inspect(pdfData: data, reference: Self.kpao, runways: Self.kpaoRunways)
        #expect(dump.contains("lat 37.4667 on horizontal line at 539."))   // 37°28'N
        #expect(dump.contains("lat 37.4583 on horizontal line at 247."))   // 37°27.5'N
        #expect(dump.contains("lon -122.1167 on vertical line at 126."))   // 122°07'W
        #expect(dump.contains("lon -122.1083 on vertical line at 359."))   // 122°06.5'W
        #expect(dump.contains("RESULT ok"))
    }

    // MARK: - KBOS (OCR labels, inset)

    @Test func bosFitsFromOCRLabelsWithRunwayCrossCheckAndInsetMask() throws {
        let data = try Self.fixture("00058AD")
        let fit = try AirportDiagramGeoreferencer.georeference(pdfData: data, reference: Self.kbos, runways: Self.kbosRunways)
        let d = fit.diagnostics
        #expect(d.labelSource == .ocr)                                   // BOS labels are vector outlines
        #expect(d.rotationDegrees == 0)
        #expect(abs(d.feetPerPoint - 34.7) < 0.7)
        #expect(d.runwaysMatched >= 5)
        let residual = try #require(d.runwayResidualFeet)
        #expect(residual <= AirportDiagramGeoreferencer.runwayToleranceFeet)

        // The magnified terminal inset (top-left circle, ~80 pt radius) is masked; the
        // "SEE INSET" marker circle on the main diagram is not.
        #expect(fit.masks.count == 1)
        let mask = try #require(fit.masks.first)
        #expect(abs(mask.radius - 79.5) < 3)
        #expect(abs(mask.centerX - 120) < 5 && abs(mask.centerY - 465) < 5)
    }

    @Test func bosRenderPunchesOutTheInsetAndKeepsRunwaysOpaque() throws {
        let data = try Self.fixture("00058AD")
        let fit = try AirportDiagramGeoreferencer.georeference(pdfData: data, reference: Self.kbos, runways: Self.kbosRunways)
        let image = try #require(AirportDiagramGeoreferencer.renderImage(pdfData: data, georeference: fit, scale: 1))
        let clip = fit.clipBox.cgRect
        #expect(image.width == Int(clip.width.rounded()))
        #expect(image.height == Int(clip.height.rounded()))

        func alpha(atPage x: Double, _ y: Double) throws -> UInt8 {
            let provider = try #require(image.dataProvider)
            let bytes = try #require(provider.data) as Data
            let px = Int((x - clip.minX).rounded()), py = Int((clip.maxY - y).rounded())  // row 0 is the page top
            let offset = py * image.bytesPerRow + px * 4
            return bytes[offset + 3]
        }
        let mask = try #require(fit.masks.first)
        #expect(try alpha(atPage: mask.centerX, mask.centerY) == 0)                    // inset centre is clear
        #expect(try alpha(atPage: clip.minX + 2, clip.minY + 2) == 0)                  // blank paper is clear
        // Centre of runway 04R/22L pavement: midpoint of the drawn runway (162.9,110.4)-(260.4,382.0).
        #expect(try alpha(atPage: 211.6, 246.2) > 200)
        #expect(AirportDiagramGeoreferencer.pngData(image) != nil)
    }

    // MARK: - Gates

    @Test func conformalGateRejectsAFitWhoseAxesDisagree() throws {
        // KPAO's real ratio is 0.9998; a tolerance tighter than that must reject it through the gate.
        let data = try Self.fixture("09216AD")
        #expect(throws: AirportDiagramGeoreferenceError.self) {
            try AirportDiagramGeoreferencer.georeference(
                pdfData: data, reference: Self.kpao, runways: Self.kpaoRunways,
                tolerances: .init(conformal: 0.0001)
            )
        }
        do {
            _ = try AirportDiagramGeoreferencer.georeference(
                pdfData: data, reference: Self.kpao, runways: Self.kpaoRunways, tolerances: .init(conformal: 0.0001)
            )
        } catch let error as AirportDiagramGeoreferenceError {
            guard case .conformalGateFailed = error else { Issue.record("expected conformalGateFailed, got \(error)"); return }
        }

        // Synthetic labels: N-S scale 10 ft/pt, E-W 12 ft/pt -> ratio 1.2, outside the 3% gate.
        let metres = AirportDiagramGeoreference.metresPerDegree(latitude: 37.46)
        let ftPerDegLat = metres.lat * 3.280_839_895, ftPerDegLon = metres.lon * 3.280_839_895
        let labels = [
            AirportDiagramGeoreferencer.SnappedLabel(isLatitude: true, value: 37.45, horizontal: true, position: 100),
            AirportDiagramGeoreferencer.SnappedLabel(isLatitude: true, value: 37.45 + 1000 / ftPerDegLat, horizontal: true, position: 200),
            AirportDiagramGeoreferencer.SnappedLabel(isLatitude: false, value: -122.1, horizontal: false, position: 100),
            AirportDiagramGeoreferencer.SnappedLabel(isLatitude: false, value: -122.1 + 1200 / ftPerDegLon, horizontal: false, position: 200),
        ]
        let ratio = try #require(AirportDiagramGeoreferencer.conformalRatio(labels, reference: Self.kpao))
        #expect(abs(ratio - 1.2) < 0.01)
        #expect(abs(ratio - 1) > AirportDiagramGeoreferencer.conformalTolerance)
    }

    @Test func runwayCrossCheckRejectsWhenTheDatabaseRunwayIsElsewhere() throws {
        // Shift the KPAO runway 1,000 ft north: the grid fit is unchanged, so the cross-check must fail.
        let data = try Self.fixture("09216AD")
        let shifted = Self.kpaoRunways.map {
            AirportDiagramRunway(identifier: $0.identifier, lengthFeet: $0.lengthFeet, widthFeet: $0.widthFeet,
                                 baseLatitude: $0.baseLatitude + 0.00275, baseLongitude: $0.baseLongitude,
                                 reciprocalLatitude: $0.reciprocalLatitude + 0.00275, reciprocalLongitude: $0.reciprocalLongitude)
        }
        do {
            _ = try AirportDiagramGeoreferencer.georeference(pdfData: data, reference: Self.kpao, runways: shifted)
            Issue.record("expected a rejection")
        } catch let error as AirportDiagramGeoreferenceError {
            switch error {
            case .runwayCrossCheckFailed, .runwaysNotMatched: break
            default: Issue.record("expected a runway rejection, got \(error)")
            }
        }
    }

    @Test func rejectsGarbageInsteadOfGuessing() throws {
        #expect(throws: AirportDiagramGeoreferenceError.unreadablePDF) {
            try AirportDiagramGeoreferencer.georeference(pdfData: Data("not a pdf".utf8), reference: Self.kpao, runways: [])
        }
    }

    // MARK: - Label parsing

    @Test func parsesGridLabelVariants() throws {
        let a = try #require(AirportDiagramGeoreferencer.parseLabel("37°28'N"))
        #expect(a.isLatitude && abs(a.value - 37.4667) < 1e-4)
        let b = try #require(AirportDiagramGeoreferencer.parseLabel("122°06.5'W"))
        #expect(!b.isLatitude && abs(b.value + 122.1083) < 1e-4)
        let c = try #require(AirportDiagramGeoreferencer.parseLabel("122º 07’W"))   // OCR variants of ° and '
        #expect(abs(c.value + 122.1167) < 1e-4)
        let d = try #require(AirportDiagramGeoreferencer.parseLabel("71°00'W"))
        #expect(abs(d.value + 71.0) < 1e-9)
        #expect(AirportDiagramGeoreferencer.parseLabel("95°10'N") == nil)          // latitude over 90
        #expect(AirportDiagramGeoreferencer.parseLabel("122°61'W") == nil)         // minutes over 60
        #expect(AirportDiagramGeoreferencer.parseLabel("ELEV 7") == nil)
    }

    // MARK: - Persistence

    @Test func georeferenceRoundTripsThroughJSON() throws {
        let data = try Self.fixture("09216AD")
        let fit = try AirportDiagramGeoreferencer.georeference(pdfData: data, reference: Self.kpao, runways: Self.kpaoRunways)
        let encoded = try JSONEncoder().encode(fit)
        let decoded = try JSONDecoder().decode(AirportDiagramGeoreference.self, from: encoded)
        #expect(decoded == fit)
        let p = decoded.coordinate(forPagePoint: CGPoint(x: 200, y: 300))
        let q = fit.coordinate(forPagePoint: CGPoint(x: 200, y: 300))
        #expect(p.latitude == q.latitude && p.longitude == q.longitude)
    }
}

@Suite("Airport Diagram Overlay Tests")
@MainActor
struct AirportDiagramOverlayTests {

    @Test func layerToggleDefaultsOnAndPersists() {
        let defaults = UserDefaults.standard
        let saved = defaults.object(forKey: AirportDiagramOverlay.enabledDefaultsKey)
        defer {
            if let saved { defaults.set(saved, forKey: AirportDiagramOverlay.enabledDefaultsKey) }
            else { defaults.removeObject(forKey: AirportDiagramOverlay.enabledDefaultsKey) }
        }
        defaults.removeObject(forKey: AirportDiagramOverlay.enabledDefaultsKey)
        let overlay = AirportDiagramOverlay()
        #expect(overlay.isEnabled)
        overlay.isEnabled = false
        #expect(defaults.bool(forKey: AirportDiagramOverlay.enabledDefaultsKey) == false)
        #expect(AirportDiagramOverlay().isEnabled == false)
        #expect(overlay.shownAirports.isEmpty)
    }

    @Test func diagramsOnlyAppearWhenZoomedIn() {
        #expect(AirportDiagramOverlay.minimumZoom == 14)
        #expect(AirportDiagramOverlay.maximumAirports <= 3)
    }
}
