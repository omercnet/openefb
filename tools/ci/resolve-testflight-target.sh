#!/usr/bin/env bash
# What the TestFlight job builds (release.yml, "Resolve what to build"). Reads the environment, writes ref, version, upload and
# preview_note to $GITHUB_OUTPUT. Kept in a script so tools/ci/resolve-testflight-target.test.sh can run the table of cases.
#
#   EVENT          push | workflow_dispatch          RELEASE_TAG   the tag release-please just created (push)
#   INPUT_TAG      the `tag` input                   INPUT_UPLOAD  the `upload` input (true | false)
#   INPUT_APP      the `app` input (variable | swift | rn)
#   GITHUB_SHA, GITHUB_REF, GITHUB_REPOSITORY, GITHUB_OUTPUT
#
# An upload builds a release tag: the one release-please just created, or the `tag` input of a manual run. A manual sign-only
# run (upload off, no tag) builds the commit it was dispatched at. One exception, the RN preview: a manual run with app=rn,
# upload on and no tag, dispatched from main, builds that commit for the internal TestFlight group, as the NEXT MINOR of
# version.txt (1.3.0 -> 1.4.0, owner decision Q3: the RN app ships as the next minor). The current version is the Swift app's
# train, which App Store Connect may have closed to new builds; a build on a closed train is rejected after processing.
# Any other untagged upload fails.
set -euo pipefail

: "${EVENT:?}" "${GITHUB_SHA:?}" "${GITHUB_OUTPUT:?}"
upload=true
[ "$EVENT" = workflow_dispatch ] && [ "${INPUT_UPLOAD:-}" = false ] && upload=false
tag=${RELEASE_TAG:-${INPUT_TAG:-}}
version=""
preview_note=""

if [ -n "$tag" ]; then
  [[ $tag =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "::error::tag '$tag' is not vX.Y.Z"; exit 1; }
  git ls-remote --exit-code --tags "https://github.com/${GITHUB_REPOSITORY:-}" "refs/tags/$tag" >/dev/null \
    || { echo "::error::tag $tag does not exist"; exit 1; }
  ref="refs/tags/$tag"
  version="${tag#v}"
elif [ "$upload" = false ]; then
  ref="$GITHUB_SHA"
elif [ "$EVENT" = workflow_dispatch ] && [ "${INPUT_APP:-}" = rn ]; then
  # The App Store Connect key goes only to reviewed code on main.
  [ "${GITHUB_REF:-}" = refs/heads/main ] \
    || { echo "::error::an RN preview upload runs only from main, not from '${GITHUB_REF:-}'"; exit 1; }
  ref="$GITHUB_SHA"
  current=$(tr -d '[:space:]' < "${VERSION_FILE:-$(dirname "$0")/../../version.txt}" 2>/dev/null || true)
  [[ $current =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] \
    || { echo "::error::version.txt ('$current') is not X.Y.Z, cannot pick the preview version"; exit 1; }
  version="${BASH_REMATCH[1]}.$((BASH_REMATCH[2] + 1)).0"
  preview_note="RN preview from ${GITHUB_SHA:0:7}"
else
  echo "::error::an upload needs a release tag: set the tag input (vX.Y.Z), turn upload off, or run app=rn from main for an RN preview"
  exit 1
fi

{
  echo "ref=$ref"
  echo "version=$version"
  echo "upload=$upload"
  echo "preview_note=$preview_note"
} >> "$GITHUB_OUTPUT"
