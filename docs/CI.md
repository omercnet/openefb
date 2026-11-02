# CI and the main branch

`main` accepts changes only through pull requests. The ruleset `main: pull requests only` (repo settings > Rules) requires a pull request and a passing `CI gate` check, blocks force pushes and deletion, and requires a linear history, so merge with squash or rebase. Direct pushes to `main` are rejected, for the owner too (no bypass).

## Workflow: `.github/workflows/ci.yml`

Runs on every pull request, on pushes to `main`, and by hand (`workflow_dispatch`). The repo is public, so GitHub-hosted macOS minutes are free. There are no path filters: a skipped required check never reports and would block the pull request. A new push to a pull request cancels its running jobs.

|Job|Runner|What it does|
|---|---|---|
|Lint and secrets|macos-26|Conventional Commits on the PR range (`tools/hooks/commit-msg.sh --range`), then `tools/check.sh`: the pre-commit checks over the whole tree plus the full-history gitleaks scan. The web jobs cover `web/*`; swift-format stays report-only.|
|Web (notam-relay, charts, interviews)|ubuntu-latest|`npm ci`, then tests / typecheck / lint as in `lefthook.yml`.|
|Unit tests (iPad simulator)|macos-26|`tools/sim-test.sh test -only-testing:efb-212Tests` on iPad Pro 13-inch (M5). The `.xcresult` is uploaded when it fails.|
|Flight scenarios (iPad simulator)|macos-26|Builds the DEBUG app and runs `tools/ci/fly-scenarios.sh`: five `tools/flight-sim` scenarios at 20x. It screenshots at 0/25/50/75/100% of each flight and fails if the app stops running, the scenario never loads, or a crash report appears. Screenshots, app logs and crash reports are uploaded as the `scenario-captures` artifact. What the app does with the fixes is asserted by the unit suite (`efb-212Tests/Simulation`).|
|CI gate|ubuntu-latest|Passes only when every job above passed. It is the one required check, so jobs can be renamed or added without touching the ruleset.|

Xcode is pinned to 26.6 (`DEVELOPER_DIR` in the workflow). The iOS target is 26.0 and `macos-26` ships iOS 26.5 simulators; move the pin when the image drops 26.6. A newer local Xcode accepts code the CI compiler rejects (a missing `import CoreLocation` in `IsraelBriefingView.swift` was the first case), so CI is the reference build.

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
- Release builds, TestFlight upload and signing are not in CI (no secrets are configured).
- One run saw `LocationServiceCharacterizationTests/fixIsConvertedToKnotsFeetAndDegrees` miss its 10 s wait on a cold runner; the next run passed. If it recurs, raise the wait in `waitUntil` or run the suite without parallel clones.
