#!/usr/bin/env bash
# OTA smoke scenario for the RN spike (the rn-spike workflow, after the capture step). Drives the app's `ota` screen
# against web/ota running under `wrangler dev`, publishing with the web/ota CLI (its documented output lines are the
# only interface used here), and checks the five steps of docs: embedded -> update A -> tampered B rejected ->
# rollback to embedded -> other channel ignored.
#   PLATFORM=ios|android OUT=<dir> KEYDIR=<dir> EXPORT_A=<dir> EXPORT_B=<dir> spikes/kanaf-rn/scripts/ota-smoke.sh
# Env: PLATFORM (required), KEYDIR (required: good/private-key.pem and bad/private-key.pem), EXPORT_A / EXPORT_B
# (`expo export` output dirs for this platform), OUT (default /tmp/rn-spike-$PLATFORM), RV_FILE (default
# $OUT/runtime-version.txt), BASE_URL (default http://127.0.0.1:8787), CHANNEL (default ci; must match the app's
# KANAF_OTA_CHANNEL), WRANGLER_LOG (default $OUT/ota/wrangler.log), SETTLE_TIMEOUT (seconds, default 120),
# iOS: APP (optional .app to install, default: already installed), SIM_NAME (default KanafRNSpike). Android: APK
# (optional, installed first).
# Writes OUT/ota/<n>-<step>.json (the settled app result), OUT/ota/publish-<n>.log, OUT/ota/screens/<n>-<step>.png.
# Needs jq. Any failed assertion exits 1 after saving what it has.
set -euo pipefail

PLATFORM=${PLATFORM:?set PLATFORM to ios or android}
KEYDIR=${KEYDIR:?set KEYDIR}
EXPORT_A=${EXPORT_A:?set EXPORT_A}
EXPORT_B=${EXPORT_B:?set EXPORT_B}
OUT=${OUT:-/tmp/rn-spike-$PLATFORM}
RV_FILE=${RV_FILE:-$OUT/runtime-version.txt}
BASE_URL=${BASE_URL:-http://127.0.0.1:8787}
CHANNEL=${CHANNEL:-ci}
WRANGLER_LOG=${WRANGLER_LOG:-$OUT/ota/wrangler.log}
SETTLE_TIMEOUT=${SETTLE_TIMEOUT:-120}
SIM_NAME=${SIM_NAME:-KanafRNSpike}
BUNDLE=io.omer.efb.rnspike
OTA_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../web/ota" && pwd)
RV=$(tr -d '[:space:]' < "$RV_FILE")
mkdir -p "$OUT/ota/screens"

stamp() { echo "[$(date +%H:%M:%S)] $*"; }
die() { echo "ota-smoke: $*" >&2; exit 1; }

case "$PLATFORM" in
  ios)
    SIM=$(xcrun simctl list devices | grep -F "$SIM_NAME (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
    [ -n "$SIM" ] || die "no simulator named $SIM_NAME"
    xcrun simctl boot "$SIM" 2>/dev/null || true
    xcrun simctl bootstatus "$SIM" -b >/dev/null
    [ -z "${APP:-}" ] || xcrun simctl install "$SIM" "$APP"
    DOCS="$(xcrun simctl get_app_container "$SIM" "$BUNDLE" data)/Documents"
    ;;
  android)
    adb wait-for-device
    [ -z "${APK:-}" ] || adb install -r "$APK"
    ;;
  *) die "PLATFORM must be ios or android" ;;
esac

collect() {
  if [ "$PLATFORM" = ios ]; then
    xcrun simctl spawn "$SIM" log show --last 15m --style compact --predicate 'process == "KanafRNSpike"' > "$OUT/ota/app.log" 2>&1 || true
  else
    adb logcat -d > "$OUT/ota/logcat.txt" 2>/dev/null || true
  fi
}
trap collect EXIT

# launch_ota: cold-start the app on the ota screen with an empty previous result.
launch_ota() {
  if [ "$PLATFORM" = ios ]; then
    rm -f "$DOCS/spike-ota.json"
    xcrun simctl launch --terminate-running-process "$SIM" "$BUNDLE" -KanafScreen ota >/dev/null
  else
    adb shell am force-stop "$BUNDLE"
    adb logcat -c
    adb shell am start -W -a android.intent.action.VIEW -d kanaf-rn://ota "$BUNDLE" >/dev/null
  fi
}

# current_result: the newest result the app wrote, or nothing.
current_result() {
  if [ "$PLATFORM" = ios ]; then
    jq -c . "$DOCS/spike-ota.json" 2>/dev/null || true
  else
    adb logcat -d -s ReactNativeJS:V | grep -F 'SPIKE_OTA ' | tail -1 | sed 's/.*SPIKE_OTA //' || true
  fi
}

# wait_settled <name>: wait for phase == settled (the app may fetch and reload first), save it as OUT/ota/<name>.json.
wait_settled() {
  local waited=0 r
  while [ "$waited" -lt "$SETTLE_TIMEOUT" ]; do
    r=$(current_result)
    if [ -n "$r" ] && [ "$(jq -r .phase <<<"$r" 2>/dev/null)" = settled ]; then
      jq . <<<"$r" > "$OUT/ota/$1.json"
      sleep 2   # let the screen draw before the screenshot
      return 0
    fi
    sleep 2; waited=$((waited + 2))
  done
  current_result > "$OUT/ota/$1.last.json"
  die "$1: no settled result after ${SETTLE_TIMEOUT}s (last: $(cat "$OUT/ota/$1.last.json"))"
}

screenshot() {
  if [ "$PLATFORM" = ios ]; then
    xcrun simctl io "$SIM" screenshot "$OUT/ota/screens/$1.png"
  else
    adb exec-out screencap -p > "$OUT/ota/screens/$1.png"
  fi
}

# ota <args...>: run the publisher CLI from web/ota (the same cwd as wrangler dev, so both see one local R2 state).
ota() { (cd "$OTA_DIR" && node cli/ota.mjs "$@"); }

# publish <n> <dist> <keydir> [channel]: print the update id from the CLI's `published <id> ...` last line.
publish() {
  local n=$1 dist=$2 key=$3 channel=${4:-$CHANNEL} last
  ota publish --dist "$dist" --platform "$PLATFORM" --channel "$channel" --runtime-version "$RV" \
    --key "$key/private-key.pem" --base-url "$BASE_URL" --local --published-by "ota-smoke" > "$OUT/ota/publish-$n.log" 2>&1 \
    || { cat "$OUT/ota/publish-$n.log" >&2; die "publish $n failed"; }
  last=$(tail -n 1 "$OUT/ota/publish-$n.log")
  [[ "$last" == "published "* ]] || die "publish $n: unexpected last line: $last"
  cut -d' ' -f2 <<<"$last"
}

# check <name> <jq filter>: the saved result must satisfy the filter.
check() {
  jq -e "$2" "$OUT/ota/$1.json" >/dev/null || { cat "$OUT/ota/$1.json" >&2; die "$1: failed: $2"; }
  stamp "$1: ok"
}

# step <name>: launch, wait, screenshot.
step() { stamp "step $1"; launch_ota; wait_settled "$1"; screenshot "$1"; }

stamp "runtime version $RV, channel $CHANNEL, server $BASE_URL"
curl -fsS "$BASE_URL/health" >/dev/null || die "no OTA server at $BASE_URL"

step 1-embedded
check 1-embedded '.running.isEmbeddedLaunch == true and .running.mark == "embedded" and .error == null'

ID_A=$(publish 2 "$EXPORT_A" "$KEYDIR/good" | tr '[:upper:]' '[:lower:]')
step 2-update-a
# iOS prints update ids upper case, Android lower case: compare folded.
check 2-update-a ".running.isEmbeddedLaunch == false and .running.mark == \"A\" and (.running.updateId | ascii_downcase) == \"$ID_A\""

# Tampered B: valid structure, signed with a key the app does not trust. The server serves it; the app must refuse it.
LINES_BEFORE=$(wc -l < "$WRANGLER_LOG")
publish 3 "$EXPORT_B" "$KEYDIR/bad" >/dev/null
step 3-tampered-b
check 3-tampered-b '.running.mark == "A" and (.error // "" | test("CodeSigning|signature"; "i"))'
tail -n +"$((LINES_BEFORE + 1))" "$WRANGLER_LOG" | grep -qE 'GET /manifest.* 200' \
  || die "3-tampered-b: wrangler.log shows no 200 manifest response, so B was not served to the client"

ota rollback --embedded --platform "$PLATFORM" --channel "$CHANNEL" --runtime-version "$RV" \
  --key "$KEYDIR/good/private-key.pem" --local > "$OUT/ota/publish-4.log" 2>&1 \
  || { cat "$OUT/ota/publish-4.log" >&2; die "rollback failed"; }
[[ "$(tail -n 1 "$OUT/ota/publish-4.log")" == "rolled-back "* ]] || die "rollback: unexpected last line: $(tail -n 1 "$OUT/ota/publish-4.log")"
step 4-rollback
check 4-rollback '.running.isEmbeddedLaunch == true and .running.mark == "embedded" and .error == null'

# Negative control: an update under another channel must not reach an app built for $CHANNEL.
publish 5 "$EXPORT_A" "$KEYDIR/good" other >/dev/null
step 5-other-channel
check 5-other-channel '.running.mark == "embedded"'

stamp "ota smoke passed"
