# SIM-IL: Scripts and tests that simulate Israel flights (dashboard T35)

Owner request. Today:
- `tools/fly.sh` feeds only a US route (KPAO → KSQL → KOAK → KSFO) through `simctl location`, which carries
  latitude/longitude only: no altitude, no GPS loss.
- Agents testing the Israel features (route following, altitude cautions, CTR/border alerts, closures, debrief) each
  improvised throwaway debug hooks and seeded databases.
We need one reusable, deterministic way to fly Israel scenarios, both by hand in the simulator and in automated tests.

## Build
1. **Scenario generator:** `tools/flight-sim/`, Python with no extra dependencies beyond the stdlib plus sqlite3.
   - Reads `efb-212/Resources/israel-aviation.sqlite`: route segments with the published altitude per direction,
     points, airspaces, aerodromes.
   - Writes scenario JSON files: a list of fixes, each with t, lat, lon, altitude ft MSL, ground speed kt, course, and
     horizontal and vertical accuracy, plus optional events (GPS loss from t1 to t2, accuracy degraded).
   - Flight profile: taxi, takeoff roll, climb at a set rate to the first leg's published altitude, cruise legs at
     each leg's altitude for the direction flown, descent, landing, taxi.
   - Options: cruise speed; altitude deviation on chosen legs (e.g. +400 ft on leg 3); off-route offset (e.g. 1.5 NM
     right for 3 min); a detour into an area; GPS loss windows; a fixed start time, so closures and LSA weekend rules
     are reproducible.
   - Commit the generated scenarios under `tools/flight-sim/scenarios/`:
     1. `il-cvfr-llhz-llib-nominal`: on route, on altitude.
     2. `il-cvfr-llhz-llib-deviations`: altitude deviations and an off-route excursion.
     3. `il-ctr-entry`: enters a CTR (e.g. LLHZ or LLHA) and a restricted area.
     4. `il-border-approach`: approaches a border buffer, e.g. near Eilat/Egypt or the northern border, and enters it.
     5. `il-closed-leg`: flies toward a leg closed by a fixture NOTAM feed. Add a fixture `notams.json` that closes a
        leg on the route, fully, plus a partial one.
     6. `il-lsa-llbs-llrs`: sport-network flight on a weekday.
     7. `il-gps-loss`: a GPS loss mid-route, then recovery. Alerts must say "no position", not stay current.
     8. `us-kpao-ksql`: the old US route, with altitude, for parity.
2. **App: DEBUG-only scenario playback.**
   - A location source that replays a scenario JSON in real time (with a speed multiplier), including altitude and GPS
     loss. Wire it through the existing `LocationService` seam (`init(appState:updates:noFixGrace:)` from CQ-1), so
     production code paths run unchanged.
   - Enable it with a launch argument: `-OpenEFBScenario <name or path>`, plus `-OpenEFBScenarioSpeed 4`.
   - Optionally, `-OpenEFBNotamFixture <path>` makes IsraelNotamService read a local fixture feed.
   - Compiled only in DEBUG (`#if DEBUG`), never in Release. Add a unit test that the Release configuration has no
     scenario code path, or verify it by building Release.
3. **CLI:**
   - `tools/fly.sh israel <scenario> [--speed N] [--sim <udid or SIM_TAG>]` launches the app on the simulator with the
     launch arguments;
   - `tools/fly.sh list` shows the scenarios;
   - `tools/fly.sh stop` still works;
   - keep the old US behaviour as the default for compatibility.
   Document it in AGENTS.md "Build & Run" and in the paseo.json scripts (add a `fly-israel` script).
4. **Automated tests:**
   - **Unit/integration (Swift Testing, no simulator UI):** a scenario runner feeds each scenario's fixes through the
     real pipeline (LocationService with the injected stream, route following, IsraelAlert/Proximity, recording, CVFR
     debrief) using a test clock, then asserts the expected outcomes:
     - nominal: no off-route or altitude cautions; the legs sequence in order; the debrief shows adherence near 100%;
     - deviations: an altitude caution on the right leg, then off-route with the correct side and distance; the
       debrief flags those legs;
     - CTR, border, closed leg: the right alert severity (red/amber) and text;
     - GPS loss: the alerts switch to "no position" and resume after recovery;
     - LSA: routing and the weekend rule;
     - US parity.
     These run in the normal unit suite and must be fast (accelerated clock).
   - **One UI smoke test** (efb-212UITests, Swift 6): launch with `-OpenEFBScenario il-cvfr-llhz-llib-nominal
     -OpenEFBScenarioSpeed 20` and assert that the route bar shows the next reporting point, and that a deviation
     scenario surfaces the caution banner. Keep it short and stable, with no screenshot assertions.
5. Screenshots of a scenario playing (route bar, an alert) in docs/design/screenshots/SIM-IL/. Map-only shots without the
   official chart are fine to commit.

## Rules
Files you own: tools/flight-sim/**, tools/fly.sh, paseo.json (the new script), the DEBUG scenario source (new files),
the minimal launch-argument wiring, tests in efb-212Tests/Simulation/** and one UI test file.
Another agent (T34, iPhone support) is editing views and layout across the app now. Avoid view files; if you must touch
MapContainerView or app startup, re-read it right before editing and keep the change to a few lines. Don't touch
dist-prep/.

Full unit suite green; the UI smoke test passes. Follow docs/handoff/COMMON.md: use the iPad pool simulator with
`export SIM_TAG=$(tools/sim-test.sh claim SIMIL)` and release it. Don't create new simulators; reuse the pool. Don't
commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T35 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
