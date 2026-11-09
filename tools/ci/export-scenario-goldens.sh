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
count=$(find "$OUT/run1" -name '*.json' | wc -l | tr -d ' ')
[ "$count" -eq 8 ] || { echo "export-scenario-goldens: expected 8 files, got $count" >&2; exit 1; }
diff -r "$OUT/run1" "$OUT/run2" || { echo "export-scenario-goldens: two runs differ" >&2; exit 1; }
mkdir -p "$OUT/goldens"
cp "$OUT/run1"/*.json "$OUT/goldens/"
echo "export-scenario-goldens: 8 goldens, two runs byte-identical, in $OUT/goldens"
