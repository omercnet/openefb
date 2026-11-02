# DOCS-2: Make the docs match the code after the Israel work (dashboard T29)

Use the `technical-documentation` skill (.claude/skills/technical-documentation/SKILL.md): audit, score, then fix. The
last docs pass (T15) predates the Israel epic, `web/`, the R2 packs and the NOTAM relay.

Check every claim against the code and the live services; don't trust older docs.
- **AGENTS.md:**
  - Current State: test count from a fresh run, the Israel region, `web/` and its live URLs, the R2 packs;
  - File Organization: new Services/Data/Views files, tools/caai-importer, caai-chart, caai-apd, web/;
  - Key Dependencies and network services: the IAA NOTAM relay, R2 charts, Cloudflare, Vercel;
  - Known Issues: from open beads;
  - Build & Run: web/ commands.
  Keep it accurate and concise.
- **README.md:** the Israel features (CVFR chart, routing and FPL, NOTAM closures, diagrams, aerodromes), the
  limitations (validation gates, the ±100 ft diagrams, the CAAI data date, the unreviewed-data rules), and the data
  credits (CAAI, FAA, NOAA, OpenFreeMap, …).
- **web/README.md** and the per-package READMEs: they match what's deployed (relay URL, R2 dev URL, Vercel project,
  git-connected deploys, the build-skip rule).
- **NOTICE:** every data source with its attribution.
- **PRD.md:** extend the dated header note with the Israel scope, which wasn't in the original PRD. Don't rewrite the
  body.
- **dist-prep/:**
  - check the App Store text still matches;
  - add Israel to the description only if the owner's release plan includes it; otherwise note it in
    dist-prep/README.md as a pending decision;
  - check the privacy labels: the interviews site isn't part of the app, but the NOTAM relay and chart downloads are
    network calls the app makes.
- **docs/handoff/COMMON.md:** the current rules: parallel-agent file ownership, the dashboard commands, the simulator
  pool, the gitignored CAAI artwork screenshot paths.

Starts after T28 (the Israel UX review), so the docs describe the final state. Run `tools/sim-test.sh test
-only-testing:efb-212Tests` once for the real count. Docs only. Close nothing; don't commit. Report a list of the
claims you corrected and the doc score before and after.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T29 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
