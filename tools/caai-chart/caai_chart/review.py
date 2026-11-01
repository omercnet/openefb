"""Owner review page: overview with CAAI points and error vectors, worst offenders, gate results, edition diff."""
from __future__ import annotations

import html
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw

from .tiler import MBTiles

ERROR_EXAGGERATION = 20  # error vectors are drawn this many times longer than they are


def _world_px(lon: float, lat: float, z: int, ts: int) -> tuple[float, float]:
    n = 2 ** z * ts
    x = (lon + 180) / 360 * n
    lat_r = math.radians(lat)
    y = (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n
    return x, y


def _composite(mb: MBTiles, z: int, ts: int, bounds, max_side: int = 2600):
    west, south, east, north = bounds
    x0, y1 = _world_px(west, south, z, ts)
    x1, y0 = _world_px(east, north, z, ts)
    ox, oy = int(x0 // ts) * ts, int(y0 // ts) * ts
    w, h = int(math.ceil(x1 / ts) * ts - ox), int(math.ceil(y1 / ts) * ts - oy)
    canvas = Image.new("RGBA", (w, h), (235, 238, 240, 255))
    for tx, ty in mb.tile_keys(z):
        px, py = tx * ts - ox, ty * ts - oy
        if 0 <= px < w and 0 <= py < h:
            im = mb.get(z, tx, ty)
            canvas.alpha_composite(im, (px, py))
    return canvas, ox, oy


def _crop(mb: MBTiles, z: int, ts: int, lon: float, lat: float, half: int = 110):
    cx, cy = _world_px(lon, lat, z, ts)
    ox, oy = int(cx) - half, int(cy) - half
    canvas = Image.new("RGBA", (2 * half, 2 * half), (235, 238, 240, 255))
    for tx in range(ox // ts, (ox + 2 * half) // ts + 1):
        for ty in range(oy // ts, (oy + 2 * half) // ts + 1):
            im = mb.get(z, tx, ty)
            if im is not None:
                canvas.alpha_composite(im, (tx * ts - ox, ty * ts - oy))
    return canvas, ox, oy


def _histogram_svg(errors: list[float], p95: float, limit_p95: float, limit_max: float) -> str:
    if not errors:
        return ""
    top = max(limit_max * 1.1, max(errors) * 1.05)
    bins = 24
    counts = [0] * bins
    for e in errors:
        counts[min(bins - 1, int(e / top * bins))] += 1
    mx = max(counts)
    w, h = 560, 120
    bw = w / bins
    bars = "".join(f'<rect x="{i * bw:.1f}" y="{h - c / mx * h:.1f}" width="{bw - 1:.1f}" height="{c / mx * h:.1f}" fill="#4a7ab5"/>'
                   for i, c in enumerate(counts))
    def vline(v, colour, label):
        x = v / top * w
        return f'<line x1="{x:.1f}" y1="0" x2="{x:.1f}" y2="{h}" stroke="{colour}" stroke-width="2"/><text x="{x + 3:.1f}" y="12" font-size="11" fill="{colour}">{label}</text>'
    return (f'<svg width="{w}" height="{h + 18}" xmlns="http://www.w3.org/2000/svg">{bars}'
            f'{vline(p95, "#222", f"p95 {p95:.0f} m")}{vline(limit_p95, "#b8860b", f"limit {limit_p95:.0f}")}{vline(limit_max, "#c0392b", f"max limit {limit_max:.0f}")}'
            f'<text x="0" y="{h + 14}" font-size="11">0 m</text><text x="{w - 40}" y="{h + 14}" font-size="11">{top:.0f} m</text></svg>')


def edition_diff(prev: Path | None, cur_mb: MBTiles, out_dir: Path, z: int, ts: int) -> dict:
    """Compare against the previous edition's pack: changed-tile counts and before/after/diff thumbnails."""
    if prev is None or not prev.exists():
        return {"previous": None}
    old = MBTiles(prev)
    ok = set(old.tile_keys(z))
    nk = set(cur_mb.tile_keys(z))
    changed = []
    for key in sorted(ok & nk):
        a, b = old.get(z, *key), cur_mb.get(z, *key)
        d = np.asarray(ImageChops.difference(a.convert("RGB"), b.convert("RGB")), dtype=np.float32)
        score = float(d.mean())
        if score > 0.5:
            changed.append((score, key))
    changed.sort(reverse=True)
    thumbs = []
    for i, (score, key) in enumerate(changed[:4]):
        a, b = old.get(z, *key).convert("RGB"), cur_mb.get(z, *key).convert("RGB")
        d = ImageChops.difference(a, b).point(lambda v: min(255, v * 4))
        sheet = Image.new("RGB", (ts * 3 + 8, ts), (255, 255, 255))
        sheet.paste(a, (0, 0)); sheet.paste(b, (ts + 4, 0)); sheet.paste(d, (2 * ts + 8, 0))
        name = f"diff_{i}.png"
        sheet.save(out_dir / name)
        thumbs.append({"file": name, "tile": f"{z}/{key[0]}/{key[1]}", "score": score})
    old.close()
    return {"previous": str(prev), "tiles_before": len(ok), "tiles_after": len(nk), "added": len(nk - ok),
            "removed": len(ok - nk), "changed": len(changed), "thumbs": thumbs}


def build_review(out_dir: Path, mb: MBTiles, manifest: dict, accuracy, completeness, tile_size: int, max_zoom: int,
                 diff: dict) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = mb.meta()
    bounds = tuple(float(v) for v in meta["bounds"].split(","))
    ov_z = min(10, max_zoom)
    canvas, ox, oy = _composite(mb, ov_z, tile_size, bounds)
    dr = ImageDraw.Draw(canvas)
    for r in accuracy.rows:
        x, y = _world_px(r["lon"], r["lat"], ov_z, tile_size)
        sx, sy = _world_px(r["symbol_lon"], r["symbol_lat"], ov_z, tile_size)
        ex, ey = x + (sx - x) * ERROR_EXAGGERATION, y + (sy - y) * ERROR_EXAGGERATION
        bad = r["error_m"] > manifest["validation"]["limits"]["p95_m"]
        col = (200, 40, 40, 255) if bad else (20, 110, 60, 255)
        dr.line([(x - ox, y - oy), (ex - ox, ey - oy)], fill=col, width=2)
        dr.ellipse([x - ox - 3, y - oy - 3, x - ox + 3, y - oy + 3], outline=(0, 0, 0, 255))
    overview = out_dir / "overview.png"
    canvas.convert("RGB").save(overview)

    worst = sorted(accuracy.rows, key=lambda r: -r["error_m"])[:12]
    crops = []
    for i, r in enumerate(worst):
        c, cx0, cy0 = _crop(mb, max_zoom, tile_size, r["lon"], r["lat"])
        d = ImageDraw.Draw(c)
        px, py = _world_px(r["lon"], r["lat"], max_zoom, tile_size)
        sx, sy = _world_px(r["symbol_lon"], r["symbol_lat"], max_zoom, tile_size)
        d.line([(px - cx0 - 8, py - cy0), (px - cx0 + 8, py - cy0)], fill=(255, 0, 0, 255), width=1)
        d.line([(px - cx0, py - cy0 - 8), (px - cx0, py - cy0 + 8)], fill=(255, 0, 0, 255), width=1)
        d.ellipse([sx - cx0 - 5, sy - cy0 - 5, sx - cx0 + 5, sy - cy0 + 5], outline=(0, 0, 255, 255))
        name = f"worst_{i:02d}_{r['code']}.png"
        c.convert("RGB").resize((c.width * 2, c.height * 2), Image.LANCZOS).save(out_dir / name)
        crops.append((r, name))

    v = manifest["validation"]
    status = "PASSED" if v["passed"] else "FAILED"
    colour = "#1e7e34" if v["passed"] else "#c0392b"
    rows = "".join(f"<tr><td>{html.escape(r['code'])}</td><td>{html.escape(r['name'])}</td><td>{r['kind']}</td><td>{r['sheet']}</td>"
                   f"<td>{r['error_m']:.0f}</td></tr>" for r in worst)
    failures = "".join(f"<li>{html.escape(f)}</li>" for f in v["failures"]) or "<li>none</li>"
    crop_html = "".join(f'<figure><img src="{n}"><figcaption>{html.escape(r["code"])} ({r["sheet"]}), {r["error_m"]:.0f} m. '
                        f'Red cross: CAAI coordinate. Blue circle: printed symbol.</figcaption></figure>' for r, n in crops)
    unm = ", ".join(html.escape(u["code"]) for u in accuracy.unmatched) or "none"
    unc = "".join(f"<li>{html.escape(u['what'])} ({u['lat']:.4f}, {u['lon']:.4f})</li>" for u in completeness.uncovered[:30]) or "<li>none</li>"
    col = "".join(f"<li>{html.escape(u['what'])}</li>" for u in completeness.collar[:30]) or "<li>none</li>"
    hid = "".join(f"<li>{html.escape(w)}</li>" for w in sorted({u['what'] for u in completeness.hidden_by_inset})[:40]) or "<li>none</li>"
    if diff.get("previous"):
        dh = (f"<p>Against {html.escape(Path(diff['previous']).parent.name)} at z{ov_z}: {diff['changed']} tiles changed, "
              f"{diff['added']} added, {diff['removed']} removed.</p>" +
              "".join(f'<figure><img src="{t["file"]}"><figcaption>tile {t["tile"]}: before | after | difference x4</figcaption></figure>' for t in diff["thumbs"]))
    else:
        dh = "<p>First edition built here: nothing earlier to compare with. Build the next edition into the same out/ folder and this section shows what changed.</p>"
    shifts = "".join(f"<li>{n}: content sits {s['east_m']:+.0f} m E, {s['north_m']:+.0f} m N of its printed graticule ({s['points']} points)</li>"
                     for n, s in accuracy.shifts.items())
    grat = "".join(f"<li>{n}: graticule fit rms {g['rms_m']:.1f} m, max {g['max_m']:.1f} m over {g['vertices']} vertices, {g['scale_m_per_pt']:.2f} m per PDF point</li>"
                   for n, g in accuracy.graticule.items())
    page = f"""<!doctype html><html><head><meta charset="utf-8"><title>CAAI CVFR chart review, edition {html.escape(manifest['edition'])}</title>
<style>body{{font:14px -apple-system,Helvetica,Arial,sans-serif;margin:24px;max-width:1100px}}table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:3px 8px;text-align:left}}
figure{{display:inline-block;margin:6px}}figcaption{{font-size:12px;max-width:440px}}img{{max-width:100%}}.v{{color:{colour};font-weight:700}}</style></head><body>
<h1>CAAI CVFR chart, edition {html.escape(manifest['edition'])} ({html.escape(manifest['edition_label'])})</h1>
<p>DRAFT for owner review. Not published. Chart (c) CAAI; base map (c) Mapa Ltd. Built {html.escape(manifest['validated_at'])}.</p>
<p>Validation: <span class="v">{status}</span>. Tiles z{manifest['min_zoom']} to z{manifest['max_zoom']}, {manifest['size_bytes'] / 1e6:.1f} MB.</p>
<h2>Gate failures</h2><ul>{failures}</ul>
<h2>Accuracy against CAAI coordinates (out of sample)</h2>
<p>{accuracy.matched} of {accuracy.checkable} checkable reporting points matched a printed triangle. Median {accuracy.median_m:.0f} m, p95 {accuracy.p95_m:.0f} m,
max {accuracy.max_m:.0f} m. Limits: p95 {v['limits']['p95_m']:.0f} m, max {v['limits']['max_m']:.0f} m. Unmatched: {unm}.</p>
{_histogram_svg([r['error_m'] for r in accuracy.rows], accuracy.p95_m, v['limits']['p95_m'], v['limits']['max_m'])}
<ul>{grat}{shifts}</ul>
<p>Seam: {len(accuracy.seam)} points are on both sheets; the two printings disagree by a median {accuracy.seam_median_m:.0f} m, max {accuracy.seam_max_m:.0f} m.</p>
<h2>Overview (z{ov_z}) with CAAI points</h2>
<p>Black circle: CAAI coordinate. Line: error to the printed symbol, drawn {ERROR_EXAGGERATION}x longer than real; red when over the p95 limit.</p>
<a href="overview.png"><img src="overview.png" style="max-height:900px"></a>
<h2>Worst 12 points</h2><table><tr><th>code</th><th>name</th><th>kind</th><th>sheet</th><th>error m</th></tr>{rows}</table>{crop_html}
<h2>Completeness</h2><p>Sheets present: {', '.join(completeness.sheets_present)}. {completeness.sampled} required places sampled (CAAI points, runway ends, a vertex every ~1 km along every CVFR route).
FIR area covered by chart pixels: {completeness.fir_area_coverage:.1%} (the rest is mostly sea hidden under the enlarged-area inset and legends).
Blank tiles at max zoom: {len(completeness.blank_tiles)}.</p>
<p>No tile:</p><ul>{unc}</ul><p>Under the enlarged-area inset (the printed inset covers the main map there, so it is masked; the CAAI vector overlay still draws these):</p><ul>{hid}</ul><p>On blank paper:</p><ul>{col}</ul>
<h2>Edition diff</h2>{dh}
</body></html>"""
    path = out_dir / "review.html"
    path.write_text(page, encoding="utf-8")
    return path
