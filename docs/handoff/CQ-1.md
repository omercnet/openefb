# CQ-1: Code-quality journey, intake and Phase 1 safety net (dashboard T26)

Use the `improve-code-quality` skill (.claude/skills/improve-code-quality/SKILL.md) and, for Phase 1, the
`working-with-legacy-code` skill. The codebase grew fast through many agents. Before TestFlight we need to know what is
pinned by tests and what isn't.

## Intake (answered by the integrator; the owner delegated decisions, so record these as confirmed)
1. **What it does / worst failure:** a free iPad VFR EFB. Worst failure: showing wrong or stale position, airspace,
   closures, frequencies or weather as current in flight (an airspace or border bust, a landing on a closed field), or
   losing a recorded flight.
2. **Change points:** the Israel modules change next: IsraelRoutePlanner, IsraelNotamService and the closure mapper,
   Israel alerts. Find the highest-churn modules with `git log --format= --name-only | sort | uniq -c | sort -rn | head
   -30`. The core domain is in-flight awareness (LocationService, MapService/MapContainerView, ProximityAlertService,
   NearestAirport, GPS status) and recording (RecordingCoordinator, FlightPersistenceService).
3. **Tests:** 763 Swift Testing unit tests, green (`tools/sim-test.sh test -only-testing:efb-212Tests`). Relay: 75
   Vitest (web/notam-relay). Charts: 4 (web/charts). The UI-test target holds template stubs only.
4. **Stack:**
   - app: SwiftUI, MapLibre, GRDB (aviation and recording databases), SwiftData (user data), Swift 6 strict
     concurrency;
   - web: Next.js 16 (Vercel), Cloudflare Worker + KV, R2.
5. **Production:** not yet; TestFlight is next. The interview site and NOTAM relay are live with very few users.
6. **Outbound dependencies:** aviationweather.gov, FAA TFR, FAA NOTAM API, FAA d-TPP, the tile hosts (ArcGIS sectional,
   OpenFreeMap, Esri, OpenTopoMap), our NOTAM relay (IAA), R2 chart packs, Apple Foundation Models; web: OpenAI
   Realtime, Vercel Blob, the IAA site.
7. **Plan:**
   - Phase 1 (gate) and Phase 7 (reliability) now; Phase 7 runs as a separate ticket (CQ-7).
   - Phases 2–4 `deferred: Israel epic in flight; run after it lands`.
   - Phase 5 `deferred: revisit after 2–4`.
   - Phase 6 runs with 2–4.
   - Phases 8–9 `skipped: load is tiny (single-user app, a few relay requests a minute)`. Phase 9's data-correctness
     questions (GRDB migrations, SwiftData) are folded into Phase 1's safety-net gaps instead.

## Do
1. Create `docs/IMPROVE-CODE-QUALITY-PLAN.md` from the skill's template with every phase statused as above, and record the
   intake decisions under Key Decisions.
2. **Phase 1:**
   - Build `docs/TESTING.md`: the Test Strategy, and a Safety Net Map covering every core module above (pinned
     behaviors, test files, gaps), from the existing tests. Read them; don't guess.
   - Build `docs/TECH-DEBT.md`: the Debt Ledger and the Sprout/Wrap Register.
   - Rank the gaps by risk (worst failure first).
   - Write characterization tests for the highest-risk unpinned behaviors in modules **no other agent is editing
     now**: LocationService and GPS status, FlightPersistenceService / RecordingCoordinator stop paths, the
     WeatherService freshness/staleness rules, the GRDB migrations (aviation and recording databases open on an old
     schema), SwiftData migration safety, and the offline map pack verification.
   - Pin current behavior. Bugs you find: pin the wrong value, file a bead (discovered-from, P per risk), and list it in
     the Debt Ledger. Never fix silently.
3. **Don't touch production code** except the least-invasive seam a test needs (Parameterize Constructor with a
   production default). Note every seam in TESTING.md.

## Coordination
Agents editing app code right now:
- FIX-1: MapService route colour, IsraelFlightPlanMessage, Views/Planning, the aircraft profile;
- IL-BRIEF: NOTAM briefing, weather formatting for Israel;
- IL-ALERTS: ActiveNavigationBar, ProximityAlertService (Israel), alert banners;
- IL-DEBRIEF: Services/Debrief, Recording vocabulary, Views/Flights;
- IL-DIAG2: AirportDiagram*, tools/caai-apd, the map badges.
Don't add seams in those files. List their modules in the Safety Net Map, with gaps marked "pin after the Israel epic
lands".

Full unit suite green at the end, run once. Follow docs/handoff/COMMON.md (claim a simulator with
`export SIM_TAG=$(tools/sim-test.sh claim CQ1)` and release it). Close nothing; don't commit. Report: the tracker state,
the top 10 gaps by risk, the tests added, and the bugs filed.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T26 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
