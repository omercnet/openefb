# T11 finish: georeferenced airport diagrams (dashboard ticket T11; beads efb-22s)

The previous agent built most of this and was stopped mid-iteration. Original brief: docs/handoff/T11.md. Read the
current code first:
- efb-212/Services/AirportDiagramGeoreferencer.swift (shared core, ~1,540 lines)
- efb-212/Services/AirportDiagramOverlay.swift
- efb-212Tests/ServiceTests/AirportDiagramGeoreferencerTests.swift + efb-212Tests/Fixtures/
- tools/apd-georef/ (main.swift, build.sh, the batch CLI)
- `bd show efb-22s` (its design notes)

## State on 2026-11-01 (full suite: 478 tests, 5 georef failures)
- `kpaoFitsFromTextLabelsAndMatchesTheRunway`, `georeferenceRoundTripsThroughJSON`: "runway cross-check failed (102 ft)"
- `bosFitsFromOCRLabelsWithRunwayCrossCheckAndInsetMask`, `bosRenderPunchesOutTheInsetAndKeepsRunwaysOpaque`: "(201 ft)"
- `kpaoGridLabelsAreSnappedToGridLines`: the debug dump doesn't contain "RESULT ok"
The cross-check tolerance is 50 ft (`Tolerances.runwayFeet`).

## What to do
1. Find out why KPAO misses by 102 ft and BOS by 201 ft. Candidates:
   - a regression from the last change (e.g. the refinement that adds runway midpoints);
   - label snapping;
   - comparing the drawn pavement end to DB thresholds (displaced thresholds);
   - imprecise bundled-DB runway coordinates (the bundled DB comes from OurAirports, not NASR).
   Measure; don't guess. For KPAO, the earlier prototype placed the DB thresholds within a few points of the drawn runway ends (~10 ft/pt).
   - If the DB coordinates are the limit, make the cross-check compare what is comparable: runway centreline offset and heading rather than end points, or use a tolerance justified by measured DB error. Document it in `bd update efb-22s --notes`.
   - Never loosen the gate just to pass the tests. A wrong overlay must still be rejected: keep the corrupted-fit rejection test.
2. Get the batch tool to run over the current cycle's APDs (cache PDFs in /tmp/apd-cache). Write docs/design/apd-georef-report.md with:
   - the pass rate;
   - failure reasons by category;
   - an accuracy histogram vs runway centrelines.
   Iterate to ≥ 90%, or document the measured ceiling and why. Add the report as a dashboard deliverable (ticket T11).
3. Visual proof in the simulator at KPAO and KSQL, zoom ~15, north-up and track-up. The overlay must be aligned and under the ownship and airport symbols. Save screenshots to docs/design/screenshots/T11/ and add them as deliverables.
4. Delete the throwaway UI tests you don't need (efb-212UITests/*TmpTests.swift that belong to T11: AirportDiagramTmpTests.swift).

Follow docs/handoff/COMMON.md, especially the simulator rules: only `tools/sim-test.sh`, never create or boot simulators.
