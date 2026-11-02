#!/usr/bin/env python3
"""Build efb-212/Resources/israel-aviation.sqlite from the CAAI GIS layer packages.

Input  : the three zips downloaded from https://www.gov.il/he/pages/aip?chapterIndex=11 into
         tools/caai-importer/input/ (see README.md for the exact file names).
Output : a read-only, WGS-84 SQLite database with R-tree indexes. Same input + same
         --import-date gives a byte-identical file.

Fails loudly (non-zero exit, nothing written) when a count differs from the AIP, a segment
endpoint does not resolve to a point, or a segment's geometry does not end at its points.
"""

import argparse
import csv
import hashlib
import json
import math
import os
import re
import sqlite3
import sys
import tempfile
import warnings
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

import pyogrio
from pyproj import Geod

warnings.filterwarnings("ignore")

IMPORTER_VERSION = 2
SCHEMA_VERSION = 2

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DEFAULT_INPUT = HERE / "input"
DEFAULT_OUTPUT = REPO / "efb-212" / "Resources" / "israel-aviation.sqlite"

# Zips as saved from the CAAI page (short ASCII names; the CAAI originals are Hebrew).
ZIP_CVFR = "CVFR2026.zip"                # נתיבי תובלה נמוכים CVFR
ZIP_FIR = "FIR-TMA-ACC-CTR.zip"          # שכבות FIR, TMA, ACC, CTR
ZIP_PRD = "PRD-CTR.zip"                  # אסורים לטיסה וCTRים
SOURCE_URLS = [
    "https://www.gov.il/he/pages/aip?chapterIndex=11",
    "https://www.gov.il/BlobFolder/guide/aip/he/CVFR2026.zip",
    "https://www.gov.il/BlobFolder/guide/aip/he/%D7%A9%D7%9B%D7%91%D7%95%D7%AA%20FIR,%20TMA,%20ACC,%20CTR.zip",
    "https://www.gov.il/BlobFolder/guide/aip/he/%D7%90%D7%A1%D7%95%D7%A8%D7%99%D7%9D%20%D7%9C%D7%98%D7%99%D7%A1%D7%94%20%D7%95CTR%D7%99%D7%9D.zip",
]

# The GDBs do not carry the AIP amendment, and their member dates are later than the amendment
# the research doc names (1/26, 2026-08-06), so the label is never guessed: aip_amendment is NULL
# unless passed with --aip-amendment. Attribution names the source data date instead.
ATTRIBUTION = "Aeronautical data: Civil Aviation Authority of Israel (CAAI), data of {data_date}"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def member_date(zip_path):
    """Latest member timestamp in the zip, as an ISO date (what `unzip -l` shows)."""
    with zipfile.ZipFile(zip_path) as z:
        return max(date(*i.date_time[:3]) for i in z.infolist() if not i.is_dir()).isoformat()


def display_date(iso):
    d = date.fromisoformat(iso)
    return "%d %s %d" % (d.day, MONTHS[d.month - 1], d.year)

# Counts the AIP publishes (docs/research/israel-cvfr.md section 4). Any mismatch aborts the import.
EXPECTED = {
    "reporting_points": 198,
    "route_segments": 275,
    "ctr_atz": 39,       # CTR + ATZ + CTA rows of the CTR layer
    "prd": 113,          # P + R + D (+ LLD) rows of F_Limited
    "tma": 9,
    "fir": 1,
    "runways": 42,
}

# Segment endpoints must lie within this distance of their point...
ENDPOINT_TOLERANCE_M = 1000.0
# ...except these published segments, whose drawn line stops short of the point (checked by pair).
ACCEPTED_ENDPOINT_GAPS_M = {("SAMAR", "LLOV"): 12000.0}  # Samar-Ovda ends ~11 km from the Ovda ARP.

# Source defects, corrected only while the source still shows them (each rule is verified against
# the segment name and geometry, and stored in metadata.corrections).
CORRECTIONS = [
    {
        "layer": "F_CVFR_ROUTES2026",
        "name": "Hazerim-Ofakim",
        "field": "firstWayPo", "was": "LLHS", "now": "LLHB",
        "reason": "Segment is named Hazerim-... and its line starts at Hazerim (LLHB); LLHS is Hazor, 57 km away.",
    },
    {
        "layer": "F_CVFR_ROUTES2026",
        "name": "Hazerim-Tzalahot",
        "field": "firstWayPo", "was": "LLHS", "now": "LLHB",
        "reason": "Segment is named Hazerim-Tzalahot and its line reaches Hazerim (LLHB); LLHS is Hazor, 57 km away.",
    },
]

GEOD = Geod(ellps="WGS84")
UNLIMITED_FT = 99000


class ImportFailure(Exception):
    pass


def fail(message):
    raise ImportFailure(message)


# ---------------------------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------------------------

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_all(zip_path, dest):
    """Extract a zip and every zip inside it (recursively) below dest."""
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(dest)
    for inner in sorted(dest.rglob("*.zip")):
        extract_all(inner, inner.with_suffix(""))


def find_gdb(root, layer):
    """The single .gdb below root holding `layer` (sorted search, so repeatable)."""
    for gdb in sorted(root.rglob("*.gdb")):
        if any(name == layer for name, _ in pyogrio.list_layers(str(gdb))):
            return gdb
    fail("layer %s not found below %s" % (layer, root))


def read_layer(root, layer):
    gdb = find_gdb(root, layer)
    frame = pyogrio.read_dataframe(str(gdb), layer=layer)
    if frame.crs is None:
        fail("layer %s has no CRS" % layer)
    return frame.to_crs(4326)  # WGS-84; source is UTM 36N (EPSG:32636)


# ---------------------------------------------------------------------------------------------
# Field helpers
# ---------------------------------------------------------------------------------------------

def clean(value):
    """Stripped text, or None for null / blank / '<Null>'."""
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
    except Exception:
        pass
    text = str(value).strip()
    return None if text in ("", "<Null>", "None", "nan") else text


def to_int(value):
    text = clean(value)
    if text is None:
        return None
    try:
        return int(round(float(text)))
    except ValueError:
        return None


def route_alt(value):
    """Route altitude token -> text. 'X' (not published), blank and null -> None."""
    text = clean(value)
    return None if text is None or text.upper() == "X" else text


def alt_parts(value):
    """'2500/3500' -> [2500, 3500]; '3000' -> [3000]; unparsable -> []."""
    text = clean(value)
    if text is None:
        return []
    parts = []
    for piece in text.split("/"):
        try:
            parts.append(int(round(float(piece.strip()))))
        except ValueError:
            return []
    return parts


def single_alt(text):
    """Altitude (ft) only when the published value is one number; varying values stay text."""
    parts = alt_parts(text)
    return parts[0] if len(parts) == 1 else None


def round6(value):
    return round(float(value) + 0.0, 6)


def ring_json(ring):
    return [[round6(y), round6(x)] for x, y, *_ in ring.coords]  # [lat, lon]


def polygons_json(geometry):
    polys = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
    out = []
    for poly in polys:
        out.append([ring_json(poly.exterior)] + [ring_json(r) for r in poly.interiors])
    return out


def bbox(geometry):
    min_lon, min_lat, max_lon, max_lat = geometry.bounds
    return round6(min_lat), round6(max_lat), round6(min_lon), round6(max_lon)


def dms(text):
    """'32° 55' 7.000\" N' -> signed decimal degrees, or None."""
    text = clean(text)
    if text is None:
        return None
    m = re.search(r"(\d+)\D+(\d+)\D+([\d.]+)\D*([NSEW])", text)
    if not m:
        return None
    value = int(m.group(1)) + int(m.group(2)) / 60.0 + float(m.group(3)) / 3600.0
    return round6(-value if m.group(4) in "SW" else value)


def geodesic_bearing(a, b):
    return GEOD.inv(a[0], a[1], b[0], b[1])[0] % 360.0


def distance_m(a, b):
    return GEOD.inv(a[0], a[1], b[0], b[1])[2]


# ---------------------------------------------------------------------------------------------
# Transformation
# ---------------------------------------------------------------------------------------------

def build_points(frame):
    kinds = {"חובה": "compulsory", "דרישה": "onRequest", "ARP": "arp"}
    rows = []
    for _, r in frame.iterrows():
        kind = kinds.get(clean(r["Report"]))
        if kind is None:
            fail("point %s: unknown Report value %r" % (r["Code"], r["Report"]))
        lat, lon = r.geometry.y, r.geometry.x
        # The layer repeats the coordinates as attributes: they must agree with the geometry.
        if abs(lat - r["N"]) > 1e-6 or abs(lon - r["E"]) > 1e-6:
            fail("point %s: attribute coordinates disagree with geometry" % r["Code"])
        rows.append({
            "code": clean(r["Code"]), "name_en": clean(r["LocalName"]), "name_he": clean(r["HebrewName"]),
            "kind": kind, "lat": round6(lat), "lon": round6(lon),
        })
    rows.sort(key=lambda p: (p["code"], p["name_en"] or "", p["lat"], p["lon"]))
    for i, p in enumerate(rows, 1):
        p["id"] = i
    return rows


def apply_corrections(frame):
    applied = []
    for rule in CORRECTIONS:
        mask = (frame["Name"].str.strip() == rule["name"]) & (frame[rule["field"]].str.strip() == rule["was"])
        if mask.sum() == 0:
            print("note: correction for %s no longer needed (source changed)" % rule["name"])
            continue
        frame.loc[mask, rule["field"]] = rule["now"]
        applied.append({k: rule[k] for k in ("layer", "name", "field", "was", "now", "reason")})
    return applied


def build_segments(frame, points):
    by_code = {}
    for p in points:
        by_code.setdefault(p["code"], []).append(p)
    rows = []
    gaps = []
    for _, r in frame.iterrows():
        first, second = clean(r["firstWayPo"]), clean(r["secondWayp"])
        for code in (first, second):
            if code not in by_code:
                fail("segment %s-%s: endpoint %s is not a reporting point or ARP" % (first, second, code))
        lines = list(r.geometry.geoms)
        if len(lines) != 1:
            fail("segment %s-%s: expected one line, found %d" % (first, second, len(lines)))
        coords = [(x, y) for x, y, *_ in lines[0].coords]

        def nearest(code, xy):
            p = min(by_code[code], key=lambda q: distance_m(xy, (q["lon"], q["lat"])))
            return p, distance_m(xy, (p["lon"], p["lat"]))

        # The drawn direction is arbitrary (67 of 275 run second -> first): orient by the codes.
        a_first, da = nearest(first, coords[0])
        z_second, dz = nearest(second, coords[-1])
        b_first, db = nearest(first, coords[-1])
        a_second, dd = nearest(second, coords[0])
        if da + dz <= db + dd:
            start, end, p_from, p_to, d_from, d_to = coords[0], coords[-1], a_first, z_second, da, dz
        else:
            coords = coords[::-1]
            start, end, p_from, p_to, d_from, d_to = coords[0], coords[-1], b_first, a_second, db, dd
        limit = ACCEPTED_ENDPOINT_GAPS_M.get((first, second), ENDPOINT_TOLERANCE_M)
        if d_from > limit or d_to > limit:
            fail("segment %s-%s: line ends %.0f m / %.0f m from its points (limit %.0f m)" % (first, second, d_from, d_to, limit))
        if max(d_from, d_to) > ENDPOINT_TOLERANCE_M:
            gaps.append("%s-%s %.0f m" % (first, second, max(d_from, d_to)))
        bearing = geodesic_bearing(start, end)

        raw = {k: route_alt(r[col]) for k, col in (("north", "N_A"), ("south", "S_A"), ("west", "W_Alt"), ("east", "E_Alt"))}
        fwd, rev = directional(raw, bearing)
        rows.append({
            "from_code": first, "to_code": second, "from_point_id": p_from["id"], "to_point_id": p_to["id"],
            "name_en": clean(r["Name"]), "name_he": clean(r["HebrewName"]),
            "length_nm": round(float(r["Length"]), 3),
            "civil": 1 if clean(r["Military"]) == "CIVIL" else 0,
            "military": 1 if clean(r["Military"]) == "MIL" else 0,
            "by_request": 1 if clean(r["byReques"]) == "BR" else 0,
            "bearing_true": round(bearing, 1),
            "alt_forward_ft": single_alt(fwd), "alt_forward_text": fwd,
            "alt_reverse_ft": single_alt(rev), "alt_reverse_text": rev,
            "alt_north": raw["north"], "alt_south": raw["south"], "alt_west": raw["west"], "alt_east": raw["east"],
            "lower_alt_ft": to_int(r["LowerALT"]), "map_sheet": clean(r["MAP"]),
            "polyline": [[round6(y), round6(x)] for x, y in coords],
        })
        if clean(r["Military"]) not in ("CIVIL", "MIL") or clean(r["byReques"]) not in ("OPEN", "BR"):
            fail("segment %s-%s: unknown Military/byReques value" % (first, second))
    rows.sort(key=lambda s: (s["from_code"], s["to_code"]))
    keys = [(s["from_code"], s["to_code"]) for s in rows]
    if len(set(keys)) != len(keys):
        fail("duplicate from/to segment pairs")
    for i, s in enumerate(rows, 1):
        s["id"] = i
    return rows, gaps


def directional(raw, bearing):
    """(forward, reverse) altitude text for travel from -> to.

    The CAAI altitudes are per compass direction (northbound/southbound or eastbound/westbound),
    not per drawing order. Use the axis the leg mostly follows; fall back to the other axis when
    that one publishes nothing. Where both axes publish, they must agree.
    """
    north_component, east_component = math.cos(math.radians(bearing)), math.sin(math.radians(bearing))
    ns = (raw["north"], raw["south"], north_component > 0)   # (positive-direction alt, negative-direction alt, forward is positive)
    we = (raw["east"], raw["west"], east_component > 0)
    axes = [ns, we] if abs(north_component) >= abs(east_component) else [we, ns]
    results = []
    for pos, neg, forward_is_pos in axes:
        if pos is None and neg is None:
            continue
        results.append((pos, neg) if forward_is_pos else (neg, pos))
    if not results:
        return None, None
    return results[0]


def prd_kind(designator, source_type):
    prefix = {"LLP": "P", "LLR": "R", "LLD": "D"}.get((designator or "")[:3])
    return prefix or {"P": "P", "R": "R", "D": "D", "LLD": "D"}.get(source_type or "")


def limits(floor_value, ceiling_value):
    """(floor_ft, floor_ref, ceiling_ft, ceiling_ref, floor_text, ceiling_text).

    Where the layer publishes two values ('3000/3500') the envelope is stored (lowest floor, highest
    ceiling: the larger volume, so a pilot is never told the airspace is smaller than published)
    and the verbatim text is kept. Floor 0 is the surface. The layers carry no reference; the AIP
    (A-17, ENR 5.1) gives limits as "ALT" (above mean sea level) and 0 = ground, so ceilings and
    non-zero floors are MSL. 99000 is "unlimited".
    """
    f, c = alt_parts(floor_value), alt_parts(ceiling_value)
    floor_ft = min(f) if f else None
    ceiling_ft = max(c) if c else None
    floor_ref = None if floor_ft is None else ("SFC" if floor_ft == 0 else "MSL")
    ceiling_ref = None if ceiling_ft is None else ("UNL" if ceiling_ft >= UNLIMITED_FT else "MSL")
    floor_text = clean(floor_value) if len(f) > 1 else None
    ceiling_text = clean(ceiling_value) if len(c) > 1 else None
    return floor_ft, floor_ref, ceiling_ft, ceiling_ref, floor_text, ceiling_text


def airspace_row(kind, code, name_en, name_he, authority, floor_value, ceiling_value, geometry, label=None):
    floor_ft, floor_ref, ceiling_ft, ceiling_ref, floor_text, ceiling_text = limits(floor_value, ceiling_value)
    min_lat, max_lat, min_lon, max_lon = bbox(geometry)
    return {
        "kind": kind, "code": code, "name_en": name_en, "name_he": name_he, "authority": authority, "label": label,
        "floor_ft": floor_ft, "floor_ref": floor_ref, "floor_text": floor_text,
        "ceiling_ft": ceiling_ft, "ceiling_ref": ceiling_ref, "ceiling_text": ceiling_text,
        "polygons": polygons_json(geometry),
        "min_lat": min_lat, "max_lat": max_lat, "min_lon": min_lon, "max_lon": max_lon,
    }


def build_airspaces(ctr, prd, tma, fir):
    rows = []
    authority = {"אזרחי": "civil", "צבאי": "military"}
    for _, r in ctr.iterrows():
        rows.append(airspace_row(clean(r["TYPE"]), clean(r["Code"]), None, clean(r["Name"]),
                                 authority.get(clean(r["Civ_Mil"])), r["Min_Alt"], r["Max_Alt"], r.geometry))
    reconciled = []
    for _, r in prd.iterrows():
        kind = prd_kind(clean(r["designator"]), clean(r["Type"]))
        if kind is None:
            fail("F_Limited %s: cannot classify (Type=%r)" % (r["designator"], r["Type"]))
        if clean(r["Type"]) != kind:
            reconciled.append("%s: Type %r -> %s" % (r["designator"], clean(r["Type"]), kind))
        rows.append(airspace_row(kind, clean(r["designator"]), clean(r["name"]), clean(r["HebrewName"]),
                                 None, r["AltMin"], r["AltMax"], r.geometry))
    for _, r in tma.iterrows():
        label = clean(r["CTR_LABEL"])
        rows.append(airspace_row("TMA", label.split()[0] if label else None, None, clean(r["name"]),
                                 "civil" if clean(r["category"]) == "אזרחים" else None,
                                 r["low_alt"], r["high_alt"], r.geometry, label=label))
    for _, r in fir.iterrows():
        rows.append(airspace_row("FIR", clean(r["designator"]), clean(r["name"]), clean(r["HebrweName"]),
                                 None, r["minAlt"], r["maxAlt"], r.geometry))
    rows.sort(key=lambda a: (a["kind"], a["code"] or "", a["name_he"] or "", a["name_en"] or "", a["min_lat"], a["min_lon"]))
    for i, a in enumerate(rows, 1):
        a["id"] = i
    return rows, reconciled


RWY_NAME = re.compile(r"^(\d{2}[LRC]?)\s*[/-]\s*(\d{2}[LRC]?)$")


def build_runways(frame):
    rows = []
    for _, r in frame.iterrows():
        lines = list(r.geometry.geoms)
        coords = [(x, y) for x, y, *_ in lines[0].coords] if lines else []
        if not coords:
            fail("runway row without geometry")
        a, z = coords[0], coords[-1]
        m = RWY_NAME.match(clean(r["RWY_Name"]) or "")
        desig_a, desig_b = (m.group(1), m.group(2)) if m else (None, None)
        headings = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", clean(r["Bearing"]) or "")]
        heading_a = heading_b = None
        if len(headings) == 2 and m:
            heading_a, heading_b = headings
            # Order the ends so end A is the one runway A departs from: the line's direction a -> z
            # must be close to heading A, otherwise swap.
            diff = abs(((geodesic_bearing(a, z) - heading_a) + 180) % 360 - 180)
            if diff > 90:
                a, z = z, a
        rows.append({
            "aerodrome": clean(r["Code"]), "name_en": clean(r["name"]), "name_he": clean(r["HebrewName"]),
            "rwy_name": clean(r["RWY_Name"]), "designator_a": desig_a, "designator_b": desig_b,
            "heading_a": heading_a, "heading_b": heading_b,
            "length_m": to_int(r["Length"]), "width_m": to_int(r["Width"]),
            "surface": clean(r["RANWAY_type"]), "control_type": clean(r["controlType"]),
            "arp_lat": dms(r["ARP_coordNorth"]), "arp_lon": dms(r["ARP_coordEast"]),
            "a_lat": round6(a[1]), "a_lon": round6(a[0]), "b_lat": round6(z[1]), "b_lon": round6(z[0]),
        })
    rows.sort(key=lambda w: (w["aerodrome"] or "~", w["designator_a"] or "~", w["rwy_name"] or "~",
                             w["length_m"] or 0, w["a_lat"], w["a_lon"]))
    for i, w in enumerate(rows, 1):
        w["id"] = i
        w["min_lat"], w["max_lat"] = round6(min(w["a_lat"], w["b_lat"])), round6(max(w["a_lat"], w["b_lat"]))
        w["min_lon"], w["max_lon"] = round6(min(w["a_lon"], w["b_lon"])), round6(max(w["a_lon"], w["b_lon"]))
    return rows


# ---------------------------------------------------------------------------------------------
# Curated aerodromes (IL-4): curated/aerodromes-il.csv, checked by hand against the AIP
# ---------------------------------------------------------------------------------------------

DEFAULT_CURATED = HERE / "curated" / "aerodromes-il.csv"
AERODROME_TYPES = ("airport", "airstrip", "heliport")
AERODROME_USES = ("civil", "military", "uas", "agricultural", "hospital", "foreign", "ultralight")
REVIEW_STATUSES = ("unreviewed", "reviewed")
PPR_VALUES = ("yes", "no", "unknown")
# A GIS point or runway must lie this close to the aerodrome row that claims it. The AIP ARP and the
# GIS ARP differ by up to ~2.8 km for the two LLNV rows (Negav / Nevatim), so this is generous.
ARP_MATCH_M = 5000.0
# 'DES LxW surface [hdg a/b T|M]'; DES may be '?' (unpublished) or a range like '175-305'; surface may be
# composite as published ('concrete+asphalt', 'asphalt/concrete').
CURATED_RWY = re.compile(r"^(\S+) (\d+(?:\.\d+)?)x(\d+(?:\.\d+)?) ([\w+/]+)(?: hdg (\d+(?:\.\d+)?)/(\d+(?:\.\d+)?) ([TM]))?$")
CURATED_FREQ = re.compile(r"^(\d{3}\.\d{3}) (.+)$")


def parse_curated_runways(code, text):
    out = []
    for part in [p.strip() for p in text.split(";") if p.strip()]:
        m = CURATED_RWY.match(part)
        if not m:
            fail("%s: cannot parse runway %r (expected 'DES LxW surface [hdg a/b T|M]')" % (code, part))
        out.append({
            "aerodrome": code, "designator": m.group(1), "length_m": float(m.group(2)), "width_m": float(m.group(3)),
            "surface": m.group(4), "heading_a": float(m.group(5)) if m.group(5) else None,
            "heading_b": float(m.group(6)) if m.group(6) else None, "heading_ref": m.group(7),
        })
    return out


def parse_curated_frequencies(code, text):
    out = []
    for part in [p.strip() for p in text.split(";") if p.strip()]:
        m = CURATED_FREQ.match(part)
        if not m:
            fail("%s: cannot parse frequency %r (expected 'NNN.NNN service[|callsign]')" % (code, part))
        mhz = float(m.group(1))
        if not 108.0 <= mhz <= 137.0:
            fail("%s: frequency %s is outside the VHF air band" % (code, m.group(1)))
        service, _, callsign = m.group(2).partition("|")
        out.append({"aerodrome": code, "mhz": m.group(1), "service": service.strip(), "callsign_he": callsign.strip() or None})
    return out


def load_curated(path):
    """Read the curated aerodrome CSV into (aerodromes, runways, frequencies); fail on any malformed row."""
    if not path.exists():
        fail("missing curated aerodromes %s" % path)
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    required = ["code", "name_he", "name_en", "type", "use", "lat", "lon", "elevation_ft", "runways", "frequencies",
                "circuit_altitude_ft", "circuit_direction", "hours", "ppr", "ppr_text", "remarks", "source_identity",
                "source_runways", "source_frequencies", "source_circuit", "source_hours", "source_remarks",
                "uncertain", "notes", "review_status", "reviewed_by"]
    missing = [c for c in required if c not in (reader.fieldnames or [])]
    if missing:
        fail("%s lacks columns %s" % (path.name, missing))
    aerodromes, runways, frequencies, seen = [], [], [], set()
    for n, r in enumerate(rows, 2):
        code = clean(r["code"])
        if not code or code in seen:
            fail("%s line %d: empty or duplicate code %r" % (path.name, n, code))
        seen.add(code)
        if r["type"] not in AERODROME_TYPES:
            fail("%s: type %r is not one of %s" % (code, r["type"], AERODROME_TYPES))
        if r["use"] not in AERODROME_USES:
            fail("%s: use %r is not one of %s" % (code, r["use"], AERODROME_USES))
        if r["ppr"] not in PPR_VALUES:
            fail("%s: ppr %r is not one of %s" % (code, r["ppr"], PPR_VALUES))
        if r["review_status"] not in REVIEW_STATUSES:
            fail("%s: review_status %r is not one of %s" % (code, r["review_status"], REVIEW_STATUSES))
        if bool(clean(r["reviewed_by"])) != (r["review_status"] == "reviewed"):
            fail("%s: reviewed rows name their reviewers in reviewed_by, unreviewed rows leave it empty" % code)
        if not clean(r["name_en"]) or not clean(r["name_he"]):
            fail("%s: names in both languages are required" % code)
        try:
            lat, lon = float(r["lat"]), float(r["lon"])
        except ValueError:
            fail("%s: latitude/longitude are not numbers" % code)
        if not (29.0 <= lat <= 34.0 and 33.5 <= lon <= 36.5):
            fail("%s: %.6f, %.6f is outside the Israel region box" % (code, lat, lon))
        elevation = to_int(r["elevation_ft"])
        if clean(r["elevation_ft"]) and elevation is None:
            fail("%s: elevation_ft %r is not an integer" % (code, r["elevation_ft"]))
        circuit = to_int(r["circuit_altitude_ft"])
        if clean(r["circuit_altitude_ft"]) and circuit is None:
            fail("%s: circuit_altitude_ft %r is not an integer" % (code, r["circuit_altitude_ft"]))
        if not clean(r["source_identity"]):
            fail("%s: source_identity is required (every row names where its coordinates came from)" % code)
        for field, source in (("runways", "source_runways"), ("frequencies", "source_frequencies"),
                              ("circuit_altitude_ft", "source_circuit"), ("hours", "source_hours")):
            if clean(r[field]) and not clean(r[source]):
                fail("%s: %s has a value but %s is empty" % (code, field, source))
        aerodromes.append({
            "code": code, "name_he": r["name_he"].strip(), "name_en": r["name_en"].strip(), "type": r["type"], "use": r["use"],
            "lat": round6(lat), "lon": round6(lon), "elevation_ft": elevation, "circuit_altitude_ft": circuit,
            "circuit_direction": clean(r["circuit_direction"]), "hours": clean(r["hours"]), "ppr": r["ppr"],
            "ppr_text": clean(r["ppr_text"]), "remarks": clean(r["remarks"]),
            "source_identity": clean(r["source_identity"]), "source_runways": clean(r["source_runways"]),
            "source_frequencies": clean(r["source_frequencies"]), "source_circuit": clean(r["source_circuit"]),
            "source_hours": clean(r["source_hours"]), "source_remarks": clean(r["source_remarks"]),
            "uncertain": clean(r["uncertain"]), "notes": clean(r["notes"]), "review_status": r["review_status"],
            "min_lat": round6(lat), "max_lat": round6(lat), "min_lon": round6(lon), "max_lon": round6(lon),
        })
        runways += parse_curated_runways(code, r["runways"])
        frequencies += parse_curated_frequencies(code, r["frequencies"])
    aerodromes.sort(key=lambda a: a["code"])
    for i, a in enumerate(aerodromes, 1):
        a["id"] = i
    for table in (runways, frequencies):
        for i, row in enumerate(table, 1):
            row["id"] = i
    return aerodromes, runways, frequencies


def cross_check_aerodromes(aerodromes, points, gis_runways):
    """Every CAAI ARP point and every CAAI runway row must resolve to a curated aerodrome row.

    ARP points resolve by code, then must lie within ARP_MATCH_M of that row. Runway rows resolve by their
    aerodrome code where they have one; the rest (mostly military fields) by position: the nearest aerodrome
    to the ARP attribute, else to the runway line's midpoint, within ARP_MATCH_M. Anything left over aborts."""
    by_code = {a["code"]: a for a in aerodromes}
    problems = []
    for p in points:
        if p["kind"] != "arp":
            continue
        a = by_code.get(p["code"])
        if a is None:
            problems.append("ARP point %s (%s) has no aerodrome row" % (p["code"], p["name_en"]))
            continue
        gap = distance_m((p["lon"], p["lat"]), (a["lon"], a["lat"]))
        if gap > ARP_MATCH_M:
            problems.append("ARP point %s is %.1f km from aerodrome row %s" % (p["code"], gap / 1000, a["code"]))
    for w in gis_runways:
        label = "runway id %d (%s %s %s m)" % (w["id"], w["aerodrome"] or "no code", w["name_en"], w["length_m"])
        if w["aerodrome"]:
            if w["aerodrome"] not in by_code:
                problems.append("%s: aerodrome code has no row" % label)
            continue
        here = (w["arp_lon"], w["arp_lat"]) if w["arp_lat"] is not None and w["arp_lon"] is not None else \
            ((w["a_lon"] + w["b_lon"]) / 2, (w["a_lat"] + w["b_lat"]) / 2)
        nearest = min(aerodromes, key=lambda a: distance_m(here, (a["lon"], a["lat"])))
        if distance_m(here, (nearest["lon"], nearest["lat"])) > ARP_MATCH_M:
            problems.append("%s: no aerodrome row within %.0f km" % (label, ARP_MATCH_M / 1000))
    if problems:
        fail("aerodrome cross-check failed:\n  - " + "\n  - ".join(problems))



# ---------------------------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------------------------

SCHEMA = """
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;

-- code is not unique: the source publishes LLNV twice (Nevatim, Negav), both ARP.
CREATE TABLE reporting_points (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL,
    name_en TEXT, name_he TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('compulsory','onRequest','arp')),
    lat REAL NOT NULL,   -- degrees, WGS-84
    lon REAL NOT NULL    -- degrees, WGS-84
);
CREATE INDEX idx_reporting_points_code ON reporting_points(code);

-- from -> to is the code order of the source; polyline runs from -> to ([lat, lon] pairs).
CREATE TABLE route_segments (
    id INTEGER PRIMARY KEY,
    from_code TEXT NOT NULL, to_code TEXT NOT NULL,
    from_point_id INTEGER NOT NULL REFERENCES reporting_points(id),
    to_point_id INTEGER NOT NULL REFERENCES reporting_points(id),
    name_en TEXT, name_he TEXT,
    length_nm REAL,                 -- nautical miles
    civil INTEGER NOT NULL, military INTEGER NOT NULL, by_request INTEGER NOT NULL,
    bearing_true REAL NOT NULL,     -- degrees true, from -> to
    alt_forward_ft INTEGER,         -- feet MSL, travelling from -> to; NULL when unpublished or varying
    alt_forward_text TEXT,          -- verbatim published value (e.g. '2500/3500'); NULL when unpublished
    alt_reverse_ft INTEGER,         -- feet MSL, travelling to -> from
    alt_reverse_text TEXT,
    alt_north TEXT, alt_south TEXT, alt_west TEXT, alt_east TEXT,  -- source fields, northbound etc.
    lower_alt_ft INTEGER,           -- feet MSL, the lower of the published altitudes
    map_sheet TEXT,
    polyline TEXT NOT NULL          -- JSON [[lat, lon], ...]
);
CREATE UNIQUE INDEX idx_route_segments_codes ON route_segments(from_code, to_code);
CREATE INDEX idx_route_segments_to ON route_segments(to_code);

CREATE TABLE airspaces (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,             -- CTR ATZ CTA TMA P R D FIR
    code TEXT, name_en TEXT, name_he TEXT, label TEXT,
    authority TEXT CHECK (authority IN ('civil','military')),
    floor_ft INTEGER, floor_ref TEXT CHECK (floor_ref IN ('SFC','MSL','AGL','FL')),
    floor_text TEXT,
    ceiling_ft INTEGER, ceiling_ref TEXT CHECK (ceiling_ref IN ('MSL','AGL','FL','UNL')),
    ceiling_text TEXT,
    min_lat REAL NOT NULL, max_lat REAL NOT NULL, min_lon REAL NOT NULL, max_lon REAL NOT NULL,
    polygons TEXT NOT NULL          -- JSON [polygon][ring][[lat, lon]]; ring 0 outer, others holes
);
CREATE INDEX idx_airspaces_kind ON airspaces(kind);
CREATE INDEX idx_airspaces_code ON airspaces(code);

CREATE TABLE runways (
    id INTEGER PRIMARY KEY,
    aerodrome TEXT, name_en TEXT, name_he TEXT,
    rwy_name TEXT, designator_a TEXT, designator_b TEXT,
    heading_a REAL, heading_b REAL,  -- degrees, as published
    length_m INTEGER, width_m INTEGER,
    surface TEXT, control_type TEXT,
    arp_lat REAL, arp_lon REAL,
    a_lat REAL NOT NULL, a_lon REAL NOT NULL, b_lat REAL NOT NULL, b_lon REAL NOT NULL,
    min_lat REAL NOT NULL, max_lat REAL NOT NULL, min_lon REAL NOT NULL, max_lon REAL NOT NULL
);
CREATE INDEX idx_runways_aerodrome ON runways(aerodrome);

CREATE VIRTUAL TABLE reporting_points_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
CREATE VIRTUAL TABLE route_segments_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
CREATE VIRTUAL TABLE airspaces_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
CREATE VIRTUAL TABLE runways_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);

-- Curated aerodromes (tools/caai-importer/curated/aerodromes-il.csv, IL-4). Airports, airstrips, heliports.
CREATE TABLE aerodromes (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,      -- ICAO where one exists, else a short slug
    name_he TEXT NOT NULL, name_en TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('airport','airstrip','heliport')),
    use TEXT NOT NULL CHECK (use IN ('civil','military','uas','agricultural','hospital','foreign','ultralight')),
    lat REAL NOT NULL, lon REAL NOT NULL,   -- degrees, WGS-84 (AIP ARP)
    elevation_ft INTEGER,                   -- feet MSL, negative below sea level
    circuit_altitude_ft INTEGER,            -- feet MSL (QNH)
    circuit_direction TEXT,
    hours TEXT,
    ppr TEXT NOT NULL CHECK (ppr IN ('yes','no','unknown')),
    ppr_text TEXT, remarks TEXT,
    source_identity TEXT NOT NULL, source_runways TEXT, source_frequencies TEXT,
    source_circuit TEXT, source_hours TEXT, source_remarks TEXT,
    uncertain TEXT,                         -- comma list of field groups the curator is unsure about
    notes TEXT,
    review_status TEXT NOT NULL CHECK (review_status IN ('unreviewed','reviewed')),
    min_lat REAL NOT NULL, max_lat REAL NOT NULL, min_lon REAL NOT NULL, max_lon REAL NOT NULL
);
CREATE TABLE aerodrome_runways (
    id INTEGER PRIMARY KEY,
    aerodrome TEXT NOT NULL REFERENCES aerodromes(code),
    designator TEXT NOT NULL,               -- '10/28', '?' when unpublished
    length_m REAL NOT NULL, width_m REAL NOT NULL,  -- metres
    surface TEXT NOT NULL,                  -- asphalt concrete dirt gravel grass unknown
    heading_a REAL, heading_b REAL,         -- degrees, as published
    heading_ref TEXT CHECK (heading_ref IN ('T','M'))  -- true or magnetic
);
CREATE INDEX idx_aerodrome_runways_aerodrome ON aerodrome_runways(aerodrome);
CREATE TABLE aerodrome_frequencies (
    id INTEGER PRIMARY KEY,
    aerodrome TEXT NOT NULL REFERENCES aerodromes(code),
    mhz TEXT NOT NULL,                      -- 'NNN.NNN', as published
    service TEXT NOT NULL, callsign_he TEXT
);
CREATE INDEX idx_aerodrome_frequencies_aerodrome ON aerodrome_frequencies(aerodrome);
CREATE VIRTUAL TABLE aerodromes_rtree USING rtree(rowid, min_lat, max_lat, min_lon, max_lon);
"""


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def write_database(path, points, segments, airspaces, runways, aerodromes, aerodrome_runways, aerodrome_frequencies, metadata):
    tmp = Path(str(path) + ".tmp")
    if tmp.exists():
        tmp.unlink()
    db = sqlite3.connect(str(tmp))
    db.execute("PRAGMA journal_mode = DELETE")
    db.execute("PRAGMA page_size = 4096")
    db.executescript(SCHEMA)
    db.executemany("INSERT INTO reporting_points VALUES (:id,:code,:name_en,:name_he,:kind,:lat,:lon)", points)
    db.executemany("INSERT INTO reporting_points_rtree VALUES (:id,:lat,:lat,:lon,:lon)", points)

    for s in segments:
        lats = [p[0] for p in s["polyline"]]
        lons = [p[1] for p in s["polyline"]]
        s["_bbox"] = (min(lats), max(lats), min(lons), max(lons))
        s["polyline_json"] = compact(s["polyline"])
    db.executemany("""INSERT INTO route_segments VALUES (
        :id,:from_code,:to_code,:from_point_id,:to_point_id,:name_en,:name_he,:length_nm,
        :civil,:military,:by_request,:bearing_true,:alt_forward_ft,:alt_forward_text,
        :alt_reverse_ft,:alt_reverse_text,:alt_north,:alt_south,:alt_west,:alt_east,
        :lower_alt_ft,:map_sheet,:polyline_json)""", segments)
    db.executemany("INSERT INTO route_segments_rtree VALUES (?,?,?,?,?)",
                   [(s["id"],) + s["_bbox"] for s in segments])

    for a in airspaces:
        a["polygons_json"] = compact(a["polygons"])
    db.executemany("""INSERT INTO airspaces VALUES (
        :id,:kind,:code,:name_en,:name_he,:label,:authority,:floor_ft,:floor_ref,:floor_text,
        :ceiling_ft,:ceiling_ref,:ceiling_text,:min_lat,:max_lat,:min_lon,:max_lon,:polygons_json)""", airspaces)
    db.executemany("INSERT INTO airspaces_rtree VALUES (:id,:min_lat,:max_lat,:min_lon,:max_lon)", airspaces)

    db.executemany("""INSERT INTO runways VALUES (
        :id,:aerodrome,:name_en,:name_he,:rwy_name,:designator_a,:designator_b,:heading_a,:heading_b,
        :length_m,:width_m,:surface,:control_type,:arp_lat,:arp_lon,
        :a_lat,:a_lon,:b_lat,:b_lon,:min_lat,:max_lat,:min_lon,:max_lon)""", runways)
    db.executemany("INSERT INTO runways_rtree VALUES (:id,:min_lat,:max_lat,:min_lon,:max_lon)", runways)

    db.executemany("""INSERT INTO aerodromes VALUES (
        :id,:code,:name_he,:name_en,:type,:use,:lat,:lon,:elevation_ft,:circuit_altitude_ft,:circuit_direction,
        :hours,:ppr,:ppr_text,:remarks,:source_identity,:source_runways,:source_frequencies,:source_circuit,
        :source_hours,:source_remarks,:uncertain,:notes,:review_status,:min_lat,:max_lat,:min_lon,:max_lon)""", aerodromes)
    db.executemany("INSERT INTO aerodromes_rtree VALUES (:id,:min_lat,:max_lat,:min_lon,:max_lon)", aerodromes)
    db.executemany("""INSERT INTO aerodrome_runways VALUES (
        :id,:aerodrome,:designator,:length_m,:width_m,:surface,:heading_a,:heading_b,:heading_ref)""", aerodrome_runways)
    db.executemany("INSERT INTO aerodrome_frequencies VALUES (:id,:aerodrome,:mhz,:service,:callsign_he)", aerodrome_frequencies)

    db.executemany("INSERT INTO metadata VALUES (?,?)", sorted(metadata.items()))
    db.execute("PRAGMA user_version = %d" % SCHEMA_VERSION)
    db.commit()
    db.execute("VACUUM")
    db.close()
    os.replace(str(tmp), str(path))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--curated", type=Path, default=DEFAULT_CURATED, help="curated aerodromes CSV (IL-4)")
    parser.add_argument("--aip-amendment", default=None, help="AIP amendment, e.g. 1/26; recorded only when given (else NULL)")
    parser.add_argument("--effective-date", default=None, help="AIP effective date YYYY-MM-DD; recorded only when given")
    parser.add_argument("--import-date", default=None,
                        help="YYYY-MM-DD stored in metadata (default: SOURCE_DATE_EPOCH, else today UTC); fix it for byte-stable output")
    args = parser.parse_args(argv)

    if args.import_date:
        import_date = args.import_date
        date.fromisoformat(import_date)
    elif os.environ.get("SOURCE_DATE_EPOCH"):
        import_date = datetime.fromtimestamp(int(os.environ["SOURCE_DATE_EPOCH"]), timezone.utc).date().isoformat()
    else:
        import_date = datetime.now(timezone.utc).date().isoformat()

    zips = {name: args.input / name for name in (ZIP_CVFR, ZIP_FIR, ZIP_PRD)}
    for name, path in zips.items():
        if not path.exists():
            fail("missing input %s (see README.md for the download)" % path)

    with tempfile.TemporaryDirectory(prefix="caai-") as work_name:
        work = Path(work_name)
        roots = {}
        for name, path in zips.items():
            roots[name] = work / path.stem
            extract_all(path, roots[name])

        point_frame = read_layer(roots[ZIP_CVFR], "F_CVFR_POINTS2026")
        route_frame = read_layer(roots[ZIP_CVFR], "F_CVFR_ROUTES2026")
        ctr_frame = read_layer(roots[ZIP_PRD], "CTR")
        prd_frame = read_layer(roots[ZIP_PRD], "F_Limited")
        tma_frame = read_layer(roots[ZIP_FIR], "TMA")
        fir_frame = read_layer(roots[ZIP_FIR], "FIR")
        rwy_frame = read_layer(roots[ZIP_FIR], "RUNWAYS")
        ctr_other = read_layer(roots[ZIP_FIR], "CTR")

        key = lambda f: sorted((clean(a), clean(b), clean(c), clean(d)) for a, b, c, d in zip(f["Code"], f["Name"], f["Min_Alt"], f["Max_Alt"]))
        if key(ctr_frame) != key(ctr_other):
            fail("the two CTR layers (PRD zip and FIR zip) differ; refusing to guess which is current")

        last_modified = max(
            str(v)[:10] for f, c in ((point_frame, "Modified"), (route_frame, "MODIFIED"), (ctr_frame, "Modified"),
                                     (prd_frame, "Modified"), (rwy_frame, "Modified"))
            for v in f[c].dropna()
        )

        corrections = apply_corrections(route_frame)
        points = build_points(point_frame)
        segments, gaps = build_segments(route_frame, points)
        airspaces, reconciled = build_airspaces(ctr_frame, prd_frame, tma_frame, fir_frame)
        runways = build_runways(rwy_frame)
        aerodromes, aerodrome_runways, aerodrome_frequencies = load_curated(args.curated)
        cross_check_aerodromes(aerodromes, points, runways)

    kinds = {}
    for a in airspaces:
        kinds[a["kind"]] = kinds.get(a["kind"], 0) + 1
    counts = {
        "reporting_points": len(points), "route_segments": len(segments),
        "ctr_atz": sum(kinds.get(k, 0) for k in ("CTR", "ATZ", "CTA")),
        "prd": sum(kinds.get(k, 0) for k in ("P", "R", "D")),
        "tma": kinds.get("TMA", 0), "fir": kinds.get("FIR", 0), "runways": len(runways),
    }
    counts["aerodromes"] = len(aerodromes)
    mismatches = ["%s: expected %d, found %d" % (k, v, counts[k]) for k, v in EXPECTED.items() if counts[k] != v]
    if mismatches:
        fail("counts differ from the AIP: " + "; ".join(mismatches))

    member_dates = {name: member_date(path) for name, path in sorted(zips.items())}
    source_data_date = max(member_dates.values())
    download_date = max(date.fromtimestamp(path.stat().st_mtime) for path in zips.values()).isoformat()
    attribution = ATTRIBUTION.format(data_date=display_date(source_data_date))
    if args.aip_amendment:
        attribution += ", AIP amendment " + args.aip_amendment

    duplicate_codes = sorted({p["code"] for p in points if sum(1 for q in points if q["code"] == p["code"]) > 1})
    kind_counts = {k: kinds[k] for k in sorted(kinds)}
    metadata = {
        "schema_version": str(SCHEMA_VERSION),
        "importer_version": str(IMPORTER_VERSION),
        "source": "Civil Aviation Authority of Israel (CAAI), GIS layers published with the domestic AIP",
        "source_urls": compact(SOURCE_URLS),
        "source_sha256": compact({name: sha256(path) for name, path in sorted(zips.items())}),
        "aip_amendment": args.aip_amendment,
        "effective_date": args.effective_date,
        "source_data_date": source_data_date,   # newest GDB zip member timestamp, all zips
        "source_member_dates": compact(member_dates),
        "download_date": download_date,         # newest modification time of the downloaded zips
        "data_last_modified": last_modified,    # newest Modified date in the layers
        "import_date": import_date,
        "attribution": attribution,
        "counts": compact(counts),
        "airspace_kinds": compact(kind_counts),
        "duplicate_point_codes": compact(duplicate_codes),
        "corrections": compact(corrections),
        "aerodromes_sha256": sha256(args.curated),
        "aerodromes_review": compact({s: sum(1 for a in aerodromes if a["review_status"] == s) for s in REVIEW_STATUSES}),
        "notes": ("Altitudes in feet MSL; floor 0 = surface; ceiling 99000 = unlimited. Route altitudes per direction "
                  "are derived from the CAAI north/south/east/west fields using the bearing from -> to. Values the "
                  "source publishes as two numbers ('2500/3500') are kept as text and have no numeric altitude."),
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_database(args.output, points, segments, airspaces, runways, aerodromes, aerodrome_runways, aerodrome_frequencies, metadata)

    unpublished = sum(1 for s in segments if s["alt_forward_text"] is None or s["alt_reverse_text"] is None)
    varying = [("%s-%s" % (s["from_code"], s["to_code"])) for s in segments
               if (s["alt_forward_text"] and s["alt_forward_ft"] is None) or (s["alt_reverse_text"] and s["alt_reverse_ft"] is None)]
    print("wrote %s (%d bytes)" % (args.output, args.output.stat().st_size))
    print("counts: %s" % counts)
    print("airspace kinds: %s" % kind_counts)
    print("duplicate point codes: %s" % duplicate_codes)
    print("corrections applied: %d" % len(corrections))
    print("segments with a direction unpublished: %d; varying text-only altitudes: %s" % (unpublished, varying))
    print("F_Limited type reconciled from designator: %s" % reconciled)
    print("segment ends >1 km from their point (accepted): %s" % gaps)
    print("attribution: %s; AIP amendment %s; layers modified %s; downloaded %s; import date %s" % (attribution, args.aip_amendment, last_modified, download_date, import_date))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ImportFailure as error:
        print("IMPORT FAILED: %s" % error, file=sys.stderr)
        sys.exit(1)
