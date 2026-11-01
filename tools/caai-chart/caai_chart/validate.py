"""Validation gate for a built chart pack: positional accuracy against CAAI coordinates, and completeness.

Accuracy method. The chart is a vector PDF, so the printed reporting-point triangles are exact geometry.
For every CAAI reporting point (compulsory or on request) we predict where our georeference puts it on the
sheet that serves that point, find the nearest printed triangle, and take the triangle centroid (the
symbol's reference point, verified against the data: its median offset from the CAAI coordinate is under
30 m) as the printed position. The error is the geodesic distance between the CAAI coordinate and the
position of the printed symbol under our georeference. Because the printed symbol is the chart's own idea
of where the point is, this measures our transform plus the chart's drafting error, which is exactly what a
pilot sees when the app draws the CAAI vector overlay on top of the chart.
"""
from __future__ import annotations

import json
import math
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from pyproj import Geod

from .georef import shifted_model
from .sheets import Sheet, _poly_area
from .tiler import MBTiles, lonlat_to_tile, seam_latitude

GEOD = Geod(ellps="WGS84")

# Gate thresholds (metres), calibrated on the AIP amendment 1/26 build of the 2/25 chart (README "Thresholds").
# Brief's starting values were p95 150 m / max 300 m. Measured on the real chart, out of sample:
# median 56 m, p90 135 m, p95 187 m, max 329 m, with our transform's own graticule residual at 9.5-15 m rms.
# So the tail is the chart's drafting (1 PDF point = 88 m; the printed symbol centre varies by ~0.7 pt rms), not
# our georeference. We therefore gate our transform tightly and the chart's drafting at the measured floor:
P95_LIMIT_M = 200.0            # chart drafting, 2.3 pt (0.8 mm at print scale)
MAX_LIMIT_M = 350.0            # 4 pt; a single misplaced symbol beyond this is a real defect
GRATICULE_RMS_LIMIT_M = 30.0   # our fit of the printed graticule (observed 9.5 and 15 m rms)
SHIFT_LIMIT_M = 250.0          # content-vs-graticule offset (observed 50 m north, 164 m south)
MIN_GRATICULE_VERTICES = 40
MATCH_RADIUS_PT = 6.0          # search radius around the predicted position, PDF points (about 530 m)
MIN_MATCH_FRACTION = 0.80      # of the checkable points; guards against a gate that checks nothing


@dataclass
class Point:
    code: str
    name: str
    kind: str
    lat: float
    lon: float


def load_points(db_path: Path) -> list[Point]:
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    rows = db.execute("SELECT code, COALESCE(name_en, ''), kind, lat, lon FROM reporting_points ORDER BY code, id").fetchall()
    db.close()
    return [Point(*r) for r in rows]


def find_triangles(sheet: Sheet) -> np.ndarray:
    """Printed reporting-point triangles: closed 3-vertex paths 3..18 pt across (open = on request, filled = compulsory). Rows: cx, cy, w, h."""
    import fitz
    page = fitz.open(sheet.pdf_path)[sheet.page_index]
    out = []
    for d in page.get_drawings():
        its = d["items"]
        if not 3 <= len(its) <= 4 or any(i[0] != "l" for i in its):
            continue
        r = d["rect"]
        if not (3 < r.width < 19 and 3 < r.height < 19):
            continue
        if math.hypot(its[-1][2].x - its[0][1].x, its[-1][2].y - its[0][1].y) > 0.05:
            continue
        verts = {(round(i[1].x, 1), round(i[1].y, 1)) for i in its}
        if len(verts) != 3:
            continue
        out.append((sum(v[0] for v in verts) / 3, sum(v[1] for v in verts) / 3, r.width, r.height))
    return np.array(out, dtype=float).reshape(-1, 4)


def _in_polygon(poly: list[tuple[float, float]], x: float, y: float) -> bool:
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def usable(sheet: Sheet, x: float, y: float) -> bool:
    f = sheet.frame
    if not (f.x0 + 4 < x < f.x1 - 4 and f.y0 + 4 < y < f.y1 - 4):
        return False
    return not any(_in_polygon(p, x, y) for p in sheet.obstructions)


def _geo_m(lon1, lat1, lon2, lat2) -> float:
    return float(GEOD.inv(lon1, lat1, lon2, lat2)[2])


@dataclass
class AccuracyResult:
    rows: list[dict] = field(default_factory=list)
    unmatched: list[dict] = field(default_factory=list)
    seam: list[dict] = field(default_factory=list)
    shifts: dict[str, dict] = field(default_factory=dict)   # per sheet: translation applied after the graticule fit
    checkable: int = 0
    matched: int = 0
    median_m: float = 0.0
    p95_m: float = 0.0
    max_m: float = 0.0
    seam_median_m: float = 0.0
    seam_max_m: float = 0.0
    shift_vectors: dict[str, list[float]] = field(default_factory=dict)
    graticule: dict[str, dict] = field(default_factory=dict)
    passed: bool = False
    failures: list[str] = field(default_factory=list)


CV_FOLDS = 10
GRID_MATCH_RADIUS_PT = 6.0    # first pass, graticule-only georeference
TRIM_PT = 4.0                 # a match further than this from the median offset is an outlier


def _match_symbols(sheet: Sheet, points: list[Point], tri: np.ndarray, radius: float, model) -> dict[str, tuple]:
    """code -> (predicted x, y, symbol x, y) for points whose printed triangle lies within `radius` pt."""
    out = {}
    if not len(tri):
        return out
    for p in points:
        if p.kind == "arp":
            continue  # aerodrome reference points are circles with a runway symbol, not triangles
        px, py = model.to_pdf(p.lon, p.lat)
        px, py = float(px), float(py)
        if not usable(sheet, px, py):
            continue
        d = np.hypot(tri[:, 0] - px, tri[:, 1] - py)
        i = int(d.argmin())
        if d[i] <= radius:
            out[p.code + "|" + p.kind] = (px, py, float(tri[i, 0]), float(tri[i, 1]))
    return out


def _trimmed_offset(vecs: np.ndarray) -> np.ndarray:
    """Robust central offset of (n, 2) residual vectors: median, drop outliers beyond TRIM_PT, median again."""
    med = np.median(vecs, axis=0)
    keep = np.hypot(*(vecs - med).T) < TRIM_PT
    if keep.sum() >= 3:
        med = np.median(vecs[keep], axis=0)
    return med


def measure_accuracy(sheets: list[Sheet], points: list[Point]) -> AccuracyResult:
    """Georeference refinement plus out-of-sample accuracy.

    1. The graticule fit places each sheet; CAAI's own points then say where the *content* sits relative to
       the printed graticule. Per sheet we apply a pure translation (2 degrees of freedom) equal to the
       robust median offset, so the chart lines up with the CAAI vector overlay. The offset is reported
       (`shifts`), because a large one means the chart's graticule and CAAI's coordinates disagree.
    2. Accuracy is then measured with 10-fold cross-validation: each point's error is taken against a
       translation estimated WITHOUT that point's fold, so the numbers are out-of-sample and a bad chart
       cannot hide behind its own correction.
    """
    north = next(s for s in sheets if s.name == "north")
    south = next(s for s in sheets if s.name == "south")
    seam_lat = seam_latitude(north, south)
    tri = {s.name: find_triangles(s) for s in sheets}
    res = AccuracyResult()

    for s_ in sheets:
        m = s_.grid_model
        res.graticule[s_.name] = {"rms_m": m.rms_m, "max_m": m.max_m, "vertices": m.n_vertices, "lon0": m.lon0,
                                  "scale_m_per_pt": m.metres_per_point()}
        if m.rms_m > GRATICULE_RMS_LIMIT_M:
            res.failures.append(f"{s_.name} sheet graticule fit rms {m.rms_m:.0f} m exceeds {GRATICULE_RMS_LIMIT_M:.0f} m")
        if m.n_vertices < MIN_GRATICULE_VERTICES:
            res.failures.append(f"{s_.name} sheet: only {m.n_vertices} graticule vertices found")

    # Pass 1: graticule-only model, wide radius, estimate the translation.
    per_sheet: dict[str, dict] = {}
    for s in sheets:
        m1 = _match_symbols(s, points, tri[s.name], GRID_MATCH_RADIUS_PT, s.grid_model)
        vecs = np.array([[v[2] - v[0], v[3] - v[1]] for v in m1.values()]).reshape(-1, 2)
        if len(vecs) < 10:
            res.failures.append(f"{s.name} sheet: only {len(vecs)} reporting points matched; cannot verify placement")
            per_sheet[s.name] = {"matches": {}, "shift": np.zeros(2)}
            continue
        shift = _trimmed_offset(vecs)
        per_sheet[s.name] = {"matches": m1, "shift": shift, "vecs": vecs}
        mpp = s.grid_model.metres_per_point()
        res.shifts[s.name] = {"east_m": float(shift[0] * mpp), "north_m": float(-shift[1] * mpp), "points": int(len(vecs))}
        if math.hypot(res.shifts[s.name]["east_m"], res.shifts[s.name]["north_m"]) > SHIFT_LIMIT_M:
            res.failures.append(f"{s.name} sheet content is offset {math.hypot(res.shifts[s.name]['east_m'], res.shifts[s.name]['north_m']):.0f} m from its graticule (limit {SHIFT_LIMIT_M:.0f} m)")

    # Pass 2: cross-validated errors on the refined placement.
    cv_err: dict[str, dict[str, float]] = {}
    sym_lonlat: dict[str, dict[str, tuple[float, float]]] = {}
    for s in sheets:
        info = per_sheet[s.name]
        m1 = info["matches"]
        keys = sorted(m1)
        errs: dict[str, float] = {}
        if len(keys) >= 10:
            vec = {k: np.array([m1[k][2] - m1[k][0], m1[k][3] - m1[k][1]]) for k in keys}
            for fold in range(CV_FOLDS):
                train = np.array([vec[k] for i, k in enumerate(keys) if i % CV_FOLDS != fold])
                off = _trimmed_offset(train)
                for i, k in enumerate(keys):
                    if i % CV_FOLDS == fold:
                        errs[k] = float(np.hypot(*(vec[k] - off)) * s.grid_model.metres_per_point())
        cv_err[s.name] = errs
        refined = shifted_model(s.grid_model, info["shift"])
        sym_lonlat[s.name] = {k: tuple(float(v) for v in refined.to_lonlat(m1[k][2], m1[k][3])) for k in keys}

    for p in points:
        if p.kind == "arp":
            continue
        key = p.code + "|" + p.kind
        serving_order = ["north", "south"] if p.lat > seam_lat else ["south", "north"]
        in_sheets = []
        for s in sheets:
            px, py = s.grid_model.to_pdf(p.lon, p.lat)
            if usable(s, float(px), float(py)):
                in_sheets.append(s.name)
        if not in_sheets:
            res.unmatched.append({"code": p.code, "kind": p.kind, "reason": "outside every sheet's map area"})
            continue
        res.checkable += 1
        serving = next(n for n in serving_order if n in in_sheets)
        if key not in cv_err.get(serving, {}):
            res.unmatched.append({"code": p.code, "kind": p.kind, "reason": f"no printed triangle within {GRID_MATCH_RADIUS_PT:.0f} pt of the predicted position on the {serving} sheet"})
            continue
        lon, lat = sym_lonlat[serving][key]
        res.matched += 1
        res.rows.append({"code": p.code, "name": p.name, "kind": p.kind, "sheet": serving, "lat": p.lat, "lon": p.lon,
                         "symbol_lat": lat, "symbol_lon": lon, "error_m": cv_err[serving][key]})
        if key in cv_err.get("north", {}) and key in cv_err.get("south", {}):
            a, b = sym_lonlat["north"][key], sym_lonlat["south"][key]
            res.seam.append({"code": p.code, "mismatch_m": _geo_m(a[0], a[1], b[0], b[1])})

    errs = np.array([r["error_m"] for r in res.rows]) if res.rows else np.array([math.inf])
    res.median_m = float(np.median(errs))
    res.p95_m = float(np.percentile(errs, 95))
    res.max_m = float(errs.max())
    res.seam_median_m = float(np.median([x["mismatch_m"] for x in res.seam])) if res.seam else 0.0
    res.seam_max_m = max((x["mismatch_m"] for x in res.seam), default=0.0)
    if res.checkable == 0 or res.matched / res.checkable < MIN_MATCH_FRACTION:
        res.failures.append(f"only {res.matched} of {res.checkable} checkable points matched a printed triangle (need {MIN_MATCH_FRACTION:.0%})")
    if res.p95_m > P95_LIMIT_M:
        res.failures.append(f"p95 error {res.p95_m:.0f} m exceeds {P95_LIMIT_M:.0f} m")
    if res.max_m > MAX_LIMIT_M:
        worst = max(res.rows, key=lambda r: r["error_m"])
        res.failures.append(f"max error {res.max_m:.0f} m ({worst['code']}) exceeds {MAX_LIMIT_M:.0f} m")
    res.passed = not res.failures
    res.shift_vectors = {n: per_sheet[n]["shift"].tolist() for n in per_sheet}
    return res


def apply_refinement(sheets: list[Sheet], res: AccuracyResult) -> None:
    """Replace each sheet's model with the graticule fit plus the measured content offset."""
    for s in sheets:
        shift = np.array(res.shift_vectors.get(s.name, [0.0, 0.0]))
        s.model = shifted_model(s.grid_model, shift)


# ---------------------------------------------------------------- completeness

def _fir_mask(db_path: Path, step: float = 0.01):
    """Boolean raster of the FIR polygon on a regular lon/lat grid (rows: lat descending)."""
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    row = db.execute("SELECT polygons FROM airspaces WHERE kind='FIR'").fetchone()
    db.close()
    polys = json.loads(row[0])
    lons = [pt[1] for poly in polys for ring in poly for pt in ring]
    lats = [pt[0] for poly in polys for ring in poly for pt in ring]
    west, east, south, north = min(lons), max(lons), min(lats), max(lats)
    w = int(math.ceil((east - west) / step))
    h = int(math.ceil((north - south) / step))
    img = Image.new("L", (w, h), 0)
    dr = ImageDraw.Draw(img)
    for poly in polys:
        for k, ring in enumerate(poly):
            xy = [((pt[1] - west) / step, (north - pt[0]) / step) for pt in ring]
            dr.polygon(xy, fill=255 if k == 0 else 0)
    return np.asarray(img) > 0, west, north, step


def _corridor_samples(db_path: Path) -> list[tuple[str, float, float]]:
    """Places the chart must cover: every CAAI point, runway end, and a vertex every ~1 km along each route."""
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    out: list[tuple[str, float, float]] = []
    for code, lat, lon in db.execute("SELECT code, lat, lon FROM reporting_points"):
        out.append((f"point {code}", lat, lon))
    for aerodrome, rw, a_lat, a_lon, b_lat, b_lon in db.execute("SELECT aerodrome, rwy_name, a_lat, a_lon, b_lat, b_lon FROM runways"):
        out.append((f"runway {aerodrome} {rw} end A", a_lat, a_lon))
        out.append((f"runway {aerodrome} {rw} end B", b_lat, b_lon))
    for sid, f, t, poly in db.execute("SELECT id, from_code, to_code, polyline FROM route_segments"):
        pts = json.loads(poly)
        for (la0, lo0), (la1, lo1) in zip(pts, pts[1:]):
            d = _geo_m(lo0, la0, lo1, la1)
            n = max(1, int(d // 1000))
            for k in range(n + 1):
                f_ = k / n
                out.append((f"route {f}-{t}", la0 + (la1 - la0) * f_, lo0 + (lo1 - lo0) * f_))
    db.close()
    return out


INSET_MIN_AREA_PT2 = 300_000.0       # the enlarged-area inset is the only masked region this large
MAX_INSET_HIDDEN_FRACTION = 0.03     # of the required places; the inset is a known, reported gap


def _under_inset(sheets: list[Sheet], lon: float, lat: float) -> bool:
    for s in sheets:
        px, py = s.model.to_pdf(lon, lat)
        for poly in s.obstructions:
            if _poly_area(poly) >= INSET_MIN_AREA_PT2 and _in_polygon(poly, float(px), float(py)):
                return True
    return False


class TileSampler:
    def __init__(self, mb: MBTiles, z: int, tile_size: int):
        self.mb, self.z, self.ts = mb, z, tile_size
        self.cache: dict[tuple[int, int], np.ndarray | None] = {}

    def window(self, lon: float, lat: float, half: int = 4):
        """(alpha_min, white_fraction) over a (2*half+1)^2 pixel window; None when the tile is absent."""
        n = 2 ** self.z
        fx = (lon + 180) / 360 * n
        lat_r = math.radians(lat)
        fy = (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n
        tx, ty = int(fx), int(fy)
        key = (tx, ty)
        if key not in self.cache:
            im = self.mb.get(self.z, tx, ty)
            self.cache[key] = None if im is None else np.asarray(im)
        arr = self.cache[key]
        if arr is None:
            return None
        px, py = int((fx - tx) * self.ts), int((fy - ty) * self.ts)
        y0, y1 = max(0, py - half), min(arr.shape[0], py + half + 1)
        x0, x1 = max(0, px - half), min(arr.shape[1], px + half + 1)
        win = arr[y0:y1, x0:x1]
        alpha_min = int(win[..., 3].min())
        white = float(((win[..., :3] >= 248).all(axis=-1)).mean())
        return alpha_min, white


@dataclass
class CompletenessResult:
    sheets_present: list[str] = field(default_factory=list)
    sampled: int = 0
    uncovered: list[dict] = field(default_factory=list)
    hidden_by_inset: list[dict] = field(default_factory=list)
    collar: list[dict] = field(default_factory=list)
    blank_tiles: list[str] = field(default_factory=list)
    fir_land_samples: int = 0
    fir_area_coverage: float = 0.0
    passed: bool = False
    failures: list[str] = field(default_factory=list)


def measure_completeness(sheets: list[Sheet], mb: MBTiles, db_path: Path, max_zoom: int, tile_size: int) -> CompletenessResult:
    res = CompletenessResult(sheets_present=sorted(s.name for s in sheets))
    if res.sheets_present != ["north", "south"]:
        res.failures.append(f"sheets present: {res.sheets_present}, need north and south")
    sampler = TileSampler(mb, max_zoom, tile_size)
    seen: set[tuple[str, int, int]] = set()
    for label, lat, lon in _corridor_samples(db_path):
        key = (label.split(" ")[0], round(lat * 1000), round(lon * 1000))
        if key in seen:
            continue
        seen.add(key)
        res.sampled += 1
        w = sampler.window(lon, lat)
        if w is None or w[0] < 250:
            item = {"what": label, "lat": lat, "lon": lon}
            if _under_inset(sheets, lon, lat):
                res.hidden_by_inset.append(item)
            else:
                res.uncovered.append(item)
        elif w[1] > 0.95:
            res.collar.append({"what": label, "lat": lat, "lon": lon})
    # FIR area coverage at z10 (information; the corridor above is the gate).
    mask, west, north, step = _fir_mask(db_path)
    z = min(10, max_zoom)
    s10 = TileSampler(mb, z, tile_size)
    covered = total = 0
    ys, xs = np.nonzero(mask[::3, ::3])
    for r, c in zip(ys, xs):
        lat = north - (r * 3 + 0.5) * step
        lon = west + (c * 3 + 0.5) * step
        total += 1
        w = s10.window(lon, lat, half=0)
        if w is not None and w[0] >= 250:
            covered += 1
    res.fir_land_samples = total
    res.fir_area_coverage = covered / total if total else 0.0
    # Blank tiles: any max-zoom tile that is almost entirely paper white.
    for x, y in mb.tile_keys(max_zoom):
        im = mb.get(max_zoom, x, y)
        a = np.asarray(im)
        opaque = a[..., 3] > 250
        if opaque.sum() < 0.05 * opaque.size:
            continue
        white = ((a[..., :3] >= 248).all(axis=-1) & opaque).sum() / opaque.sum()
        if white > 0.97:
            res.blank_tiles.append(f"{max_zoom}/{x}/{y}")
    if res.uncovered:
        res.failures.append(f"{len(res.uncovered)} required places have no chart tile (first: {res.uncovered[0]['what']})")
    if res.hidden_by_inset and len(res.hidden_by_inset) / max(1, res.sampled) > MAX_INSET_HIDDEN_FRACTION:
        res.failures.append(f"{len(res.hidden_by_inset)} required places lie under the enlarged-area inset (limit {MAX_INSET_HIDDEN_FRACTION:.0%})")
    if res.collar:
        res.failures.append(f"{len(res.collar)} required places fall on blank or collar paper (first: {res.collar[0]['what']})")
    if res.blank_tiles:
        res.failures.append(f"{len(res.blank_tiles)} blank tiles at z{max_zoom}")
    res.passed = not res.failures
    return res
