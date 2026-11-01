#!/usr/bin/env bash
# Publish a built CVFR chart edition to the chart host (Cloudflare R2) through web/charts/publish.sh.
#
#   tools/caai-chart/publish.sh <edition> [--remote --base-url https://<public-host>] [--manifest-only]
#                                         [--approve] [--dry-run]
#
# Default target is wrangler's LOCAL R2 simulator, so nothing leaves this machine. --remote uploads to
# the real bucket and is for the owner only. Without --approve the edition is uploaded with
# published=false and the app ignores it; --approve flips published=true (add --manifest-only to skip
# re-uploading the pack). Publishing never unpublishes. A failed validation gate blocks --approve.
#
# Setup (owner, once) and the URL layout: web/charts/README.md. Alternatives to R2 for the same
# <base>/israel-cvfr/<edition>/ layout: any S3-compatible bucket or static host; upload the pack and
# manifest.json under that path, then write <base>/israel-cvfr/manifest.json (index) the way
# web/charts/lib.mjs does. The app only needs the layout and the sha256 in files[].
#
# The pack (c) CAAI, base map (c) Mapa Ltd. Do not publish before the CAAI permission is settled.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
product="israel-cvfr"

if [[ $# -lt 1 || "$1" == -* ]]; then
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
fi
edition="$1"; shift

dir="$here/out/$edition"
pack="$dir/$product-$edition.mbtiles"
manifest="$dir/manifest.json"
[[ -f "$pack" && -f "$manifest" ]] || { echo "no build for edition '$edition' in $dir (run: python -m caai_chart build ...)" >&2; exit 1; }

approve=0
for a in "$@"; do [[ "$a" == "--approve" ]] && approve=1; done

if [[ $approve -eq 1 ]]; then
  python3 - "$manifest" <<'PY'
import json, sys
m = json.load(open(sys.argv[1], encoding="utf-8"))
if not m["validation"]["passed"]:
    sys.exit("refusing --approve: the validation gate failed for this edition: " + "; ".join(m["validation"]["failures"]))
PY
fi

exec "$repo/web/charts/publish.sh" --product "$product" --edition "$edition" --pack "$pack" --manifest "$manifest" "$@"
