# IL-DEFAULT: Default to Israel; move the chart dropdown into Settings (dashboard T33)

Owner request, before the first TestFlight build.

## 1. Default region = Israel
- New installs start in the Israel region: `Region` default in UserSettings / AppState (Core/Region.swift and
  UserSettings). Existing installs keep whatever the user chose. If a stored value exists, don't override it; only the
  default for a fresh store changes.
- The first launch lands on the Israel home view, and onboarding still works. Check anything that assumed US first:
  - demo/screenshot paths;
  - `tools/sim-test.sh demo`, which may set KPAO;
  - dist-prep/screenshots notes. Don't recapture store screenshots, but note in dist-prep/README.md that the default is
    now Israel.
- **Tests:** the default region for a fresh store is Israel; a stored US choice is kept. Update the tests that assumed a
  US default; most set the region explicitly, so check.

## 2. Chart dropdown off the map
The top-left map badge stack ("CHART: Not downloaded ⌄", "DIAGRAMS: ±100 ft · LLBG …", built in IL-DIAG2) should not be
on the main screen. Move the chart and diagram source and edition information into **Settings, under the Region
section**:
- **Region section (Israel):**
  - "Official CAAI CVFR chart": edition and date, or "Not downloaded", with a Download / Update / Delete action using
    the existing IsraelChartStore flows;
  - "Aerodrome diagrams": edition, accuracy ±100 ft, the placed aerodromes, and Download / Update;
  - the CAAI data attribution that's already there.
  Link to Offline Maps for the street packs.
- **Map:** remove the chart and diagram rows and the dropdown.
- **Keep safety-relevant staleness on the map:** the TFR/AIRMET "OLD" badge, the NOTAM stale state, GPS status and any
  "data unavailable" warnings stay where REL-FIX and earlier tickets put them. Never show stale data as current
  (COMMON.md). If the badge container only holds staleness warnings now, keep it minimal and show it only when there's
  a warning.
- When the official chart isn't downloaded in Israel, the map shows the street base with the full CVFR overlay (the
  existing fallback), with no badge. Settings > Region is where to get the chart. Add one non-intrusive, dismissible
  hint per install on the first Israel launch ("Download the official CAAI chart in Settings › Region"), so testers
  find it.

## Verify
Full unit suite green. Simulator screenshots in docs/design/screenshots/IL-DEFAULT/:
- a fresh install landing in Israel;
- the map with no chart badge;
- the first-launch hint;
- Settings > Region with chart and diagram rows, before and after the download, day and night.
Screenshots showing the official chart artwork go to a gitignored path (see .gitignore).

Another agent (ICON) is editing only the app icon asset catalog and tools/app-icon/. Don't touch those. Follow
docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim DEF)` and release it). Don't
commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T33 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Never end your turn on an intention.
