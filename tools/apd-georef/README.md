# apd-georef: batch georeferencing of FAA airport diagrams

Command-line tool that runs the app's airport-diagram georeferencer
(`efb-212/Services/AirportDiagramGeoreferencer.swift`, the same file the iPad app compiles) over every
airport diagram (APD) in a d-TPP cycle and reports how many fit, why the rest were rejected, and how
accurate the accepted fits are against the runway thresholds in the bundled `aviation.sqlite`.

The method (grid labels from the PDF text layer or Vision OCR, snapped to the vector grid lines, a
similarity fit with rotation limited to 0/90/180/270, drawn-runway extraction for scale and position
cross-checks, inset masking) is described at the top of the core file. The latest report is
`docs/design/apd-georef-report.md`.

## Build and run (macOS)

```
tools/apd-georef/build.sh                  # swiftc; output tools/apd-georef/apd-georef (git-ignored)
cd <repo root>
tools/apd-georef/apd-georef                # current cycle, all APDs, report to docs/design/apd-georef-report.md
tools/apd-georef/apd-georef --cycle 2611 --only KPAO,KBOS --inspect   # per-stage trace for a few airports
tools/apd-georef/apd-georef --render /tmp/apd-render                   # PNG per accepted fit with DB thresholds in red
```

Options: `--cycle YYNN` (default: computed from the 28-day schedule), `--db` (default
`efb-212/Resources/aviation.sqlite`), `--cache DIR` (default `/tmp/apd-cache`, PDFs are never committed),
`--report FILE`, `--json FILE` (every result with diagnostics), `--render DIR`, `--only A,B`, `--limit N`,
`--jobs N`, `--verbose`, `--inspect`, `--runway-tolerance FEET` (loosen the gate to measure the residual
distribution).

The metafile comes from `https://aeronav.faa.gov/d-tpp/{cycle}/xml_data/d-tpp_Metafile.xml` and PDFs from
`https://aeronav.faa.gov/d-tpp/{cycle}/{pdf_name}`; both are cached under `--cache`.

## The `us-diagrams` chart pack (M5)

`--pack DIR` also writes the pack the RN app downloads (owner decision Q6: georeferencing is computed offline, never on
the device). `PackWriter.swift` writes `DIR/<cycle>/`: `<ICAO>.png` (transparent ink, `--pack-scale`, default 2) and
`<ICAO>.json` (the georeference) for every accepted diagram, `index.json` (product `us-diagrams`, edition = the d-TPP
cycle, `accuracyFeet` = the runway gate) and `manifest.json` (`published: false`, bytes and sha256 per file, the input of
`web/charts/publish.sh`). Rejected diagrams are not in the pack (no FAA sheet PDFs: they would add hundreds of MB) and the
app draws nothing for them.

```
tools/apd-georef/apd-georef --cycle 2611 --pack /var/tmp/us-pack --report /var/tmp/apd-report.md
node tools/apd-georef/check-pack.mjs /var/tmp/us-pack/2611        # the app's format, manifest hashes, file sets
node --test tools/apd-georef/check-pack.test.mjs                  # tests of the checker
```

CI builds it without a Mac of your own: `.github/workflows/us-diagrams.yml` (sample on pull requests, full pack by
`workflow_dispatch`, artifact only). Publishing is the owner's step, see `docs/CI.md`.

`prototype.swift` is the original throwaway research prototype (~70% success); it is kept for reference only.
