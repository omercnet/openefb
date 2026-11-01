# caai-importer

Builds `efb-212/Resources/israel-aviation.sqlite` from the GIS layers CAAI publishes with the Israeli domestic AIP.
CAAI approved redistribution of these layers (see `docs/research/israel-cvfr.md` §1 and `NOTICE`). The official CVFR
chart is **not** licensed: do not add it.

## Get the input

The gov.il WAF blocks `curl`; download in a browser from <https://www.gov.il/he/pages/aip?chapterIndex=11>
and save as these names in `tools/caai-importer/input/` (git-ignored):

| Saved as | CAAI file | Layers used |
|---|---|---|
| `CVFR2026.zip` | `CVFR2026.zip` (נתיבי תובלה נמוכים CVFR) | `F_CVFR_POINTS2026`, `F_CVFR_ROUTES2026` |
| `FIR-TMA-ACC-CTR.zip` | `שכבות FIR, TMA, ACC, CTR.zip` | `FIR`, `TMA`, `RUNWAYS` (and a second `CTR` copy) |
| `PRD-CTR.zip` | `אסורים לטיסה וCTRים.zip` | `F_Limited` (P/R/D), `CTR` |

The importer unpacks the nested zips itself. When CAAI publishes a new year, the file names carry the year ("2027");
rename the downloads to the names above and pass `--amendment` / `--effective-date`.

## Run

```bash
cd tools/caai-importer
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python import_caai.py --import-date "$(date -u +%F)"
```

The pinned `pyogrio` wheel bundles GDAL with the OpenFileGDB driver, so no system GDAL is needed.
If you prefer system GDAL (to inspect layers with `ogrinfo`): `brew install gdal`, then
`ogrinfo -so -al "input/.../New File Geodatabase.gdb"`. Note that `brew install gdal` compiles
several dependencies and can take close to an hour.

Options: `--input DIR`, `--output FILE`, `--aip-amendment 1/26`, `--effective-date 2026-08-06` (both only when you
have verified them against the layers), `--import-date YYYY-MM-DD` (also `SOURCE_DATE_EPOCH`).

**Repeatable.** Rows are sorted, ids assigned after sorting, coordinates rounded to 6 decimals (about 0.1 m),
JSON written with sorted keys. The same zips and the same `--import-date` give a byte-identical file
(`shasum -a 256` twice to check). The import date is the only value that changes between days.

## Validation (the run aborts with `IMPORT FAILED` and writes nothing)

- Counts must equal the AIP: 198 points, 275 route segments, 39 CTR/ATZ/CTA, 113 P/R/D, 9 TMA, 1 FIR, 42 runways.
- Curated aerodromes (see below): every ARP point and every GIS runway row must resolve to an aerodrome row; every
  value group needs a source; the CSV must parse. Run `.venv/bin/python -m unittest test_aerodromes -v` for the checks.
- Every segment endpoint code must be a point or ARP code.
- Each segment's line must end within 1 km of its two points (see *Source defects* for the exceptions).
- Point attribute coordinates (`E`/`N`) must match the reprojected geometry.
- The two copies of the `CTR` layer (in two zips) must be identical.

## What is in the database

All coordinates are WGS-84 (the layers are UTM 36N, EPSG:32636). Altitudes are feet MSL. Details in the `CREATE TABLE`
comments in `import_caai.py`.

| Table | Rows | Notes |
|---|---|---|
| `reporting_points` | 198 | `kind` compulsory / onRequest / arp; Hebrew and English names |
| `route_segments` | 275 | polyline from → to, bearing, civil/military/by-request, altitude per direction |
| `airspaces` | 162 | CTR, ATZ, CTA, TMA, P, R, D, FIR; floor/ceiling with reference; polygons |
| `runways` | 42 | designators and heading where the layer has them (23 rows); ends from the line |
| `metadata` | | amendment, effective date, source URLs and zip SHA-256, attribution, import date, corrections |
| `aerodromes` | 49 | curated airports, airstrips, heliports (IL-4): AIP position, elevation, circuit, hours, PPR, remarks, a source per value group, `review_status` |
| `aerodrome_runways`, `aerodrome_frequencies` | 52, 53 | designator, metres, surface, heading (true or magnetic); MHz, service, Hebrew call sign |
| `*_rtree` | | `reporting_points`, `route_segments`, `airspaces`, `runways`, `aerodromes`, columns `min_lat max_lat min_lon max_lon` |


## Curated aerodromes (IL-4)

`curated/aerodromes-il.csv` is checked in and merged by the importer (`--curated PATH` to override). One row per aerodrome:
ICAO code or short slug, Hebrew and English name, type, use (civil, military, uas, agricultural, hospital, foreign),
WGS-84 position, elevation (feet MSL), runways (`DES LxW surface [hdg a/b T|M]`, metres), frequencies
(`NNN.NNN service|Hebrew call sign`), circuit altitude (feet MSL) and direction, hours, PPR, remarks, one `source_*`
column per value group (AIP chapter and PDF page, eAIP section, CAAI GIS row, or OurAirports as a flagged fallback),
`uncertain` (field groups the curator doubts), `notes`, and `review_status` (`unreviewed` until the owner has checked it).

Sources: domestic AIP `פמ"ת מלא 1-26.pdf` (440 pages; chapter ד airports from p208, chapter ה airstrips from p292, ו
hospital pads from p402), eAIP AIRAC 2026-08-06 AD 2 for LLBG, LLHA, LLER, the CAAI GIS layers for military bases and
strips the AIP does not cover. The AIP PDF is not checked in (gov.il/Mapa terms); save it in `input/` to re-extract.

`review_sheet.py` writes `docs/research/israel-aerodromes-review.md` from the CSV: uncertain values first, every value
with its page. To mark a field reviewed, set `review_status` to `reviewed` in the CSV and re-run the importer; the app
drops its "Unreviewed data" note for that field.

### Decisions you should know about

- **Route direction.** CAAI publishes altitudes per compass direction (`N_A`/`S_A`, `W_Alt`/`E_Alt`; `X` = none).
  The drawn line of 67 segments runs second → first, and the `BEARING` field follows the drawn line, so the importer
  orients every polyline by its codes, computes the from → to bearing itself, and derives `alt_forward_*`
  (from → to) and `alt_reverse_*` from the axis the leg mostly follows. The raw four fields are kept.
- **Two-number altitudes** (`2500/3500`, 10 segments) are kept as text and have no numeric altitude; the app shows
  the text. Airspace limits written that way use the larger volume (lowest floor, highest ceiling) and keep the text.
- **Altitude reference.** The layers carry none. The AIP gives P/R/D and CTR limits as "ALT" (above mean sea level)
  with 0 = ground, so a floor of 0 is `SFC`, a ceiling of 99000 is `UNL` (unlimited) and everything else is `MSL`.
  LLR31 has no limits in the source and is stored without any.
- **Amendment.** The GDBs do not carry the AIP amendment, and their member dates (2026-10-14 to 2026-10-25) are
  later than amendment 1/26 (effective 2026-08-06), so it is not guessed: `aip_amendment` and `effective_date` are
  NULL unless passed on the command line. The database records `source_data_date` (newest zip member timestamp,
  per zip in `source_member_dates`), `download_date` (zip file date) and `data_last_modified` (newest `Modified`
  in the layers). The About line reads "…(CAAI), data of 25 Oct 2026", with ", AIP amendment N" appended only when known.
- **P/R/D type** is taken from the designator prefix (LLP/LLR/LLD) when the `Type` column is empty or says `LLD`
  (8 rows); the importer prints each reconciliation.

### Source defects

- `Hazerim-Ofakim` and `Hazerim-Tzalahot` list `LLHS` (Hazor, 57 km away); their lines end at Hazerim, `LLHB`. The
  importer rewrites the code and records the correction in `metadata.corrections`. A correction only applies while the
  source still has the defect.
- `Samar-Ovda` ends 11 km short of the Ovda ARP; accepted by name, listed on every run.
- `LLNV` appears twice as an ARP (Nevatim, Negav). Both rows are kept; segments point at the nearest one (Negav).
- Runway rows without an aerodrome code (23 of 42, mostly military fields) are kept; designators are filled where the layer has them.
