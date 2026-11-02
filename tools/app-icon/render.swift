#!/usr/bin/env swift
// OpenEFB app icon renderer. Draws the icon with CoreGraphics so it is reproducible:
//
//   swift tools/app-icon/render.swift <output-dir>
//
// Writes AppIcon-1024.png (default, opaque), AppIcon-1024-dark.png (opaque) and
// AppIcon-1024-tinted.png (grayscale glyph on transparent) plus icon.svg (the default
// variant, same geometry) next to this script. No text, no third-party marks.
//
// Geometry: the app's own ownship chevron (MapService.createOwnshipChevron, 32 pt grid:
// nose 16,3 / 26,28 / notch 16,22 / 6,28) over a compass ring with 30-degree ticks and
// one wide airspace-style arc. Apple masks the corners, so the canvas is a full square.

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let canvas: CGFloat = 1024
let center = CGPoint(x: canvas / 2, y: canvas / 2)

struct RGB {
    let r: CGFloat, g: CGFloat, b: CGFloat
    func cg(_ alpha: CGFloat = 1) -> CGColor { CGColor(srgbRed: r, green: g, blue: b, alpha: alpha) }
    var hex: String { String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255)) }
}

func rgb(_ hex: UInt32) -> RGB {
    RGB(r: CGFloat((hex >> 16) & 0xFF) / 255, g: CGFloat((hex >> 8) & 0xFF) / 255, b: CGFloat(hex & 0xFF) / 255)
}

struct Variant {
    let file: String
    let opaque: Bool
    let backgroundTop: RGB?     // nil = transparent
    let backgroundBottom: RGB?
    let ring: RGB               // compass ring and ticks
    let ringAlpha: CGFloat
    let arc: RGB                // airspace arc
    let arcAlpha: CGFloat
    let glyph: RGB              // chevron fill
    let halo: RGB               // chevron outline
    let haloAlpha: CGFloat
}

let variants: [Variant] = [
    // Aviation blue, white glyph. Reads at 60 px: one big white shape on a saturated field.
    Variant(file: "AppIcon-1024.png", opaque: true,
            backgroundTop: rgb(0x2F7FE6), backgroundBottom: rgb(0x0B3F8F),
            ring: rgb(0xFFFFFF), ringAlpha: 0.55, arc: rgb(0xFFFFFF), arcAlpha: 0.18,
            glyph: rgb(0xFFFFFF), halo: rgb(0x062A5E), haloAlpha: 1),
    // Night: navy field, light glyph, dimmer ring (halation per refactoring-ui, never pure black).
    Variant(file: "AppIcon-1024-dark.png", opaque: true,
            backgroundTop: rgb(0x1B2A4A), backgroundBottom: rgb(0x0E1626),
            ring: rgb(0x9DBBF0), ringAlpha: 0.45, arc: rgb(0x9DBBF0), arcAlpha: 0.14,
            glyph: rgb(0xE8F0FF), halo: rgb(0x060B16), haloAlpha: 1),
    // Tinted (iOS 18+): grayscale on transparent; the system supplies colour and background.
    Variant(file: "AppIcon-1024-tinted.png", opaque: false,
            backgroundTop: nil, backgroundBottom: nil,
            ring: rgb(0xFFFFFF), ringAlpha: 0.5, arc: rgb(0xFFFFFF), arcAlpha: 0.16,
            glyph: rgb(0xFFFFFF), halo: rgb(0x000000), haloAlpha: 0.0),
]

// MARK: geometry

let ringRadius: CGFloat = 372
let ringWidth: CGFloat = 14
let tickLong: CGFloat = 56
let tickShort: CGFloat = 28
let tickWidth: CGFloat = 14
let arcRadius: CGFloat = 300
let arcWidth: CGFloat = 92
let arcStart: CGFloat = 200 * .pi / 180   // degrees, math convention (0 = east, CCW)
let arcEnd: CGFloat = 330 * .pi / 180
let chevronScale: CGFloat = 21             // 32 pt grid -> 672 px wide chevron
let chevronHalo: CGFloat = 4 * chevronScale * 0.55

/// Chevron path in canvas coordinates (y down), centred on the canvas.
func chevronPath() -> CGPath {
    let grid: [(CGFloat, CGFloat)] = [(16, 3), (26, 28), (16, 22), (6, 28)]
    let path = CGMutablePath()
    for (i, p) in grid.enumerated() {
        let x = center.x + (p.0 - 16) * chevronScale
        let y = center.y + (p.1 - 15.5) * chevronScale - 20   // nudge up: the notch leaves the bottom light
        if i == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
    }
    path.closeSubpath()
    return path
}

func tickLines() -> [(CGPoint, CGPoint)] {
    (0..<12).map { i in
        let a = CGFloat(i) * 30 * .pi / 180
        let len = i % 3 == 0 ? tickLong : tickShort
        let outer = ringRadius - ringWidth / 2 - 6
        let inner = outer - len
        return (CGPoint(x: center.x + cos(a) * inner, y: center.y - sin(a) * inner),
                CGPoint(x: center.x + cos(a) * outer, y: center.y - sin(a) * outer))
    }
}

// MARK: CoreGraphics

func render(_ v: Variant) -> CGImage {
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let info: CGImageAlphaInfo = v.opaque ? .noneSkipLast : .premultipliedLast
    guard let ctx = CGContext(data: nil, width: Int(canvas), height: Int(canvas), bitsPerComponent: 8,
                              bytesPerRow: 0, space: space, bitmapInfo: info.rawValue) else {
        fatalError("CGContext")
    }
    // Flip so y goes down like the SVG.
    ctx.translateBy(x: 0, y: canvas)
    ctx.scaleBy(x: 1, y: -1)
    ctx.setAllowsAntialiasing(true)

    if let top = v.backgroundTop, let bottom = v.backgroundBottom {
        let gradient = CGGradient(colorsSpace: space, colors: [top.cg(), bottom.cg()] as CFArray, locations: [0, 1])!
        ctx.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: canvas), options: [])
    } else {
        ctx.clear(CGRect(x: 0, y: 0, width: canvas, height: canvas))
    }

    // Airspace arc (wide, faint) under everything else.
    ctx.setStrokeColor(v.arc.cg(v.arcAlpha))
    ctx.setLineWidth(arcWidth)
    ctx.setLineCap(.butt)
    ctx.addArc(center: center, radius: arcRadius, startAngle: -arcEnd, endAngle: -arcStart, clockwise: false)
    ctx.strokePath()

    // Compass ring and ticks.
    ctx.setStrokeColor(v.ring.cg(v.ringAlpha))
    ctx.setLineWidth(ringWidth)
    ctx.addEllipse(in: CGRect(x: center.x - ringRadius, y: center.y - ringRadius, width: ringRadius * 2, height: ringRadius * 2))
    ctx.strokePath()
    ctx.setLineWidth(tickWidth)
    ctx.setLineCap(.round)
    for (a, b) in tickLines() {
        ctx.move(to: a); ctx.addLine(to: b)
    }
    ctx.strokePath()

    // Chevron: halo, fill.
    let path = chevronPath()
    if v.haloAlpha > 0 {
        ctx.setLineJoin(.round)
        ctx.setStrokeColor(v.halo.cg(v.haloAlpha))
        ctx.setLineWidth(chevronHalo)
        ctx.addPath(path)
        ctx.strokePath()
    }
    ctx.setFillColor(v.glyph.cg())
    ctx.addPath(path)
    ctx.fillPath()

    return ctx.makeImage()!
}

func writePNG(_ image: CGImage, to url: URL) {
    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fatalError("destination \(url.path)")
    }
    CGImageDestinationAddImage(dest, image, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("write \(url.path)") }
}

// MARK: SVG (default variant, same geometry)

func svg(_ v: Variant) -> String {
    func f(_ x: CGFloat) -> String { String(format: "%.1f", x) }
    let path = chevronPath()
    var d = ""
    path.applyWithBlock { el in
        let p = el.pointee.points
        switch el.pointee.type {
        case .moveToPoint: d += "M\(f(p[0].x)) \(f(p[0].y)) "
        case .addLineToPoint: d += "L\(f(p[0].x)) \(f(p[0].y)) "
        case .closeSubpath: d += "Z"
        default: break
        }
    }
    let a0 = CGPoint(x: center.x + cos(arcStart) * arcRadius, y: center.y - sin(arcStart) * arcRadius)
    let a1 = CGPoint(x: center.x + cos(arcEnd) * arcRadius, y: center.y - sin(arcEnd) * arcRadius)
    let ticks = tickLines().map {
        "    <line x1=\"\(f($0.0.x))\" y1=\"\(f($0.0.y))\" x2=\"\(f($0.1.x))\" y2=\"\(f($0.1.y))\"/>"
    }.joined(separator: "\n")
    return """
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <!-- OpenEFB app icon. Generated by tools/app-icon/render.swift; edit the script, not this file. -->
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="\(v.backgroundTop?.hex ?? "none")"/>
          <stop offset="1" stop-color="\(v.backgroundBottom?.hex ?? "none")"/>
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" fill="url(#bg)"/>
      <path d="M\(f(a0.x)) \(f(a0.y)) A\(f(arcRadius)) \(f(arcRadius)) 0 0 0 \(f(a1.x)) \(f(a1.y))"
            fill="none" stroke="\(v.arc.hex)" stroke-opacity="\(v.arcAlpha)" stroke-width="\(f(arcWidth))"/>
      <circle cx="\(f(center.x))" cy="\(f(center.y))" r="\(f(ringRadius))"
              fill="none" stroke="\(v.ring.hex)" stroke-opacity="\(v.ringAlpha)" stroke-width="\(f(ringWidth))"/>
      <g stroke="\(v.ring.hex)" stroke-opacity="\(v.ringAlpha)" stroke-width="\(f(tickWidth))" stroke-linecap="round">
    \(ticks)
      </g>
      <path d="\(d)" fill="\(v.glyph.hex)" stroke="\(v.halo.hex)" stroke-width="\(f(chevronHalo))"
            stroke-linejoin="round" paint-order="stroke fill"/>
    </svg>

    """
}

// MARK: main

let args = CommandLine.arguments
guard args.count == 2 else {
    FileHandle.standardError.write("usage: swift render.swift <output-dir>\n".data(using: .utf8)!)
    exit(2)
}
let outDir = URL(fileURLWithPath: args[1], isDirectory: true)
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
for v in variants {
    let url = outDir.appendingPathComponent(v.file)
    writePNG(render(v), to: url)
    print("wrote \(url.path)")
}
let scriptDir = URL(fileURLWithPath: args[0]).deletingLastPathComponent()
let svgURL = scriptDir.appendingPathComponent("icon.svg")
try svg(variants[0]).write(to: svgURL, atomically: true, encoding: .utf8)
print("wrote \(svgURL.path)")
