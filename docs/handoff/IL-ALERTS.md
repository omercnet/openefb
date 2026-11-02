# IL-ALERTS: Israel in-flight route following and alerts (dashboard T21; beads efb-aac.8 remainder, efb-aac.9)

Background: docs/research/israel-cvfr.md §2 (rules: border buffers, CVFR altitudes, squawk) and §8 (jobs). The Israel
planner (Services/IsraelRoutePlanner.swift) produces legs with the published altitude per direction. Activating a plan
feeds the existing navigation: the T21 Direct-To/route bar `Views/Map/ActiveNavigationBar.swift`, and DTG/ETE in the
instrument strip.

## 1. Route following (rest of efb-aac.8)
- With an Israel plan active, show:
  - the **active leg** (FROM → TO codes);
  - the **published altitude** for this leg in the direction flown;
  - the **next reporting point** with its distance and ETA (local time);
  - the leg after it.
  Glanceable, in-flight sizing (≥60pt controls), minimal animation.
- **Auto-sequencing:** move to the next leg when passing abeam or within 0.5 NM of the TO point; allow a manual "next" or
  "previous".
- **Off-route caution (amber):** cross-track distance beyond a threshold (default 1 NM, configurable), with the
  distance and side ("0.8 NM right of route").
- **Altitude caution (amber):** GPS altitude more than ±300 ft from the leg's published altitude for longer than 30 s.
  Two-number altitude text means compare against both. Suppress it in the climb after takeoff and the descent before
  landing, i.e. within 3 NM of the departure or destination aerodrome.

## 2. Israel alerts (efb-aac.9)
Follow the COMMON.md colour rule: red = warning, amber = caution. Alerts must be glanceable and must not stack into
noise; keep one banner area with the highest priority on top.
- **Closed route on the plan:**
  - before flight: in the plan validation (the planner may already flag this; verify);
  - in flight: when a NOTAM closure (`IsraelNotamService`, IL-6/NOTAM-2 model) newly covers a leg ahead. Full closure
    red; partial amber with the available altitude.
- **Prohibited/restricted/danger areas and CTRs:** caution when the projected track (2 min ahead) enters a P/R/D or
  CTR within its vertical limits.
  - Red when inside a prohibited area; amber for restricted/danger, and for a CTR with no clearance (we can't know
    clearance, so phrase it as a reminder, "Entering Herzliya CTR: contact TWR 122.2").
  - Reuse the US ProximityAlertService patterns, including altitude awareness (T19), deterministic debounce and MIL
    flags.
  - Data: `IsraelAviationDatabase` airspaces.
- **Border buffers:** no flight within 6 km of the Gaza Strip border (LLP19), 3 km of Egypt, 6 km of Syria, 3 km of
  Lebanon, plus the 33°00'N rule (A-17 §4b, PDF p63; research §2).
  - Warning (red) inside a buffer; caution (amber) within 1 NM of one, or on a 2-min projection into it.
  - The buffer geometry: use the CAAI P-area polygons where they exist (LLP19 etc.); otherwise build buffers from a
    public-domain border line (Natural Earth admin-0, public domain) and document the source and accuracy.
  - Never claim more precision than the data has.
- **Squawk reminder:** on departure in the Israel region (ground speed above 40 kt after being on the ground), a
  one-time reminder to squawk the CVFR code the AIP specifies. Verify the code in the AIP text (research says 5100);
  if you can't verify it, show "Set the CVFR squawk per AIP".
- All alerts are region-gated (Israel only); the US alert behaviour is unchanged.

## Tests
Leg sequencing, cross-track and side, altitude deviation with suppression windows, closure-on-leg transitions, buffer
and area entry projection, debounce, squawk once.

## Rules
Files you own: ActiveNavigationBar and new Israel route-following views, ProximityAlertService (Israel paths) or a new
IsraelAlertService, the alert banner, and buffer geometry data/resources.
Other agents in parallel:
- FIX-1 owns the MapService route colour, IsraelFlightPlanMessage and the FPL preview;
- IL-BRIEF owns the NOTAM briefing view and weather;
- IL-DEBRIEF owns Debrief and Recording;
- IL-DIAG2 owns AirportDiagram* and the top-left map badge stack.
Re-read MapContainerView and MapService before every edit; they're shared.

Full unit suite green. Simulator screenshots (use `tools/fly.sh`-style GPX/location feeds over Israel) in
docs/design/screenshots/IL-ALERTS/: the route-following bar, an off-route caution, a CTR caution, a border warning, a
closed-leg alert. Follow docs/handoff/COMMON.md (claim a simulator with
`export SIM_TAG=$(tools/sim-test.sh claim ALERTS)` and release it). Close nothing; don't commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T21 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
