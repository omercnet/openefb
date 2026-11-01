# caai-apd: georeferencing the official CAAI aerodrome diagrams (IL-13)

Runs the app's airport-diagram georeferencer (`efb-212/Services/AirportDiagramGeoreferencer.swift`, the same
core that `tools/apd-georef` and the iPad app compile) over the Israeli aerodrome charts and produces the
`il-diagrams` pack. The charts are (c) CAAI; the owner is arranging permission, so build locally and do not publish.

Israeli diagrams carry no lat/lon graticule, so the grid method does not apply. The core fits scale and rotation
from the drawn runway polygons and picks the translation from one runway. This tool then refits scale and
translation by least squares over all matched runways and applies the US gates: every runway within 50 ft
(cross-track, along-track and midpoint) and within 5% of the database length. Control truth is the CAAI GIS runway
ends in `efb-212/Resources/israel-aviation.sqlite` (`runways`).

A diagram is georeferenced only with at least two independently matched runways. A single runway fixes scale and
position from the same two points that would validate them, so it cannot be checked: it stays "sheet only".

## Inputs (not committed)

`tools/caai-apd/input/` (gitignored): eAIP AD 2 PDFs from `https://e-aip.azurefd.net/<AIRAC>/graphics/eAIP/` and the
domestic AIP PDF (`https://www.gov.il/BlobFolder/guide/aip/he/פמת מלא 1-26.pdf`), whose chapter ד/ה chart pages were
split into `AIP-D-<ICAO>-p<page>.pdf` single-page files. `control.json` lists every chart: ICAO, file, title,
language, printed scale, source URL, optional north-arrow rotation check, optional hand-picked `maskRects`
(PDF points: tables, legends, insets punched out of the image).

## Build and run (macOS, repo root)

```
tools/caai-apd/build.sh
tools/caai-apd/caai-apd                         # all charts -> tools/caai-apd/out/<edition>/
tools/caai-apd/caai-apd --only LLBG --inspect   # per-runway residuals
tools/caai-apd/caai-apd --dev-runway-tolerance 80   # DEV ONLY, see below
```

## Output (`out/<edition>/`, gitignored)

`<ICAO>.pdf` for every chart (the "sheet only" fallback), plus `<ICAO>.png` and `<ICAO>.json` (an
`AirportDiagramGeoreference`, decoded by the app's overlay) for georeferenced ones; `index.json` (per-aerodrome status,
chart title, language, scale, reason; what the app reads first); `manifest.json` (product `il-diagrams`, edition,
sha256 per file, `published: false`, validation; the `--manifest` input of `web/charts/publish.sh --product il-diagrams`);
`results.json` (every chart with its residuals or rejection reason).

`--dev-runway-tolerance FEET` loosens the gate to produce a pack for wiring and screenshots. It writes to
`out/dev-<edition>/` and sets `validation.passed = false`, so the app's `isServable` rejects it unless the developer
setting for unpublished editions is on. Never publish a dev pack.
