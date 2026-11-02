#!/bin/bash
# Run xcodebuild against this worktree's one simulator, one run at a time.
#
# Several agents work in a worktree at once. Booting extra simulators or running two xcodebuild
# test sessions on one device at the same time crashed the simulator host, so every simulator use
# goes through this script: it takes a per-worktree lock and reuses one simulator per worktree.
#
# Usage:
#   tools/sim-test.sh test  [-only-testing:efb-212Tests/SomeSuite ...]   # unit/UI tests
#   tools/sim-test.sh build                                               # build for the sim
#   tools/sim-test.sh demo  [lat,lon]                                     # install + launch the built app
#   tools/sim-test.sh id                                                  # print the sim UDID
#   tools/sim-test.sh claim <ticket>                                      # reuse a free agent simulator (prints its tag)
#   tools/sim-test.sh release                                             # give SIM_TAG's simulator back to the pool
#   tools/sim-test.sh delete                                              # delete this SIM_TAG's simulator
#   tools/sim-test.sh teardown                                            # delete every simulator of this worktree
# Extra args are passed to xcodebuild. Set DD=<path> for a private derived-data dir
# (default /tmp/efb-dd-<worktree>). Result bundles: RESULT=<path.xcresult>.
# SIM_DEVICE=<device type name> picks the simulator model (default "iPad Pro 13-inch (M5)"; e.g.
# "iPhone 17 Pro" or "iPhone 17e"). `claim` only reuses simulators of that model and names new ones
# after it ("iphone17pro-pool1"), so a SIM_TAG implies its model.
set -euo pipefail
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

ROOT=$(git rev-parse --show-toplevel)
NAME=$(basename "$ROOT")
# SIM_TAG=<ticket> gives an agent its own simulator (and its own lock), so agents don't wait
# on each other. Without it, everyone shares the worktree simulator one run at a time.
SUFFIX=${SIM_TAG:+ · $SIM_TAG}
SIM_NAME="OpenEFB · $NAME$SUFFIX"
DD=${DD:-/tmp/efb-dd-$NAME${SIM_TAG:+-$SIM_TAG}}
LOCK=/tmp/efb-sim-lock-$NAME${SIM_TAG:+-$SIM_TAG}
RUNTIME=$(xcrun simctl list runtimes | grep -oE 'com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9]+-[0-9]+' | sort -Vu | tail -1)
SIM_DEVICE=${SIM_DEVICE:-iPad Pro 13-inch (M5)}
DEFAULT_DEVICE="iPad Pro 13-inch (M5)"
DEVICE_TYPE=$(xcrun simctl list devicetypes | grep -F "$SIM_DEVICE (" | grep -oE 'com\.apple\.CoreSimulator\.SimDeviceType\.[A-Za-z0-9-]+' | head -1 || true)
[ -n "$DEVICE_TYPE" ] || { echo "sim-test: unknown SIM_DEVICE '$SIM_DEVICE' (see xcrun simctl list devicetypes)" >&2; exit 2; }
# Pool tags are prefixed by the model, except the default iPad ("pool1", "iphone17pro-pool1").
if [ "$SIM_DEVICE" = "$DEFAULT_DEVICE" ]; then TAG_PREFIX=""; else TAG_PREFIX="$(echo "$SIM_DEVICE" | tr -d ' ()' | tr '[:upper:]' '[:lower:]')-"; fi

CLAIMS=/tmp/efb-sim-claims-$NAME
CLAIM_TTL_MIN=${CLAIM_TTL_MIN:-480}   # a claim older than this is treated as abandoned

# Tags of existing agent simulators of this model in this worktree ("OpenEFB · <worktree> · <tag>").
pool_tags() {
  xcrun simctl list devices -j | python3 -c '
import json, sys
prefix, dtype = sys.argv[1], sys.argv[2]
for devs in json.load(sys.stdin)["devices"].values():
    for d in devs:
        if d["name"].startswith(prefix) and d.get("deviceTypeIdentifier") == dtype and d.get("isAvailable", True):
            print(d["name"][len(prefix):])
' "OpenEFB · $NAME · " "$DEVICE_TYPE" | sort -u
}

sim_id() {
  local id
  id=$(xcrun simctl list devices | grep -F "$SIM_NAME (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
  if [ -z "$id" ]; then
    id=$(xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME")
  fi
  echo "$id"
}

acquire() {
  local waited=0
  until mkdir "$LOCK" 2>/dev/null; do
    if [ -f "$LOCK/pid" ] && ! kill -0 "$(cat "$LOCK/pid")" 2>/dev/null; then
      rm -rf "$LOCK"; continue        # stale lock from a dead run
    fi
    [ $((waited % 60)) -eq 0 ] && echo "sim-test: waiting for another run to finish ($waited s)" >&2
    sleep 5; waited=$((waited + 5))
  done
  echo $$ > "$LOCK/pid"
  trap 'rm -rf "$LOCK"' EXIT
}

cmd=${1:-test}; shift || true
case "$cmd" in
  id) sim_id; exit 0 ;;
  build)
    exec xcodebuild build-for-testing -project "$ROOT/efb-212.xcodeproj" -scheme efb-212 \
      -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO "$@" </dev/null ;;
  test)
    acquire
    SIM=$(sim_id)
    xcrun simctl boot "$SIM" 2>/dev/null || true
    xcrun simctl bootstatus "$SIM" -b >/dev/null
    args=(test -project "$ROOT/efb-212.xcodeproj" -scheme efb-212 -destination "id=$SIM"
          -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO)
    [ -n "${RESULT:-}" ] && { rm -rf "$RESULT"; args+=(-resultBundlePath "$RESULT"); }
    xcodebuild "${args[@]}" "$@" </dev/null ;;
  demo)
    acquire
    SIM=$(sim_id)
    xcrun simctl boot "$SIM" 2>/dev/null || true
    xcrun simctl bootstatus "$SIM" -b >/dev/null
    BUNDLE=io.omer.efb
    xcrun simctl install "$SIM" "$DD/Build/Products/Debug-iphonesimulator/efb-212.app"
    xcrun simctl privacy "$SIM" grant location-always "$BUNDLE" || true
    xcrun simctl spawn "$SIM" defaults write "$BUNDLE" hasSeenOnboarding -bool YES
    xcrun simctl location "$SIM" set "${1:-32.0114,34.8867}"   # LLBG: a fresh install starts in Israel; pass 37.4611,-122.1150 for KPAO
    xcrun simctl terminate "$SIM" "$BUNDLE" 2>/dev/null || true
    xcrun simctl launch "$SIM" "$BUNDLE"
    open -g /Applications/Xcode.app/Contents/Applications/DeviceHub.app 2>/dev/null || true ;;
  claim)
    # Reuse an existing agent simulator nobody holds; create one only when all are busy.
    owner=${1:-agent}; mkdir -p "$CLAIMS"
    exec 9>"$CLAIMS/.lock"; while ! mkdir "$CLAIMS/.mutex" 2>/dev/null; do sleep 1; done
    trap 'rmdir "$CLAIMS/.mutex" 2>/dev/null || true' EXIT
    tag=""
    for t in $(pool_tags); do
      f="$CLAIMS/$t"
      if [ ! -f "$f" ] || [ -n "$(find "$f" -mmin +"$CLAIM_TTL_MIN" 2>/dev/null)" ]; then tag=$t; break; fi
    done
    if [ -z "$tag" ]; then n=1; while pool_tags | grep -qx "${TAG_PREFIX}pool$n"; do n=$((n + 1)); done; tag="${TAG_PREFIX}pool$n"; fi
    echo "$owner $(date -u +%FT%TZ)" > "$CLAIMS/$tag"
    SIM_NAME="OpenEFB · $NAME · $tag"; sim_id >/dev/null
    echo "$tag" ;;
  release)
    [ -n "${SIM_TAG:-}" ] && rm -f "$CLAIMS/$SIM_TAG" ;;
  delete)
    [ -n "${SIM_TAG:-}" ] || { echo "delete needs SIM_TAG (refusing to delete the shared worktree sim)" >&2; exit 2; }
    id=$(xcrun simctl list devices | grep -F "$SIM_NAME (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
    [ -n "$id" ] && { xcrun simctl shutdown "$id" 2>/dev/null || true; xcrun simctl delete "$id"; } ;;
  teardown)
    prefix="OpenEFB · $NAME"
    xcrun simctl list devices | grep -F "$prefix" | grep -oE '[0-9A-F-]{36}' | while read -r id; do
      xcrun simctl shutdown "$id" 2>/dev/null || true
      xcrun simctl delete "$id" && echo "deleted $id"
    done
    rm -rf "/tmp/efb-dd-$NAME" /tmp/efb-dd-"$NAME"-* /tmp/efb-sim-lock-"$NAME"* ;;
  *) echo "usage: $0 test|build|demo|id|claim|release|delete|teardown [xcodebuild args]" >&2; exit 2 ;;
esac
