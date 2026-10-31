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
#   tools/sim-test.sh delete                                              # delete this SIM_TAG's simulator
#   tools/sim-test.sh teardown                                            # delete every simulator of this worktree
# Extra args are passed to xcodebuild. Set DD=<path> for a private derived-data dir
# (default /tmp/efb-dd-<worktree>). Result bundles: RESULT=<path.xcresult>.
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

sim_id() {
  local id
  id=$(xcrun simctl list devices | grep -F "$SIM_NAME (" | grep -oE '[0-9A-F-]{36}' | head -1 || true)
  if [ -z "$id" ]; then
    id=$(xcrun simctl create "$SIM_NAME" "iPad Pro 13-inch (M5)" "$RUNTIME")
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
    xcrun simctl location "$SIM" set "${1:-37.4611,-122.1150}"
    xcrun simctl terminate "$SIM" "$BUNDLE" 2>/dev/null || true
    xcrun simctl launch "$SIM" "$BUNDLE"
    open -g /Applications/Xcode.app/Contents/Applications/DeviceHub.app 2>/dev/null || true ;;
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
  *) echo "usage: $0 test|build|demo|id|delete|teardown [xcodebuild args]" >&2; exit 2 ;;
esac
