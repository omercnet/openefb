#!/bin/bash
# Fly a simulated route on a simulator (feeds GPS to the running app).
#   tools/fly.sh                       # US: KPAO → KSQL → KOAK → KSFO at ~100 kt (simctl location; lat/lon only)
#   tools/fly.sh stop                  # stop the route (US route, or a scenario: relaunches the app without it)
#   tools/fly.sh list                  # the Israel/US scenarios in tools/flight-sim/scenarios
#   tools/fly.sh israel <scenario> [--speed N] [--start SECONDS] [--notams FILE] [--sim <udid|SIM_TAG>]
#       launches the DEBUG build with -OpenEFBScenario: fixes with altitude, speed, course and GPS loss,
#       through the real LocationService. --speed multiplies time (default 1), --start skips ahead (seconds),
#       --notams serves a fixture NOTAM feed (il-closed-leg gets tools/flight-sim/fixtures/notams-closed-leg.json).
#       A GPS loss only shows as "no position" when it lasts longer than 5 x speed seconds.
# Env: SPEED (m/s, US route, default 50 ≈ 97 kt), SIM_TAG (fly on an agent's own sim).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
SCENARIOS=tools/flight-sim/scenarios
BUNDLE=io.omer.efb

list_scenarios() {
  python3 - "$SCENARIOS" <<'PY'
import glob, json, os, sys
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*.json"))):
    with open(path) as fh:
        s = json.load(fh)
    print(f"{s['name']:<32} {s['fixes'][-1]['t'] / 60:5.1f} min  {s['description']}")
PY
}

case "${1:-}" in
  list)
    list_scenarios
    exit 0 ;;
  israel)
    shift
    SCENARIO=${1:-}; [ -n "$SCENARIO" ] || { echo "usage: tools/fly.sh israel <scenario> [--speed N] [--start S] [--notams FILE] [--sim udid|tag]" >&2; exit 2; }
    shift
    SPEED_MULT=1; START=0; NOTAMS=""; SIM_ARG=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --speed) SPEED_MULT=$2; shift 2 ;;
        --start) START=$2; shift 2 ;;
        --notams) NOTAMS=$2; shift 2 ;;
        --sim) SIM_ARG=$2; shift 2 ;;
        *) echo "fly.sh: unknown option $1" >&2; exit 2 ;;
      esac
    done
    FILE="$PWD/$SCENARIOS/$SCENARIO.json"
    [ -f "$FILE" ] || { echo "fly.sh: no scenario '$SCENARIO' (tools/fly.sh list)" >&2; exit 2; }
    if [ -z "$NOTAMS" ] && [ "$SCENARIO" = "il-closed-leg" ]; then NOTAMS="$PWD/tools/flight-sim/fixtures/notams-closed-leg.json"; fi
    if [ -n "$SIM_ARG" ]; then
      if [[ "$SIM_ARG" =~ ^[0-9A-Fa-f-]{36}$ ]]; then SIM=$SIM_ARG; else SIM=$(SIM_TAG=$SIM_ARG tools/sim-test.sh id); fi
    else
      SIM=$(tools/sim-test.sh id)
    fi
    xcrun simctl boot "$SIM" 2>/dev/null || true
    xcrun simctl bootstatus "$SIM" -b >/dev/null
    # Install the built DEBUG app when it is not there yet (tools/sim-test.sh build first).
    if ! xcrun simctl get_app_container "$SIM" "$BUNDLE" >/dev/null 2>&1; then
      NAME=$(basename "$PWD"); TAG=${SIM_ARG:-${SIM_TAG:-}}
      [[ "$TAG" =~ ^[0-9A-Fa-f-]{36}$ ]] && TAG=""
      APP=${DD:-/tmp/efb-dd-$NAME${TAG:+-$TAG}}/Build/Products/Debug-iphonesimulator/efb-212.app
      [ -d "$APP" ] || { echo "fly.sh: no built app at $APP; run tools/sim-test.sh build first" >&2; exit 1; }
      xcrun simctl install "$SIM" "$APP"
    fi
    xcrun simctl privacy "$SIM" grant location-always "$BUNDLE" || true
    xcrun simctl location "$SIM" clear 2>/dev/null || true   # the scenario replaces the simulator's GPS
    ARGS=(-hasSeenOnboarding YES -OpenEFBScenario "$FILE" -OpenEFBScenarioSpeed "$SPEED_MULT" -OpenEFBScenarioStart "$START")
    [ -n "$NOTAMS" ] && ARGS+=(-OpenEFBNotamFixture "$NOTAMS")
    xcrun simctl launch --terminate-running-process "$SIM" "$BUNDLE" "${ARGS[@]}"
    echo "Flying $SCENARIO at ${SPEED_MULT}x from ${START}s on $SIM. Stop with: tools/fly.sh stop"
    exit 0 ;;
esac

SIM=$(tools/sim-test.sh id)
if [ "${1:-}" = "stop" ]; then
  xcrun simctl location "$SIM" clear
  # A scenario is a launch argument: relaunch the app plainly to stop it.
  if xcrun simctl get_app_container "$SIM" "$BUNDLE" >/dev/null 2>&1; then
    xcrun simctl terminate "$SIM" "$BUNDLE" 2>/dev/null || true
  fi
  exit 0
fi
xcrun simctl location "$SIM" clear
xcrun simctl location "$SIM" start --speed="${SPEED:-50}" --interval=1 \
  37.4611,-122.1150 37.5124,-122.2495 37.7213,-122.2208 37.6189,-122.3750
echo "Flying KPAO → KSQL → KOAK → KSFO on $SIM. Stop with: tools/fly.sh stop"
