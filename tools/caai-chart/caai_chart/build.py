"""Build one edition: georeference, validate placement, tile, validate completeness, write the pack + manifest + review."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from . import validate
from .review import build_review, edition_diff
from .sheets import load_sheet, sha256_file
from .tiler import MBTiles, build_mbtiles

PRODUCT = "israel-cvfr"
ATTRIBUTION = "Chart (c) Civil Aviation Authority of Israel (CAAI). Base map (c) Mapa Ltd."
HERE = Path(__file__).resolve().parent.parent
DEFAULT_DB = HERE.parent.parent / "efb-212" / "Resources" / "israel-aviation.sqlite"


def edition_id(edition: dict) -> str:
    return f"{edition['year']}-{edition['amendment']:02d}"


def edition_label(edition: dict) -> str:
    month = f" ({edition['month']} {edition['year']})" if edition.get("month") else ""
    return f"Update {edition['amendment']}/{str(edition['year'])[2:]}{month}"


def _now_iso(explicit: str | None) -> str:
    if explicit:
        return explicit
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    t = datetime.fromtimestamp(int(epoch), timezone.utc) if epoch else datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def run(args: argparse.Namespace) -> int:
    t0 = time.time()
    log = lambda m: print(f"[{time.time() - t0:6.1f}s] {m}", flush=True)
    sources = []
    if args.aip_pdf:
        pdf = Path(args.aip_pdf)
        specs = [("north", pdf, args.north_page - 1), ("south", pdf, args.south_page - 1)]
        sources.append({"name": pdf.name, "sha256": sha256_file(pdf), "pages": {"north": args.north_page, "south": args.south_page}})
    else:
        specs = [("north", Path(args.north), 0), ("south", Path(args.south), 0)]
        for name, p, _ in specs:
            sources.append({"name": p.name, "sha256": sha256_file(p), "pages": {name: 1}})
    log("loading sheets and fitting the printed graticule")
    sheets = [load_sheet(n, p, i) for n, p, i in specs]
    editions = {s.name: s.edition for s in sheets}
    if not all(editions.values()) or editions["north"] != editions["south"]:
        print(f"edition imprint missing or different on the two sheets: {editions}", file=sys.stderr)
        return 2
    edition = editions["north"]
    eid = edition_id(edition)
    out_dir = Path(args.out) / eid
    out_dir.mkdir(parents=True, exist_ok=True)
    log(f"edition {eid} {edition_label(edition)}")

    points = validate.load_points(Path(args.db))
    log("matching CAAI reporting points to printed symbols (placement + accuracy)")
    acc = validate.measure_accuracy(sheets, points)
    validate.apply_refinement(sheets, acc)
    log(f"  matched {acc.matched}/{acc.checkable}; median {acc.median_m:.0f} m, p95 {acc.p95_m:.0f} m, max {acc.max_m:.0f} m; shifts {acc.shifts}")

    pack_name = f"{PRODUCT}-{eid}.mbtiles"
    pack = out_dir / pack_name
    log(f"tiling z{args.min_zoom}-{args.max_zoom} as {args.format}")
    stats = build_mbtiles(
        sheets, pack, min_zoom=args.min_zoom, max_zoom=args.max_zoom, tile_size=args.tile_size, fmt=args.format,
        quality=args.quality, log=log,
        metadata={"name": f"CAAI CVFR {edition_label(edition)}", "description": "Official CAAI CVFR low-level routes chart, 1:250,000",
                  "attribution": ATTRIBUTION, "version": eid})
    log(f"pack {pack.stat().st_size / 1e6:.1f} MB, {sum(stats.count_by_zoom.values())} tiles")

    mb = MBTiles(pack)
    log("checking completeness")
    comp = validate.measure_completeness(sheets, mb, Path(args.db), args.max_zoom, args.tile_size)
    failures = acc.failures + comp.failures
    passed = not failures
    validated_at = _now_iso(args.validated_at)
    size = pack.stat().st_size
    downloaded = args.downloaded or datetime.fromtimestamp(Path(specs[0][1]).stat().st_mtime, timezone.utc).strftime("%Y-%m-%d")
    manifest = {
        "product": PRODUCT,
        "edition": eid,
        "edition_label": edition_label(edition),
        "edition_label_he": f"עדכון {edition['amendment']}/{str(edition['year'])[2:]}",
        "attribution": ATTRIBUTION,
        "source_pdfs": sources,
        "download_date": downloaded,
        "bounds": [round(v, 6) for v in stats.bounds],
        "min_zoom": args.min_zoom,
        "max_zoom": args.max_zoom,
        "tile_size": args.tile_size,
        "format": args.format,
        "tile_count": sum(stats.count_by_zoom.values()),
        "size_bytes": size,
        "tile_checksum": stats.tile_checksum,
        "files": [{"name": pack_name, "bytes": size, "sha256": sha256_file(pack)}],
        "validation": {
            "passed": passed,
            "failures": failures,
            "limits": {"p95_m": validate.P95_LIMIT_M, "max_m": validate.MAX_LIMIT_M,
                       "graticule_rms_m": validate.GRATICULE_RMS_LIMIT_M, "content_shift_m": validate.SHIFT_LIMIT_M},
            "accuracy": {"points_checkable": acc.checkable, "points_matched": acc.matched, "median_m": round(acc.median_m, 1),
                         "p95_m": round(acc.p95_m, 1), "max_m": round(acc.max_m, 1), "method": "10-fold cross-validated"},
            "unmatched": [u["code"] for u in acc.unmatched],
            "seam": {"points": len(acc.seam), "median_m": round(acc.seam_median_m, 1), "max_m": round(acc.seam_max_m, 1)},
            "graticule": {k: {kk: round(vv, 3) for kk, vv in v.items()} for k, v in acc.graticule.items()},
            "content_shift": {k: {kk: (round(vv, 1) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in acc.shifts.items()},
            "completeness": {"sheets": comp.sheets_present, "places_sampled": comp.sampled, "uncovered": len(comp.uncovered), "hidden_by_inset": len(comp.hidden_by_inset),
                             "hidden_by_inset_places": sorted({u["what"] for u in comp.hidden_by_inset}),
                             "on_collar": len(comp.collar), "blank_tiles": len(comp.blank_tiles),
                             "fir_area_coverage": round(comp.fir_area_coverage, 4)},
        },
        "validated_at": validated_at,
        "published": False,
    }
    prev = None
    editions_dirs = sorted(d for d in Path(args.out).iterdir() if d.is_dir() and d.name < eid and (d / f"{PRODUCT}-{d.name}.mbtiles").exists())
    if editions_dirs:
        prev = editions_dirs[-1] / f"{PRODUCT}-{editions_dirs[-1].name}.mbtiles"
    log("review page")
    diff = edition_diff(prev, mb, out_dir, min(9, args.max_zoom), args.tile_size)
    build_review(out_dir, mb, manifest, acc, comp, args.tile_size, args.max_zoom, diff)
    mb.close()
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    (out_dir / "accuracy.json").write_text(json.dumps(acc.rows, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    log(f"{'PASSED' if passed else 'FAILED'}: {out_dir}")
    for f in failures:
        print("  gate failure:", f)
    return 0 if passed else 1


def stage_local(args: argparse.Namespace) -> int:
    """Lay an edition out the way the R2 host does, for local app testing (python3 -m http.server)."""
    src = Path(args.edition_dir)
    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    eid = manifest["edition"]
    dest = Path(args.base) / PRODUCT / eid
    dest.mkdir(parents=True, exist_ok=True)
    for f in manifest["files"]:
        shutil.copy2(src / f["name"], dest / f["name"])
        f["path"] = f"{PRODUCT}/{eid}/{f['name']}"
    manifest["published"] = bool(args.as_published) or manifest["published"]
    if args.as_published:
        manifest["publishedAt"] = manifest["validated_at"]
    (dest / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    index = {"product": PRODUCT, "updatedAt": manifest["validated_at"], "latest": eid if manifest["published"] else None,
             "editions": [{"edition": eid, "published": manifest["published"], "publishedAt": manifest.get("publishedAt"),
                           "validatedAt": manifest["validated_at"]}]}
    (Path(args.base) / PRODUCT / "manifest.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"staged {eid} under {Path(args.base) / PRODUCT} (published={manifest['published']})")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="caai_chart")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build and validate an edition")
    src = b.add_mutually_exclusive_group(required=True)
    src.add_argument("--aip-pdf", help="the full domestic AIP PDF; sheets are taken from --north-page/--south-page")
    src.add_argument("--north", help="north sheet PDF (page 1); needs --south")
    b.add_argument("--south")
    b.add_argument("--north-page", type=int, default=113)
    b.add_argument("--south-page", type=int, default=114)
    b.add_argument("--db", default=str(DEFAULT_DB))
    b.add_argument("--out", default=str(HERE / "out"))
    b.add_argument("--min-zoom", type=int, default=7)
    b.add_argument("--max-zoom", type=int, default=12)
    b.add_argument("--tile-size", type=int, default=256, choices=[256, 512])
    b.add_argument("--format", default="webp", choices=["webp", "png"])
    b.add_argument("--quality", type=int, default=88)
    b.add_argument("--downloaded", help="YYYY-MM-DD the source PDF was downloaded (default: file date)")
    b.add_argument("--validated-at", help="ISO timestamp for the manifest (default: SOURCE_DATE_EPOCH or now)")
    st = sub.add_parser("stage-local", help="lay an edition out like the R2 host for local app testing")
    st.add_argument("edition_dir")
    st.add_argument("--base", required=True)
    st.add_argument("--as-published", action="store_true", help="dev tree only: mark published so the app accepts it")
    args = ap.parse_args(argv)
    if args.cmd == "build":
        if not args.aip_pdf and not args.south:
            ap.error("--north needs --south")
        return run(args)
    return stage_local(args)


if __name__ == "__main__":
    sys.exit(main())
