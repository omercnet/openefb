#!/usr/bin/env bash
# Thin wrapper so callers (tools/caai-chart/publish.sh) don't care about node_modules. Arguments: see `publish.sh --help`.
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules/wrangler ] || npm ci --no-audit --no-fund >&2
exec node publish.mjs "$@"
