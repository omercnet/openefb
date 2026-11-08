#!/usr/bin/env bash
# Install the Release simulator build of the RN spike on an iPad simulator, screenshot each screen and collect the
# self-test result (the rn-spike workflow's ios job). Simulator selection follows tools/sim-test.sh.
#   APP=<path/KanafRNSpike.app> OUT=<dir> spikes/kanaf-rn/scripts/ios-capture.sh
# Env: APP (required), OUT (default /tmp/rn-spike-ios), WAIT (seconds per screen, default 15),
# SIM_DEVICE (default "iPad Pro 13-inch (M5)"), RESULT_TIMEOUT (seconds, default 120).
# Writes OUT/screens/<screen>.png, OUT/spike-result.json, OUT/spike-anim.json, OUT/app.log.
set -euo pipefail

APP=${APP:?set APP to the built .app}
OUT=${OUT:-/tmp/rn-spike-ios}
WAIT=${WAIT:-15}
RESULT_TIMEOUT=${RESULT_TIMEOUT:-120}
SIM_DEVICE=${SIM_DEVICE:-iPad Pro 13-inch (M5)}
BUNDLE=io.omer.efb.rnspike
SIM_NAME="KanafRNSpike"
mkdir -p "$OUT/screens"

stamp() { echo "[$(date +%H:%M:%S)] $*"; }

RUNTIME=$(xcrun simctl list runtimes | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9]+-[0-9]+' | sort -Vu | tail -1)
DEVICE_TYPE=$(xcrun simctl list devicetypes | grep -F "$SIM_DEVICE (" | grep -oE 'com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9-]+' | head -1 || true)
[ -n "$DEVICE_TYPE" ] || { echo "ios-capture: unknown SIM_DEVICE '$SIM_DEVICE'" >&2; xcrun simctl list devicetypes >&2; exit 2; }
SIM=$(xcrun simctl list devices | grep -F "$SIM_NAME (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
[ -n "$SIM" ] || SIM=$(xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME")
stamp "simulator $SIM ($SIM_DEVICE, $RUNTIME)"

xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
xcrun simctl install "$SIM" "$APP"
for service in location location-always microphone; do
  xcrun simctl privacy "$SIM" grant "$service" "$BUNDLE" || echo "ios-capture: privacy grant $service failed" >&2
done
xcrun simctl location "$SIM" set 37.4876,-122.2289   # ownship over Redwood City (src/fixtures/scenario.ts)

# open <url> <seconds>: cold-start the app on a deep link and wait.
open_url() {
  xcrun simctl terminate "$SIM" "$BUNDLE" 2>/dev/null || true
  xcrun simctl openurl "$SIM" "$1"
  sleep "$2"
}

for screen in map airport night sheet; do
  stamp "screen $screen"
  open_url "kanaf-rn://$screen" "$WAIT"
  xcrun simctl io "$SIM" screenshot "$OUT/screens/$screen.png"
done

stamp "map animation: 60 s at 10 Hz"
open_url "kanaf-rn://map?animate=1" 70

stamp "self test"
open_url "kanaf-rn://selftest" 1
DATA=$(xcrun simctl get_app_container "$SIM" "$BUNDLE" data)
waited=0
until [ -s "$DATA/Documents/spike-result.json" ] || [ "$waited" -ge "$RESULT_TIMEOUT" ]; do
  sleep 5; waited=$((waited + 5))
done
xcrun simctl io "$SIM" screenshot "$OUT/screens/selftest.png"
cp "$DATA/Documents/spike-anim.json" "$OUT/" 2>/dev/null || echo "ios-capture: no spike-anim.json" >&2
xcrun simctl spawn "$SIM" log show --last 10m --style compact --predicate "process == \"KanafRNSpike\"" > "$OUT/app.log" 2>&1 || true
if [ ! -s "$DATA/Documents/spike-result.json" ]; then
  echo "ios-capture: no spike-result.json after ${RESULT_TIMEOUT}s" >&2
  exit 1
fi
cp "$DATA/Documents/spike-result.json" "$OUT/"
stamp "self test result: $OUT/spike-result.json"
cat "$OUT/spike-result.json"
