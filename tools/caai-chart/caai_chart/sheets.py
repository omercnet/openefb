"""A CVFR chart sheet inside a vector PDF: graticule fit, content footprint (collar/legend/inset mask)."""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from pathlib import Path

import fitz
import numpy as np
from PIL import Image, ImageDraw

from .georef import SheetModel, fit_sheet
from .graticule import GridLine, find_grid

NEATLINE_INSET_PT = 2.0  # drop the neat line itself and its anti-aliasing
MIN_OBSTRUCTION_AREA = 30_000.0  # pt^2, about 2.5 x 2.5 km at 1:250k... small boxes are map content


@dataclass
class Sheet:
    name: str                       # "north" / "south"
    pdf_path: Path
    page_index: int
    page_rect: fitz.Rect
    frame: fitz.Rect
    lines: list[GridLine]
    model: SheetModel
    obstructions: list[list[tuple[float, float]]] = field(default_factory=list)  # polygons, PDF pts
    edition: dict | None = None
    grid_model: SheetModel | None = None  # graticule-only fit; `model` adds the CAAI-point offset

    def footprint_mask(self, scale: float, size: tuple[int, int]) -> np.ndarray:
        """Boolean raster (h, w) of usable map pixels for a page rendered at `scale` px per pt."""
        w, h = size
        img = Image.new("L", (w, h), 0)
        dr = ImageDraw.Draw(img)
        f = self.frame
        dr.rectangle([ (f.x0 + NEATLINE_INSET_PT) * scale, (f.y0 + NEATLINE_INSET_PT) * scale,
                       (f.x1 - NEATLINE_INSET_PT) * scale, (f.y1 - NEATLINE_INSET_PT) * scale], fill=255)
        for poly in self.obstructions:
            dr.polygon([(x * scale, y * scale) for x, y in poly], fill=0)
        return np.asarray(img) > 0


def _polygon_of(drawing) -> list[tuple[float, float]]:
    pts: list[tuple[float, float]] = []
    for it in drawing["items"]:
        if it[0] == "l":
            pts.append((it[1].x, it[1].y))
            pts.append((it[2].x, it[2].y))
        elif it[0] == "re":
            r = it[1]
            pts += [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
        elif it[0] == "qu":
            q = it[1]
            pts += [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)]
    # dedupe consecutive duplicates
    out: list[tuple[float, float]] = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.01:
            out.append(p)
    return out


def _poly_area(poly: list[tuple[float, float]]) -> float:
    """Shoelace area, pt^2."""
    s = 0.0
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        s += x0 * y1 - x1 * y0
    return abs(s) / 2


def find_obstructions(page: fitz.Page, frame: fitz.Rect) -> list[list[tuple[float, float]]]:
    """Legend boxes, tables, cover block and the enlarged-area inset: big white-filled shapes,
    plus 1 pt stroke-only boxes (the cover blocks) that lie inside the neat line."""
    polys = []
    for d in page.get_drawings():
        r = d["rect"]
        area = r.width * r.height
        if area < MIN_OBSTRUCTION_AREA or r.width > frame.width * 0.95:
            continue
        fill, col, w = d.get("fill"), d.get("color"), d.get("width") or 0
        white = fill is not None and min(fill) > 0.985
        cover = fill is None and col is not None and 0.95 < w < 1.05 and len(d["items"]) == 1
        if not (white or cover):
            continue
        poly = _polygon_of(d)
        if len(poly) < 3:
            continue
        # Boxes are rectangular; a white map shape (an airspace, a lake) is not. The enlarged-area
        # inset is an irregular polygon but huge.
        if _poly_area(poly) / area < 0.85 and area < 300_000:
            continue
        polys.append(poly)
    return polys


def imprint_text(page: fitz.Page) -> str:
    """Edition imprint printed at the bottom/top of the sheet: Hebrew 'update N/YY' + month."""
    words = page.get_text("words")
    txt = " ".join(w[4] for w in sorted(words, key=lambda w: (round(w[1] / 8), w[0])))
    return txt


def load_sheet(name: str, pdf_path: Path, page_index: int) -> Sheet:
    doc = fitz.open(pdf_path)
    page = doc[page_index]
    frame, lines = find_grid(page)
    model = fit_sheet(lines)
    obs = find_obstructions(page, frame)
    sheet = Sheet(name, Path(pdf_path), page_index, page.rect, frame, lines, model, obs)
    sheet.edition = parse_edition(page)
    sheet.grid_model = model
    return sheet


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


_HEB_MONTHS = {
    "ינואר": "January", "פברואר": "February", "מרץ": "March", "מרס": "March", "אפריל": "April", "מאי": "May",
    "יוני": "June", "יולי": "July", "אוגוסט": "August", "ספטמבר": "September", "אוקטובר": "October",
    "נובמבר": "November", "דצמבר": "December",
}


def parse_edition(page: fitz.Page) -> dict | None:
    """Edition imprint, e.g. Hebrew 'update 2/25, October 2025' -> amendment 2, year 2025.

    The imprint sits on the cover block and the sheet footer; the PDF text extraction is lossy for
    Hebrew ('עדכו' for 'עדכון'), so match on the digits next to the word, not the whole word.
    """
    import re
    words = page.get_text("words")
    for w in words:
        if not w[4].startswith("עדכו"):
            continue
        row = [v for v in words if abs(v[1] - w[1]) < 6 and abs(v[0] - w[0]) < 160]
        amend = year = None
        month = None
        for v in row:
            m = re.match(r"^,?(\d)/(\d{2})$", v[4])
            if m:
                amend, year = int(m.group(1)), 2000 + int(m.group(2))
            if v[4] in _HEB_MONTHS:
                month = _HEB_MONTHS[v[4]]
        if amend:
            return {"amendment": amend, "year": year, "month": month}
    return None
