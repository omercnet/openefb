//
//  AirportDiagramVectorScanTests.swift
//  efb-212Tests
//
//  Synthetic one-page PDFs against PDFVectorScanner: runways drawn as a thick stroked line (CAAI domestic AIP
//  charts), colour set inside q/Q, and rotated georeferences giving rotated map corners.
//

import Testing
import Foundation
import CoreGraphics
@testable import efb_212

@Suite("Airport Diagram Vector Scan Tests")
struct AirportDiagramVectorScanTests {

    /// One 400 x 400 pt page drawn by `draw`, scanned with the given graphics-state mode.
    static func scan(restoresGraphicsState: Bool, draw: (CGContext) -> Void) throws -> PDFVectorScanner.Result {
        let data = NSMutableData()
        var box = CGRect(x: 0, y: 0, width: 400, height: 400)
        let consumer = try #require(CGDataConsumer(data: data as CFMutableData))
        let context = try #require(CGContext(consumer: consumer, mediaBox: &box, nil))
        context.beginPDFPage(nil)
        draw(context)
        context.endPDFPage()
        context.closePDF()
        let provider = try #require(CGDataProvider(data: data as CFData))
        let document = try #require(CGPDFDocument(provider))
        let page = try #require(document.page(at: 1))
        return PDFVectorScanner.scan(page: page, restoresGraphicsState: restoresGraphicsState)
    }

    // MARK: - Stroked runways

    @Test func thickDarkStrokedLineIsARunway() throws {
        let result = try Self.scan(restoresGraphicsState: true) { c in
            c.setStrokeColor(gray: 0.1, alpha: 1)
            c.setLineWidth(6)
            c.move(to: CGPoint(x: 50, y: 50)); c.addLine(to: CGPoint(x: 350, y: 300)); c.strokePath()
        }
        #expect(result.runwayShapes().isEmpty)
        let shapes = result.strokedRunwayShapes()
        #expect(shapes.count == 1)
        let shape = try #require(shapes.first)
        #expect(abs(shape.length - hypot(300, 250)) < 0.5)
        #expect(abs(shape.widthPoints - 6) < 0.1)
    }

    @Test func thinLinesLightStrokesAndBentPathsAreNotRunways() throws {
        let result = try Self.scan(restoresGraphicsState: true) { c in
            c.setStrokeColor(gray: 0.1, alpha: 1)
            c.setLineWidth(1)   // a road or a boundary: too thin
            c.move(to: CGPoint(x: 20, y: 20)); c.addLine(to: CGPoint(x: 380, y: 20)); c.strokePath()
            c.setLineWidth(8)
            c.move(to: CGPoint(x: 20, y: 100)); c.addLine(to: CGPoint(x: 200, y: 100)); c.addLine(to: CGPoint(x: 200, y: 300)); c.strokePath()   // bent taxiway
            c.setStrokeColor(gray: 0.7, alpha: 1)   // a grey closed runway
            c.move(to: CGPoint(x: 20, y: 350)); c.addLine(to: CGPoint(x: 380, y: 350)); c.strokePath()
        }
        #expect(result.strokedRunwayShapes().isEmpty)
    }

    // MARK: - Graphics state

    /// A one-page PDF with exactly the given content stream (CoreGraphics' own writer wraps every draw in its own
    /// q/Q, so it cannot reproduce a colour leaking out of a q ... Q block).
    static func rawPDF(content: String) -> Data {
        var pdf = Data("%PDF-1.4\n".utf8)
        var offsets: [Int] = []
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Contents 4 0 R >>",
            "<< /Length \(content.utf8.count) >>\nstream\n\(content)\nendstream",
        ]
        for (i, body) in objects.enumerated() {
            offsets.append(pdf.count)
            pdf.append(Data("\(i + 1) 0 obj\n\(body)\nendobj\n".utf8))
        }
        let xref = pdf.count
        pdf.append(Data("xref\n0 \(objects.count + 1)\n0000000000 65535 f \n".utf8))
        for offset in offsets { pdf.append(Data(String(format: "%010d 00000 n \n", offset).utf8)) }
        pdf.append(Data("trailer\n<< /Size \(objects.count + 1) /Root 1 0 R >>\nstartxref\n\(xref)\n%%EOF\n".utf8))
        return pdf
    }

    /// The runway is filled black after a `q white-fill Q` block. With the graphics state restored it is dark; the
    /// legacy scan (US pipeline, flag off) keeps the white from inside the block and sees no runway.
    @Test func qQRestoresFillColourOnlyWhenAsked() throws {
        let pdf = Self.rawPDF(content: "0.1 g\nq\n1 g\n300 300 20 20 re f\nQ\n50 200 300 8 re f")
        let provider = try #require(CGDataProvider(data: pdf as CFData))
        let page = try #require(CGPDFDocument(provider)?.page(at: 1))
        #expect(PDFVectorScanner.scan(page: page, restoresGraphicsState: true).runwayShapes().count == 1)
        #expect(PDFVectorScanner.scan(page: page, restoresGraphicsState: false).runwayShapes().isEmpty)
    }


    // MARK: - Rotated georeference

    /// A chart drawn rotated against north: the four map corners rotate with it, they are not the bounds.
    @Test func rotatedGeoreferenceGivesRotatedCorners() throws {
        let rect = AirportDiagramGeoreference.Rect(CGRect(x: 0, y: 0, width: 100, height: 200))
        let theta = 30.0 * .pi / 180
        let scale = 2.0   // metres per point
        let g = AirportDiagramGeoreference(
            a: scale * cos(theta), b: scale * sin(theta), c: -scale * sin(theta), d: scale * cos(theta), tx: 0, ty: 0,
            reference: rect, referenceLatitude: 32.0, referenceLongitude: 35.0, pageBox: rect, clipBox: rect, masks: [],
            diagnostics: .init(method: .runway, labelSource: .none, latitudeLabels: 0, longitudeLabels: 0, rotationDegrees: 30,
                               feetPerPoint: scale * 3.28084, scaleRatio: nil, runwaysMatched: 1, runwayResidualFeet: 0,
                               runwayMidpointFeet: 0, runwayEndFeet: 0, runwayBestMidpointFeet: 0, runwayMedianMidpointFeet: 0, maskedInsets: 0))
        let corners = g.clipCorners   // top-left, bottom-left, bottom-right, top-right
        #expect(corners.count == 4)
        let m = AirportDiagramGeoreference.metresPerDegree(latitude: 32)
        func local(_ i: Int) -> CGPoint {
            CGPoint(x: (corners[i].longitude - 35) * m.lon, y: (corners[i].latitude - 32) * m.lat)
        }
        // Left edge (top-left -> bottom-left) is 200 pt * 2 m = 400 m long, pointing 30 degrees off south.
        let edge = CGPoint(x: local(1).x - local(0).x, y: local(1).y - local(0).y)
        #expect(abs(hypot(edge.x, edge.y) - 400) < 0.5)
        #expect(abs(edge.x) > 150)   // an unrotated quad would have a vertical left edge
        // Top edge (top-left -> top-right) is 100 pt * 2 m = 200 m, perpendicular to the left edge.
        let top = CGPoint(x: local(3).x - local(0).x, y: local(3).y - local(0).y)
        #expect(abs(hypot(top.x, top.y) - 200) < 0.5)
        #expect(abs(edge.x * top.x + edge.y * top.y) < 1)
    }
}
