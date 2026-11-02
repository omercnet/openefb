# caai-chart

Converts the official CAAI CVFR chart (domestic AIP B-03 appendix A, "מפת נתיבי תובלה נמוכים", north and south
sheets, 1:250,000, WGS-84, vector PDF) into one MBTiles pack for all of Israel, validates it against CAAI's own
coordinates, and prepares it for hosting on our servers. The app downloads this pack from us, never from gov.il.
The chart is (c) CAAI; the base map is (c) Mapa Ltd. Nothing in this folder publishes anything by itself: **build locally; the
owner uploads and approves** (`publish.sh`, below). Edition 2025-02 is published on R2 (`publishedAt` 2026-11-01); this repository records no CAAI/Mapa permission for the chart, so check with the owner before publishing another edition.

## Input

Both sheets are pages of the full domestic AIP PDF (amendment 1/26: pages 113 north, 114 south), which
`tools/caai-importer` already downloads. gov.il blocks non-browser clients, so download in a browser and save as
`tools/caai-chart/input/aip-1-26.pdf` (a symlink to `../caai-importer/input/aip-1-26.pdf` works). `input/` is
git-ignored. If CAAI publishes the sheets as separate PDFs (`aip_ב'-03 CVFR צפוני-.pdf`, `... דרומי.pdf`), use
`--north FILE --south FILE` instead of `--aip-pdf` (the sheet is page 1 of each file).

## Run

```bash
cd tools/caai-chart
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m caai_chart build --aip-pdf input/aip-1-26.pdf
# options: --max-zoom 12 --tile-size 256 --format webp --quality 88 --downloaded 2026-11-01 --validated-at <ISO>
```

About 2.5 minutes. Output in `out/<edition>/` (git-ignored); the edition id comes from the sheet imprint
("עדכון 2/25" -> `2025-02`):

| File | What |
|---|---|
| `israel-cvfr-<edition>.mbtiles` | the pack, z7 to z12, WebP, 256 px, TMS rows (MBTiles standard) |
| `manifest.json` | edition, source PDF SHA-256s and download date, bounds, zooms, size, tile checksum, validation results, `validated_at`, `published: false` |
| `review.html` + PNGs | owner review page: overview with CAAI points and error vectors, worst 12 points, gate results, edition diff |
| `accuracy.json` | per-point error table |

**Deterministic.** Same input and `--validated-at` give a byte-identical pack and manifest (tiles are written in
z/x/y order with fixed encoder settings; `tile_checksum` covers every tile). `validated_at` defaults to
`SOURCE_DATE_EPOCH`, else now.

**Edition diff.** Build the next edition into the same `out/` folder: the review page compares z9 tiles against the
newest earlier edition and shows before / after / difference thumbnails of the most changed tiles.

## How it works

1. **Graticule.** The sheets carry a printed lat/lon graticule (long thin grey lines, 10' spacing, labelled in the
   margins). `graticule.py` chains the strokes into polylines, drops the Tel Aviv inset's own grid, and labels each line
   from the margin text.
2. **Projection.** `georef.py` fits a transverse Mercator with a free central meridian plus a similarity transform to
   every graticule vertex (cross-track residual in metres). Fit: 9.5 m rms on the north sheet, 15 m on the south
   (printed lines are 3-vertex polylines, so sub-pixel agreement is not expected). Both sheets fit TM about lon0 35.2
   degrees (the Israeli TM grid); the fit is insensitive to lon0 over this extent, which is fine.
   The scale comes out at 87.9 m per PDF point (north) and 88.2 m (south) against 88.19 m nominal for 1:250,000.
3. **Content offset.** The printed graticule and the printed symbols disagree by a constant per sheet: the content sits
   50 m west (north sheet) and 164 m east (south sheet) of its graticule. `validate.py` estimates that translation
   (2 parameters per sheet, robust median over about 130 and 60 reporting points) and applies it, so the chart lines up
   with the CAAI vector overlay the app draws on top. The offsets are reported in the manifest; a changed edition that
   shifts by more than 250 m fails the gate.
4. **Mask.** Legends, tables, cover blocks and the enlarged-area inset are masked (transparent, so the street base
   shows through): white-filled rectangles over 30,000 pt^2 plus the 1 pt cover boxes, and the irregular inset
   polygon. The street base shows in those holes.
5. **Tiling.** Per zoom, each sheet is rasterised at 1.5x the tile resolution and bilinear-sampled per tile pixel
   through the inverse projection; the sheets are merged at the middle of their overlap band (about 31.33 N) with
   alpha compositing, so a masked area on one sheet falls back to the other. Tiles are WebP (lossy, quality 88); fully
   opaque tiles are RGB, edge tiles RGBA. z12 is the native resolution at 256 px (32 m per pixel; the source is
   88 m per point). Higher zooms only enlarge the same printed line work (`--max-zoom 13` is 4x the size, about 60 MB;
   MapLibre over-zooms the pack past its max zoom anyway).

## Validation gate (the point of hosting it ourselves)

The build exits non-zero and writes `validation.passed: false` when any check fails; the app never installs such an
edition, and `publish.sh --approve` refuses it.

**Accuracy, against all CAAI reporting points** (`efb-212/Resources/israel-aviation.sqlite`, read-only). The sheets
are vectors, so each printed reporting-point triangle is exact geometry: for every compulsory / on-request point we find
the nearest printed triangle within 6 pt (about 530 m) of its predicted position and take its centroid as the printed
position. (Verified: the triangle centroid is the reference point; the median offset from the CAAI coordinate is under
30 m once the sheet offset is removed, and a bounding-box centre is 1.6 pt off in y.) Error = geodesic distance between
the CAAI coordinate and the printed symbol under our georeference, **10-fold cross-validated** (the sheet offset used for
each point is estimated without that point's fold), so a bad chart cannot hide behind its own correction. The 25
aerodrome reference points are circles with a runway symbol, not triangles, so they are only checked for coverage.

Result on the amendment 2/25 chart: 170 of 173 checkable points matched (RANNO, SIRNI, ZRANA have no printed
triangle near their predicted position; 25 ARP points not checked; 198 total); median 56 m, p90 135 m, **p95 187 m**,
max 329 m (LLMZ).

**Thresholds.** The brief proposed p95 150 m and max 300 m before there was data. Measured on the real chart, the
error is dominated by the chart's own drafting, not our transform: one PDF point is 88 m on the ground, a printed
line is 0.2 mm (50 m), and symbol centres vary by about 0.7 pt rms (about 60 m per axis), which puts the p95 of a 2-D
Rayleigh error at roughly 150 to 190 m before any transform error. Our transform is checked separately and tightly. So
the gate is:

| Check | Limit | Measured |
|---|---|---|
| graticule fit rms (our transform) | 30 m | 9.5 m north, 15.2 m south |
| content offset from graticule | 250 m | 50 m north, 164 m south |
| cross-validated p95 (chart drafting) | 200 m | 187 m |
| cross-validated max | 350 m | 329 m |
| points matched of checkable | 80% | 98% |

The p95 and max limits are calibrated to this chart's measured floor with little headroom (13 m and 21 m). If the
owner wants the original 150 / 300 m, change `P95_LIMIT_M` and `MAX_LIMIT_M` in `validate.py`; the current chart would
then fail, which would be a statement about CAAI's drafting, not about the pack.
Seam: 21 points appear on both sheets; their two printings disagree by a median 84 m, max 310 m (reported, not gated).

**Completeness.** Both sheets present. About 3,270 required places (all 198 CAAI points, all 84 runway ends, a vertex
every kilometre along all 275 CVFR routes) must have an opaque tile pixel that is not blank paper. Zero blank tiles at
max zoom. Places hidden under the masked enlarged-area inset are listed separately (`hidden_by_inset`) and allowed up
to 3%. On this build: 0 uncovered, 0 on collar, 0 hidden. FIR area covered by chart pixels is 82.5% (the rest is
mostly sea under the inset, legends and Egyptian/Jordanian territory beyond the sheets).

Not checked: runway ends and CTR corners against printed geometry (runways are drawn without a vector symbol that
can be matched reliably; CTR corners are not marked). Cheap follow-up if the owner wants it.

## Publish (owner only)

`publish.sh <edition>` is a thin wrapper around `web/charts/publish.sh` (Cloudflare R2; egress is free; set-up in
`web/charts/README.md`). It never runs from the build. The default target is the local R2 simulator.

```bash
tools/caai-chart/publish.sh 2025-02 --remote --base-url https://<public-host>        # upload, published=false
tools/caai-chart/publish.sh 2025-02 --remote --base-url https://<public-host> --manifest-only --approve   # go live
```

Public layout: `<base>/israel-cvfr/manifest.json` (index with `latest` = newest published edition),
`<base>/israel-cvfr/<edition>/manifest.json`, `<base>/israel-cvfr/<edition>/israel-cvfr-<edition>.mbtiles`.
Wrangler's upload limit is 300 MiB per file; the pack is 15 MB. Other static hosts work with the same layout (S3,
Vercel Blob); the app only needs the layout and the SHA-256 in `files[]`.

## Local app testing

```bash
.venv/bin/python -m caai_chart stage-local out/2025-02 --base /tmp/il9-host --as-published   # dev tree only
cd /tmp/il9-host && python3 -m http.server 8000
```

The app's default base URL is the R2 dev bucket; launch it with `-israelChartBaseURL http://127.0.0.1:8000` to use the local tree. Settings > Offline
Maps > Israel official chart downloads it. `--as-published` only touches the staged copy; the built manifest stays
`published: false`.
