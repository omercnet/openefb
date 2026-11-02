# IL-DIAG2: More Israeli diagrams, the badge layout, and the CAAI data-fix email (dashboard T23; beads efb-aac.17, efb-2e7)

Background: docs/design/caai-apd-report.md, tools/caai-apd, and the published pack `il-diagrams` 2026-08 on R2 (18 files;
LLBG and LLHA placed, 11 sheet-only).

## 1. Rotated charts
LLIB (Rosh Pina) failed only because its chart is drawn rotated 82° from north-up, beyond the 10° limit.
- Add rotation support to the fit in `tools/caai-apd`, without changing the US core behaviour or its tests.
- Re-run every aerodrome under the same 100 ft gate plus the independent ARP check (owner decision Q6 = B). Report
  which, if any, now pass.
- Check the app overlay draws a rotated georeference correctly (the four corners, not just bounds); fix
  `AirportDiagramOverlay` if it assumes north-up.

## 2. No runway polygon
LLER, LLBS and LLKZ failed with "no runway polygon in the vector stream".
- Look at whether the runway is drawn as stroked lines, hatched fills or text-only on those sheets, and extend the
  extractor if it's tractable.
- LLER's sheet is an apron chart; look for a proper aerodrome chart in the eAIP AD 2.24 list for LLER.
- Record the findings either way.

## 3. Badge layout
In the Israel map, the diagram badge ("CAAI aerodrome diagrams … ±100 ft") and the "Official chart not downloaded" badge
stack in the top-left and collide. Design one compact badge stack (top-left, below the search/route buttons) that shows
data sources and freshness without covering map content:
- one line per source;
- tap to expand;
- legible day and night.
Edit only the badge container in Views/Map; the IL-ALERTS agent owns the alert banners and the navigation bar.

## 4. Data-fix email to CAAI (draft only, owner sends)
Write docs/research/israel-caai-data-fixes.md: a short email in Hebrew, then English, to the CAAI AIS address in
docs/research/israel-caai-permission-request.md, marked DRAFT. It should:
- thank them for the approval;
- report the GIS defects from efb-2e7 (`bd show efb-2e7`): the LLHS typo on the Hazerim routes, the duplicate LLNV ARP,
  and the Samar–Ovda line ending 11 km short;
- report the AIP inconsistencies the Hebrew review found: LLKZ runway 1600 m in the p365 table vs 1500 m on the p368
  chart, and anything else in docs/research/hebrew-review/adjudication.md;
- ask for the surveyed threshold and ARP coordinates for LLHZ and the other single-runway fields (list them, with the
  measured offsets from caai-apd-report.md);
- ask which source is authoritative where the LLBG GIS runway ends and the AD 2.12 thresholds disagree by 24–69 m.
Keep it concise and polite, with no unverified claims.

## 5. Pack
If any new diagram passes, rebuild the `il-diagrams` pack as a new edition with `published: false`. Don't upload
anything; the integrator publishes after review.

## Rules
Full unit suite green; the US diagram tests are unchanged. Screenshots in docs/design/screenshots/IL-DIAG2/ (these are
gitignored like IL-13 if they show CAAI artwork, so put them under docs/design/screenshots/IL-13/ or another gitignored
path): the badge stack day and night, plus any newly placed diagram.
Files you own: tools/caai-apd/**, AirportDiagram*, the Israel diagram store, the top-left map badge container, and
docs/design/caai-apd-report.md.
Other agents work in parallel (FIX-1, IL-BRIEF, IL-ALERTS, IL-DEBRIEF); re-read shared files before editing. Follow
docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim DIAG2)` and release it). Close
nothing; don't commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T23 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
