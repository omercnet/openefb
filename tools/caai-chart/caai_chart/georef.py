"""Per-sheet georeferencing: fit a transverse-Mercator + similarity model to the printed graticule."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from pyproj import Transformer
from scipy.optimize import least_squares

from .graticule import GridLine

M_PER_PT_NOMINAL = 0.3527778 / 1000 * 250_000  # 1:250,000 -> metres on the ground per PDF point (88.19 m)
_FWD_CACHE: dict[float, Transformer] = {}


def _tmerc(lon0: float) -> Transformer:
    key = round(float(lon0), 9)
    if key not in _FWD_CACHE:
        crs = f"+proj=tmerc +lon_0={key:.9f} +k=1 +datum=WGS84 +units=m"
        _FWD_CACHE[key] = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    return _FWD_CACHE[key]


@dataclass(frozen=True)
class SheetModel:
    """lon/lat (WGS-84, degrees) <-> PDF page points (origin top-left, y down)."""
    lon0: float      # degrees, central meridian of the chart's transverse Mercator
    scale: float     # PDF points per metre
    theta: float     # radians
    tx: float
    ty: float
    rms_m: float = 0.0
    max_m: float = 0.0
    n_vertices: int = 0

    def to_pdf(self, lon, lat):
        lon = np.asarray(lon, dtype=float)
        lat = np.asarray(lat, dtype=float)
        e, n = _tmerc(self.lon0).transform(lon, lat)
        c, s = math.cos(self.theta), math.sin(self.theta)
        px = self.scale * (c * e - s * n) + self.tx
        py = -(self.scale * (s * e + c * n) + self.ty)
        return px, py

    def to_lonlat(self, x, y):
        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float)
        qx, qy = x - self.tx, -y - self.ty
        c, s = math.cos(self.theta), math.sin(self.theta)
        e = (c * qx + s * qy) / self.scale
        n = (-s * qx + c * qy) / self.scale
        return _tmerc(self.lon0).transform(e, n, direction="INVERSE")

    def metres_per_point(self) -> float:
        return 1.0 / self.scale


def fit_sheet(lines: list[GridLine]) -> SheetModel:
    """Least-squares fit. Every polyline vertex of a labelled meridian/parallel must lie on that
    graticule line; the residual is the cross-track distance in metres."""
    pts, kind, val = [], [], []
    for gl in lines:
        for x, y in gl.points:
            pts.append((x, -y))
            kind.append(gl.kind == "meridian")
            val.append(gl.value)
    if len(pts) < 12:
        raise RuntimeError("too few graticule vertices to georeference the sheet")
    pts = np.array(pts)
    is_mer = np.array(kind)
    val = np.array(val)
    s0 = 1.0 / M_PER_PT_NOMINAL

    def unpack(p):
        return p[0], p[1], p[2], p[3], p[4]

    def residuals(p):
        lon0, s, th, tx, ty = unpack(p)
        q = pts - [tx, ty]
        c, sn = math.cos(th), math.sin(th)
        e = (c * q[:, 0] + sn * q[:, 1]) / s
        n = (-sn * q[:, 0] + c * q[:, 1]) / s
        lon, lat = _tmerc(lon0).transform(e, n, direction="INVERSE")
        return np.where(is_mer, (lon - val) * 111_320 * np.cos(np.radians(lat)), (lat - val) * 110_574)

    # Initial guess: anchor the first parallel's left end at its latitude, longitude 34.0.
    first = next(g for g in lines if g.kind == "parallel")
    x, y = first.points[0]
    e, n = _tmerc(35.2).transform(34.0, first.value)
    x0 = [35.2, s0, 0.0, x - s0 * e, -y - s0 * n]
    sol = least_squares(residuals, x0, x_scale=[1, 1e-4, 1e-4, 100, 100])
    r = sol.fun
    return SheetModel(
        lon0=float(sol.x[0]), scale=float(sol.x[1]), theta=float(sol.x[2]),
        tx=float(sol.x[3]), ty=float(sol.x[4]),
        rms_m=float(np.sqrt(np.mean(r ** 2))), max_m=float(np.abs(r).max()), n_vertices=len(r),
    )


def shifted_model(model: SheetModel, shift_pt) -> SheetModel:
    """Model moved so a feature predicted at PDF (x, y) lands at (x + dx, y + dy); shift in PDF points."""
    from dataclasses import replace
    dx, dy = float(shift_pt[0]), float(shift_pt[1])
    return replace(model, tx=model.tx + dx, ty=model.ty - dy)
