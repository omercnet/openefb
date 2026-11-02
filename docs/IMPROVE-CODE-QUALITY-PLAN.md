# Improve Code Quality Plan

Tracker for the `improve-code-quality` journey. Resume here: read this file, then `docs/TESTING.md`
and `docs/TECH-DEBT.md`, before entering a phase.

## Context

Started 2026-11-02 (ticket CQ-1 / dashboard T26, bead efb-dzz). Intake answered by the integrator; the owner
delegated the decisions, so they are recorded as confirmed.

1. **What it does / worst failure.** A free iPad VFR EFB (moving map, flight planning, recording, debrief).
   Worst failure: showing wrong or stale position, airspace, closures, frequencies or weather as current in
   flight (an airspace or border bust, a landing on a closed field), or losing a recorded flight.
2. **Change points.** Next to change: the Israel modules (`IsraelRoutePlanner`, `IsraelNotamService`,
   `IsraelNotamClosureMapper`, Israel alerts). Highest churn (`git log --format= --name-only | sort | uniq -c
   | sort -rn`): `ContentView.swift` 19, `MapService.swift` 15, `efb_212App.swift` 13, `MapViewModel.swift`
   13, `AppState.swift` 12, `MapContainerView.swift` 10, `LayerControlsView.swift` 9, `AviationDatabase.swift`
   9. Core domain: in-flight awareness (`LocationService`, `MapService`/`MapContainerView`,
   `ProximityAlertService`, `NearestAirportViewModel`, `GPSStatus`) and recording (`RecordingCoordinator`,
   `FlightPersistenceService`).
3. **Tests.** 763 Swift Testing unit tests at intake (967 `@Test` in the tree at the end of CQ-1, 90 of them added by CQ-1; other tickets added the rest), green via
   `tools/sim-test.sh test -only-testing:efb-212Tests`. NOTAM relay: 75 Vitest (`web/notam-relay`). Charts:
   4 (`web/charts`). The UI-test target holds template stubs only.
4. **Stack.** App: SwiftUI, MapLibre Native, GRDB (aviation and recording databases), SwiftData (user data),
   Swift 6 strict concurrency with `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`. Web: Next.js 16 on Vercel,
   Cloudflare Worker + KV, R2.
5. **Production.** Not yet; TestFlight is next. The interview site and NOTAM relay are live with very few
   users.
6. **Outbound dependencies.** aviationweather.gov, FAA TFR, FAA NOTAM API, FAA d-TPP, tile hosts (ArcGIS
   sectional, OpenFreeMap, Esri, OpenTopoMap), our NOTAM relay (IAA), R2 chart packs, Apple Foundation
   Models. Web: OpenAI Realtime, Vercel Blob, the IAA site.
7. **Scope now.** Phase 1 (gate) and Phase 7 (reliability, run as ticket CQ-7). Phases 2–4 and 6 after the
   Israel epic lands. Phase 5 after 2–4. Phases 8–9 skipped (single-user app, a few relay requests a minute);
   Phase 9's data-correctness questions (GRDB migrations, SwiftData) are folded into Phase 1's safety-net gaps.

## Phase Status

| Phase | Skill | Status | Artifact | Date |
|---|---|---|---|---|
| 1 — Build the safety net | working-with-legacy-code | done (CQ-1; characterization backlog remains in TESTING.md) | TESTING.md + TECH-DEBT.md (GATE) | 2026-11-02 |
| 2 — Make the code readable | clean-code | deferred: Israel epic in flight; run after it lands | TECH-DEBT.md | |
| 3 — Apply named refactorings | refactoring-patterns | deferred: Israel epic in flight; run after it lands | TECH-DEBT.md | |
| 4 — Reduce complexity | software-design-philosophy | deferred: Israel epic in flight; run after it lands | TECH-DEBT.md | |
| 5 — Draw the architecture boundary | clean-architecture | deferred: revisit after 2–4 | ARCHITECTURE.md | |
| 6 — Lock in the habits | pragmatic-programmer | deferred: runs with 2–4 | TECH-DEBT.md | |
| 7 — Make it survive production | release-it | done (CQ-7): web services fixed and relay deployed; 9 app findings filed under efb-zfm (.10 to .18); score 4/10 | RELIABILITY.md | 2026-11-02 |
| 8 — Size for real load | system-design | skipped: load is tiny (single-user app, a few relay requests a minute) | ARCHITECTURE.md + RELIABILITY.md | |
| 9 — Get the data layer right | ddia-systems | skipped: load is tiny; migration and durability questions folded into Phase 1 gaps | ARCHITECTURE.md | |
| Optional — Domain language | domain-driven-design | pending | ARCHITECTURE.md | |

Statuses: pending · in-progress · awaiting-evidence · done · deferred: <reason> · skipped: <reason>

## Key Decisions

| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-11-02 | Intake | Worst failure is wrong/stale in-flight data shown as current, or a lost recording. Gap ranking in TESTING.md follows this order. | Integrator answer 1. |
| 2026-11-02 | Intake | Phase 1 starting modules: `LocationService`/`GPSStatus`, `RecordingCoordinator`/`FlightPersistenceService` stop paths, `WeatherService`/`DataFreshness`, GRDB migrations, SwiftData migration, offline pack verification. Israel modules are mapped but not pinned now. | Three-axis heuristic; five agents are editing the Israel, briefing, debrief, diagram and planning files concurrently (CQ-1 §Coordination). |
| 2026-11-02 | Intake | Phases 2–4, 6 deferred until the Israel epic lands; 5 after 2–4; 8–9 skipped. | Integrator answer 7; load far below any scaling threshold. |
| 2026-11-02 | Intake | Phase 7 runs now as ticket CQ-7, not inside CQ-1. | Timeouts and breakers are table stakes before TestFlight. |
| 2026-11-02 | Phase 1 | Bugs found while characterizing are pinned at their current (wrong) value with a `// BUG efb-xxx` comment, filed as a bead with `discovered-from:efb-dzz`, and listed in the Debt Ledger. Never fixed silently. | Callers may depend on the quirk; a fix is a separate behavior commit. |
| 2026-11-02 | Phase 1 | Production edits limited to Parameterize Constructor with a production default. Seams added: `LocationService.init(appState:updates:noFixGrace:)`, `WeatherService.init(session:now:)`. No seams in files other agents own (`RecordingDatabase.swift`, `MapService.swift`, Israel/Debrief/Diagram files). | CQ-1 §3; every seam listed in TESTING.md §Seams. |
| 2026-11-02 | Phase 1 | Tests that recompute arithmetic inline without calling production code (`LocationManagerTests`) were replaced by tests that drive the real `LocationService`. | They pinned nothing and inflated the count. |

## Next Actions

- [x] CQ-7: Phase 7 integration-point audit → `docs/RELIABILITY.md` (done 2026-11-02; app fixes are beads efb-zfm.10–.18).
- [ ] After the Israel epic lands: pin the "pin after the Israel epic lands" rows of the Safety Net Map, then enter Phase 2 on `MapViewModel` and `ContentView` (highest churn).
- [ ] Fix the P1/P2 beads filed from Phase 1 (`docs/TECH-DEBT.md` Debt Ledger) as separate behavior commits, each with its pin test flipped to the correct value.
- [ ] Work the Characterization Backlog in TESTING.md top-down before any refactor of those modules.
