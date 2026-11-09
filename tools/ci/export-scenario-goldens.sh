#!/usr/bin/env bash
# Export the flight-sim scenario goldens for the React Native scenario harness (ticket S0).
#   tools/ci/export-scenario-goldens.sh
# Runs efb-212Tests/Simulation/ScenarioGoldenExport (the production pipeline on a virtual clock, the path
# ScenarioFlightTests asserts on) twice into two directories and fails unless the 8 files are byte-identical.
# Env: OUT (default /tmp/efb-goldens), RESULT (xcresult path), DD and SIM_TAG as in tools/sim-test.sh.
# Why not the simulator playback of tools/ci/fly-scenarios.sh: that one runs on wall-clock time at SPEED x and only
# asserts "the app stays up", so its log is not reproducible; the virtual-clock run is.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
OUT=${OUT:-/tmp/efb-goldens}
rm -rf "$OUT"
for pass in 1 2; do
  export TEST_RUNNER_OPENEFB_GOLDEN_DIR="$OUT/run$pass"
  tools/sim-test.sh test -only-testing:efb-212Tests/ScenarioGoldenExport
done
names() { (cd "$1" && find . -maxdepth 1 -name '*.json' -exec basename {} \; | sort); }
count=$(names "$OUT/run1" | wc -l | tr -d ' ')
diff <(names tools/flight-sim/scenarios) <(names "$OUT/run1") >/dev/null || {
  echo "export-scenario-goldens: goldens do not match tools/flight-sim/scenarios one to one (is the scenario in goldenScenarios in ScenarioGoldenExport.swift?)" >&2
  diff <(names tools/flight-sim/scenarios) <(names "$OUT/run1") >&2 || true
  exit 1
}
diff -r "$OUT/run1" "$OUT/run2" || { echo "export-scenario-goldens: two runs differ" >&2; exit 1; }
mkdir -p "$OUT/goldens"
cp "$OUT/run1"/*.json "$OUT/goldens/"
echo "export-scenario-goldens: $count goldens, two runs byte-identical, in $OUT/goldens"
