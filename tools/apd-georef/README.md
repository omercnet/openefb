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

`prototype.swift` is the original throwaway research prototype (~70% success); it is kept for reference only.
