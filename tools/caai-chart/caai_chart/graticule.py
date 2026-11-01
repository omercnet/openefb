"""Find the printed lat/lon graticule of a CVFR sheet (vector PDF) and its labels."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

import fitz

# Graticule strokes: dark grey, thin (0.2 pt) or 0.7 pt for the 30' lines.
_GRID_COLOR = (0.113, 0.112, 0.107)
_LABEL_RE = re.compile(r"^(\d+)°(?:(\d+)')?(?:(\d+)\")?([EN])$")


@dataclass
class GridLine:
    kind: str                      # "meridian" or "parallel"
    value: float                   # degrees (lon for meridian, lat for parallel)
    points: list[tuple[float, float]]  # PDF points, in order along the line


def parse_label(text: str) -> tuple[str, float] | None:
    m = _LABEL_RE.match(text.strip())
    if not m:
        return None
    deg = int(m.group(1)) + int(m.group(2) or 0) / 60 + int(m.group(3) or 0) / 3600
    return ("lon" if m.group(4) == "E" else "lat", deg)


def _segments(page: fitz.Page, frame: fitz.Rect) -> list[tuple[float, float, float, float]]:
    out = []
    for d in page.get_drawings():
        w, c = d.get("width"), d.get("color")
        if not w or not c or not (0.15 < w < 0.8):
            continue
        if max(abs(c[i] - _GRID_COLOR[i]) for i in range(3)) > 0.02:
            continue
        for it in d["items"]:
            if it[0] != "l":
                continue
            a, b = it[1], it[2]
            if math.hypot(a.x - b.x, a.y - b.y) > 600:
                out.append((a.x, a.y, b.x, b.y))
    return out


def _chain(segs: list[tuple[float, float, float, float]]) -> list[list[tuple[float, float]]]:
    """Join segments sharing an endpoint (within 0.6 pt) into polylines."""
    remaining = [((s[0], s[1]), (s[2], s[3])) for s in segs]
    chains: list[list[tuple[float, float]]] = []
    close = lambda p, q: math.hypot(p[0] - q[0], p[1] - q[1]) < 0.6
    while remaining:
        a, b = remaining.pop()
        chain = [a, b]
        grew = True
        while grew:
            grew = False
            for i, (p, q) in enumerate(remaining):
                if close(chain[-1], p):
                    chain.append(q)
                elif close(chain[-1], q):
                    chain.append(p)
                elif close(chain[0], q):
                    chain.insert(0, p)
                elif close(chain[0], p):
                    chain.insert(0, q)
                else:
                    continue
                remaining.pop(i)
                grew = True
                break
        chains.append(chain)
    return chains


def find_frame(page: fitz.Page) -> fitz.Rect:
    """The thick (about 1 pt) neat-line rectangle that bounds the map."""
    best = None
    for d in page.get_drawings():
        w = d.get("width") or 0
        if 0.9 < w < 1.1:
            xs, ys = [], []
            for it in d["items"]:
                if it[0] == "l":
                    xs += [it[1].x, it[2].x]
                    ys += [it[1].y, it[2].y]
                elif it[0] == "re":
                    xs += [it[1].x0, it[1].x1]
                    ys += [it[1].y0, it[1].y1]
            if xs and (max(xs) - min(xs)) > 1500 and (max(ys) - min(ys)) > 2000:
                r = fitz.Rect(min(xs), min(ys), max(xs), max(ys))
                if best is None or r.get_area() > best.get_area():
                    best = r
    if best is None:
        raise RuntimeError("map neat line not found")
    return best


def find_grid(page: fitz.Page) -> tuple[fitz.Rect, list[GridLine]]:
    """Return the map frame and labelled main-grid lines (inset grids excluded)."""
    frame = find_frame(page)
    chains = [c for c in _chain(_segments(page, frame))]
    labels = []
    for w in page.get_text("words"):
        parsed = parse_label(w[4])
        if parsed:
            labels.append((parsed[0], parsed[1], (w[0] + w[2]) / 2, (w[1] + w[3]) / 2))
    lines: list[GridLine] = []
    for ch in chains:
        (x0, y0), (x1, y1) = ch[0], ch[-1]
        dx, dy = x1 - x0, y1 - y0
        vertical = abs(dy) > abs(dx) * 3
        if not vertical and abs(dx) < abs(dy) * 3:
            continue
        # Main grid spans the frame; the Tel Aviv inset grid runs off the page.
        if min(p[0] for p in ch) < -100 or max(p[0] for p in ch) > page.rect.width + 100:
            continue
        if vertical:
            # Extrapolate the end nearest the top to the label band, match the label centre x.
            top = min(ch, key=lambda p: p[1])
            bottom = max(ch, key=lambda p: p[1])
            slope = (bottom[0] - top[0]) / (bottom[1] - top[1])
            cand = [l for l in labels if l[0] == "lon" and l[3] < frame.y0 + 5]
            best = None
            for l in cand:
                xe = top[0] + slope * (l[3] - top[1])
                err = abs(xe - l[2])
                if err < 20 and (best is None or err < best[0]):
                    best = (err, l[1])
            if best:
                lines.append(GridLine("meridian", best[1], sorted(ch, key=lambda p: p[1])))
        else:
            left = min(ch, key=lambda p: p[0])
            right = max(ch, key=lambda p: p[0])
            slope = (right[1] - left[1]) / (right[0] - left[0])
            cand = [l for l in labels if l[0] == "lat" and l[2] < frame.x0 + 5]
            best = None
            for l in cand:
                ye = left[1] + slope * (l[2] - left[0])
                err = abs(ye - l[3])
                if err < 20 and (best is None or err < best[0]):
                    best = (err, l[1])
            if best:
                lines.append(GridLine("parallel", best[1], sorted(ch, key=lambda p: p[0])))
    return frame, lines
