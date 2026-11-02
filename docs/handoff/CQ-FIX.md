# CQ-FIX: Fix the bugs the safety net found (dashboard T32)

The code-quality Phase 1 run (CQ-1) pinned current behaviour in `efb-212Tests/CharacterizationTests/` and filed these
bugs as beads (`bd show <id>` for evidence). docs/TESTING.md and docs/TECH-DEBT.md have the context. Rule from the
improve-code-quality skill: a behaviour change flips the characterization test that pinned the wrong value to the
correct value, in the same change. Keep structure-only refactors separate from behaviour fixes, and say which is which
in your report.

## Batch A: start now (no other agent is editing these files)
- **efb-0xs (P1):** a regenerated `aviation.sqlite` with the same size and data version is never installed, so old
  airport data is served. Compare a content hash (or the bundle's build/hash marker), not size and version.
- **efb-91u (P2):** a corrupt installed copy with a matching marker is never re-copied. Validate on open
  (integrity_check, or open-and-query) and re-install from the bundle.
- **efb-71b (P2):** a location stream error is terminal: `isTracking` stays true and nothing restarts it. Restart with
  backoff and surface the GPS status honestly.
- **efb-hql (P3):** vertical speed uses arrival time (`Date()`), not the fix timestamps.
- **efb-asl (P2) and efb-epd (P3):** offline packs: "complete" with missing resources must not read "Offline ready"; a
  failed or removed pack reads "not downloaded".
- **efb-lrq (P3):** SwiftData: `EFBSchemaMigrationPlan` is never passed to any ModelContainer, and the model list is
  hard-coded three times. Make one container factory and pass the plan. Be very careful: user data must survive. Test
  opening a store created by the current build, and the earlier schema if CQ-1 pinned it.

## Batch B: after IL-DEBRIEF finishes
IL-DEBRIEF is the agent "IL-DEBRIEF CVFR debrief", working in Services/Debrief, Recording and RecordingDatabase. Check
its status with the Paseo tools, or wait until docs/handoff/IL-DEBRIEF.md's dashboard ticket T22 shows done
(`paseo-progress show`).
- **efb-7xe (P1):** an unreadable track is treated as empty, so the flight and its audio are deleted. A read error must
  never delete anything: keep the flight, mark it damaged, and surface it.
- **efb-cul (P2):** the FlightRecord and draft logbook entry are inserted but never saved; it relies on autosave. Save
  explicitly and handle the error.
- **efb-5ql (P2):** failed track-point writes are still counted in the stop summary.
- **efb-df8 (P2):** phase marker rows never get an end time.
- **efb-bep (P3):** discarding an empty flight leaves its debrief row.
- **efb-6io (P3):** the debrief `generatedAt` is written as seconds since 2001 but read as since 1970.
- **Crash or kill recovery for recordings** (no bead yet; CQ-1 top-10 #7): on launch, find orphaned recordings (track
  points or audio with no FlightRecord) and recover them into History as "recovered". File a bead, implement, and test.

## Not yours
These go to other tickets:
- weather (efb-bgb, efb-dv5, efb-8d4) and the app reliability beads efb-zfm.10–.18: T31;
- proximity (efb-8lm): IL-ALERTS is editing it; append it to T31;
- planner closures (efb-qpk): IL-LSA owns the planner; append it to T24.

Full unit suite green at the end. The two current failures are another agent's in-progress work
(`CVFRDebriefTests…FlownHigh…` belongs to IL-DEBRIEF); report them if they're still failing, but don't fix other agents'
tests. Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim CQFIX)` and
release it). Close nothing; don't commit. Report per bead: the fix, the test flipped, and any risk.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T32 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
