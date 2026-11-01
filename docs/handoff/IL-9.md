# IL-9: Official CAAI CVFR chart, converted, validated and hosted by us (dashboard ticket T09; beads efb-aac.10)

Owner decision (Q5): the Israel base chart is the official CAAI CVFR chart. We convert it, validate it, and host it on
our servers; the app downloads chart packs from us, never from gov.il. This lets us test each edition before pilots get
it. The chart is © CAAI, with the base map © Mapa Ltd. The owner is handling permission with CAAI, so don't publish
anything publicly yourself: build locally, and leave uploading to the owner.

Source (docs/research/israel-cvfr.md §3):
- domestic AIP B-03 appendix A, "מפת נתיבי תובלה נמוכים";
- north and south sheets, 1:250,000, WGS-84, vector PDF;
- direct links on gov.il chapter ב: `aip_ב'-03 CVFR צפוני-.pdf`, `aip_ב'-03 CVFR דרומי.pdf`, legend `aip_ב'-03CVFR אחורי.pdf`.
The gov.il WAF blocks non-browser clients, so download with the browser into `tools/caai-chart/input/` (gitignored).

## Part A: Pipeline, `tools/caai-chart/` (Python; reuse the IL-1 pyogrio venv approach)
1. Rasterize each sheet (PyMuPDF) at a resolution that gives crisp text at the top zoom. Pick it from evidence:
   1:250k gives roughly z11–z12 native.
2. **Georeference:** find the sheet's lat/lon graticule (border ticks and grid) and fit a transform per sheet. The
   sheets are WGS-84, but the projection must be identified (check the legend sheet). Mask the collar, legend and
   insets so only map content is tiled. Merge north and south where they overlap.
3. **Tile:** to XYZ PNG (or WebP if MapLibre iOS renders it) for z7 to the native max, and pack them as MBTiles. That
   gives one pack for all of Israel.
4. **Validation gate** (the point of hosting it ourselves):
   - **Accuracy:** for every CVFR reporting point in `efb-212/Resources/israel-aviation.sqlite` (198, exact CAAI
     coordinates), locate its printed triangle near the predicted pixel and measure the error.
     - Report the median, p95 and max in metres.
     - Fail the build if p95 is over 150 m or any point is over 300 m. Justify the thresholds against 1:250k drafting
       precision, and adjust them only with evidence.
     - Also check runway ends and CTR corners if that's cheap.
   - **Completeness:** no blank or collar tiles inside the FIR land area, and both sheets present.
   - **Review page:** an HTML or PNG overview for the owner: the chart with CAAI points overlaid, error vectors, and
     before/after edition diff thumbnails.
5. **Output** in `tools/caai-chart/out/<edition>/`:
   - `israel-cvfr-<edition>.mbtiles`;
   - `manifest.json`: edition id from the sheet imprint (e.g. "עדכון 2/25"), source PDF SHA-256s and download date,
     bounds, zooms, size, tile checksum, validation results, `validated_at`, and `published: false`;
   - the review page.
   Make it deterministic for the same input.
6. **Publish script:** `publish.sh` uploads the pack and manifest to a configurable static host and flips
   `published: true` only after the owner runs it with `--approve`. Default to Vercel Blob, alongside services/il-notam;
   document R2 or S3 as alternatives. Don't run it.

## Part B: App
- In the Israel region the base chart is "CAAI CVFR (official)" from our manifest URL (configurable; default to a local
  dev URL for testing). Our CVFR vector drawing from IL-3 stays as an overlay on top of it.
- **Download flow:** reuse the offline-maps UX (T05/T22).
  - Settings > Offline Maps offers "Israel CVFR chart, edition X, N MB", with progress, resume, and a checksum verify
    against the manifest.
  - Store it as an MBTiles file and serve it to MapLibre locally, following the existing offline pattern.
- **Edition status:**
  - show the edition and its date in the chart badge;
  - say when a newer validated edition is available;
  - never show an unvalidated or unpublished edition, except in a dev setting;
  - if no pack is downloaded, use the street base, and say "Official chart not downloaded".
- Tests: manifest decode, checksum mismatch rejected, an unpublished edition ignored, edition-update detection, and the
  fallback state.
- Screenshots in docs/design/screenshots/IL-9/: central Israel at two zooms with the overlay, the Negev, the download
  screen, and the edition badge. Serve the pack locally to the simulator (`python3 -m http.server`).

## Coordination
- The IL-3 agent is finishing the overlay in Services/Map* and Views/Map. Do Part A first. Start Part B's map
  integration only after I message you that IL-3 is done; the download/manifest service code can start any time in new
  files.
- The IL-4 agent owns aerodromes in Data/IsraelAviation* and the importer's curated/ directory. Use
  israel-aviation.sqlite read-only.
- You own tools/caai-chart/**, new Services/IsraelChart* files and the Israel offline-download UI.

Full unit suite green. Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim IL9)`
and release it). Close nothing; report the validation numbers, pack size, edition, and anything the owner must do.
Never end your turn on an intention.
