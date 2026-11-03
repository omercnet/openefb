#!/usr/bin/env bash
# Lints property lists (XML, binary and the OpenStep format of project.pbxproj). Usage: plist-lint.sh <file>...
# macOS: plutil -lint. Linux: libplist's plistutil (apt install libplist-utils), which parses every input format when
# an output format is forced. Exit 1 when any file fails to parse.
set -u

if command -v plutil >/dev/null; then
  exec plutil -lint "$@"
fi
command -v plistutil >/dev/null || { echo "plist-lint: need plutil (macOS) or plistutil (libplist-utils)" >&2; exit 2; }

fail=0
for f in "$@"; do
  if plistutil -i "$f" -f xml -o /dev/null; then
    echo "$f: OK"
  else
    echo "invalid plist: $f" >&2
    fail=1
  fi
done
exit "$fail"
