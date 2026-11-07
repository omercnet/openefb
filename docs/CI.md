# CI and the main branch

`main` accepts changes only through pull requests. The ruleset `main: pull requests only` (repo settings > Rules) requires a pull request and a passing `CI gate` check, blocks force pushes and deletion, and requires a linear history, so merge with squash or rebase. Direct pushes to `main` are rejected, for the owner too (no bypass).

## Workflow: `.github/workflows/ci.yml`

Runs on every pull request, on pushes to `main`, and by hand (`workflow_dispatch`). The repo is public, so GitHub-hosted macOS minutes are free. There are no path filters: a skipped required check never reports and would block the pull request. A new push to a pull request cancels its running jobs.

|Job|Runner|What it does|
|---|---|---|
|Lint and secrets|ubuntu-latest|The official `gitleaks/gitleaks-action` (gitleaks 8.30.1, `.gitleaks.toml`) reports on the pull request's commits. Then Conventional Commits on the PR range (`tools/hooks/commit-msg.sh --range`) and `tools/check.sh`: the pre-commit checks over the whole tree plus the full-history gitleaks scan, which stays the gate because the action walks first-parent commits only. lefthook 2.2.2 and gitleaks 8.30.1 come from `jdx/mise-action` (lefthook has no official setup action); plists and `project.pbxproj` are linted with libplist's `plistutil` (`tools/hooks/plist-lint.sh`). The web jobs cover `web/*`; swift-format stays report-only (and is skipped here).|
|Web (notam-relay, charts, interviews)|ubuntu-latest|`npm ci`, then tests / typecheck / lint as in `lefthook.yml`.|
|Unit tests (iPad simulator)|hosted macos-latest (temporarily; normally self-hosted Tart `tartelet`)|`tools/sim-test.sh test -only-testing:efb-212Tests` on iPad Pro 13-inch (M5). The `.xcresult` is uploaded when it fails.|
|Flight scenarios (iPad simulator)|hosted macos-latest (temporarily; normally self-hosted Tart `tartelet`)|Builds the DEBUG app and runs `tools/ci/fly-scenarios.sh`: five `tools/flight-sim` scenarios at 20x. It screenshots at 0/25/50/75/100% of each flight and fails if the app stops running, the scenario never loads, or a crash report appears. Recording runs without the microphone (`tools/fly.sh --no-audio`, DEBUG `-OpenEFBNoAudio`): the VMs' simulators abort inside CoreAudio when asked for audio input, BlackHole or not. Screenshots, app logs and crash reports are uploaded as the `scenario-captures` artifact. What the app does with the fixes is asserted by the unit suite (`efb-212Tests/Simulation`).|
|Build with the release Xcode (26.6, advisory)|macos-26|`tools/sim-test.sh build` with Xcode 26.6, the TestFlight toolchain. Not part of the gate: hosted macOS capacity runs out (jobs cancelled after 15 min queued), and that must not block merges. Check it before merging a release pull request.|
|CI gate|ubuntu-latest|Passes only when every job above passed. It is the one required check, so jobs can be renamed or added without touching the ruleset.|

**Temporary (2026-11-07):** the Tart runners are offline (none registered), so both test jobs run on hosted `macos-latest` with the image's default Xcode (`/Applications/Xcode.app`, 26.6 on today's macOS 26 image) for every event, forks included. Hosted capacity can queue them. When the runners are back, restore the previous `runs-on` / `DEVELOPER_DIR` expressions (described in the jobs' comments) and drop this note. The next two paragraphs describe that normal setup.

Normally the macOS test jobs run on the self-hosted Tart runners (image `ghcr.io/cirruslabs/macos-runner:golden-gate`, label `tartelet`, declared in `.github/actionlint.yaml`) because the hosted macOS arm64 pool often has no capacity. That image carries Xcode 27.x only, so those jobs build with Xcode 27.2; `DEVELOPER_DIR` is set at job level, before checkout (`/usr/bin/git` is an xcrun shim). Releases still archive with 26.6 (`release.yml`): the advisory 26.6 build job covers the gap, and a newer Xcode accepts code 26.6 rejects (a missing `import CoreLocation` in `IsraelBriefingView.swift` was the first case).

In the normal setup, pull requests from forks run the macOS jobs on hosted `macos-26` with Xcode 26.6. That routing lives in the workflow, which a fork can edit, so the boundary is the repository setting: fork pull request workflows need a maintainer's approval for all outside contributors (Settings › Actions › General).

Only the simulator jobs need macOS. Building the app on Linux (xtool) was ruled out on 2026-11-03: no iOS Simulator, no asset catalog compiler, no App Store upload, and Linux-built binaries record the wrong SDK version, which App Store Connect rejects.

## Workflow: `.github/workflows/release.yml`

|Job|Runner|What it does|
|---|---|---|
|Release pull request|ubuntu-latest|On every push to `main`, release-please (`release-please-config.json`, `.release-please-manifest.json`) keeps a pull request open that bumps `version.txt` and `CHANGELOG.md` from the Conventional Commits since the last release. Merging it tags `vX.Y.Z` and publishes the GitHub release.|
|TestFlight upload|macos-26, environment `testflight`|Runs when a release was just created, or by hand. Checks out the release tag (`refs/tags/vX.Y.Z`), installs the `Gemfile.lock` fastlane, and runs `bundle exec fastlane ios beta`: Release archive signed with the Apple Distribution identity (with the profile name sigh installed), version from the tag, build number = commit count, upload with symbols. With `TESTFLIGHT_GROUPS` set it checks each name against the app's external groups before building, waits for processing, adds the build to those groups and submits it for Beta App Review, with the release notes as What to Test, converted to plain text (TestFlight shows no markdown) without links, PR numbers, commit hashes or developer-only scopes (`TOOLING_SCOPES` in the Fastfile). By hand (`workflow_dispatch`): an upload needs the `tag` input (an existing `vX.Y.Z`); with `upload: false` and no tag it archives and signs the commit it was dispatched at; `build_number` overrides the commit count, which a retry needs once Apple has accepted an upload of that number. Runs of the workflow queue in order (`concurrency.queue: max`), so a manual run never cancels the push run that tags a release. gym logs are uploaded when it fails.|

Secrets, in the `testflight` environment (only that job sees them):

|Name|What|
|---|---|
|`ASC_KEY_ID`, `ASC_ISSUER_ID`|App Store Connect API key ids (the key that `~/.appstoreconnect/openefb.env` names)|
|`ASC_KEY_P8`|The `.p8` key file contents|
|`DIST_CERT_P12_BASE64`, `DIST_CERT_P12_PASSWORD`|The Apple Distribution identity (certificate and private key), base64 `.p12` and its password. Imported into a throwaway keychain per run. When the certificate expires or is revoked, export the new one and replace both.|

Repository variable `TESTFLIGHT_GROUPS` (comma-separated, now `Public Beta`, the external group with the public link) names the external groups; empty means internal testing only. Repository secret `RELEASE_PLEASE_TOKEN` (optional, fine-grained token with Contents and Pull requests read/write on this repo): a release pull request opened with the default `GITHUB_TOKEN` does not trigger CI, so its required `CI gate` never reports. Without the token, close and reopen the release pull request to start CI.

The same lane runs on the owner's Mac (`bundle install`, then `bundle exec fastlane ios beta`, `upload:false` to stop after signing); see `dist-prep/TESTFLIGHT.md`.

## Workflow: `.github/workflows/testflight-crashes.yml`

Manual. Fetches the newest TestFlight crash submissions of the app (`GET /v1/apps/6829641724/betaFeedbackCrashSubmissions`, then each `crashLog`) with the `testflight` environment's App Store Connect key. The repository and its artifacts are public and a crash log carries tester and device details, so the job prints only counts and uploads a one-day artifact encrypted (CMS, AES-256) to a certificate you pass in. `tools/testflight-crashes.sh [limit]` does all of it from a shell: creates a key and certificate in `~/.config/kanaf` once, dispatches the workflow on `main`, waits, downloads and decrypts into `build/testflight-crashes/` (`<id>.crash` plus `<id>.json` with the tester's comment, device and build). The same fetch runs on a Mac with `tools/testflight-crashes.py` when the key is in `~/.appstoreconnect/`.

## Working with it

```bash
git switch -c fix/short-name
# ... work ...
git push -u origin fix/short-name
gh pr create --repo omercnet/openefb       # forks default to upstream: always pass --repo
gh pr checks --watch --repo omercnet/openefb
gh pr merge --squash --repo omercnet/openefb
```

The integrator's `git commit-tree` snapshot flow (docs/handoff/COMMON.md) still works on a branch; it must now end in a pull request instead of a push to `main`. The pull request title becomes the squash commit, so write it as a Conventional Commit.

A CodeRabbit "changes requested" review blocks the merge until its comments are fixed or the review is dismissed, even with no required approvals.

Run the simulator scenarios locally with `tools/sim-test.sh build` then `tools/ci/fly-scenarios.sh [scenario ...]` (`OUT=<dir>`, `SPEED=<n>`).

## Not done

- Actions are referenced by major version tag, not commit SHA.
- No required reviewers: a sole owner cannot approve their own pull request.
- The TestFlight job has run only by hand so far; the first release-please release is its first real run.
- `release.yml` (TestFlight) still runs on hosted `macos-26` and can wait on hosted capacity.
