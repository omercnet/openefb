#!/usr/bin/env bash
# Fly flight-sim scenarios in the simulator with the DEBUG app and check that it stays up (the CI simulation job).
#   tools/ci/fly-scenarios.sh [scenario ...]      default: the CI set below (tools/fly.sh list shows them all)
# Needs a DEBUG build first: tools/sim-test.sh build. Env: SPEED (time multiplier, default 20), OUT (screenshots,
# logs and crash reports, default /tmp/efb-scenarios), plus DD and SIM_TAG as in tools/sim-test.sh.
# Per scenario: launch through tools/fly.sh, screenshot at 0/25/50/75/100% of the flight, and fail when the app is not
# running at a checkpoint, the scenario's load notice is missing from the app log, or a crash report appears.
# What the app does with the fixes (alerts, route following, debrief) is asserted by efb-212Tests/Simulation.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

SPEED=${SPEED:-20}
OUT=${OUT:-/tmp/efb-scenarios}
BUNDLE=io.omer.efb
CRASH_DIR="$HOME/Library/Logs/DiagnosticReports"
SCENARIOS=("$@")
[ ${#SCENARIOS[@]} -gt 0 ] || SCENARIOS=(il-cvfr-llhz-llib-nominal il-cvfr-llhz-llib-deviations il-closed-leg il-gps-loss us-kpao-ksql)

mkdir -p "$OUT" "$CRASH_DIR"
SIM=$(tools/sim-test.sh id)
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null

# The app's launchd job has a numeric PID while it runs ("-" or no line once it exits or crashes).
app_running() {
  xcrun simctl spawn "$SIM" launchctl list |
    awk -v job="UIKitApplication:$BUNDLE" 'index($3, job) == 1 && $1 ~ /^[0-9]+$/ { found = 1 } END { exit !found }'
}

# Scenario length in seconds (time of the last fix).
duration() {
  python3 -c 'import json, sys; print(int(json.load(open(sys.argv[1]))["fixes"][-1]["t"]))' "tools/flight-sim/scenarios/$1.json"
}

failed=()
summary="| Scenario | Flight | Wall | Result |\n|---|---|---|---|\n"
for name in "${SCENARIOS[@]}"; do
  secs=$(duration "$name")
  wall=$(( secs / SPEED + 1 ))
  quarter=$(( (wall + 3) / 4 ))
  marker=$(mktemp)
  since=$(date '+%Y-%m-%d %H:%M:%S')
  problems=()
  echo "::group::$name (${secs}s at ${SPEED}x, ~${wall}s)"

  tools/fly.sh israel "$name" --speed "$SPEED" --sim "$SIM"
  sleep 5   # launch, first frame
  for pct in 0 25 50 75 100; do
    [ "$pct" -gt 0 ] && sleep "$quarter"
    xcrun simctl io "$SIM" screenshot "$OUT/$name-$pct.png" >/dev/null 2>&1 || true
    app_running || { problems+=("app not running at $pct%"); break; }
  done

  xcrun simctl spawn "$SIM" log show --style compact --start "$since" \
    --predicate "subsystem == \"$BUNDLE\"" >"$OUT/$name.log" 2>&1 || true
  grep -q "Scenario $name x" "$OUT/$name.log" || problems+=("no 'Scenario $name' load notice in the app log")
  while IFS= read -r report; do
    cp "$report" "$OUT/"
    problems+=("crash report $(basename "$report")")
  done < <(find "$CRASH_DIR" -name 'efb-212*' -newer "$marker" 2>/dev/null)
  rm -f "$marker"
  tools/fly.sh stop >/dev/null 2>&1 || true

  if [ ${#problems[@]} -eq 0 ]; then
    echo "$name: OK"
    summary+="| $name | ${secs}s | ${wall}s | OK |\n"
  else
    printf '%s: FAILED: %s\n' "$name" "${problems[*]}" >&2
    failed+=("$name")
    summary+="| $name | ${secs}s | ${wall}s | FAILED: ${problems[*]} |\n"
  fi
  echo "::endgroup::"
done

[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf "### Simulator scenarios (%sx)\n\n$summary" "$SPEED" >>"$GITHUB_STEP_SUMMARY"
if [ ${#failed[@]} -gt 0 ]; then
  echo "fly-scenarios: FAILED: ${failed[*]} (screenshots and logs in $OUT)" >&2
  exit 1
fi
echo "fly-scenarios: all ${#SCENARIOS[@]} scenarios flew (screenshots and logs in $OUT)"
