# Product

## Vision
A free, open-source VFR EFB for the iPad that a weekend pilot trusts at a glance: where I am on a current sectional, what hazards are near, and the nearest runway if something goes wrong. Recording and debrief come second. Anchor job: J1 in-flight awareness (docs/CUSTOMER.md). Worst dimension: trust.

## MVP Definition
Type: native iPad app (SwiftUI, MapLibre, GRDB). Scope: moving map on the FAA sectional, airports and airport sheet, METAR/TAF/PIREP/winds/NOTAM, TFR and AIRMET layers, NRST + Direct-To, offline regions, flight recording with replay/debrief, logbook, aircraft and pilot profiles.
Excludes: IFR, cloud sync, weight and balance, ADS-B In, anything needing a certified GPS. Not for primary navigation (disclaimer shown on first run and in Settings).

## Outcome Roadmap
| Outcome / problem | Job served | Priority | Status |
|---|---|---|---|
| Pilot sees true position or an honest "no position" (never a fake ownship) | J1 | P1 | done (T14, efb-77r.24) |
| TFR proximity alerts run by default | J1 | P1 | done (T14, efb-77r.25) |
| First run reaches the map in 2 interactions | J1 | P2 | done (T14, efb-77r.17) |
| Replay opens without an empty panel | J4 | P2 | done (T14, efb-pva / efb-77r.26) |
| Location denied says why and how to fix it | J1 | P2 | open (efb-77r.27) |
| Direct-To can be cleared | J3 | P2 | open (efb-77r.28) |
| Cut list below (banner, offline Satellite/Terrain, transcript bar, duplicate copy) | J1 | P3 | banner, offline packs, copy done (T22, efb-77r.18/.19/.21); transcript bar open (efb-77r.20) |
| Tab and feature merges (Aircraft into Settings, Logbook into Flights) | J4 | P3 | done (T22, efb-77r.22-23); see "Tab bar decision" below |
| Validate all of this with pilots | all | P2 | open (efb-77r.7, efb-77r.34) |

### Tab bar decision (T22, 2026-11-01; superseded 2026-11-06)
Superseded by Direction 2 stage 1 (`docs/DESIGN.md`): there is no tab bar. The map screen carries the flight log strip; the log stack is home and holds flights, plans, logbook entries and their totals; Settings is a link from the log stack. The draft rule below still holds: a draft logbook entry reads as a neutral to-do in the log stack, not amber.

The tab bar was **Map / Flights / Settings** (was Map / Flights / Logbook / Aircraft / Settings). Screenshots: `docs/design/screenshots/T22/`.
- Logbook is a section of Flights: the History / Logbook / Plans control sits in the Flights navigation bar (the old History / Plans control at the top of the content was hidden behind the iPadOS floating tab bar; T14 B08 shows no control at all). Every logbook screen stays: draft rows from recordings, confirm/lock, manual entries, delete. Flights did not get worse: one bar, three sections, and a recording's two outcomes (FlightRecord, draft logbook entry) now sit next to each other. The fourth-tab fallback (Map / Flights / Logbook / Settings) was not needed.
- The draft count reads "Logbook (n)" in the segment, neutral text, not a red badge: a draft is a to-do, not a warning (efb-77r.32).
- Aircraft & Pilot is a row under Settings > Profiles. Non-current currency (medical, flight review, night) shows as an amber "n to renew" on that row, replacing the old tab badge.
- Beta banner: Map tab only; once dismissed, only the line under Settings > About remains (efb-77r.18).

### Design Review: Kanaf (T14 final cut, 2026-11-01)
Evidence: the app walked cold on the iPad Pro 13-inch simulator (iOS 27, KPAO, `tools/fly.sh` route). Screenshots: `docs/design/screenshots/T14/`. **This review rests on documented assumptions: no pilot has used a build** (CUSTOMER.md evidence status). It has not been tried on a physical iPad or in a cockpit.

**Verdict:** NOT DONE (score 6/10 after the T14 fixes; 3/10 before)
**The One Thing:** show a VFR pilot where they are on a current sectional, with the hazards and the nearest runway, and never show anything that is not true now.
**Keeps its promise?** Mostly. With a GPS fix the map, NRST, airport sheet, charts and age badges deliver it (A02, A04, A06, B01). Without a fix it broke the promise: a live blue ownship arrow sat in Kansas (efb-77r.24, fixed), and TFR proximity never ran by default (efb-77r.25, fixed). Still open: location denied shows "GPS LOST / waiting for GPS" with no reason or fix (efb-77r.27).

**Steps to value**
| Path | Before T14 | After T14 |
|---|---|---|
| J1: install, open, see yourself on a sectional | open, 3 swipes, "I understand", Allow location = 5 interactions | open, "I understand", Allow location = 2 interactions (needs network for the sectional until a region is downloaded) |
| J3: emergency Direct-To nearest landable field | NRST, Direct = 2 taps | unchanged: 2 taps (A07, B02). Cannot be undone afterwards (efb-77r.28) |

**Quick Diagnostic (7 rows)**
| Question | Before | After |
|---|---|---|
| One Thing in one sentence? | pass | pass |
| Core value in 3 steps or fewer? | fail (5) | pass (2) |
| Reviewed cold, as a customer? | pass | pass |
| Working demo on the real device? | fail (simulator only) | fail (still simulator only) |
| Anything removed this cycle? | fail | pass (three onboarding pages, placeholder ownship) |
| Error, empty and edge states at hero quality? | fail | fail (efb-77r.27, .29, .31) |
| Would the team proudly use it daily, unvalidated? | fail | fail (no pilot validation) |
Score: 2/7 = 3/10 before; 4/7 = 6/10 after. To reach 9+: a physical-iPad flight test, location-denied and silent-discard states fixed, pilot validation.

**Cut list (ranked)**
1. Onboarding: 4 swipe-only pages to one page. **Done** (efb-77r.17).
2. Beta banner on every tab: show on Map only (efb-77r.18).
3. Offline Satellite and Terrain packs, and the "Zoom 8-12" labels (efb-77r.19; see efb-zfm.8).
4. Live Transcription bar in the map bottom stack while recording (efb-77r.20).
5. Third copy of "what works offline" (efb-77r.21).
6. Recommendation, left in (PRD features, needs a product call): merge Aircraft into Settings, 5 tabs to 4 (efb-77r.22). Fold Logbook into Flights (efb-77r.23). AI Debrief on flights with no transcript is a fix (efb-77r.31), not a cut.

**Fix list (ranked)**
1. Fake ownship before first fix. **Done** (efb-77r.24).
2. TFR layer default on. **Done** (efb-77r.25).
3. Replay transcript panel expanded and empty (efb-pva). **Done** (efb-77r.26); `dist-prep/screenshots/09-replay.png` recaptured from a recorded flight.
4. Location denied: cause and Open Settings (efb-77r.27).
5. Clear Direct-To (efb-77r.28).
6. Silent discard of 0-point recordings, debrief on empty flights (efb-77r.31).
7. Auto-start re-arms after End Recording (efb-77r.29); phase says Taxi at 97 kt without altitude (efb-77r.30).
8. Red Logbook badge (efb-77r.32), "0h 0m" duration (efb-77r.33).

**Back of the fence:** see `docs/DESIGN.md` `## Back-of-the-fence audit (T14)`.

## Opportunity Solution Tree Notes
Outcome: pilots keep Kanaf on the yoke for the whole flight (no switch back to ForeFlight mid-flight).
- Opportunity: "I can't tell what still works offline" -> offline status lines, per-region packs (exists); next: one "offline ready" indicator on the map.
- Opportunity: "I can't tell if the position is real" -> GPS chip, stale grey chevron, no placeholder ownship (done); next: location-denied notice.
- Opportunity: "I need the nearest field now" -> NRST + Direct (exists); next: clear Direct-To.
Assumptions to test (efb-77r.7): pilots want the sectional with TFRs on by default; pilots will not miss the swipe tour; 2 taps to Direct-To is fast enough in turbulence.

## Hook Model
Trigger: pilot mounts the iPad before each flight. Action: open app, glance at the map. Variable reward: a live weather and TFR picture that differs every flight. Investment: downloaded regions, aircraft profile, flight history. Weakest phase: investment, because nothing carries pilots back after landing except the logbook draft.

## Activation & Retention Plan
| Friction / moment | Fix | Owner | Status |
|---|---|---|---|
| First run takes 5 interactions | One-page onboarding | T14 | done |
| Map opens with no sectional offline | Offline region pack, "offline ready" cue | efb-zfm.5 | partly done |
| Location permission denied, no explanation | Notice with Open Settings | efb-77r.27 | open |
| After landing, nothing prompts a return | Logbook draft badge (red, wrong) | efb-77r.32 | open |

## Discovery Cadence
Weekly, from the first TestFlight build: 3 pilot touchpoints (Mom Test rules: their last flight, not our features). Questions to ask first: how they check TFRs today, what they do when the iPad loses GPS, whether they would use Direct-To in an emergency or fly the plane first. Tracked in efb-77r.7 and efb-77r.34.
