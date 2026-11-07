#!/usr/bin/env bash
# Screenshot the Direction 2 screens on an iPad and an iPhone simulator with the DEBUG app (the CI simulation job).
#   tools/ci/capture-screens.sh
# Needs a DEBUG build first: tools/sim-test.sh build. Env: WAIT (seconds from launch to screenshot, default 12),
# OUT (screenshots and crash reports, default /tmp/efb-screens), plus DD and SIM_TAG as in tools/sim-test.sh.
# Each shot launches the app flying us-kpao-ksql from 150 s (airborne, 97 kt, climbing) with the DEBUG screen hooks
# (-OpenEFBScreen, -OpenEFBStripColumn, -OpenEFBDisplayMode, -OpenEFBDirectTo; ScreenCaptureHooks.swift; the map
# shots go direct to KOAK so NEXT shows a waypoint, map-noplan does not),
# screenshots it as <device>-<shot>.png (device ipad|iphone) and fails when the app is not running after the wait or
# a crash report appears. Image content is not asserted. The iPad also gets the Israel route (il-map-day).
# Recording runs without the microphone (-OpenEFBNoAudio), as in tools/ci/fly-scenarios.sh.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

WAIT=${WAIT:-12}
OUT=${OUT:-/tmp/efb-screens}
BUNDLE=io.omer.efb
CRASH_DIR="$HOME/Library/Logs/DiagnosticReports"
SCENARIOS="$PWD/tools/flight-sim/scenarios"
APP=${DD:-/tmp/efb-dd-$(basename "$PWD")${SIM_TAG:+-${SIM_TAG}}}/Build/Products/Debug-iphonesimulator/efb-212.app
[ -d "$APP" ] || { echo "capture-screens: no built app at $APP; run tools/sim-test.sh build first" >&2; exit 1; }

mkdir -p "$OUT" "$CRASH_DIR"

# stamp <message>: timestamped progress line, so a hung step is visible in the job log.
stamp() { echo "[$(date +%H:%M:%S)] $*"; }

# limited <seconds> <command...>: run with a deadline (macOS has no timeout(1)); 124 when it ran out.
limited() {
  local secs=$1 pid watchdog rc
  shift
  "$@" &
  pid=$!
  { sleep "$secs"; pkill -9 -P "$pid"; kill -9 "$pid"; } >/dev/null 2>&1 &
  watchdog=$!
  rc=0
  wait "$pid" 2>/dev/null || rc=$?
  # The watchdog dies by our SIGTERM (143): never let that reach set -e.
  kill "$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  [ "$rc" -eq 137 ] && rc=124
  return "$rc"
}

# app_running <sim>: 0 when the app's launchd job has a numeric PID, 1 when it has none, 2 when launchctl did not
# answer (retried 3 times, 5 s apart).
app_running() {
  local sim=$1 list try
  for try in 1 2 3; do
    if list=$(limited 30 xcrun simctl spawn "$sim" launchctl list 2>/dev/null); then
      awk -v job="UIKitApplication:$BUNDLE" 'index($3, job) == 1 && $1 ~ /^[0-9]+$/ { found = 1 } END { exit !found }' <<<"$list"
      return
    fi
    [ "$try" -lt 3 ] && sleep 5
  done
  return 2
}

# prepare <sim>: boot, install the built app, grant location, clear the simulator's GPS (the scenario replaces it).
prepare() {
  local sim=$1
  xcrun simctl boot "$sim" 2>/dev/null || true
  limited 300 xcrun simctl bootstatus "$sim" -b >/dev/null || { echo "capture-screens: simulator $sim did not boot" >&2; exit 1; }
  limited 300 xcrun simctl install "$sim" "$APP" || { echo "capture-screens: install on $sim failed" >&2; exit 1; }
  xcrun simctl privacy "$sim" grant location-always "$BUNDLE" || true
  xcrun simctl location "$sim" clear 2>/dev/null || true
}

failed=()
first_launch=1
# shot <sim> <device> <shot> <scenario> <start seconds> <hook args...>
shot() {
  local sim=$1 device=$2 name=$3 scenario=$4 start=$5 deadline=120 marker state report problems=()
  shift 5
  marker=$(mktemp)
  stamp "$device-$name"
  # The first launch on a fresh runner is cold (install, dyld, first MapLibre frame); see fly-scenarios.sh.
  [ "$first_launch" -eq 1 ] && deadline=300
  first_launch=0
  limited "$deadline" xcrun simctl launch --terminate-running-process "$sim" "$BUNDLE" \
    -hasSeenOnboarding YES -OpenEFBNoAudio YES -OpenEFBScenario "$SCENARIOS/$scenario.json" \
    -OpenEFBScenarioSpeed 1 -OpenEFBScenarioStart "$start" "$@" >/dev/null || problems+=("launch failed or timed out")
  if [ ${#problems[@]} -eq 0 ]; then
    sleep "$WAIT"   # the map, the first frame and a few fixes
    limited 60 xcrun simctl io "$sim" screenshot "$OUT/$device-$name.png" >/dev/null 2>&1 || problems+=("no screenshot")
    state=0
    app_running "$sim" || state=$?
    case $state in
      1) problems+=("app not running after ${WAIT}s") ;;
      2) stamp "warning: could not check that the app runs (launchctl did not answer)" ;;
    esac
  fi
  while IFS= read -r report; do
    cp "$report" "$OUT/"
    problems+=("crash report $(basename "$report")")
  done < <(find "$CRASH_DIR" -name 'efb-212*' -newer "$marker" 2>/dev/null)
  rm -f "$marker"
  xcrun simctl terminate "$sim" "$BUNDLE" 2>/dev/null || true
  if [ ${#problems[@]} -gt 0 ]; then
    printf '%s-%s: FAILED: %s\n' "$device" "$name" "${problems[*]}" >&2
    failed+=("$device-$name")
  fi
}

# shots <sim> <device>: the US set, flying KPAO to KSQL.
shots() {
  local sim=$1 device=$2
  shot "$sim" "$device" map-day us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDisplayMode day -OpenEFBDirectTo KOAK
  shot "$sim" "$device" map-night us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDisplayMode night -OpenEFBDirectTo KOAK
  # The bar toggles (Layers > Panels): flight log hidden, then both bars hidden. Launch arguments are not persisted.
  shot "$sim" "$device" map-nolog us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDisplayMode day -OpenEFBDirectTo KOAK -showsFlightLog NO
  shot "$sim" "$device" map-chartonly us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDisplayMode day -OpenEFBDirectTo KOAK -showsFlightLog NO -showsInstruments NO
  # Stage 2: predicted airspace ahead (Layers > Panels > Predictions), day and night.
  shot "$sim" "$device" map-predictions us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDisplayMode day -OpenEFBDirectTo KOAK -showsPredictions YES
  shot "$sim" "$device" map-predictions-night us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDisplayMode night -OpenEFBDirectTo KOAK -showsPredictions YES
  shot "$sim" "$device" map-noplan us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDisplayMode day
  shot "$sim" "$device" airport-KSQL us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn airport:KSQL -OpenEFBDisplayMode day
  shot "$sim" "$device" nearest us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn nearest -OpenEFBDisplayMode day
  shot "$sim" "$device" layers us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn layers -OpenEFBDisplayMode day
  shot "$sim" "$device" search us-kpao-ksql 150 -OpenEFBScreen map -OpenEFBStripColumn search -OpenEFBDisplayMode day
  shot "$sim" "$device" log us-kpao-ksql 150 -OpenEFBScreen log -OpenEFBDisplayMode day
}

echo "::group::iPad"
IPAD=$(tools/sim-test.sh id)
stamp "iPad simulator $IPAD"
prepare "$IPAD"
shots "$IPAD" ipad
# Herzliya to Rosh Pina from 600 s: on the CVFR route at 1500 ft.
shot "$IPAD" ipad il-map-day il-cvfr-llhz-llib-nominal 600 -OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDisplayMode day
shot "$IPAD" ipad il-map-predictions il-cvfr-llhz-llib-nominal 600 -OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDisplayMode day -showsPredictions YES
echo "::endgroup::"

echo "::group::iPhone"
IPHONE=$(SIM_DEVICE="iPhone 17 Pro" SIM_TAG="${SIM_TAG:+$SIM_TAG-}iphone17pro-screens" tools/sim-test.sh id)
stamp "iPhone simulator $IPHONE"
first_launch=1
prepare "$IPHONE"
shots "$IPHONE" iphone
xcrun simctl shutdown "$IPHONE" 2>/dev/null || true
echo "::endgroup::"

if [ ${#failed[@]} -gt 0 ]; then
  echo "capture-screens: FAILED: ${failed[*]} (screenshots in $OUT)" >&2
  exit 1
fi
echo "capture-screens: all screens captured in $OUT"
