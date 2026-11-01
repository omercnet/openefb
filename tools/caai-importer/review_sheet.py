#!/usr/bin/env python3
"""Render curated/aerodromes-il.csv as a Markdown review sheet for the owner.

Writes docs/research/israel-aerodromes-review.md. Stdlib only, deterministic
output (same CSV -> byte-identical file).

Usage: python3 tools/caai-importer/review_sheet.py
"""

import csv
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CSV_PATH = os.path.join(HERE, "curated", "aerodromes-il.csv")
OUT_PATH = os.path.join(REPO, "docs", "research", "israel-aerodromes-review.md")

WARN = "\u26a0\ufe0f"
TRUNC = 220

# Curator note -> field group. Checked in this order; first match wins when
# none of the matching groups is flagged uncertain.
NOTE_RULES = [
    ("runways", re.compile(r"runway|\bRWY\b|heading|width|magnetic|designator", re.I)),
    ("frequencies", re.compile(r"frequenc|MHz", re.I)),
    ("circuit", re.compile(r"circuit", re.I)),
    ("hours", re.compile(r"hour|illegible", re.I)),
    ("elevation_ft", re.compile(r"elevation|\bELEV\b", re.I)),
    ("identity", re.compile(r"\bARP\b|coordinate", re.I)),
]


def cell(text):
    """Make text safe for a Markdown table cell."""
    return " ".join(text.split()).replace("|", "\\|")


def truncate(text, limit=TRUNC):
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[: limit - 3]
    if " " in cut:
        cut = cut[: cut.rindex(" ")]
    return cut.rstrip(" ,;(") + "..."


def dms(value, pos, neg, deg_width):
    v = abs(value)
    total = int(round(v * 3600))
    d, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    hemi = pos if value >= 0 else neg
    return "%0*d\u00b0%02d'%02d\"%s" % (deg_width, d, m, s, hemi)


def arp_text(row, with_dms):
    if not row["lat"] or not row["lon"]:
        return "-"
    lat, lon = float(row["lat"]), float(row["lon"])
    text = "%s, %s" % (row["lat"], row["lon"])
    if with_dms:
        text += " (%s %s)" % (dms(lat, "N", "S", 2), dms(lon, "E", "W", 3))
    return text


def split_identity_source(src):
    """source_identity may carry '; elevation <source>'. Return (arp, elev)."""
    arp_parts, elev_parts = [], []
    for part in [p.strip() for p in src.split(";") if p.strip()]:
        if part.lower().startswith("elevation "):
            elev_parts.append(part[len("elevation "):])
        else:
            arp_parts.append(part)
    arp = "; ".join(arp_parts)
    elev = "; ".join(elev_parts) if elev_parts else arp
    return arp, elev


def is_ourairports(src):
    return "ourairports" in src.lower()


def short_ref(src):
    """Compact inline ref for the consistent table, e.g. '(p293,294)'."""
    if not src:
        return ""
    refs = []
    for part in [p.strip() for p in src.split(";") if p.strip()]:
        if is_ourairports(part):
            refs.append("OurAirports " + WARN)
            continue
        pages = re.search(r"\bp(\d[\d,\-]*)", part)
        sect = re.search(r"\u00a7\s*([\d.\-]+)", part)
        if part.startswith("eAIP") and sect:
            refs.append("eAIP \u00a7" + sect.group(1))
        elif pages:
            refs.append("p" + pages.group(1))
        elif part.startswith("CAAI GIS"):
            refs.append("GIS")
        else:
            refs.append(part)
    return "(" + "; ".join(refs) + ")"


def doc_label(src):
    if not src:
        return None
    if src.startswith("AIP 1/26"):
        m = re.match(r"AIP 1/26 (ch\.\S+)", src)
        return "AIP 1/26 " + m.group(1) if m else "AIP 1/26"
    if src.startswith("eAIP"):
        m = re.match(r"(eAIP AIRAC \S+)", src)
        return m.group(1) if m else "eAIP"
    if src.startswith("CAAI GIS"):
        return "CAAI GIS"
    return src


def split_list(text):
    return [p.strip() for p in text.split(";") if p.strip()] if text else []


def freq_text(item, compact):
    num, _, rest = item.partition(" ")
    service, _, callsign = rest.partition("|")
    if compact:
        service = truncate(service, 30)
    parts = [num]
    if service:
        parts.append(service)
    text = " ".join(parts)
    if callsign:
        text += " / " + callsign
    return text


def circuit_text(row):
    alt, direction = row["circuit_altitude_ft"], row["circuit_direction"]
    if not alt and not direction:
        return ""
    if alt and direction:
        return "%s ft; %s" % (alt, direction)
    return "%s ft" % alt if alt else direction


def ppr_text(row):
    text = row["ppr"] or "-"
    if row["ppr_text"]:
        text += ": " + row["ppr_text"]
    return text


def uncertain_groups(row):
    return [g.strip() for g in row["uncertain"].split(",") if g.strip()]


def notes_of(row):
    return [n.strip() for n in row["notes"].split("|") if n.strip()]


def assign_notes(row):
    """Map each curator note to field groups; unmatched -> 'other'."""
    flagged = set(uncertain_groups(row))
    out = {}
    for note in notes_of(row):
        matches = [g for g, rx in NOTE_RULES if rx.search(note)]
        targets = [g for g in matches if g in flagged][:1] or matches[:1] or ["other"]
        for g in targets:
            out.setdefault(g, []).append(note)
    return out


def check_section(row, lines):
    flagged = set(uncertain_groups(row))
    notes = assign_notes(row)
    warn_count = 0
    arp_src, elev_src = split_identity_source(row["source_identity"])

    # (field, value, source, group); group None = not a checkable group.
    entries = [("ARP", arp_text(row, True), arp_src, "identity"),
               ("Elevation", (row["elevation_ft"] + " ft") if row["elevation_ft"] else "-",
                elev_src, "elevation_ft")]
    rwys = split_list(row["runways"]) or ["-"]
    for i, r in enumerate(rwys):
        entries.append(("Runway" if len(rwys) == 1 else "Runway %d" % (i + 1),
                        r, row["source_runways"], "runways"))
    freqs = split_list(row["frequencies"]) or ["-"]
    for i, f in enumerate(freqs):
        entries.append(("Frequency" if len(freqs) == 1 else "Frequency %d" % (i + 1),
                        f if f == "-" else freq_text(f, False),
                        row["source_frequencies"], "frequencies"))
    entries.append(("Circuit", circuit_text(row) or "-", row["source_circuit"], "circuit"))
    entries.append(("Hours", row["hours"] or "-", row["source_hours"], "hours"))
    entries.append(("PPR", ppr_text(row), row["source_remarks"], None))
    entries.append(("Remarks", row["remarks"] or "-", row["source_remarks"], None))

    lines.append("### %s - %s / %s (%s, %s)" % (
        row["code"], row["name_he"], row["name_en"], row["type"], row["use"]))
    lines.append("")
    lines.append("Uncertain: %s" % ", ".join(uncertain_groups(row)))
    lines.append("")
    lines.append("| Field | Value | Source | Check |")
    lines.append("|---|---|---|---|")
    noted = set()
    for field, value, src, group in entries:
        check = []
        if group in flagged:
            check.append(WARN)
            warn_count += 1
        if is_ourairports(src):
            check.append("Not an official source (OurAirports).")
        if group in notes and group not in noted:
            noted.add(group)
            check.extend(notes[group])
        lines.append("| %s | %s | %s | %s |" % (
            field, cell(value), cell(src) or "-", "<br>".join(cell(c) for c in check)))
    if "other" in notes:
        lines.append("| Other note | - | - | %s |" % "<br>".join(cell(n) for n in notes["other"]))
    lines.append("")
    return warn_count


def consistent_row(row):
    arp_src, elev_src = split_identity_source(row["source_identity"])
    arp = "%s %s" % (arp_text(row, False), short_ref(arp_src))
    elev = "%s %s" % (row["elevation_ft"] or "-",
                      short_ref(elev_src) if row["elevation_ft"] else "")
    rwys = split_list(row["runways"])
    rwy = "<br>".join(rwys) + " " + short_ref(row["source_runways"]) if rwys else "-"
    freqs = [freq_text(f, True) for f in split_list(row["frequencies"])]
    frq = "<br>".join(freqs) + " " + short_ref(row["source_frequencies"]) if freqs else "-"
    circ = row["circuit_altitude_ft"]
    if circ:
        circ = "%s ft %s" % (circ, short_ref(row["source_circuit"]))
    else:
        circ = "-"
    hours = row["hours"]
    if not hours:
        hours = "-"
    elif len(hours) > 40:
        hours = "see below %s" % short_ref(row["source_hours"])
    else:
        hours = "%s %s" % (hours, short_ref(row["source_hours"]))
    docs = []
    for key in ("source_identity", "source_runways", "source_frequencies",
                "source_circuit", "source_hours", "source_remarks"):
        for part in split_list(row[key]):
            label = "OurAirports " + WARN if is_ourairports(part) else doc_label(part)
            if label and label not in docs:
                docs.append(label)
    if row["source_remarks"]:
        docs.append("rmk " + short_ref(row["source_remarks"]))
    vals = [row["code"], row["name_he"], row["name_en"], row["type"] + "/" + row["use"],
            arp, elev.strip(), rwy, frq, circ, hours, row["ppr"] or "-", "; ".join(docs)]
    return "| " + " | ".join(cell(v) for v in vals) + " |"


def remark_bullet(row):
    parts = []
    if row["hours"] and len(row["hours"]) > 40:
        parts.append("Hours: " + truncate(row["hours"]))
    if row["circuit_direction"]:
        parts.append("Circuit: " + truncate(row["circuit_direction"]))
    if row["remarks"]:
        parts.append("Remarks: " + truncate(row["remarks"]))
    if row["ppr_text"]:
        parts.append("PPR: " + truncate(row["ppr_text"]))
    if not parts and not row["notes"]:
        return []
    out = ["- **%s**" % row["code"]]
    for p in parts:
        out.append("  - " + p)
    notes = notes_of(row)
    if notes:
        out.append("  - Curator notes: " + truncate(" | ".join(notes)))
    return out


def main():
    with open(CSV_PATH, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    rows.sort(key=lambda r: r["code"])

    check = [r for r in rows if uncertain_groups(r)]
    check.sort(key=lambda r: (-len(uncertain_groups(r)), r["code"]))
    rest = [r for r in rows if not uncertain_groups(r)]

    body = []
    warn_total = 0
    for r in check:
        warn_total += check_section(r, body)

    lines = [
        "# Israeli aerodromes: owner review sheet",
        "",
        "DRAFT: unreviewed data, not for navigation",
        "",
        "Generated by `tools/caai-importer/review_sheet.py` from "
        "`tools/caai-importer/curated/aerodromes-il.csv`. Do not edit by hand; re-run the script.",
        "",
        "- Page refs like `p293` are PDF page numbers of `\u05e4\u05de\"\u05ea \u05de\u05dc\u05d0 1-26.pdf` "
        "(domestic AIP amendment 1/26, 440 pages); `eAIP \u00a72.12` is the English eAIP section.",
        "- To mark an aerodrome reviewed: set `review_status` to `reviewed` in the CSV, "
        "then re-run `tools/caai-importer/import_caai.py`.",
        "- %s marks a value the curator is unsure about; the Check column quotes the curator's note."
        % WARN,
        "- Counts: %d aerodromes, %d with at least one warning, %d warning values."
        % (len(rows), len(check), warn_total),
        "",
        "## Check these first",
        "",
        "Ordered by number of uncertain field groups, then code.",
        "",
    ]
    lines.extend(body)

    lines.append("## Looks consistent (still unreviewed)")
    lines.append("")
    lines.append("No field flagged by the curator. Long text (hours, remarks, PPR) and "
                 "curator notes are in the list under the table.")
    lines.append("")
    lines.append("| Code | Hebrew | English | Type | ARP lat,lon | Elev ft | Runways | "
                 "Frequencies | Circuit | Hours | PPR | Sources |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in rest:
        lines.append(consistent_row(r))
    lines.append("")
    lines.append("### Remarks")
    lines.append("")
    for r in rest:
        lines.extend(remark_bullet(r))
    lines.append("")

    lines.append("## Sources")
    lines.append("")
    lines.append("- Domestic AIP (Hebrew), amendment 1/26: `\u05e4\u05de\"\u05ea \u05de\u05dc\u05d0 1-26.pdf` "
                 "(local copy `tools/caai-importer/input/aip-1-26.pdf`). Chapter \u05d3 airports, "
                 "chapter \u05d4 airstrips (incl. \u05de\u05e0\u05d7\u05ea\u05d9\u05dd \u05e0\u05d5\u05e1\u05e4\u05d9\u05dd), "
                 "chapter \u05d5 hospital helipads.")
    lines.append("- English eAIP, AIRAC 2026-08-06, AD 2 (LLBG, LLER, LLHA); "
                 "text copies in `docs/research/israel-cvfr-samples/`.")
    lines.append("- CAAI GIS geodatabase layers published with the AIP (RUNWAYS, F_CVFR_POINTS2026); "
                 "used where no AIP chapter exists (military, foreign, closed/restricted strips).")
    lines.append("- OurAirports (public domain): fallback only, not an official source.")
    lines.append("")
    fallback = []
    for r in rows:
        fields = [k for k in ("source_identity", "source_runways", "source_frequencies",
                              "source_circuit", "source_hours", "source_remarks")
                  if is_ourairports(r[k])]
        if fields:
            fallback.append("- %s %s (%s): %s" % (
                WARN, r["code"], r["name_en"],
                "; ".join("%s = %s" % (k, r[k]) for k in fields)))
    lines.append("### Rows using OurAirports (%d)" % len(fallback))
    lines.append("")
    lines.extend(fallback or ["- none"])
    lines.append("")

    text = "\n".join(lines).rstrip("\n") + "\n"
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print("aerodromes=%d with_warnings=%d warning_values=%d lines=%d -> %s" % (
        len(rows), len(check), warn_total, text.count("\n"), os.path.relpath(OUT_PATH, REPO)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
