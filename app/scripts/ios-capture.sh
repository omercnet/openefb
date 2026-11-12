#!/usr/bin/env bash
# Install the Release simulator build of the RN spike on an iPad simulator, screenshot each screen and collect the
# self-test result (the app workflow's ios job). Simulator selection follows tools/sim-test.sh.
#   APP=<path/KanafEFBDev.app> OUT=<dir> app/scripts/ios-capture.sh
# Env: APP (required), OUT (default /tmp/app-ios), WAIT (seconds for non-map screens, default 10),
# MAP_TIMEOUT (seconds to wait for a fully rendered map, default 45), SIM_DEVICE (default "iPad Pro 13-inch (M5)"),
# RESULT_TIMEOUT (seconds, default 120).
# Screens are chosen with launch arguments (-KanafScreen <screen>, -KanafAnimate 1; read through NSUserDefaults by
# src/app/index.tsx), not `simctl openurl`: a custom-scheme URL stops at an "Open in ...?" system alert nobody can accept here.
# Writes OUT/screens/<screen>.png, OUT/map-status-<screen>.json, OUT/spike-result.json, OUT/spike-anim.json and
# OUT/app.log (the log and whatever files exist are collected even when the script fails).
set -euo pipefail

APP=${APP:?set APP to the built .app}
OUT=${OUT:-/tmp/app-ios}
WAIT=${WAIT:-10}
MAP_TIMEOUT=${MAP_TIMEOUT:-45}
RESULT_TIMEOUT=${RESULT_TIMEOUT:-120}
SIM_DEVICE=${SIM_DEVICE:-iPad Pro 13-inch (M5)}
BUNDLE=io.omer.efb.dev
SIM_NAME="KanafEFBDev"
LOCATION=37.4876,-122.2289   # ownship over Redwood City (src/fixtures/scenario.ts)
mkdir -p "$OUT/screens"

stamp() { echo "[$(date +%H:%M:%S)] $*"; }

RUNTIME=$(xcrun simctl list runtimes | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9]+-[0-9]+' | sort -Vu | tail -1)
DEVICE_TYPE=$(xcrun simctl list devicetypes | grep -F "$SIM_DEVICE (" | grep -oE 'com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9-]+' | head -1 || true)
[ -n "$DEVICE_TYPE" ] || { echo "ios-capture: unknown SIM_DEVICE '$SIM_DEVICE'" >&2; xcrun simctl list devicetypes >&2; exit 2; }
SIM=$(xcrun simctl list devices | grep -F "$SIM_NAME (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
[ -n "$SIM" ] || SIM=$(xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME")
stamp "simulator $SIM ($SIM_DEVICE, $RUNTIME)"

DOCS=""
LOCATION_LOOP=""
# Always keep what was learned: the app's log and every result file the app wrote.
collect() {
  [ -n "$LOCATION_LOOP" ] && kill "$LOCATION_LOOP" 2>/dev/null || true
  xcrun simctl spawn "$SIM" log show --last 15m --style compact --predicate 'process == "KanafEFBDev"' > "$OUT/app.log" 2>&1 || true
  if [ -n "$DOCS" ]; then
    cp "$DOCS"/spike-result.json "$DOCS"/spike-anim.json "$OUT/" 2>/dev/null || true
  fi
}
trap collect EXIT

xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
xcrun simctl install "$SIM" "$APP"
for service in location location-always microphone; do
  xcrun simctl privacy "$SIM" grant "$service" "$BUNDLE" || echo "ios-capture: privacy grant $service failed" >&2
done
xcrun simctl location "$SIM" set "$LOCATION"
# expo-file-system's Paths.document is the app's Documents directory inside its data container.
DOCS="$(xcrun simctl get_app_container "$SIM" "$BUNDLE" data)/Documents"
stamp "documents: $DOCS"

# launch <args...>: (re)start the app with launch arguments.
launch() {
  xcrun simctl launch --terminate-running-process "$SIM" "$BUNDLE" "$@" >/dev/null
}

# wait_map <screen>: wait for MapSurface's map-status.json to report a fully rendered (or failed) map, print it.
wait_map() {
  local waited=0
  until grep -qE '"(fullyRendered|failed)": true' "$DOCS/map-status.json" 2>/dev/null || [ "$waited" -ge "$MAP_TIMEOUT" ]; do
    sleep 1; waited=$((waited + 1))
  done
  stamp "map status after ${waited}s:"
  cat "$DOCS/map-status.json" 2>/dev/null || echo "(no map-status.json)"
  cp "$DOCS/map-status.json" "$OUT/map-status-$1.json" 2>/dev/null || true
  sleep 2   # symbol fade-in
}

# Screens with no map (a native sheet, the log, the settings forms) wait a fixed time instead of for the map status.
NO_MAP=" sheet log settings onboarding disclaimers aircraft aircraftedit pilot logbookentry logbooklocked recording recordingstopped recordingstop replay replayfast "
for screen in map map-layers airport night layers nearest search log sheet settings onboarding disclaimers aircraft aircraftedit pilot logbookentry logbooklocked recording recordingstopped recordingstop replay replayfast; do
  stamp "screen $screen"
  rm -f "$DOCS/map-status.json"
  launch -KanafScreen "$screen"
  if [[ "$NO_MAP" == *" $screen "* ]]; then sleep "$WAIT"; else wait_map "$screen"; fi
  xcrun simctl io "$SIM" screenshot "$OUT/screens/$screen.png"
done

stamp "map animation: 60 s at 10 Hz"
rm -f "$DOCS/spike-anim.json"
launch -KanafScreen map -KanafAnimate 1
sleep 70

stamp "self test"
rm -f "$DOCS/spike-result.json"
# The simulator reports a fix once per `location set`; keep re-sending it so watchPositionAsync sees updates.
while true; do xcrun simctl location "$SIM" set "$LOCATION" >/dev/null 2>&1 || true; sleep 1; done &
LOCATION_LOOP=$!
launch -KanafScreen selftest
waited=0
until [ -s "$DOCS/spike-result.json" ] || [ "$waited" -ge "$RESULT_TIMEOUT" ]; do
  sleep 5; waited=$((waited + 5))
done
xcrun simctl io "$SIM" screenshot "$OUT/screens/selftest.png"
if [ ! -s "$DOCS/spike-result.json" ]; then
  echo "ios-capture: no spike-result.json after ${RESULT_TIMEOUT}s" >&2
  exit 1
fi
stamp "self test result:"
cat "$DOCS/spike-result.json"
