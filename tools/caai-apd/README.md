# caai-apd: georeferencing the official CAAI aerodrome diagrams (IL-13)

Runs the app's airport-diagram georeferencer (`efb-212/Services/AirportDiagramGeoreferencer.swift`, the same
core that `tools/apd-georef` and the iPad app compile) over the Israeli aerodrome charts and produces the
`il-diagrams` pack. The charts are (c) CAAI, who approved their in-app use. Build locally; the owner uploads and approves with `web/charts/publish.sh`. Edition 2026-08b is published on R2 (`publishedAt` 2026-11-02).

Israeli diagrams carry no lat/lon graticule, so the grid method does not apply. The core fits scale and rotation
from the drawn runway polygons and picks the translation from one runway. This tool then refits scale and
translation by least squares over all matched runways and applies the Israeli gate (owner decision Q6): every
runway within 100 ft (cross-track, along-track and midpoint; the US keeps 50 ft in the core) and within 5% of the
database length. Control truth is the CAAI GIS runway ends in `efb-212/Resources/israel-aviation.sqlite` (`runways`).

A single-runway field can't check itself, so it also needs the printed ARP symbol (a circle with a cross beside an
"ARP" label) to land within 100 ft plus the AIP's 1 arc-second rounding (61.5 m N-S, 56.5 m E-W) of the AIP ARP.
Its rotation comes from the GIS runway bearing and must be within 10 degrees of north-up. No ARP symbol, or one
outside the box, means "sheet only". Never placed without an independent check. Coverage: docs/design/caai-apd-report.md.

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

`--dev-runway-tolerance FEET` overrides the runway gate (not the ARP check) to produce a pack for wiring tests. It writes
to `out/dev-<edition>/` and sets `validation.passed = false`. Never publish a dev pack.
