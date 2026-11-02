//
//  IsraelChartStyle.swift
//  efb-212
//
//  Colours and rendered symbols for the Israel CVFR chart (IL-3). Labels and point symbols are
//  drawn to images and added to the style as sprites, because glyph PBFs come from the network
//  (openfreemap) and the chart must draw with no connectivity.
//
//  Colour rules (COMMON.md): red = warning, amber = caution, nothing else. Red is used only for
//  NOTAM route closures; P/R/D areas are amber. Ordinary airspace is indigo, civil routes green,
//  military routes blue (the CVFR chart's own convention, docs/research/israel-cvfr.md §2).
//

import UIKit

nonisolated struct IsraelChartPalette: Sendable {
    let civilRoute: UIColor
    let militaryRoute: UIColor
    let airspace: UIColor
    let restricted: UIColor
    let closure: UIColor
    let runway: UIColor
    let symbol: UIColor
    let labelText: UIColor
    let labelHalo: UIColor
    let altitudeText: UIColor
    let militaryText: UIColor
    let closureText: UIColor
    /// Fill opacity for airspace areas (light: the base map must show through).
    let airspaceFillOpacity: Double

    static let day = IsraelChartPalette(
        civilRoute: UIColor(red: 0.05, green: 0.47, blue: 0.20, alpha: 1),
        militaryRoute: UIColor(red: 0.08, green: 0.28, blue: 0.78, alpha: 1),
        airspace: UIColor(red: 0.34, green: 0.20, blue: 0.68, alpha: 1),
        restricted: UIColor(red: 0.647, green: 0.322, blue: 0, alpha: 1),   // Palette.caution (day)
        closure: UIColor(red: 0.784, green: 0, blue: 0.078, alpha: 1),      // Palette.warning (day)
        runway: UIColor(white: 0.12, alpha: 1),
        symbol: UIColor(red: 0.04, green: 0.08, blue: 0.30, alpha: 1),
        labelText: UIColor(white: 0.08, alpha: 1),
        labelHalo: UIColor(white: 1, alpha: 0.92),
        altitudeText: UIColor(red: 0.02, green: 0.33, blue: 0.13, alpha: 1),
        militaryText: UIColor(red: 0.05, green: 0.20, blue: 0.65, alpha: 1),
        closureText: UIColor(red: 0.784, green: 0, blue: 0.078, alpha: 1),
        airspaceFillOpacity: 0.07
    )

    /// Night: about 55% luminance foregrounds, dark halos, so nothing glares against the dimmed map.
    static let night = IsraelChartPalette(
        civilRoute: UIColor(red: 0.28, green: 0.58, blue: 0.38, alpha: 1),
        militaryRoute: UIColor(red: 0.36, green: 0.52, blue: 0.84, alpha: 1),
        airspace: UIColor(red: 0.58, green: 0.46, blue: 0.82, alpha: 1),
        restricted: UIColor.systemOrange.withAlphaComponent(0.85),
        closure: UIColor.systemRed,
        runway: UIColor(white: 0.62, alpha: 1),
        symbol: UIColor(red: 0.66, green: 0.72, blue: 0.90, alpha: 1),
        labelText: UIColor(white: 0.74, alpha: 1),
        labelHalo: UIColor(white: 0.04, alpha: 0.90),
        altitudeText: UIColor(red: 0.52, green: 0.80, blue: 0.60, alpha: 1),
        militaryText: UIColor(red: 0.60, green: 0.72, blue: 0.95, alpha: 1),
        closureText: UIColor.systemRed,
        airspaceFillOpacity: 0.10
    )

    static func palette(night: Bool) -> IsraelChartPalette { night ? Self.night : Self.day }
}

/// The kinds of label sprite. Each has a colour and size; the text varies.
nonisolated enum IsraelChartLabelKind: String, Sendable {
    case altitude
    case altitudeMilitary
    case pointCode
    case airspace
    case airspaceRestricted
    case closure
    case closureCaution

    func color(in palette: IsraelChartPalette) -> UIColor {
        switch self {
        case .altitude: return palette.altitudeText
        case .altitudeMilitary: return palette.militaryText
        case .pointCode: return palette.labelText
        case .airspace: return palette.airspace
        case .airspaceRestricted: return palette.restricted
        case .closure: return palette.closureText
        case .closureCaution: return palette.restricted  // amber: partial closures and "check NOTAM"
        }
    }

    /// Point size. Altitude labels are the working numbers of a CVFR flight, so the largest.
    var fontSize: CGFloat {
        switch self {
        case .altitude, .altitudeMilitary: return 12
        case .closure, .closureCaution: return 12
        case .pointCode: return 11
        case .airspace, .airspaceRestricted: return 10.5
        }
    }
}

/// Point symbols (sprites).
nonisolated enum IsraelChartSymbol: String, CaseIterable, Sendable {
    case compulsory = "il-sym-compulsory"   // filled triangle
    case onRequest = "il-sym-onrequest"     // open triangle
    case aerodrome = "il-sym-aerodrome"     // ring with ticks
    case airstrip = "il-sym-airstrip"       // small ring (IL-4 strips without an ARP)
    case heliport = "il-sym-heliport"       // ring with H

    init(_ kind: IsraelPointKind) {
        switch kind {
        case .compulsory: self = .compulsory
        case .onRequest: self = .onRequest
        case .arp: self = .aerodrome
        case .unlisted: self = .onRequest
        }
    }

    init(_ type: IsraelAerodromeType) {
        switch type {
        case .airport: self = .aerodrome
        case .airstrip: self = .airstrip
        case .heliport: self = .heliport
        }
    }
}

nonisolated enum IsraelChartRenderer {

    /// Sprite name for a label: stable across day/night so features keep their `icon` attribute and
    /// only the pixels are replaced on a display-mode change.
    static func labelName(kind: IsraelChartLabelKind, text: String) -> String {
        "il-lbl-\(kind.rawValue)-\(text)"
    }

    /// Text with a halo, centred in a transparent image.
    static func labelImage(kind: IsraelChartLabelKind, text: String, palette: IsraelChartPalette) -> UIImage {
        let font = UIFont.systemFont(ofSize: kind.fontSize, weight: .semibold)
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let fill: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: kind.color(in: palette), .paragraphStyle: paragraph
        ]
        let halo: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: palette.labelHalo, .paragraphStyle: paragraph,
            .strokeColor: palette.labelHalo, .strokeWidth: 7
        ]
        let textSize = (text as NSString).size(withAttributes: fill)
        let pad: CGFloat = 3
        let size = CGSize(width: ceil(textSize.width) + pad * 2, height: ceil(textSize.height) + pad * 2)
        return UIGraphicsImageRenderer(size: size).image { _ in
            let rect = CGRect(x: pad, y: pad, width: ceil(textSize.width), height: ceil(textSize.height))
            (text as NSString).draw(in: rect, withAttributes: halo)
            (text as NSString).draw(in: rect, withAttributes: fill)
        }
    }

    static func symbolImage(_ symbol: IsraelChartSymbol, palette: IsraelChartPalette) -> UIImage {
        let side: CGFloat = 22
        let size = CGSize(width: side, height: side)
        return UIGraphicsImageRenderer(size: size).image { context in
            let ctx = context.cgContext
            ctx.setLineJoin(.round)
            ctx.setLineCap(.round)
            switch symbol {
            case .compulsory, .onRequest:
                let path = CGMutablePath()
                path.move(to: CGPoint(x: side / 2, y: 3))
                path.addLine(to: CGPoint(x: side - 3, y: side - 4))
                path.addLine(to: CGPoint(x: 3, y: side - 4))
                path.closeSubpath()
                // Halo first, then the symbol
                ctx.setStrokeColor(palette.labelHalo.cgColor)
                ctx.setLineWidth(symbol == .compulsory ? 5 : 6.5)
                ctx.addPath(path)
                ctx.strokePath()
                if symbol == .compulsory {
                    ctx.setFillColor(palette.symbol.cgColor)
                    ctx.addPath(path)
                    ctx.fillPath()
                } else {
                    ctx.setStrokeColor(palette.symbol.cgColor)
                    ctx.setLineWidth(2.2)
                    ctx.addPath(path)
                    ctx.strokePath()
                }
            case .aerodrome, .airstrip:
                let center = CGPoint(x: side / 2, y: side / 2)
                let radius: CGFloat = symbol == .aerodrome ? 5.5 : 4.0
                let ring = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
                let ticks = CGMutablePath()
                if symbol == .aerodrome {
                    for angle in stride(from: 0.0, to: 360.0, by: 90.0) {
                        let r = angle * .pi / 180
                        ticks.move(to: CGPoint(x: center.x + (radius + 0.5) * cos(r), y: center.y + (radius + 0.5) * sin(r)))
                        ticks.addLine(to: CGPoint(x: center.x + (radius + 4.5) * cos(r), y: center.y + (radius + 4.5) * sin(r)))
                    }
                }
                ctx.setStrokeColor(palette.labelHalo.cgColor)
                ctx.setLineWidth(5.5)
                ctx.strokeEllipse(in: ring)
                ctx.addPath(ticks)
                ctx.strokePath()
                ctx.setStrokeColor(palette.symbol.cgColor)
                ctx.setLineWidth(2.2)
                ctx.strokeEllipse(in: ring)
                ctx.addPath(ticks)
                ctx.strokePath()
            case .heliport:
                // Ring with an "H", the ICAO heliport symbol
                let center = CGPoint(x: side / 2, y: side / 2)
                let radius: CGFloat = 6
                let ring = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
                ctx.setStrokeColor(palette.labelHalo.cgColor)
                ctx.setLineWidth(5)
                ctx.strokeEllipse(in: ring)
                ctx.setStrokeColor(palette.symbol.cgColor)
                ctx.setLineWidth(1.8)
                ctx.strokeEllipse(in: ring)
                let font = UIFont.systemFont(ofSize: 9, weight: .bold)
                let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: palette.symbol]
                let text = "H" as NSString
                let s = text.size(withAttributes: attrs)
                text.draw(at: CGPoint(x: center.x - s.width / 2, y: center.y - s.height / 2), withAttributes: attrs)
            }
        }
    }
}
