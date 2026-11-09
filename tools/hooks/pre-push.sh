#!/usr/bin/env bash
# pre-push helper. Usage: pre-push.sh commits|gitleaks|build|web   (stdin = git's "<lref> <lsha> <rref> <rsha>" lines)
# Skip any step: LEFTHOOK_EXCLUDE=pre-push-commits,pre-push-gitleaks,pre-push-build,pre-push-web git push   (or git push --no-verify)
set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

ZERO=0000000000000000000000000000000000000000
step="${1:-}"

# Collect pushed ranges once from git's pre-push stdin. New branches (remote sha all zeros) use commits not on any remote.
# lefthook passes stdin to a job only with use_stdin, and then to one job only, so with no stdin fall back to the commits
# on HEAD that no remote has yet.
ranges=()
while read -r _lref lsha _rref rsha; do
  [ -z "${lsha:-}" ] && continue
  [ "$lsha" = "$ZERO" ] && continue # deleting a branch
  if [ "$rsha" = "$ZERO" ]; then
    ranges+=("$lsha --not --remotes")
  else
    ranges+=("$rsha..$lsha")
  fi
done
[ "${#ranges[@]}" -gt 0 ] || ranges+=("HEAD --not --remotes")

case "$step" in
  commits)
    # Conventional Commits for every pushed commit, including ones made with git commit-tree (no commit-msg hook).
    for r in "${ranges[@]}"; do
      tools/hooks/commit-msg.sh --range "$r" || exit 1
    done
    ;;
  gitleaks)
    command -v gitleaks >/dev/null || { echo "pre-push: gitleaks not installed, skipping"; exit 0; }
    [ "${#ranges[@]}" -eq 0 ] && exit 0
    for r in "${ranges[@]}"; do
      # $r is intentionally unquoted: it can hold "<sha> --not --remotes".
      # shellcheck disable=SC2086
      gitleaks git --no-banner --log-opts="$r" . || exit 1
    done
    ;;
  build)
    if ! command -v xcodebuild >/dev/null; then
      echo "pre-push: xcodebuild not found (not macOS?), skipping app build"
      exit 0
    fi
    export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
    tools/sim-test.sh build -quiet
    ;;
  web)
    [ "${#ranges[@]}" -eq 0 ] && exit 0
    changed=""
    for r in "${ranges[@]}"; do
      # shellcheck disable=SC2086
      changed+=$'\n'"$(git diff --name-only $r 2>/dev/null)"
    done
    for pkg in notam-relay charts ota; do
      if printf '%s\n' "$changed" | grep -q "^web/$pkg/"; then
        echo "pre-push: npm test in web/$pkg"
        (cd "web/$pkg" && npm test) || exit 1
      fi
    done
    if printf '%s\n' "$changed" | grep -q '^web/interviews/'; then
      echo "pre-push: npm run build in web/interviews"
      (cd web/interviews && npm run build) || exit 1
    fi
    ;;
  *)
    echo "usage: pre-push.sh commits|gitleaks|build|web" >&2
    exit 2
    ;;
esac
