"""Reproject CVFR sheets to Web Mercator XYZ tiles and pack them as MBTiles (deterministic)."""
from __future__ import annotations

import hashlib
import io
import math
import sqlite3
from dataclasses import dataclass
from pathlib import Path

import fitz
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates

from .sheets import Sheet

MAX_RASTER_PIXELS = 110_000_000   # per sheet render; caps memory at the highest zoom
OVERSAMPLE = 1.5                  # render this much finer than the tile grid, then bilinear-sample
EARTH_CIRCUMFERENCE = 40_075_016.686  # metres


def lonlat_grid(z: int, x: int, y: int, tile_size: int) -> tuple[np.ndarray, np.ndarray]:
    """Pixel-centre lon/lat (degrees) of every pixel of XYZ tile (z, x, y); arrays are (ts, ts)."""
    n = 2 ** z
    f = (np.arange(tile_size) + 0.5) / tile_size
    px = (x + f) / n
    py = (y + f) / n
    lon = px * 360.0 - 180.0
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * py))))
    return np.broadcast_to(lon[None, :], (tile_size, tile_size)), np.broadcast_to(lat[:, None], (tile_size, tile_size))


def lonlat_to_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int(math.floor((lon + 180.0) / 360.0 * n))
    lat_r = math.radians(max(min(lat, 85.0511), -85.0511))
    y = int(math.floor((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n))
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def metres_per_pixel(z: int, lat: float, tile_size: int) -> float:
    return EARTH_CIRCUMFERENCE * math.cos(math.radians(lat)) / (tile_size * 2 ** z)


@dataclass
class SheetRaster:
    sheet: Sheet
    scale: float          # raster px per PDF pt
    clip: fitz.Rect       # PDF rect that was rendered
    rgb: np.ndarray       # (h, w, 3) uint8
    alpha: np.ndarray     # (h, w) float32 0..1 usable-content mask

    def sample(self, lon: np.ndarray, lat: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Bilinear sample at lon/lat arrays; returns (rgb float32 (..,3), alpha float32)."""
        px, py = self.sheet.model.to_pdf(lon, lat)
        cx = (px - self.clip.x0) * self.scale - 0.5
        cy = (py - self.clip.y0) * self.scale - 0.5
        coords = [cy.ravel(), cx.ravel()]
        shape = lon.shape
        rgb = np.stack([map_coordinates(self.rgb[..., c], coords, order=1, mode="nearest") for c in range(3)], axis=-1)
        a = map_coordinates(self.alpha, coords, order=1, mode="constant", cval=0.0)
        h, w = self.alpha.shape
        inside = (cx >= -0.5) & (cy >= -0.5) & (cx <= w - 0.5) & (cy <= h - 0.5)
        a = np.where(inside.ravel(), a, 0.0)
        return rgb.reshape(shape + (3,)).astype(np.float32), a.reshape(shape).astype(np.float32)


def render_sheet(sheet: Sheet, z: int, tile_size: int) -> SheetRaster:
    """Rasterize the sheet's map area at a resolution matched to zoom z."""
    lat_c = float(sheet.model.to_lonlat(sheet.frame.x0 + sheet.frame.width / 2, sheet.frame.y0 + sheet.frame.height / 2)[1])
    target_mpp = metres_per_pixel(z, lat_c, tile_size)
    px_per_pt = (1.0 / target_mpp) / sheet.model.scale  # raster px per PDF pt at 1:1 sampling
    scale = px_per_pt * OVERSAMPLE
    clip = fitz.Rect(sheet.frame.x0 - 1, sheet.frame.y0 - 1, sheet.frame.x1 + 1, sheet.frame.y1 + 1) & sheet.page_rect
    pixels = clip.width * clip.height * scale * scale
    if pixels > MAX_RASTER_PIXELS:
        scale *= math.sqrt(MAX_RASTER_PIXELS / pixels)
    doc = fitz.open(sheet.pdf_path)
    pix = doc[sheet.page_index].get_pixmap(matrix=fitz.Matrix(scale, scale), clip=clip, alpha=False)
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
    # The pixmap origin snaps to whole device pixels; recover the PDF rect it really covers.
    real_clip = fitz.Rect(pix.x / scale, pix.y / scale, (pix.x + pix.width) / scale, (pix.y + pix.height) / scale)
    mask = sheet_mask_for(sheet, real_clip, scale, (pix.width, pix.height))
    return SheetRaster(sheet, scale, real_clip, rgb, mask)


def sheet_mask_for(sheet: Sheet, clip: fitz.Rect, scale: float, size: tuple[int, int]) -> np.ndarray:
    """Float 0..1 mask of usable map pixels for the clipped render (anti-aliased edges)."""
    from PIL import ImageDraw
    w, h = size
    ss = 2  # supersample the polygon edges
    img = Image.new("L", (w * ss, h * ss), 0)
    dr = ImageDraw.Draw(img)
    f = sheet.frame
    inset = 2.0
    def pt(x: float, y: float) -> tuple[float, float]:
        return ((x - clip.x0) * scale * ss, (y - clip.y0) * scale * ss)
    dr.rectangle([pt(f.x0 + inset, f.y0 + inset), pt(f.x1 - inset, f.y1 - inset)], fill=255)
    for poly in sheet.obstructions:
        dr.polygon([pt(x, y) for x, y in poly], fill=0)
    img = img.resize((w, h), Image.BOX)
    return np.asarray(img, dtype=np.float32) / 255.0


def sheet_geo_bounds(sheet: Sheet) -> tuple[float, float, float, float]:
    """(west, south, east, north) of the sheet's neat line, from its model."""
    f = sheet.frame
    xs = np.linspace(f.x0, f.x1, 12)
    ys = np.linspace(f.y0, f.y1, 12)
    gx, gy = np.meshgrid(xs, ys)
    lon, lat = sheet.model.to_lonlat(gx.ravel(), gy.ravel())
    return float(np.min(lon)), float(np.min(lat)), float(np.max(lon)), float(np.max(lat))


def seam_latitude(north: Sheet, south: Sheet) -> float:
    """Middle of the north/south overlap band, degrees."""
    n_bottom = sheet_geo_bounds(north)[1]
    s_top = sheet_geo_bounds(south)[3]
    return (n_bottom + s_top) / 2


def encode_tile(rgb: np.ndarray, alpha: np.ndarray, fmt: str, quality: int) -> bytes:
    a8 = np.clip(np.rint(alpha * 255), 0, 255).astype(np.uint8)
    opaque = bool((a8 == 255).all())
    arr = np.clip(np.rint(rgb), 0, 255).astype(np.uint8)
    if opaque:
        img = Image.fromarray(arr, "RGB")
    else:
        # Straight alpha, transparent pixels carry no colour.
        arr = np.where(a8[..., None] == 0, 0, arr)
        img = Image.fromarray(np.dstack([arr, a8]), "RGBA")
    buf = io.BytesIO()
    if fmt == "webp":
        img.save(buf, "WEBP", quality=quality, method=4)
    else:
        img.save(buf, "PNG", optimize=True, compress_level=9)
    return buf.getvalue()


def render_tile(z: int, x: int, y: int, tile_size: int, rasters: list[SheetRaster], seam_lat: float | None):
    """Composite the sheets into one tile; returns (rgb, alpha) or None when fully transparent."""
    lon, lat = lonlat_grid(z, x, y, tile_size)
    layers = []
    for r in rasters:
        rgb, a = r.sample(lon, lat)
        if a.max() <= 0:
            continue
        layers.append((r, rgb, a))
    if not layers:
        return None
    if len(layers) == 1:
        _, rgb, a = layers[0]
        return rgb, a
    # Two sheets: the north sheet wins above the seam latitude, the south sheet below it.
    north = next(l for l in layers if l[0].sheet.name == "north")
    south = next(l for l in layers if l[0].sheet.name == "south")
    north_first = (lat > seam_lat) if seam_lat is not None else np.ones_like(lat, dtype=bool)
    pri_rgb = np.where(north_first[..., None], north[1], south[1])
    pri_a = np.where(north_first, north[2], south[2])
    sec_rgb = np.where(north_first[..., None], south[1], north[1])
    sec_a = np.where(north_first, south[2], north[2])
    out_a = pri_a + sec_a * (1 - pri_a)
    denom = np.maximum(out_a, 1e-6)[..., None]
    out_rgb = (pri_rgb * pri_a[..., None] + sec_rgb * (sec_a * (1 - pri_a))[..., None]) / denom
    return out_rgb, out_a


def tiles_for_zoom(bounds: tuple[float, float, float, float], z: int) -> list[tuple[int, int]]:
    west, south, east, north = bounds
    x0, y0 = lonlat_to_tile(west, north, z)
    x1, y1 = lonlat_to_tile(east, south, z)
    return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]


@dataclass
class TileStats:
    count_by_zoom: dict[int, int]
    total_bytes: int
    tile_checksum: str
    bounds: tuple[float, float, float, float]


def build_mbtiles(
    sheets: list[Sheet], out_path: Path, *, min_zoom: int, max_zoom: int, tile_size: int,
    fmt: str, quality: int, metadata: dict[str, str], log=print,
) -> TileStats:
    """Write the MBTiles file. Tiles are emitted in (z, x, y) order so the file is reproducible."""
    north = next(s for s in sheets if s.name == "north")
    south = next(s for s in sheets if s.name == "south")
    seam = seam_latitude(north, south)
    bs = [sheet_geo_bounds(s) for s in sheets]
    union = (min(b[0] for b in bs), min(b[1] for b in bs), max(b[2] for b in bs), max(b[3] for b in bs))
    if out_path.exists():
        out_path.unlink()
    db = sqlite3.connect(out_path)
    db.executescript(
        "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;"
        "CREATE TABLE metadata (name TEXT, value TEXT);"
        "CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);"
        "CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);"
    )
    digest = hashlib.sha256()
    counts: dict[int, int] = {}
    total = 0
    for z in range(min_zoom, max_zoom + 1):
        log(f"  zoom {z}: rendering sheets")
        rasters = [render_sheet(s, z, tile_size) for s in sheets]
        cand = set()
        for s in sheets:
            cand.update(tiles_for_zoom(sheet_geo_bounds(s), z))
        n = 0
        for (x, y) in sorted(cand):
            res = render_tile(z, x, y, tile_size, rasters, seam)
            if res is None:
                continue
            rgb, a = res
            if a.max() < 0.02:
                continue
            data = encode_tile(rgb, a, fmt, quality)
            tms_y = (2 ** z - 1) - y
            db.execute("INSERT INTO tiles VALUES (?,?,?,?)", (z, x, tms_y, data))
            digest.update(f"{z}/{x}/{y}:".encode())
            digest.update(hashlib.sha256(data).digest())
            total += len(data)
            n += 1
        counts[z] = n
        log(f"  zoom {z}: {n} tiles")
        del rasters
    meta = dict(metadata)
    meta.update({
        "format": fmt, "type": "baselayer", "scheme": "tms",
        "minzoom": str(min_zoom), "maxzoom": str(max_zoom),
        "bounds": ",".join(f"{v:.6f}" for v in union),
        "center": f"{(union[0] + union[2]) / 2:.6f},{(union[1] + union[3]) / 2:.6f},{min(max_zoom, 9)}",
        "tile_size": str(tile_size),
    })
    for k in sorted(meta):
        db.execute("INSERT INTO metadata VALUES (?,?)", (k, meta[k]))
    db.commit()
    db.execute("VACUUM")
    db.close()
    return TileStats(counts, total, digest.hexdigest(), union)


class MBTiles:
    """Minimal reader used by validation and review."""

    def __init__(self, path: Path):
        self.db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)

    def meta(self) -> dict[str, str]:
        return dict(self.db.execute("SELECT name, value FROM metadata"))

    def get(self, z: int, x: int, y: int) -> Image.Image | None:
        row = self.db.execute(
            "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
            (z, x, (2 ** z - 1) - y)).fetchone()
        if not row:
            return None
        return Image.open(io.BytesIO(row[0])).convert("RGBA")

    def tile_keys(self, z: int) -> list[tuple[int, int]]:
        rows = self.db.execute("SELECT tile_column, tile_row FROM tiles WHERE zoom_level=?", (z,)).fetchall()
        return sorted((x, (2 ** z - 1) - ty) for x, ty in rows)

    def close(self) -> None:
        self.db.close()
