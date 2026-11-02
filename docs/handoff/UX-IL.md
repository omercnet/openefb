# UX-IL: Usability and HIG review of the Israel mode (dashboard T28)

The US app went through improve-app phases 2–3b (ux-heuristics, design-everyday-things, ios-hig-design) and the final cut
review (T14). The Israel mode was built since then by many agents and has never been reviewed as a whole.

Use the `ux-heuristics` skill (Nielsen's 10, plus Krug), then the `ios-hig-design` skill, through the EFB lens in
docs/handoff/COMMON.md:
- glanceable in sunlight;
- in-flight controls ≥60pt;
- red = warning, amber = caution;
- standard aviation abbreviations;
- never show stale data as current;
- minimal animation.
The anchor job is J1, in-flight awareness (docs/CUSTOMER.md).

## Walk it cold in the simulator, Israel region
1. Settings: the region switch to Israel.
2. Offline Maps: download the official chart and diagram packs. They're live on R2.
3. The map: chart, overlay, closures, the badge stack, NRST, the airport sheets (LLHZ, LLBG), and a diagram on zoom.
4. Pre-flight: the NOTAM briefing and weather.
5. Plan LLHZ → LLIB: routing, the legs table, the FPL preview and share, return flight.
6. Activate it and fly it with a location feed: route following, cautions and alerts.
7. Record it, then debrief.
8. Do the same at night.

Screenshot each step into docs/design/screenshots/UX-IL/. Screenshots that show CAAI chart or diagram artwork go under a
gitignored path (see .gitignore); keep the rest committed.

## Also check on screen (built without visual checks)
- **History:** the amber "Track damaged" line and the "Recovered" flights (T32); force them with a seeded damaged
  track and an orphaned recording.
- **CVFR debrief:** the "3 of 11 heard" count against 0 transcript segments, and red used for poor legs (efb-aac.19).
- **NOTAM briefing:** HEL and ultralight closures shown red to a CVFR pilot (see the bead filed after T20).
- **Route bar:** Prev/Next/Clear sizes (≥60pt) and the route line magenta over the official CAAI chart (T18).
- **Map:** stale TFR/AIRMET marking and the chart-download error with Retry (T31).

## Output
- Extend docs/DESIGN.md with an "Israel mode review" section: findings, each with heuristic, severity (0–4), evidence
  (screenshot) and fix; plus a HIG checklist result.
- **Fix** every severity 3–4 finding now (the same rule as the US pass: no in-flight trust defects backlogged).
- File severity 1–2 findings as beads under efb-aac.
- Update docs/IMPROVE-APP-PLAN.md: the phase table is stale. Phases 3b, 4, 5 and 6 were done by tickets T10, T07, T08
  and T09 on 2026-10-31/11-01. Mark them done with those references, and add a row for this Israel review.

This starts after the Israel feature tickets land (dashboard T18–T24), so the code is stable. Full unit suite green.
Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim UXIL)` and release it).
Close nothing; don't commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T28 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
