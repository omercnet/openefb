#!/usr/bin/env bash
# Conventional Commits check (https://www.conventionalcommits.org).
#   commit-msg.sh <message-file>        lefthook commit-msg hook
#   commit-msg.sh --range <rev-range>   check every non-merge commit in a range (pre-push, tools/check.sh)
# Subject: <type>(<optional scope>)<optional !>: <description>, at most 100 characters.
set -u

TYPES='feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert'
PATTERN="^($TYPES)(\([a-z0-9._/-]+\))?!?: [^[:space:]]"

# check_subject <subject> <label>; prints the problem and returns 1 when the subject fails.
check_subject() {
  local subject="$1" label="$2"
  if [ -z "$subject" ]; then
    echo "commit-msg: $label: empty subject" >&2
    return 1
  fi
  if [ "${#subject}" -gt 100 ]; then
    echo "commit-msg: $label: subject is ${#subject} characters (max 100)" >&2
    return 1
  fi
  if ! printf '%s\n' "$subject" | grep -Eq "$PATTERN"; then
    echo "commit-msg: $label: not a Conventional Commit: \"$subject\"" >&2
    echo "  expected <type>(<scope>): <description>, type one of: ${TYPES//|/ }" >&2
    echo "  examples: feat(israel): show closure age    fix: keep stale METAR badge    docs: update TESTING" >&2
    return 1
  fi
}

if [ "${1:-}" = "--range" ]; then
  [ -n "${2:-}" ] || { echo "usage: commit-msg.sh --range <rev-range>" >&2; exit 2; }
  failed=0
  # $2 is intentionally unquoted: it can hold "<sha> --not --remotes".
  # shellcheck disable=SC2086
  while IFS=$'\t' read -r sha subject; do
    check_subject "$subject" "${sha:0:7}" || failed=1
  done < <(git log --no-merges --format='%H%x09%s' $2)
  exit "$failed"
fi

subject=$(grep -v '^#' "$1" | sed -n '/[^[:space:]]/{p;q;}')
case "$subject" in
  "Merge "* | "fixup! "* | "squash! "* | "amend! "*) exit 0 ;; # git-generated; fixups are squashed before pushing
esac
check_subject "$subject" "message" || exit 1
