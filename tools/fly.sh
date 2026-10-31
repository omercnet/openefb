#!/bin/bash
# Fly a simulated VFR route on this worktree's simulator (feeds GPS to the running app).
#   tools/fly.sh            # KPAO → KSQL → KOAK → KSFO at ~100 kt
#   tools/fly.sh stop       # stop the route
# Env: SPEED (m/s, default 50 ≈ 97 kt), SIM_TAG (fly on an agent's own sim).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
SIM=$(tools/sim-test.sh id)

if [ "${1:-}" = "stop" ]; then
  xcrun simctl location "$SIM" clear
  exit 0
fi
xcrun simctl location "$SIM" clear
xcrun simctl location "$SIM" start --speed="${SPEED:-50}" --interval=1 \
  37.4611,-122.1150 37.5124,-122.2495 37.7213,-122.2208 37.6189,-122.3750
echo "Flying KPAO → KSQL → KOAK → KSFO on $SIM. Stop with: tools/fly.sh stop"
