#!/usr/bin/env bash
# Blocks files that must never be committed. Usage: forbidden-files.sh <file>...
# Names are repo-relative paths (lefthook {staged_files}). Exit 1 when any is forbidden.
set -u

MAX_BYTES=$((5 * 1024 * 1024))
fail=0

for f in "$@"; do
  case "$f" in
    *.p8 | *.p12 | *.mobileprovision | *.xcarchive | *.xcarchive/* | *TmpTests.swift)
      echo "forbidden file: $f" >&2; fail=1; continue ;;
    private-key.pem | */private-key.pem | public-key.pem | */public-key.pem)
      echo "forbidden file (signing key material, never committed): $f" >&2; fail=1; continue ;;
    .env.example | */.env.example) ;;
    .env* | */.env*)
      echo "forbidden file (env): $f" >&2; fail=1; continue ;;
    docs/design/screenshots/IL-9/* | docs/design/screenshots/IL-13/* | docs/design/screenshots/UX-IL-CAAI/*)
      echo "forbidden file (CAAI artwork, never committed): $f" >&2; fail=1; continue ;;
    tools/caai-*/input/* | tools/caai-*/out/*)
      echo "forbidden file (raw CAAI input or built pack): $f" >&2; fail=1; continue ;;
  esac

  [ -f "$f" ] || continue
  case "$f" in
    efb-212/Resources/*.sqlite) continue ;; # bundled aviation databases are large by design
  esac
  # Only files new to HEAD are size-checked: oversized files that were already committed (old screenshots) stay.
  git cat-file -e "HEAD:$f" 2>/dev/null && continue
  size=$(wc -c <"$f" | tr -d ' ')
  if [ "$size" -gt "$MAX_BYTES" ]; then
    echo "file over 5 MB ($size bytes): $f (allowlist: efb-212/Resources/*.sqlite)" >&2
    fail=1
  fi
done

exit "$fail"
