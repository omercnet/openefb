# REL-FIX: Fix the app's reliability gaps before beta (dashboard T31)

The source is docs/RELIABILITY.md, from the release-it review (CQ-7). The beads have the evidence and file:line
references (`bd show <id>`). The app scored 1.5/7 on the release-it quick diagnostic. Before TestFlight we need: every
outbound call bounded, nothing stale shown as current, failures visible, and a sensible cache fallback.
COMMON.md rule: never show stale or unvalidated data as current.

## Batch A: now
- **efb-zfm.10 (P1):** chart pack downloads use `URLSession.shared`, with a 7-day resource timeout and no retry. Use a
  dedicated session with sensible request and resource timeouts, resume on retry with backoff, and a visible error with
  Retry.
- **efb-zfm.11 (P1):** TFR and AIRMET/SIGMET age shows only inside the layer panel; stale snapshots draw on the map
  unmarked. Mark stale overlays on the map itself: the age badge in the map badge stack (IL-DIAG2 built it in
  Views/Map; reuse it) and a visual stale treatment (dashed or faded, with "OLD"). Past their validity, hide them
  instead of showing them as current.
- **efb-zfm.12 (P2):** the Israel NOTAM stale copy is memory-only, so after an offline relaunch there are no closures.
  Persist the last good feed with its age and show it as stale.
- **efb-zfm.13 (P2):** no periodic refresh of weather/TFR/AIRMET during a long flight. Refresh on an interval suited to
  each product, battery-aware, and only when the network is reachable.
- **efb-zfm.15 (P2):** FAA NOTAM API: no stale fallback, up to 20 sequential pages, and the badge uses the fetch time.
  Add a cache fallback, a page cap and time budget, and base the badge on data time.
- **efb-zfm.16 (P2):** d-TPP and diagram PDFs are trusted on file existence; there's no expiry warning in ChartPDFView,
  and the overlay swallows failures. Check the cycle and expiry, show "expired" honestly, and surface failures.
- **efb-zfm.17 (P3):** installed chart pack integrity is checked by size only at load. Re-verify the SHA-256 lazily, or
  on first load after install and update.
- **efb-zfm.18 (P3):** basemap tile failures have no visible indicator. Show a small "map tiles offline" indicator when
  tile loads fail repeatedly.
- **efb-8lm (P2):** proximity alerts: a database error clears alerts silently, so "no alert" and "check failed" look the
  same. Fail visibly (amber "airspace check unavailable"), never fail open silently. Flip the characterization test if
  CQ-1 pinned it.

## Batch B: after IL-BRIEF (T20) finishes
IL-BRIEF owns weather formatting until T20 shows done (`paseo-progress show`).
- **efb-zfm.14 (P2):** a weather failure is silent when a cached METAR exists, and the TAF has no age badge.
- **efb-bgb (P2):** the weather fetch error and Retry are hidden when a stale cached METAR exists.
- **efb-dv5 (P2):** an offline batch fetch drops expired stations instead of serving them with an age badge.
- **efb-8d4 (P3):** a TAF without a validity end never reads EXPIRED; the TAF isn't shown with a badge.

## Rules
- Behaviour fixes flip their characterization tests (efb-212Tests/CharacterizationTests) in the same change.
- Update docs/RELIABILITY.md: the status per finding, and re-score the app diagnostic.
- Files you own: the chart/diagram pack services, MapService overlay staleness, IsraelNotamService persistence,
  NotamService (FAA), ChartPDFView and the diagram overlay error paths, ProximityAlertService, and the WeatherService
  refresh (batch B for the formatting).
- Other agents now: IL-BRIEF (weather formatting, NOTAM briefing), IL-LSA (the planner and the importer), CQ-FIX (the
  aviation DB install, location, offline map status, SwiftData, recording). Don't edit their files; re-read shared ones
  (MapService, MapContainerView) before every edit.

Full unit suite green. Screenshots in docs/design/screenshots/REL-FIX/: a stale TFR on the map, a chart download error
with Retry, "airspace check unavailable". Follow docs/handoff/COMMON.md (claim a simulator with
`export SIM_TAG=$(tools/sim-test.sh claim RELFIX)` and release it). Close nothing; don't commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T31 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
