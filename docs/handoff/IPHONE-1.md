# IPHONE-1: iPhone support, audit and core flows (dashboard T34)

Owner request: the iPad stays the primary device, but OpenEFB should also run usefully on iPhone. Today
`TARGETED_DEVICE_FAMILY = 2` (iPad only), and every layout was designed and reviewed for iPad.

## Scope ("some support")
On iPhone, a pilot must be able to:
- see the moving map with ownship, the instrument strip, GPS status and the staleness and alert banners;
- use NRST with Direct-To and the route/Direct-To bar;
- open an airport sheet (weather, frequencies, runways, NOTAMs/briefing, charts as PDF);
- start, stop and review a recording (History, Replay, debrief);
- read and edit the logbook;
- use Settings, including Region and the chart downloads;
- complete onboarding.
Israel planning (the legs table, the FPL preview) and the NOTAM briefing must be usable on iPhone, even if they're less
roomy: scrolling lists rather than wide tables.

Out of scope for this ticket: iPhone App Store screenshots, and iPhone-specific features. Everything works in portrait;
landscape on iPhone is a nice-to-have.

## Rules (the EFB lens from COMMON.md still applies)
- In-flight controls ≥60pt, even on iPhone. Prefer fewer, larger controls over many small ones: collapse secondary map
  controls into one menu on compact width.
- Glanceable instrument strip; no truncated numbers. On compact width, drop to the key fields (GS, ALT, TRK, plus
  DTG/ETE when a route is active) rather than shrinking the type.
- Red = warning, amber = caution. Never show stale data as current. Alerts must stay visible and must not hide the
  ownship.
- Use size classes (`horizontalSizeClass`), not device checks. The iPad layouts must stay exactly as they are. Verify the
  iPad visually after the change.

## Steps
1. **Project:** set `TARGETED_DEVICE_FAMILY = "1,2"` for the app target (and the test targets, if needed to run on an
   iPhone simulator). Add `INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone` (portrait, plus landscape if it
   works). Make sure the app icon still compiles: the single 1024 icon covers iPhone too. Check the Info.plist for
   iPad-only keys.
2. **Simulator tooling:** let `tools/sim-test.sh` claim an iPhone simulator through a `SIM_DEVICE` env var (default stays
   the iPad Pro 13-inch). Create one iPhone simulator (iPhone 17 Pro) for the pool, plus a small one (iPhone 17e) for
   the narrowest width. Reuse them; never delete simulators. Document it in AGENTS.md "Build & Run" and COMMON.md.
3. **Audit:** run every screen on the iPhone simulator (Israel and US regions) and screenshot each into
   docs/design/screenshots/IPHONE/ (CAAI chart artwork goes to a gitignored path). Write `docs/design/IPHONE.md`: one
   row per screen with what breaks and its severity (0–4).
4. **Fix** every severity 3–4 issue in the core flows above, and severity 2 where it's cheap. Before/after screenshots.
5. Run the full unit suite. Add a unit test only where the layout logic is testable, e.g. which strip fields show on
   compact width.

Another agent may be fixing a small Settings duplicate (the "Offline Maps" row) right now; re-read Settings files before
editing them. Don't touch dist-prep/ or the upload script; the integrator owns them. Don't commit. Report the audit table,
what you fixed, and what's left as beads (file them under epic efb-zfm with label iphone).

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T34 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
