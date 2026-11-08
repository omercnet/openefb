#!/usr/bin/env bash
# Install the Release APK of the RN spike on the running emulator, screenshot each screen and collect the self-test
# result (the rn-spike workflow's android job, run inside reactivecircus/android-emulator-runner).
#   APK=<app-release.apk> OUT=<dir> spikes/kanaf-rn/scripts/android-capture.sh
# Env: APK (required), OUT (default /tmp/rn-spike-android), WAIT (seconds per screen, default 15),
# RESULT_TIMEOUT (seconds, default 120).
# Writes OUT/screens/<screen>.png, OUT/spike-result.json (from logcat, or the file when the build is debuggable),
# OUT/spike-anim.json (from logcat) and OUT/logcat.txt.
set -euo pipefail

APK=${APK:?set APK to the built release APK}
OUT=${OUT:-/tmp/rn-spike-android}
WAIT=${WAIT:-15}
RESULT_TIMEOUT=${RESULT_TIMEOUT:-120}
PKG=io.omer.efb.rnspike
mkdir -p "$OUT/screens"

stamp() { echo "[$(date +%H:%M:%S)] $*"; }

adb wait-for-device
adb install -r "$APK"
for perm in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION ACCESS_BACKGROUND_LOCATION RECORD_AUDIO POST_NOTIFICATIONS; do
  adb shell pm grant "$PKG" "android.permission.$perm" || echo "android-capture: pm grant $perm failed" >&2
done
adb emu geo fix -122.2289 37.4876   # longitude latitude: ownship over Redwood City (src/fixtures/scenario.ts)
# Pixel Tablet is landscape-natural; rotate 90 degrees so screenshots match the portrait iPad references.
adb shell settings put system accelerometer_rotation 0 || true
adb shell cmd window user-rotation lock 1 || echo "android-capture: could not lock portrait" >&2

# open <url> <seconds>: cold-start the app on a deep link and wait.
open_url() {
  adb shell am force-stop "$PKG"
  adb shell am start -W -a android.intent.action.VIEW -d "$1" "$PKG" >/dev/null
  sleep "$2"
}

# logged <tag>: the JSON after "<tag> " in the newest matching ReactNativeJS logcat line, or nothing.
logged() {
  adb logcat -d -s ReactNativeJS:V | grep -F "$1 " | tail -1 | sed "s/.*$1 //" || true
}

for screen in map airport night sheet; do
  stamp "screen $screen"
  open_url "kanaf-rn://$screen" "$WAIT"
  adb exec-out screencap -p > "$OUT/screens/$screen.png"
done

stamp "map animation: 60 s at 10 Hz"
adb logcat -c
open_url "kanaf-rn://map?animate=1" 70
logged SPIKE_ANIM > "$OUT/spike-anim.json"

stamp "self test"
adb logcat -c
open_url "kanaf-rn://selftest" 1
waited=0
until [ -n "$(logged SPIKE_RESULT)" ] || [ "$waited" -ge "$RESULT_TIMEOUT" ]; do
  sleep 5; waited=$((waited + 5))
done
adb exec-out screencap -p > "$OUT/screens/selftest.png"
adb logcat -d > "$OUT/logcat.txt"
# A release build is not debuggable, so run-as normally fails; logcat is the primary channel (lines cap near 4 KB).
if ! adb exec-out run-as "$PKG" cat files/spike-result.json > "$OUT/spike-result.json" 2>/dev/null || ! [ -s "$OUT/spike-result.json" ]; then
  logged SPIKE_RESULT > "$OUT/spike-result.json"
fi
if ! [ -s "$OUT/spike-result.json" ]; then
  echo "android-capture: no SPIKE_RESULT after ${RESULT_TIMEOUT}s" >&2
  exit 1
fi
python3 -m json.tool "$OUT/spike-result.json" >/dev/null || echo "android-capture: spike-result.json is not valid JSON (logcat line truncated?)" >&2
stamp "self test result: $OUT/spike-result.json"
cat "$OUT/spike-result.json"
