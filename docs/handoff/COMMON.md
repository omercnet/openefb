# Kanaf agent brief (shared by all implementers)

Worktree: /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal (branch review-project-health).
App: Kanaf, a free open-source iPad VFR EFB (SwiftUI, MapLibre, GRDB). Read AGENTS.md and the
docs/ folder first (docs/CUSTOMER.md, docs/IMPROVE-APP-PLAN.md, docs/DESIGN.md when it exists).

## Ground rules
- Several agents work in this worktree AT THE SAME TIME. Edit only the files your task owns. If you
  must touch a shared file (MapService.swift, MapContainerView.swift, AppState.swift, Types.swift,
  project.pbxproj), keep the edit minimal and re-read the file right before editing.
- Your task brief names the files you own. Docs-only tasks edit only the docs named in the brief; code tasks don't edit docs
  other than the ones named. Shared files are listed above; for `AGENTS.md` and `README.md`, report the change you need
  instead of editing unless your brief owns them.
- Do NOT git commit, stash, reset, checkout or rebase. Commit signing is unavailable, and the
  integrator snapshots the tree.
- Project build settings: SWIFT_VERSION 6.0, strict concurrency complete, SWIFT_DEFAULT_ACTOR_ISOLATION=MainActor. Pure
  parsing and model code used off the main actor must be `nonisolated`. Copy patterns from
  Services/WeatherService.swift and efb-212Tests/ServiceTests/WeatherParsingTests.swift.
- For network tests, use `StubURLProtocol.session { request in (200, data) }` from
  efb-212Tests/Mocks/StubURLProtocol.swift. Use Swift Testing (`@Test`, `#expect`).
- Conventions: every service has a protocol; no force unwraps in production; use EFBError for
  errors; comment aviation units (`// feet MSL`, `// knots`). New files are picked up automatically
  (file-system synchronized groups), so don't edit project.pbxproj for them.
- EFB lens for anything the pilot sees:
  - Glanceable in sunlight; in-flight controls at least 60pt (`MapControlMetrics.size`), other tappables at least 44pt.
  - Red = warning and amber = caution, only.
  - Keep standard aviation abbreviations.
  - Never show stale or unvalidated data as current.
  - Minimal animation in flight.
## Build and test: claim a simulator from the pool, through tools/sim-test.sh
Reuse simulators; don't create fresh ones. At the start, claim a free agent simulator, which reuses one from a
finished task and only creates one when all are busy. Release it at the end. Never delete simulators.
```
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export SIM_TAG=$(tools/sim-test.sh claim <your-ticket-id>)   # e.g. prints T09; also selects its derived-data dir
tools/sim-test.sh build -quiet                                       # compile app + tests
tools/sim-test.sh test -only-testing:efb-212Tests/<SuiteName>        # run your suites
RESULT=/tmp/<ticket>.xcresult tools/sim-test.sh test -only-testing:efb-212UITests/<YourTmpTests>
tools/sim-test.sh demo                       # install + launch the built app at KPAO on your sim
tools/sim-test.sh id                         # your sim UDID, for `simctl io <id> screenshot` etc.
tools/sim-test.sh release                    # when you are completely done (do NOT delete the sim)
```
iPhone checks: `SIM_DEVICE="iPhone 17 Pro" tools/sim-test.sh claim <ticket>` claims an iPhone simulator (tags look like
`iphone17pro-pool1`; use `SIM_DEVICE="iPhone 17e"` for the narrowest width). `claim` only reuses a simulator of the same model,
and the default stays the iPad Pro 13-inch. Then `export SIM_TAG=<printed tag>` as usual; the tag implies the model. Layouts
switch on `horizontalSizeClass` (iPhone portrait is compact), never on the device; the iPad layouts must stay as they are.
NEVER touch simulators that aren't yours (no `simctl shutdown all`, `delete all` or `erase`).
A claim older than 8 hours (`CLAIM_TTL_MIN`, default 480) counts as abandoned and can be reused by the next `claim`.
`delete` and `teardown` exist for the integrator; agents never run them. Without `SIM_TAG`, everyone shares the worktree
simulator, one run at a time (a lock serialises them).
Before you finish, run the FULL unit suite once (`-only-testing:efb-212Tests`) and make sure it is
green. If another agent's in-progress edit breaks the build in a file you don't own, wait a few
minutes and retry. Don't fix their file.

UI changes need visual proof. Write a throwaway XCUITest in efb-212UITests/ (name ending in
`TmpTests.swift`). Launch with `app.launchArguments += ["-hasSeenOnboarding", "YES"]` and set
`XCUIDevice.shared.location`. Attach screenshots with
`XCTAttachment(screenshot:)`, `lifetime = .keepAlways`. Run it with `-resultBundlePath` and export with
`xcrun xcresulttool export attachments`. Look at the screenshots. Delete the throwaway test when
done. Accessibility labels in use: "Search airports", "Toggle map layers", "Close map layers",
"Zoom in", "Zoom out"; the airport sheet close button has identifier "xmark.circle.fill".

## Screenshots that show CAAI artwork stay out of git
The official CAAI CVFR chart and aerodrome diagrams are (c) CAAI, base map (c) Mapa Ltd, and the project holds no recorded
permission to publish them. A screenshot that shows that artwork goes under one of these gitignored folders and is never
committed:
- `docs/design/screenshots/IL-9/` (CVFR chart)
- `docs/design/screenshots/IL-13/` (aerodrome diagrams)
- `docs/design/screenshots/UX-IL-CAAI/` (Israel usability review shots that show either)
Screenshots without that artwork (US map, FAA diagrams, Israel screens that show only our own vector overlay or text, such
as `docs/design/screenshots/UX-IL/`) are committed. Raw CAAI inputs and built packs are gitignored too:
`tools/caai-importer/input/`, `tools/caai-chart/input/` and `out/`, `tools/caai-apd/input/` and `out/`. Check with
`git check-ignore -v <path>` before adding a file near them.

## web/ (server side)
`web/notam-relay`, `web/charts` and `web/interviews` each have their own `package.json` and README. Edit only the folder your
task owns. Check with `npm ci && npm test` (relay, charts) or `npm ci && npm run build` (interviews) in that folder. Never
deploy, publish or approve an edition yourself: `wrangler deploy`, `web/charts/publish.sh --remote` and `vercel --prod` are
the owner's or integrator's calls. See `web/README.md` for what is live.

## Hooks and checks
Git hooks (lefthook, `lefthook.yml`) block secrets, forbidden files and broken plist/JSON/shell/Python on commit. Don't commit
(see ground rules), but never bypass them either. The integrator's `git commit-tree` skips hooks, so run `tools/check.sh`
(whole tree + history secret scan) before it; `tools/check.sh --staged` checks only staged files. Never put a secret, a `.p8`,
a `.env*` file or a `*TmpTests.swift` in a tree that will be committed. Details: `tools/hooks/README.md`.

## Tracking
- beads: `bd update <issue> --claim` at start. Record notable decisions with `bd update <issue> --notes "..."`.
  For a follow-up you discover but don't own: `bd create "<title>" -t bug|task -p 2 --deps discovered-from:<issue> -d "..."`.
  Do NOT close your issue; the integrator closes it after verifying.
- Paseo dashboard (plain words, for a product manager):
  - at each new stage: `cd <worktree> && paseo-progress ticket update <TICKET> --stage <Build|Review|Fixes|Verify>`
  - between stages: `cd <worktree> && paseo-progress ticker set "<what you are doing now>"`
  - milestones: `paseo-progress activity add "<text>" --ticket <TICKET>`
  - screenshots or reports worth reviewing: `paseo-progress deliverable add "<title>" <path> --ticket <TICKET> --kind screenshot|report`
    (copy screenshots into docs/design/screenshots/ first so they persist)
  - Do NOT mark the ticket done; the integrator does that.

## Final reply
List the files changed, what you changed and why, the tests added, the exact test results (counts),
what you verified visually, and anything left undone or uncertain.
