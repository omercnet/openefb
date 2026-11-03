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

# stamp <message>: timestamped progress line, so a hung step is visible in the job log.
stamp() { echo "[$(date +%H:%M:%S)] $*"; }

# limited <seconds> <command...>: run with a deadline (macOS has no timeout(1)); 124 when it ran out.
limited() {
  local secs=$1 pid watchdog rc
  shift
  "$@" &
  pid=$!
  # Kill the children first (fly.sh waits on simctl), then the command. No stdout: an orphaned sleep must not hold a pipe open.
  { sleep "$secs"; pkill -9 -P "$pid"; kill -9 "$pid"; } >/dev/null 2>&1 &
  watchdog=$!
  wait "$pid" 2>/dev/null; rc=$?
  kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null
  [ "$rc" -eq 137 ] && rc=124
  return "$rc"
}

SIM=$(tools/sim-test.sh id)
stamp "simulator $SIM"
xcrun simctl boot "$SIM" 2>/dev/null || true
limited 300 xcrun simctl bootstatus "$SIM" -b >/dev/null || { echo "fly-scenarios: simulator did not boot" >&2; exit 1; }

# app_state: 0 when the app's launchd job has a numeric PID ("-" or no line once it exits or crashes), 1 when it has
# none, 2 when launchctl did not answer (deadline hit or spawn error: a loaded runner during the first cold launch).
app_state() {
  local list rc=0
  list=$(limited 45 xcrun simctl spawn "$SIM" launchctl list 2>/dev/null) || rc=$?
  [ "$rc" -eq 0 ] || return 2
  awk -v job="UIKitApplication:$BUNDLE" 'index($3, job) == 1 && $1 ~ /^[0-9]+$/ { found = 1 } END { exit !found }' <<<"$list"
}

# app_running: app_state with up to 3 tries, 5 s apart; returns the last answer (0 running, 1 not running, 2 unknown).
app_running() {
  local try state
  for try in 1 2 3; do
    state=0
    app_state || state=$?
    [ "$state" -eq 0 ] && return 0
    [ "$try" -lt 3 ] && sleep 5
  done
  return "$state"
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
  problems=()
  notes=()
  echo "::group::$name (${secs}s at ${SPEED}x, ~${wall}s)"

  # Stream the app's log while it flies (`log show` after the fact can take minutes on a fresh simulator).
  xcrun simctl spawn "$SIM" log stream --style compact --level debug \
    --predicate "subsystem == \"$BUNDLE\"" >"$OUT/$name.log" 2>&1 &
  logpid=$!
  # Let the stream subscribe before the app starts: the load notice is logged once, at launch. (The stream's own
  # header cannot signal readiness: it is block-buffered into the file.)
  sleep 4

  launched=$(date '+%Y-%m-%d %H:%M:%S')   # the simulator logs in host time; only this launch may satisfy the check
  stamp "launch $name"
  limited 120 tools/fly.sh israel "$name" --speed "$SPEED" || problems+=("launch failed or timed out")
  sleep 5   # launch, first frame
  for pct in 0 25 50 75 100; do
    [ ${#problems[@]} -eq 0 ] || break
    [ "$pct" -gt 0 ] && sleep "$quarter"
    stamp "checkpoint $pct%"
    limited 60 xcrun simctl io "$SIM" screenshot "$OUT/$name-$pct.png" >/dev/null 2>&1 || true
    state=0
    app_running || state=$?
    case $state in
      1) problems+=("app not running at $pct%") ;;
      # Unknown is not a failure on its own: a crash still fails through the crash-report scan below.
      2) stamp "warning: could not check that the app runs at $pct% (launchctl did not answer)"
         notes+=("liveness unknown at $pct%") ;;
    esac
  done

  sleep 2
  kill "$logpid" 2>/dev/null || true; wait "$logpid" 2>/dev/null || true
  if ! grep -q "Scenario $name x" "$OUT/$name.log"; then
    # The stream may have subscribed after the notice: look it up in the stored log since this launch, with a deadline.
    limited 120 xcrun simctl spawn "$SIM" log show --style compact --start "$launched" \
      --predicate "subsystem == \"$BUNDLE\" AND category == \"ScenarioPlayback\"" >>"$OUT/$name.log" 2>&1 || true
    grep -q "Scenario $name x" "$OUT/$name.log" || problems+=("no 'Scenario $name' load notice in the app log")
  fi
  while IFS= read -r report; do
    cp "$report" "$OUT/"
    problems+=("crash report $(basename "$report")")
  done < <(find "$CRASH_DIR" -name 'efb-212*' -newer "$marker" 2>/dev/null)
  rm -f "$marker"
  limited 60 tools/fly.sh stop >/dev/null 2>&1 || true

  if [ ${#problems[@]} -eq 0 ]; then
    echo "$name: OK${notes[*]:+ (${notes[*]})}"
    summary+="| $name | ${secs}s | ${wall}s | OK${notes[*]:+ (${notes[*]})} |\n"
  else
    printf '%s: FAILED: %s\n' "$name" "${problems[*]}" >&2
    failed+=("$name")
    summary+="| $name | ${secs}s | ${wall}s | FAILED: ${problems[*]} |\n"
  fi
  echo "::endgroup::"
done

[ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '### Simulator scenarios (%sx)\n\n%b' "$SPEED" "$summary" >>"$GITHUB_STEP_SUMMARY"
if [ ${#failed[@]} -gt 0 ]; then
  echo "fly-scenarios: FAILED: ${failed[*]} (screenshots and logs in $OUT)" >&2
  exit 1
fi
echo "fly-scenarios: all ${#SCENARIOS[@]} scenarios flew (screenshots and logs in $OUT)"
