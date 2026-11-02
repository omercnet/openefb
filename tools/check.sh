#!/usr/bin/env bash
# Runs the pre-commit checks without git hooks. The integrator commits with `git commit-tree`, which bypasses
# hooks, so run this before it.
#   tools/check.sh            all tracked files (lefthook pre-commit --all-files) + full-history gitleaks scan
#   tools/check.sh --staged   only staged files, like the hook
#   tools/check.sh --quick    skip the history scan
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

mode=all
history=1
for a in "$@"; do
  case "$a" in
    --staged) mode=staged ;;
    --quick) history=0 ;;
    *) echo "usage: tools/check.sh [--staged] [--quick]" >&2; exit 2 ;;
  esac
done

command -v lefthook >/dev/null || { echo "lefthook missing: mise use -g lefthook@latest" >&2; exit 2; }

rc=0
if [ "$mode" = all ]; then
  lefthook run pre-commit --all-files || rc=1
else
  lefthook run pre-commit || rc=1
fi

if [ "$history" -eq 1 ]; then
  gitleaks git --no-banner --redact=100 . || rc=1
fi

[ "$rc" -eq 0 ] && echo "check.sh: all checks passed" || echo "check.sh: FAILED" >&2
exit "$rc"
