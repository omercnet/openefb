#!/usr/bin/env bash
# Install the Release APK of the RN spike on the running emulator, screenshot each screen and collect the self-test
# result (the rn-spike workflow's android job, run inside reactivecircus/android-emulator-runner).
#   APK=<app-release.apk> OUT=<dir> spikes/kanaf-rn/scripts/android-capture.sh
# Env: APK (required), OUT (default /tmp/rn-spike-android), WAIT (seconds for non-map screens, default 10),
# MAP_TIMEOUT (seconds to wait for a fully rendered map, default 45), RESULT_TIMEOUT (seconds, default 120).
# Writes OUT/screens/<screen>.png, OUT/map-status-<screen>.json and OUT/logcat-<screen>.txt, OUT/spike-result.json
# and OUT/spike-anim.json (from logcat: a release build is not debuggable, so run-as cannot read the files).
set -euo pipefail

APK=${APK:?set APK to the built release APK}
OUT=${OUT:-/tmp/rn-spike-android}
WAIT=${WAIT:-10}
MAP_TIMEOUT=${MAP_TIMEOUT:-45}
RESULT_TIMEOUT=${RESULT_TIMEOUT:-120}
PKG=io.omer.efb.rnspike
GEO="-122.2289 37.4876"   # longitude latitude: ownship over Redwood City (src/fixtures/scenario.ts)
mkdir -p "$OUT/screens"

stamp() { echo "[$(date +%H:%M:%S)] $*"; }

LOCATION_LOOP=""
collect() {
  [ -n "$LOCATION_LOOP" ] && kill "$LOCATION_LOOP" 2>/dev/null || true
  adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
}
trap collect EXIT

adb wait-for-device
adb install -r "$APK"
for perm in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION ACCESS_BACKGROUND_LOCATION RECORD_AUDIO POST_NOTIFICATIONS; do
  adb shell pm grant "$PKG" "android.permission.$perm" || echo "android-capture: pm grant $perm failed" >&2
done
# shellcheck disable=SC2086 # GEO is two arguments
adb emu geo fix $GEO

# portrait: Pixel Tablet is landscape-natural (2560x1600), so portrait is user rotation 1 (90 degrees), not 0.
portrait() {
  adb shell settings put system accelerometer_rotation 0 || true
  adb shell cmd window user-rotation lock 1 >/dev/null || adb shell settings put system user_rotation 1 || true
}

# screenshot <screen>: capture and check it is portrait like the iPad references (warn, do not fail).
screenshot() {
  local png="$OUT/screens/$1.png" size
  adb exec-out screencap -p > "$png"
  size=$(python3 -c 'import struct,sys; w,h=struct.unpack(">II",open(sys.argv[1],"rb").read()[16:24]); print(w,h)' "$png")
  stamp "$1.png ${size/ /x}"
  read -r w h <<<"$size"
  [ "$h" -gt "$w" ] || echo "android-capture: $1.png is landscape ($w x $h)" >&2
}

# open <url>: cold-start the app on a deep link (logcat cleared first, so logged() only sees this launch).
open_url() {
  adb shell am force-stop "$PKG"
  adb logcat -c
  portrait
  adb shell am start -W -a android.intent.action.VIEW -d "$1" "$PKG" >/dev/null
}

# logged <tag>: the JSON after "<tag> " in the newest matching ReactNativeJS logcat line, or nothing.
logged() {
  adb logcat -d -s ReactNativeJS:V | grep -F "$1 " | tail -1 | sed "s/.*$1 //" || true
}

# wait_map <screen>: wait for MapSurface's SPIKE_MAP status to report a fully rendered (or failed) map, print it.
wait_map() {
  local waited=0
  until logged SPIKE_MAP | grep -qE '"(fullyRendered|failed)":true' || [ "$waited" -ge "$MAP_TIMEOUT" ]; do
    sleep 1; waited=$((waited + 1))
  done
  stamp "map status after ${waited}s:"
  logged SPIKE_MAP | tee "$OUT/map-status-$1.json"
  adb logcat -d > "$OUT/logcat-$1.txt"
  sleep 2   # symbol fade-in
}

for screen in map airport night sheet; do
  stamp "screen $screen"
  open_url "kanaf-rn://$screen"
  if [ "$screen" = sheet ]; then sleep "$WAIT"; else wait_map "$screen"; fi
  screenshot "$screen"
done

stamp "map animation: 60 s at 10 Hz"
open_url "kanaf-rn://map?animate=1"
sleep 70
logged SPIKE_ANIM > "$OUT/spike-anim.json"

stamp "self test"
# The emulator reports one fix per `geo fix`; keep re-sending it so watchPositionAsync sees updates.
# shellcheck disable=SC2086 # GEO is two arguments
while true; do adb emu geo fix $GEO >/dev/null 2>&1 || true; sleep 1; done &
LOCATION_LOOP=$!
open_url "kanaf-rn://selftest"
waited=0
until [ -n "$(logged SPIKE_RESULT)" ] || [ "$waited" -ge "$RESULT_TIMEOUT" ]; do
  sleep 5; waited=$((waited + 5))
done
screenshot selftest
logged SPIKE_RESULT > "$OUT/spike-result.json"
if ! [ -s "$OUT/spike-result.json" ]; then
  echo "android-capture: no SPIKE_RESULT after ${RESULT_TIMEOUT}s" >&2
  exit 1
fi
python3 -m json.tool "$OUT/spike-result.json" >/dev/null || echo "android-capture: spike-result.json is not valid JSON (logcat line truncated?)" >&2
stamp "self test result:"
cat "$OUT/spike-result.json"
