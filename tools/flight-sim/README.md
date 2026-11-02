# flight-sim: deterministic flight scenarios

One reusable way to fly Israel (and US) scenarios, by hand in the simulator and in automated tests (dashboard T35).

- `gen.py` (Python 3, stdlib + sqlite3) reads `efb-212/Resources/israel-aviation.sqlite` and writes a scenario JSON.
- `make.sh` regenerates the committed scenarios in `scenarios/`. `fixtures/notams-closed-leg.json` is the fixture NOTAM feed.
- The DEBUG build replays a scenario through `LocationService` (`efb-212/Services/Simulation/`); the unit suite flies the
  same files through the real pipeline (`efb-212Tests/Simulation/`).

## Scenario file

`fixes[]`: `t` (s since start), `lat`, `lon`, `alt` (ft MSL), `gs` (kt), `crs` (deg true), `hAcc`, `vAcc` (m), `leg` (route
leg index; -1 before the route, `legs.count` after). `route.legs[]` carry the segment id, published altitude for the
direction flown, and the polyline, so the app builds the active route without a planner. `events[]` say what the generator
injected (`altitudeDeviation`, `offRoute`, `gpsLoss`, `accuracyDegraded`); `expect` records the intended outcome;
`startTime` is fixed, so closures and the LSA weekend rule are reproducible (2026-11-04 is a Wednesday).

Profile: taxi, take-off roll, climb at 500 fpm to the first leg's altitude, cruise legs at each leg's published altitude
for the direction flown (a change between legs is flown half a change early, at 1000 fpm), descent inside 2.8 NM of the
field, landing, taxi.

## Generating

```bash
python3 tools/flight-sim/gen.py --name my-flight --network cvfr --from LLHZ --to LLIB \
  --alt-dev 6:400            # +400 ft on leg 6
  --offset 9:1.5:R:180       # 1.5 NM right of route for 180 s on leg 9
  --gps-loss 1156:1200        # no fixes from t=1156 to t=1200
  --accuracy 600:700:120     # hAcc 120 m between t=600 and t=700
  --speed 100 --start 2026-11-04T08:00:00+02:00
# direct path (no network): --from LLES --to LLHA --via 32.658,35.013 --cruise-alt 1500
# LSA: --network lsa --from LLBS --to LLRS --weekday-only
```

## Flying in the simulator (DEBUG build only)

```bash
tools/fly.sh list
tools/fly.sh israel il-cvfr-llhz-llib-deviations --speed 4 [--start 1000] [--notams FILE] [--sim <udid|SIM_TAG>]
tools/fly.sh stop
```

This launches the app with `-OpenEFBScenario <name or path>`, `-OpenEFBScenarioSpeed N`, `-OpenEFBScenarioStart S` and
`-OpenEFBNotamFixture <path>`; `il-closed-leg` gets its fixture automatically (its dates are moved to the scenario).
Fix timestamps are wall clock (the GPS-lost rule is 5 real seconds); route following and the alerts use the scenario clock,
which runs `speed` times faster. A GPS loss shows as "no position" only if it lasts longer than 5 x speed seconds.
The scenario code is compiled only in DEBUG (`#if DEBUG`); `ScenarioHooks` in a Release build returns the production values.
