#!/usr/bin/env bash
# The selection table of tools/ci/resolve-testflight-target.sh: push / dispatch x app x tag x upload. A fake `git` answers the tag
# check (tag v1.3.0 exists, v9.9.9 does not). Run: tools/ci/resolve-testflight-target.test.sh
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
script="$here/resolve-testflight-target.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/bin"
cat > "$work/bin/git" <<'G'
#!/usr/bin/env bash
[ "$1" = ls-remote ] && [[ "$*" == *"refs/tags/v1.3.0"* ]] && exit 0
exit 2
G
chmod +x "$work/bin/git"

SHA=0123456789abcdef0123456789abcdef01234567
fails=0
total=0

# run <name> <expected: "ok ref version upload note" | "fail"> VAR=value...
run() {
  local name=$1 expected=$2; shift 2
  total=$((total + 1))
  : > "$work/out"
  local status=0
  env -i PATH="$work/bin:$PATH" GITHUB_OUTPUT="$work/out" GITHUB_SHA=$SHA GITHUB_REPOSITORY=o/r "$@" bash "$script" >"$work/log" 2>&1 || status=$?
  local got
  if [ $status -ne 0 ]; then
    got=fail
  else
    got="ok $(sed -n 's/^ref=//p' "$work/out") $(sed -n 's/^version=//p' "$work/out") $(sed -n 's/^upload=//p' "$work/out") [$(sed -n 's/^preview_note=//p' "$work/out")]"
  fi
  if [ "$got" = "$expected" ]; then
    printf 'ok   %s\n' "$name"
  else
    printf 'FAIL %s\n  expected: %s\n  got:      %s\n' "$name" "$expected" "$got"
    fails=$((fails + 1))
  fi
}

MAIN=GITHUB_REF=refs/heads/main
# push (release-please created a tag, or the job is skipped upstream: then there is no tag and no upload)
run "push, release tag"                          "ok refs/tags/v1.3.0 1.3.0 true []"  EVENT=push RELEASE_TAG=v1.3.0 $MAIN
run "push, no tag (cannot happen: job skipped)"   fail                                 EVENT=push $MAIN
run "push, malformed tag"                         fail                                 EVENT=push RELEASE_TAG=1.3 $MAIN
# dispatch, with a tag
run "dispatch, tag, upload, app swift"           "ok refs/tags/v1.3.0 1.3.0 true []"  EVENT=workflow_dispatch INPUT_TAG=v1.3.0 INPUT_UPLOAD=true INPUT_APP=swift $MAIN
run "dispatch, tag, upload, app rn"              "ok refs/tags/v1.3.0 1.3.0 true []"  EVENT=workflow_dispatch INPUT_TAG=v1.3.0 INPUT_UPLOAD=true INPUT_APP=rn $MAIN
run "dispatch, tag that does not exist"           fail                                 EVENT=workflow_dispatch INPUT_TAG=v9.9.9 INPUT_UPLOAD=true INPUT_APP=rn $MAIN
run "dispatch, tag, upload off"                  "ok refs/tags/v1.3.0 1.3.0 false []" EVENT=workflow_dispatch INPUT_TAG=v1.3.0 INPUT_UPLOAD=false INPUT_APP=rn $MAIN
# dispatch, no tag, upload off (the signing check)
run "dispatch, no tag, upload off, app rn"       "ok $SHA  false []"                  EVENT=workflow_dispatch INPUT_UPLOAD=false INPUT_APP=rn $MAIN
run "dispatch, no tag, upload off, app swift"    "ok $SHA  false []"                  EVENT=workflow_dispatch INPUT_UPLOAD=false INPUT_APP=swift $MAIN
run "dispatch, no tag, upload off, variable"     "ok $SHA  false []"                  EVENT=workflow_dispatch INPUT_UPLOAD=false INPUT_APP=variable $MAIN
# dispatch, no tag, upload on: only app=rn from main (the RN preview)
run "dispatch, no tag, upload, app rn, main"     "ok $SHA  true [RN preview from 0123456]" EVENT=workflow_dispatch INPUT_UPLOAD=true INPUT_APP=rn $MAIN
run "dispatch, no tag, upload, app rn, branch"    fail                                 EVENT=workflow_dispatch INPUT_UPLOAD=true INPUT_APP=rn GITHUB_REF=refs/heads/feature
run "dispatch, no tag, upload, app rn, tag ref"   fail                                 EVENT=workflow_dispatch INPUT_UPLOAD=true INPUT_APP=rn GITHUB_REF=refs/tags/v1.3.0
run "dispatch, no tag, upload, app swift"         fail                                 EVENT=workflow_dispatch INPUT_UPLOAD=true INPUT_APP=swift $MAIN
run "dispatch, no tag, upload, app variable"      fail                                 EVENT=workflow_dispatch INPUT_UPLOAD=true INPUT_APP=variable $MAIN
run "dispatch, no tag, upload, app empty"         fail                                 EVENT=workflow_dispatch INPUT_UPLOAD=true $MAIN
run "dispatch, no tag, upload unset, app rn"     "ok $SHA  true [RN preview from 0123456]" EVENT=workflow_dispatch INPUT_APP=rn $MAIN
# a push can never be a preview, whatever the inputs look like
run "push with app=rn in the environment"         fail                                 EVENT=push INPUT_APP=rn INPUT_UPLOAD=true $MAIN

printf '%s of %s cases passed\n' $((total - fails)) "$total"
[ "$fails" -eq 0 ]
