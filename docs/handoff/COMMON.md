# OpenEFB agent brief (shared by all implementers)

Worktree: /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal (branch review-project-health).
App: OpenEFB, a free open-source iPad VFR EFB (SwiftUI, MapLibre, GRDB). Read AGENTS.md and the
docs/ folder first (docs/CUSTOMER.md, docs/IMPROVE-APP-PLAN.md, docs/DESIGN.md when it exists).

## Ground rules
- Several agents work in this worktree AT THE SAME TIME. Edit only the files your task owns. If you
  must touch a shared file (MapService.swift, MapContainerView.swift, AppState.swift, Types.swift,
  project.pbxproj), keep the edit minimal and re-read the file right before editing.
- Do NOT git commit, stash, reset, checkout or rebase. Commit signing is unavailable, and the
  integrator snapshots the tree.
- Project build settings: SWIFT_VERSION 5 with SWIFT_DEFAULT_ACTOR_ISOLATION=MainActor. Pure
  parsing and model code used off the main actor must be `nonisolated`. Copy patterns from
  Services/WeatherService.swift and efb-212Tests/ServiceTests/WeatherParsingTests.swift.
- For network tests, use `StubURLProtocol.session { request in (200, data) }` from
  efb-212Tests/Mocks/StubURLProtocol.swift. Use Swift Testing (`@Test`, `#expect`).
- Conventions: every service has a protocol; no force unwraps in production; use EFBError for
  errors; comment aviation units (`// feet MSL`, `// knots`). New files are picked up automatically
  (file-system synchronized groups), so don't edit project.pbxproj for them.
- EFB lens for anything the pilot sees:
  - Glanceable in sunlight; in-flight controls larger than 44pt.
  - Red = warning and amber = caution, only.
  - Keep standard aviation abbreviations.
  - Never show stale or unvalidated data as current.
  - Minimal animation in flight.
## Build and test: your own simulator, through tools/sim-test.sh
Each agent gets its own simulator so nobody waits. Set `SIM_TAG` to your ticket id and use
`tools/sim-test.sh`; it creates "OpenEFB · <worktree> · <ticket>" on first use and reuses it.
NEVER touch simulators that aren't yours (no `simctl shutdown all`, `delete all` or `erase`).
```
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export SIM_TAG=<your-ticket-id>              # e.g. T07; also gives you a private derived-data dir
tools/sim-test.sh build -quiet                                       # compile app + tests
tools/sim-test.sh test -only-testing:efb-212Tests/<SuiteName>        # run your suites
RESULT=/tmp/<ticket>.xcresult tools/sim-test.sh test -only-testing:efb-212UITests/<YourTmpTests>
tools/sim-test.sh demo                       # install + launch the built app at KPAO on your sim
tools/sim-test.sh id                         # your sim UDID, for `simctl io <id> screenshot` etc.
tools/sim-test.sh delete                     # delete your sim when you are completely done
```
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
