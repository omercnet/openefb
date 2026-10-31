# Improve App Plan

## Context
Started 2026-10-31. OpenEFB, a free open-source iPad VFR EFB (SwiftUI, MapLibre).

Intake:
- **Users:** weekend VFR pilots (PRD.md §3). Primary job: J1, in-flight awareness (docs/CUSTOMER.md).
- **Roughest area:** in-flight trust in the map. Offline behaviour, map follow, staleness signals, night use.
- **Evidence:** none yet (no pilot testers). Findings are audit-based until interviews run (beads `efb-77r.7`).
- **Platform:** native iPad only. No browser surface.
- **Upsell surfaces:** none in the app (the PRD's cloud tier isn't built).
- **Existing docs:** PRD.md (personas, positioning, IA). No prior docs/ artifacts.

EFB lens (applies to every phase):
- Glanceable in sunlight; in-flight controls larger than 44pt (turbulence).
- Night palette that preserves dark adaptation.
- Red = warning and amber = caution, only.
- Keep standard aviation abbreviations.
- Never show stale or unvalidated data as current.
- Minimal animation in flight.

Work items live in beads (epic `efb-77r`). This file holds phase status and decisions only.

## Phase Status
| Phase | Skill | Status | Artifact | Beads | Date |
|---|---|---|---|---|---|
| 1 | jobs-to-be-done | done (assumption-based; validate via efb-77r.7) | CUSTOMER.md | efb-77r.1 | 2026-10-31 |
| 2 | ux-heuristics | done (18 findings, 4 sev-4 / 8 sev-3) | DESIGN.md | efb-77r.2 | 2026-10-31 |
| 3 | design-everyday-things | done (gulf analysis merged into findings) | DESIGN.md | efb-77r.2 | 2026-10-31 |
| 3b | ios-hig-design (optional, added) | pending | DESIGN.md | efb-77r.3 | |
| 4 | refactoring-ui | pending | DESIGN.md, EXPERIMENTS.md | efb-77r.4 | |
| 5 | microinteractions | pending | DESIGN.md, EXPERIMENTS.md | efb-77r.5 | |
| 6 | made-to-stick | pending | POSITIONING.md, EXPERIMENTS.md | efb-77r.8 | |
| 7 | influence-psychology | skipped: no in-app upsell surfaces | | | 2026-10-31 |
| 8 | high-perf-browser | skipped: native app, no browser surface | | | 2026-10-31 |
| 9 | steve-jobs-design-review | pending (after discovery interviews) | PRODUCT.md, DESIGN.md, EXPERIMENTS.md | efb-77r.6 | |

Statuses: pending · in-progress · awaiting-evidence · done · deferred: <reason> · skipped: <reason>

## Key Decisions
| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-10-31 | Intake | Track work in beads; docs/ holds design records | AGENTS.md: no markdown TODO lists |
| 2026-10-31 | Intake | Skip phases 7 and 8; add ios-hig-design after phase 3 | No upsell surface; native iPad app |
| 2026-10-31 | Intake | Keep phase 6, but standard aviation abbreviations are never rewritten | Pilots read standard terms faster than plain-language substitutes |
| 2026-10-31 | 1 | Anchor job: J1 in-flight awareness | Used on every flight; the map is the product |
| 2026-10-31 | 1 | Worst dimension: emotional (trust) | Anxiety is the dominant force for a safety tool |
| 2026-10-31 | 1 | Failure mode: Little Hire (every flight) | One in-flight gap sends the pilot back to ForeFlight |
| 2026-10-31 | 1 | Phase 1 rests on assumptions; run discovery interviews before the cut pass | No user evidence yet |
| 2026-10-31 | 2-3 | Fix every severity 3-4 finding now; severity 1-2 go into phases 4-6 | Safety tool: no in-flight trust defects backlogged |
