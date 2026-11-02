#!/bin/bash
# Paseo "simulator" service: build Kanaf, run it on this worktree's simulator, and stream the
# simulator into the browser (serve-sim) on the port Paseo assigns. Open the service URL in Paseo.
#
# Env: PASEO_PORT (from Paseo; default 3200), LOCATION=lat,lon (default KPAO).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}

echo "Building Kanaf for the simulator…"
APP="${DD:-/tmp/efb-dd-$(basename "$PWD")}/Build/Products/Debug-iphonesimulator/efb-212.app"
if ! tools/sim-test.sh build -quiet; then
  # Agents edit this worktree concurrently, so a mid-edit tree may not compile. Show the last
  # build that did, rather than nothing.
  [ -d "$APP" ] || { echo "Build failed and there is no earlier build to show." >&2; exit 1; }
  echo "Build failed (work in progress?). Launching the last successful build instead." >&2
fi
tools/sim-test.sh demo "${LOCATION:-37.4611,-122.1150}"

SIM=$(tools/sim-test.sh id)

# serve-sim's helper looks for SimulatorKit under its own lib/ dir among other places; Xcode 27 moved
# the framework to Contents/SharedFrameworks. Keep a stable install and point lib/ at Xcode's copy.
SERVE_SIM_DIR=${SERVE_SIM_DIR:-$HOME/.cache/openefb-serve-sim}
if [ ! -x "$SERVE_SIM_DIR/node_modules/.bin/serve-sim" ]; then
  mkdir -p "$SERVE_SIM_DIR"
  npm install --prefix "$SERVE_SIM_DIR" --silent --no-audit --no-fund serve-sim@0.1.40
fi
mkdir -p "$SERVE_SIM_DIR/node_modules/serve-sim/lib"
ln -sfn "$(dirname "$DEVELOPER_DIR")/SharedFrameworks/SimulatorKit.framework" \
  "$SERVE_SIM_DIR/node_modules/serve-sim/lib/SimulatorKit.framework"

echo "Streaming the simulator at ${PASEO_URL:-http://localhost:${PASEO_PORT:-3200}}"
exec "$SERVE_SIM_DIR/node_modules/.bin/serve-sim" --port "${PASEO_PORT:-3200}" "$SIM"
