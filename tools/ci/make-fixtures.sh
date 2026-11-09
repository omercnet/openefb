#!/usr/bin/env bash
# Generate the Swift app's on-disk data as ground truth for the React Native importer (ticket D1).
#   tools/ci/make-fixtures.sh [profile ...]      default: full small
# Needs a DEBUG build first: tools/sim-test.sh build. Env: OUT (default /tmp/efb-fixtures), DD and SIM_TAG as in
# tools/sim-test.sh.
# Per profile: fresh install, launch the app with -OpenEFBSeed <profile> (efb-212/Services/Simulation/SeedDataHook.swift
# writes the data through the app's own persistence), wait for Documents/seed-report.json, copy the store files while
# the app is still running ("live": -wal and -shm as an in-use store leaves them), terminate, copy again ("closed"),
# and export UserDefaults. Layout: $OUT/<profile>/{live,closed}/..., $OUT/<profile>/seed-report.json, container.txt.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

OUT=${OUT:-/tmp/efb-fixtures}
BUNDLE=io.omer.efb
DD=${DD:-/tmp/efb-dd-$(basename "$PWD")${SIM_TAG:+-$SIM_TAG}}
APP="$DD/Build/Products/Debug-iphonesimulator/efb-212.app"
PROFILES=("$@")
[ ${#PROFILES[@]} -gt 0 ] || PROFILES=(full small)
[ -d "$APP" ] || { echo "make-fixtures: no build at $APP (run tools/sim-test.sh build)" >&2; exit 1; }

SIM=$(tools/sim-test.sh id)
echo "simulator $SIM"
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null

# collect <container> <dest>: the SwiftData store (default.store*), the recording database, preferences.
collect() {
  local container=$1 dest=$2 support="$1/Library/Application Support"
  mkdir -p "$dest"
  while IFS= read -r f; do
    rel=${f#"$support"/}
    mkdir -p "$dest/support/$(dirname "$rel")"
    cp "$f" "$dest/support/$rel"
  done < <(find "$support" -type f \( -name 'default.store*' -o -name 'recording.sqlite*' \) 2>/dev/null)
  [ -f "$container/Library/Preferences/$BUNDLE.plist" ] && cp "$container/Library/Preferences/$BUNDLE.plist" "$dest/$BUNDLE.container.plist" || true
}

for profile in "${PROFILES[@]}"; do
  echo "::group::seed $profile"
  dest="$OUT/$profile"
  rm -rf "$dest"; mkdir -p "$dest"
  xcrun simctl terminate "$SIM" "$BUNDLE" 2>/dev/null || true
  xcrun simctl uninstall "$SIM" "$BUNDLE" 2>/dev/null || true
  xcrun simctl install "$SIM" "$APP"
  xcrun simctl launch "$SIM" "$BUNDLE" -OpenEFBSeed "$profile" -OpenEFBNoAudio YES >/dev/null
  container=$(xcrun simctl get_app_container "$SIM" "$BUNDLE" data)
  report="$container/Documents/seed-report.json"
  for _ in $(seq 1 120); do [ -f "$report" ] && break; sleep 1; done
  [ -f "$report" ] || { echo "make-fixtures: no seed report after 120 s" >&2; find "$container" -type f | head -50 >&2; exit 1; }
  sleep 2   # let SwiftData and GRDB finish their writes
  cp "$report" "$dest/seed-report.json"
  grep -q '"error"' "$report" && { cat "$report" >&2; exit 1; }

  collect "$container" "$dest/live"
  xcrun simctl spawn "$SIM" defaults export "$BUNDLE" - >"$dest/live/$BUNDLE.defaults-export.plist" 2>/dev/null || true
  xcrun simctl terminate "$SIM" "$BUNDLE" || true
  sleep 3
  collect "$container" "$dest/closed"
  xcrun simctl spawn "$SIM" defaults export "$BUNDLE" - >"$dest/closed/$BUNDLE.defaults-export.plist" 2>/dev/null || true
  (cd "$container" && find . -type f \( -path './Library/*' -o -path './Documents/*' \) -exec ls -l {} + | awk '{print $5, $9, $10, $11}') >"$dest/container.txt" || true
  echo "::endgroup::"
done
echo "make-fixtures: ${PROFILES[*]} in $OUT"
