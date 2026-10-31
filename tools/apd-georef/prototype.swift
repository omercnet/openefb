import Foundation
import CoreGraphics
import PDFKit
import Vision
import AppKit
setvbuf(stdout, nil, _IONBF, 0)

// ---------- vector segments ----------
final class Collector {
    var ctm = CGAffineTransform.identity; var stack: [CGAffineTransform] = []
    var current: CGPoint?; var start: CGPoint?
    var pending: [(CGPoint, CGPoint)] = []; var segments: [(CGPoint, CGPoint)] = []
}
func pop(_ s: CGPDFScannerRef) -> CGFloat { var v: CGPDFReal = 0; CGPDFScannerPopNumber(s, &v); return CGFloat(v) }
func col(_ i: UnsafeMutableRawPointer?) -> Collector { Unmanaged<Collector>.fromOpaque(i!).takeUnretainedValue() }
let table: CGPDFOperatorTableRef = {
    let t = CGPDFOperatorTableCreate()!
    CGPDFOperatorTableSetCallback(t, "q") { _, i in let c = col(i); c.stack.append(c.ctm) }
    CGPDFOperatorTableSetCallback(t, "Q") { _, i in let c = col(i); if let x = c.stack.popLast() { c.ctm = x } }
    CGPDFOperatorTableSetCallback(t, "cm") { s, i in
        let f = pop(s), e = pop(s), d = pop(s), cc = pop(s), b = pop(s), a = pop(s)
        let c = col(i); c.ctm = CGAffineTransform(a: a, b: b, c: cc, d: d, tx: e, ty: f).concatenating(c.ctm)
    }
    CGPDFOperatorTableSetCallback(t, "m") { s, i in let y = pop(s), x = pop(s); let c = col(i); let p = CGPoint(x: x, y: y).applying(c.ctm); c.current = p; c.start = p }
    CGPDFOperatorTableSetCallback(t, "l") { s, i in let y = pop(s), x = pop(s); let c = col(i); let p = CGPoint(x: x, y: y).applying(c.ctm); if let q = c.current { c.pending.append((q, p)) }; c.current = p }
    CGPDFOperatorTableSetCallback(t, "h") { _, i in let c = col(i); if let q = c.current, let s0 = c.start { c.pending.append((q, s0)) } }
    CGPDFOperatorTableSetCallback(t, "re") { s, i in
        let h = pop(s), w = pop(s), y = pop(s), x = pop(s); let c = col(i)
        let p = [CGPoint(x: x, y: y), CGPoint(x: x + w, y: y), CGPoint(x: x + w, y: y + h), CGPoint(x: x, y: y + h)].map { $0.applying(c.ctm) }
        for k in 0..<4 { c.pending.append((p[k], p[(k + 1) % 4])) }
    }
    for op in ["S", "s", "B", "B*", "b", "b*", "f", "F", "f*"] { CGPDFOperatorTableSetCallback(t, op) { _, i in let c = col(i); c.segments += c.pending; c.pending = [] } }
    CGPDFOperatorTableSetCallback(t, "n") { _, i in col(i).pending = [] }
    return t
}()
struct Line { let horizontal: Bool; let pos: CGFloat; let lo: CGFloat; let hi: CGFloat }
func gridLines(_ page: CGPDFPage) -> [Line] {
    let c = Collector()
    let sc = CGPDFScannerCreate(CGPDFContentStreamCreateWithPage(page), table, Unmanaged.passUnretained(c).toOpaque())
    CGPDFScannerScan(sc)
    return c.segments.compactMap { a, b in
        if abs(a.y - b.y) < 0.3, abs(a.x - b.x) > 3 { return Line(horizontal: true, pos: (a.y + b.y) / 2, lo: min(a.x, b.x), hi: max(a.x, b.x)) }
        if abs(a.x - b.x) < 0.3, abs(a.y - b.y) > 3 { return Line(horizontal: false, pos: (a.x + b.x) / 2, lo: min(a.y, b.y), hi: max(a.y, b.y)) }
        return nil
    }
}

// ---------- labels ----------
struct Label { let isLat: Bool; let value: Double; let rect: CGRect }
func labels(_ doc: PDFDocument, _ page: PDFPage) -> [Label] {
    let text = page.string ?? ""; let ns = text as NSString
    let re = try! NSRegularExpression(pattern: #"(\d{1,3})\s*°\s*(\d{1,2}(?:\.\d+)?)\s*['’′]\s*([NSEW])"#)
    var out: [Label] = []; var seen = Set<String>()
    for m in re.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
        let deg = Double(ns.substring(with: m.range(at: 1)))!, mins = Double(ns.substring(with: m.range(at: 2)))!
        let hemi = ns.substring(with: m.range(at: 3)); guard mins < 60 else { continue }
        var v = deg + mins / 60; if hemi == "S" || hemi == "W" { v = -v }
        let str = ns.substring(with: m.range); guard seen.insert(str).inserted else { continue }
        for sel in doc.findString(str, withOptions: []) where sel.pages.first == page {
            let r = sel.bounds(for: page); if !r.isNull, !r.isEmpty { out.append(Label(isLat: hemi == "N" || hemi == "S", value: v, rect: r)) }
        }
    }
    return out
}

// Distance from a line's nearer endpoint to the label rect.
func endGap(_ l: Line, _ r: CGRect) -> CGFloat {
    let ends = l.horizontal ? [CGPoint(x: l.lo, y: l.pos), CGPoint(x: l.hi, y: l.pos)] : [CGPoint(x: l.pos, y: l.lo), CGPoint(x: l.pos, y: l.hi)]
    return ends.map { p in hypot(max(r.minX - p.x, 0, p.x - r.maxX), max(r.minY - p.y, 0, p.y - r.maxY)) }.min()!
}
/// Grid line belonging to a label: ends within 10 pt of it, perpendicular offset < 20 pt.
func snap(_ lab: Label, _ lines: [Line]) -> Line? {
    lines.filter { l in
        let off = l.horizontal ? abs(l.pos - lab.rect.midY) : abs(l.pos - lab.rect.midX)
        let inner = lab.rect.insetBy(dx: 2, dy: 2)
        let ends = l.horizontal ? [CGPoint(x: l.lo, y: l.pos), CGPoint(x: l.hi, y: l.pos)] : [CGPoint(x: l.pos, y: l.lo), CGPoint(x: l.pos, y: l.hi)]
        if ends.contains(where: { inner.contains($0) }) { return false }
        if l.hi - l.lo < 8 { return false }
        return off < 20 && endGap(l, lab.rect) < 10
    }.min { endGap($0, lab.rect) + abs(($0.horizontal ? $0.pos - lab.rect.midY : $0.pos - lab.rect.midX)) * 0.2
          < endGap($1, lab.rect) + abs(($1.horizontal ? $1.pos - lab.rect.midY : $1.pos - lab.rect.midX)) * 0.2 }
}

/// Short tick (3-8 pt) at the label, in a known orientation: perpendicular offset < 4 pt, gap < 4 pt.
func snapTick(_ lab: Label, _ lines: [Line], horizontal: Bool) -> Line? {
    let inner = lab.rect.insetBy(dx: 2, dy: 2)
    return lines.filter { l in
        guard l.horizontal == horizontal, l.hi - l.lo < 8 else { return false }
        let ends = l.horizontal ? [CGPoint(x: l.lo, y: l.pos), CGPoint(x: l.hi, y: l.pos)] : [CGPoint(x: l.pos, y: l.lo), CGPoint(x: l.pos, y: l.hi)]
        if ends.contains(where: { inner.contains($0) }) { return false }
        let off = l.horizontal ? abs(l.pos - lab.rect.midY) : abs(l.pos - lab.rect.midX)
        return off < 4 && endGap(l, lab.rect) < 4
    }.min { endGap($0, lab.rect) < endGap($1, lab.rect) }
}

func linFit(_ p: [(Double, Double)]) -> (Double, Double)? {
    guard Set(p.map { $0.1 }).count >= 2 else { return nil }
    let n = Double(p.count), sx = p.reduce(0) { $0 + $1.0 }, sy = p.reduce(0) { $0 + $1.1 }
    let sxx = p.reduce(0) { $0 + $1.0 * $1.0 }, sxy = p.reduce(0) { $0 + $1.0 * $1.1 }
    let a = (n * sxy - sx * sy) / (n * sxx - sx * sx); return (a, (sy - a * sx) / n)
}


let labelRegex = try! NSRegularExpression(pattern: #"(\d{1,3})\s*[°º*o]\s*(\d{1,2}(?:[.,]\d+)?)\s*['’′`]?\s*([NSEW])"#)
func parseLabel(_ s: String) -> (Bool, Double)? {
    let ns = s as NSString
    guard let m = labelRegex.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { return nil }
    let deg = Double(ns.substring(with: m.range(at: 1)))!
    guard let mins = Double(ns.substring(with: m.range(at: 2)).replacingOccurrences(of: ",", with: ".")), mins < 60 else { return nil }
    let h = ns.substring(with: m.range(at: 3)); var v = deg + mins / 60; if h == "S" || h == "W" { v = -v }
    return (h == "N" || h == "S", v)
}
func ocrLabels(_ page: PDFPage) -> [Label] {
    let box = page.bounds(for: .mediaBox); let scale: CGFloat = 5
    let w = Int(box.width * scale), h = Int(box.height * scale)
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    ctx.setFillColor(gray: 1, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale); ctx.translateBy(x: -box.minX, y: -box.minY)
    page.draw(with: .mediaBox, to: ctx)
    let img = ctx.makeImage()!
    var out: [Label] = []
    for orient in [CGImagePropertyOrientation.up, .left, .right] {
        let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.usesLanguageCorrection = false
        try? VNImageRequestHandler(cgImage: img, orientation: orient).perform([req])
        for obs in req.results ?? [] {
            guard let cand = obs.topCandidates(1).first, let (isLat, v) = parseLabel(cand.string) else { continue }
            // boundingBox is normalized in the oriented image; map back to page space
            guard let r = try? cand.boundingBox(for: cand.string.startIndex..<cand.string.endIndex)?.boundingBox else { continue }
            let u = VNImageRectForNormalizedRect(r, 1, 1)
            var n: CGRect
            switch orient {
            case .left:  n = CGRect(x: 1 - u.maxY, y: u.minX, width: u.height, height: u.width)
            case .right: n = CGRect(x: u.minY, y: 1 - u.maxX, width: u.height, height: u.width)
            default:     n = u
            }
            n = CGRect(x: box.minX + n.minX * box.width, y: box.minY + n.minY * box.height, width: n.width * box.width, height: n.height * box.height)
            out.append(Label(isLat: isLat, value: v, rect: n))
        }
        if Set(out.filter { $0.isLat }.map { $0.value }).count >= 2 && Set(out.filter { !$0.isLat }.map { $0.value }).count >= 2 { break }
    }
    return out
}

struct Result { let ok: Bool; let note: String; let ratio: Double }
func georef(_ path: String, lat0: Double, lon0: Double) -> Result {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)), let page = doc.page(at: 0), let cg = page.pageRef else { return Result(ok: false, note: "open", ratio: 0) }
    let plausible: (Label) -> Bool = { $0.isLat ? abs($0.value - lat0) < 0.5 : abs($0.value - lon0) < 0.5 }
    var labs = labels(doc, page).filter(plausible); var src = "text"
    let enough: ([Label]) -> Bool = { l in Set(l.filter { $0.isLat }.map { $0.value }).count >= 2 && Set(l.filter { !$0.isLat }.map { $0.value }).count >= 2 }
    if !enough(labs) { labs += ocrLabels(page).filter(plausible); src = "ocr" }
    let lines = gridLines(cg)
    var latH: [(Double, Double)] = [], latV: [(Double, Double)] = [], lonH: [(Double, Double)] = [], lonV: [(Double, Double)] = []
    var unsnapped: [Label] = []
    for l in labs {
        guard let g = snap(l, lines) else { unsnapped.append(l); continue }
        let pt = (Double(g.pos), l.value)
        if l.isLat { if g.horizontal { latH.append(pt) } else { latV.append(pt) } } else { if g.horizontal { lonH.append(pt) } else { lonV.append(pt) } }
    }
    let rotated = latV.count + lonH.count > latH.count + lonV.count
    for l in unsnapped {
        let latLinesHorizontal = !rotated
        guard let g = snapTick(l, lines, horizontal: l.isLat ? latLinesHorizontal : !latLinesHorizontal) else { continue }
        let pt = (Double(g.pos), l.value)
        if l.isLat { if g.horizontal { latH.append(pt) } else { latV.append(pt) } } else { if g.horizontal { lonH.append(pt) } else { lonV.append(pt) } }
    }
    let latPts = rotated ? latV : latH, lonPts = rotated ? lonH : lonV
    guard let (a, _) = linFit(latPts), let (c, _) = linFit(lonPts) else { return Result(ok: false, note: "\(src) labels \(labs.count) latPts \(latPts.count) lonPts \(lonPts.count)", ratio: 0) }
    let ns = abs(a) * 60 * 6076.12, ew = abs(c) * 60 * 6076.12 * cos(lat0 * .pi / 180)
    return Result(ok: true, note: "\(src) \(rotated ? "ROT" : "up") lat\(latPts.count) lon\(lonPts.count)", ratio: ew / ns)
}
let coords = Dictionary(uniqueKeysWithValues: try! String(contentsOfFile: "/tmp/georef/coords.txt", encoding: .utf8).split(separator: "\n").map { l -> (String, (Double, Double)) in
    let p = l.split(separator: "|"); return (String(p[0]), (Double(p[1])!, Double(p[2])!)) })
for path in CommandLine.arguments.dropFirst() {
    let name = (path as NSString).lastPathComponent
    guard let (la, lo) = coords[name] else { print(name, "NOCOORD"); continue }
    let r = georef(path, lat0: la, lon0: lo)
    print(String(format: "%@ %@ ratio=%.3f %@", name, r.ok ? "OK " : "FAIL", r.ratio, r.note))
}
