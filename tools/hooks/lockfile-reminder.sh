#!/usr/bin/env bash
# post-checkout / post-merge: remind (print only) to run `npm ci` when a web or app lockfile changed.
# Usage: lockfile-reminder.sh <old-ref> <new-ref>   (ORIG_HEAD..HEAD for post-merge)
set -u

old="${1:-ORIG_HEAD}"
new="${2:-HEAD}"
# A null old ref (first checkout) or an unresolvable one means there is nothing to compare.
git rev-parse --verify --quiet "$old^{commit}" >/dev/null || exit 0

changed=$(git diff --name-only "$old" "$new" -- 'web/*/package-lock.json' 'app/package-lock.json' 2>/dev/null)
for lock in $changed; do
  echo "hooks: $lock changed. Run: (cd $(dirname "$lock") && npm ci)"
done
exit 0
