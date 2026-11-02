# Git hooks and checks

lefthook runs the hooks in `lefthook.yml`. gitleaks is configured in `.gitleaks.toml`.

## Install (once per clone)

```bash
mise use -g lefthook@latest     # or: brew install lefthook
lefthook install                # writes the git hooks
```

gitleaks and shellcheck come from mise too (`mise use -g gitleaks shellcheck`); swift-format is `xcrun swift-format`.

## What runs

| Hook | Job | Blocks? |
|---|---|---|
| pre-commit | gitleaks on staged changes | yes |
| | forbidden files (`tools/hooks/forbidden-files.sh`): `*.p8`, `.env*` (not `.env.example`), `*.mobileprovision`, `*.xcarchive`, `*TmpTests.swift`, CAAI artwork paths, new files over 5 MB (`efb-212/Resources/*.sqlite` allowed) | yes |
| | `plutil -lint` on `.plist`, `.xcprivacy`, `.entitlements`, `project.pbxproj` | yes |
| | `python3 -m json.tool` on `*.json` | yes |
| | shellcheck on `*.sh` | yes |
| | Python syntax (compiled in memory, so tracked `.pyc` files stay untouched) | yes |
| | `swift-format lint` with `.swift-format` | **no, report only** |
| | `npm run lint` (web/interviews), `npm test` (web/notam-relay, web/charts) when those folders have staged files | yes |
| pre-push | Conventional Commits for every pushed commit (catches `git commit-tree` commits); gitleaks over the pushed range; `tools/sim-test.sh build -quiet` (skipped without `xcodebuild`); web tests for changed packages | yes |
| commit-msg | Conventional Commits: `<type>(<scope>)!: <description>`, type `feat fix docs style refactor perf test build ci chore revert`, subject at most 100 characters (`Merge`, `fixup!`, `squash!`, `amend!` pass) | yes |
| post-checkout, post-merge | prints an `npm ci` reminder when `web/*/package-lock.json` changed | no |

`.agents/skills/**` and `.claude/skills/**` are excluded from the JSON, shellcheck, Python and swift-format jobs.

swift-format is report-only because the tree has about 4,400 findings with the repo config (indentation, line length 120,
spacing). Reformatting is a separate change. Make the job blocking by removing `|| true` in `lefthook.yml` after a format pass.

## Skipping

```bash
git commit --no-verify
LEFTHOOK_EXCLUDE=swift-format,web-relay git commit ...
LEFTHOOK_EXCLUDE=pre-push-build git push        # or: git push --no-verify
```

## Without git: `tools/check.sh`

The integrator commits with `git commit-tree`, which bypasses hooks. `tools/check.sh` runs the pre-commit jobs over every tracked
file and then a full-history `gitleaks git` scan. `--staged` checks only staged files, `--quick` skips the history scan.

## Full unit suite

Not in a hook (about 4 minutes): `tools/sim-test.sh test -only-testing:efb-212Tests`.

## gitleaks

`gitleaks git --no-banner .` scans history. Extra rules: App Store Connect `.p8` / PKCS#8 keys, Cloudflare tokens, Vercel
tokens, OpenAI `sk-` keys, FAA NOTAM client secrets. Allowed: `op://` 1Password references, the public R2 dev URL,
`web/notam-relay/test/`. For a one-off historical false positive, add its fingerprint to `.gitleaksignore`.
`gitleaks dir .` also scans ignored folders (`node_modules`, `.next`, `.build`), which hold third-party noise; use `git`.
