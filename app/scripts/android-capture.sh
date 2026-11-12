#!/usr/bin/env bash
# Install the Release APK of the RN spike on the running emulator, screenshot each screen and collect the self-test
# result (the app workflow's android job, run inside reactivecircus/android-emulator-runner).
#   APK=<app-release.apk> OUT=<dir> app/scripts/android-capture.sh
# Env: APK (required), OUT (default /tmp/app-android), WAIT (seconds for non-map screens, default 10),
# MAP_TIMEOUT (seconds to wait for a fully rendered map, default 45), RESULT_TIMEOUT (seconds, default 120),
# SCREENS (default "map map-layers airport night layers nearest search log sheet settings onboarding disclaimers"), FULL (1 = also run the animation and the self test, default 1; the
# workflow's second emulator pass with another GPU mode sets FULL=0 SCREENS=map).
# Writes OUT/screens/<screen>.png, OUT/map-status-<screen>.json (screens with a map) and OUT/logcat-<screen>.txt (every screen),
# OUT/spike-result.json
# and OUT/spike-anim.json (from logcat: a release build is not debuggable, so run-as cannot read the files), and
# OUT/dumpsys-location.txt.
set -euo pipefail

APK=${APK:?set APK to the built release APK}
OUT=${OUT:-/tmp/app-android}
WAIT=${WAIT:-10}
MAP_TIMEOUT=${MAP_TIMEOUT:-45}
RESULT_TIMEOUT=${RESULT_TIMEOUT:-120}
SCREENS=${SCREENS:-map map-layers airport night layers nearest search log sheet settings onboarding disclaimers}
# Screens with no map (a native sheet, the log, the settings forms) wait a fixed time instead of for the map status.
NO_MAP=" sheet log settings onboarding disclaimers "
FULL=${FULL:-1}
PKG=io.omer.efb.dev
GEO="-122.2289 37.4876"   # longitude latitude: ownship over Redwood City (src/fixtures/scenario.ts)
LATLON="37.4876,-122.2289"
mkdir -p "$OUT/screens"

stamp() { echo "[$(date +%H:%M:%S)] $*"; }

LOCATION_LOOP=""
collect() {
  [ -n "$LOCATION_LOOP" ] && kill "$LOCATION_LOOP" 2>/dev/null || true
  adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
}
trap collect EXIT

# anr_dialogs: the packages with an "isn't responding" dialog up. A starved CI emulator sometimes ANRs its own launcher and
# the dialog then covers every screenshot (run 43111102990: all four dimmed under "Pixel Launcher isn't responding", SSIM
# 0.51 to 0.58, logcat "Application Not Responding: com.google.android.apps.nexuslauncher"). The dialog's window title
# names the process.
anr_dialogs() {
  adb shell dumpsys window 2>/dev/null | grep -o 'Application Not Responding: [A-Za-z0-9_.]*' | sed 's/.*: //' | sort -u || true
}
# clear_anr_dialogs: killing the process dismisses its dialog (the system server drops a dead process's error dialogs)
# and the launcher restarts by itself.
clear_anr_dialogs() {
  local pkg
  for pkg in $(anr_dialogs); do
    echo "android-capture: dismissing the ANR dialog of $pkg" >&2
    adb shell am force-stop "$pkg" || true
  done
}

adb wait-for-device
# The system server re-reads this setting live: with it set, a process that ANRs is killed quietly instead of getting the
# dialog. Set it before the install, the first heavy step. A real crash of the app still fails the gate (blank screenshot).
adb shell settings put global hide_error_dialogs 1 || echo "android-capture: could not hide error dialogs" >&2
adb install -r "$APK"
for perm in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION ACCESS_BACKGROUND_LOCATION RECORD_AUDIO POST_NOTIFICATIONS; do
  adb shell pm grant "$PKG" "android.permission.$perm" || echo "android-capture: pm grant $perm failed" >&2
done
# shellcheck disable=SC2086 # GEO is two arguments
adb emu geo fix $GEO
clear_anr_dialogs   # a dialog that came up before the script started (boot) is not covered by the setting

# portrait: Pixel Tablet is landscape-natural (2560x1600), so portrait is user rotation 1 (90 degrees), not 0.
portrait() {
  adb shell settings put system accelerometer_rotation 0 || true
  adb shell cmd window user-rotation lock 1 >/dev/null || adb shell settings put system user_rotation 1 || true
}

# screenshot <screen>: capture and check it is portrait like the iPad references (warn, do not fail). An ANR dialog that
# came up while the screen rendered would dim the capture, so dismiss it first and say so in the log if one is still up.
screenshot() {
  local png="$OUT/screens/$1.png" size dialogs
  clear_anr_dialogs
  adb exec-out screencap -p > "$png"
  size=$(python3 -c 'import struct,sys; w,h=struct.unpack(">II",open(sys.argv[1],"rb").read()[16:24]); print(w,h)' "$png")
  stamp "$1.png ${size/ /x}"
  read -r w h <<<"$size"
  [ "$h" -gt "$w" ] || echo "android-capture: $1.png is landscape ($w x $h)" >&2
  dialogs=$(anr_dialogs)
  [ -z "$dialogs" ] || echo "android-capture: $1.png was taken with an ANR dialog up ($dialogs)" >&2
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

for screen in $SCREENS; do
  stamp "screen $screen"
  open_url "kanaf-dev://$screen"
  if [[ "$NO_MAP" == *" $screen "* ]]; then
    sleep "$WAIT"
    # No map status to wait for, and the next open_url clears logcat: keep this screen's log (the only evidence of a crash).
    adb logcat -d > "$OUT/logcat-$screen.txt" || true
  else
    wait_map "$screen"
  fi
  screenshot "$screen"
done

[ "$FULL" = 1 ] || exit 0

stamp "map animation: 60 s at 10 Hz"
open_url "kanaf-dev://map?animate=1"
sleep 70
logged SPIKE_ANIM > "$OUT/spike-anim.json"

stamp "self test"
# Location: make sure location is on, then feed two sources every second: the emulator's GNSS (`geo fix`, reaches the
# gps provider unmocked) and a shell test provider for gps (fixes arrive with mocked=true), so the result's
# `watchMocked` / `current.mocked` say which one expo-location's fused provider passed through.
adb shell cmd location set-location-enabled true || true
adb shell appops set com.android.shell android:mock_location allow || true
adb shell cmd location providers add-test-provider gps || echo "android-capture: no gps test provider" >&2
adb shell cmd location providers set-test-provider-enabled gps true || true
adb shell settings get secure location_mode | sed 's/^/location_mode=/' || true
# shellcheck disable=SC2086 # GEO is two arguments
while true; do
  adb emu geo fix $GEO >/dev/null 2>&1 || true
  adb shell cmd location providers set-test-provider-location gps --location "$LATLON" --accuracy 5 >/dev/null 2>&1 || true
  sleep 1
done &
LOCATION_LOOP=$!
open_url "kanaf-dev://selftest"
waited=0
until logged SPIKE_RESULT_END | grep -q . || [ "$waited" -ge "$RESULT_TIMEOUT" ]; do
  sleep 5; waited=$((waited + 5))
done
screenshot selftest
adb shell dumpsys location > "$OUT/dumpsys-location.txt" 2>&1 || true
adb shell cmd location providers remove-test-provider gps >/dev/null 2>&1 || true
# The result is logged in numbered chunks (logcat truncates lines near 4 KB); reassemble them in order.
adb logcat -d -s ReactNativeJS:V | grep -F 'SPIKE_RESULT_PART ' | sed 's/.*SPIKE_RESULT_PART //' | sort -n -k1,1 \
  | cut -d' ' -f2- | tr -d '\n' > "$OUT/spike-result.json" || true
if ! [ -s "$OUT/spike-result.json" ]; then
  echo "android-capture: no SPIKE_RESULT after ${RESULT_TIMEOUT}s" >&2
  exit 1
fi
python3 -m json.tool "$OUT/spike-result.json" >/dev/null || echo "android-capture: spike-result.json is not valid JSON (logcat line truncated?)" >&2
stamp "self test result:"
cat "$OUT/spike-result.json"
