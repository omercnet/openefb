# HOOKS: gitleaks + lefthook (dashboard T37)

The owner wants secret scanning and git hooks wired to this repo's own scripts, plus whatever is useful for Swift and
Xcode.

Installed on this Mac:
- gitleaks (mise);
- shellcheck (mise);
- `swift-format` in the Xcode toolchain (`xcrun swift-format`).
lefthook is not installed: install it with mise (preferred, matching the others) or brew, and document how. Read the
repo first: tools/sim-test.sh, tools/fly.sh, tools/*/README, web/*/package.json, AGENTS.md "Build & Run" and
docs/handoff/COMMON.md.

## 1. gitleaks
- **Scan the full history first** with `gitleaks git` (or `detect`, depending on the installed version). Report every
  finding, classified as true secret / false positive.
  - If a **real secret** is in history, stop and report it, with the commit, the file and the secret type. Never print
    the secret value. Don't rewrite history yourself.
- **`.gitleaks.toml`:** extend the default rules (`[extend] useDefault = true`) and add rules for what this project
  handles:
  - App Store Connect `.p8` keys (`-----BEGIN PRIVATE KEY-----`);
  - Cloudflare API tokens;
  - Vercel tokens;
  - OpenAI keys (`sk-…`);
  - FAA NOTAM client secrets;
  - 1Password references are fine.
- Allowlist the known false positives narrowly, by path or regex, with a comment each: test fixtures, the public R2 dev
  URL, research samples, the scenario JSON. Prefer `.gitleaksignore` fingerprints for one-off historical false
  positives.
- Make sure `.gitignore` covers `*.p8`, `.env*`, `fastlane_api_key.json`, `.vercel`, `.wrangler` and `*.mobileprovision`.
  Add any that are missing.

## 2. lefthook (`lefthook.yml` at the repo root)
Keep the hooks fast and scoped to staged files.

**pre-commit,** in parallel where safe:
- **gitleaks** on the staged changes (`gitleaks git --pre-commit --staged`, or the version's equivalent). This one
  blocks.
- **Forbidden files:** block committing `*.p8`, `.env*` (except `.env.example`), `*.mobileprovision`, `*.xcarchive`,
  `*TmpTests.swift`, and anything under the gitignored CAAI artwork paths (`docs/design/screenshots/IL-9|IL-13|UX-IL-CAAI`,
  `tools/caai-*/input|out`). Also block single files over 5 MB, except an allowlist of known large assets
  (`efb-212/Resources/*.sqlite`).
- **Plists:** `plutil -lint` on staged `.plist`, `.xcprivacy`, `.entitlements` and `project.pbxproj`. A broken pbxproj is
  the classic multi-agent failure.
- **JSON:** `python3 -m json.tool` on staged `*.json`, including the asset catalog `Contents.json` and the flight-sim
  scenarios.
- **Shell:** `shellcheck` on staged `*.sh` (tools/, dist-prep/, web/). Fix the existing scripts' warnings, or add
  precise disables with a reason, so the hook passes on the current tree.
- **Python:** `python3 -m py_compile` on staged `*.py` (tools/flight-sim, tools/caai-*).
- **Swift:** `xcrun swift-format lint` on staged `*.swift`, with a repo `.swift-format` config that matches the current
  style (4-space indent, the line length used in the codebase; measure it). Run it over the whole tree first.
  - If the current code has many violations, make this job **non-blocking** (report only) and say so in the README.
    Don't reformat the codebase in this ticket.
  - If it's nearly clean, make it blocking and fix the few violations.
- **web/:** when staged files are under `web/interviews`, run `npm run lint` there; under `web/notam-relay` or
  `web/charts`, run `npm test` there. Use lefthook `root:` and `glob:` scoping.

**pre-push** (heavier; skippable with `LEFTHOOK_EXCLUDE=…` or `--no-verify`, documented):
- the full gitleaks scan of the pushed range;
- `tools/sim-test.sh build -quiet`, which compiles the app and tests. Skip it on a Linux host where `xcodebuild` is
  missing, with a clear message;
- the web tests for the changed packages.
Not the full unit suite: it takes about 4 minutes, so document how to run it.

**commit-msg:** block an empty subject and a subject over 100 characters. Nothing heavier.

**post-checkout / post-merge:** if the `web/*/package-lock.json` changed, remind the user to run `npm ci` (print only).

## 3. Integrate with how this repo commits
The integrator commits with `git commit-tree` from a verified tree, which **bypasses hooks**. Add a script
`tools/check.sh` that runs the same pre-commit checks over a given tree or the whole repo (`lefthook run pre-commit
--all-files`, or the equivalent), so the integrator can run it before `commit-tree`. Document it in COMMON.md and
AGENTS.md (Build & Run, plus a "Hooks" section), and add a `check` script to paseo.json.

## 4. Verify
- `lefthook install`, then show that each pre-commit job passes on the current tree (`lefthook run pre-commit
  --all-files`).
- Demonstrate blocking with temporary files you then delete:
  - a fake `.p8` / `sk-` key gets blocked by gitleaks;
  - a broken plist is caught;
  - a `*TmpTests.swift` is blocked.
- `tools/check.sh` passes.
- Don't commit; the integrator will. No other agents are running now.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T37 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
