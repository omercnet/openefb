# IL-DEBRIEF: CVFR debrief: altitude per leg and reporting-point times (dashboard T22; beads efb-aac.12)

A recorded flight in Israel should debrief against the CVFR route, not only the US-style summary. The existing pieces:
- `Services/Debrief/` (`DebriefEngine` on Apple Foundation Models, `FlightSummaryBuilder`);
- `Data/RecordingDatabase.swift` (track points, transcript segments, phase markers);
- `Services/Recording/` (recording, TranscriptionService, AviationVocabulary);
- Israel data in `IsraelAviationDatabase` (route segments with published altitude per direction, reporting points).

## Build
1. **Route matching:** after a flight, match the recorded track to the CVFR network.
   - If the flight had an active Israel plan, use its legs (store the plan's legs with the flight record if they aren't
     already).
   - Otherwise, match each track section to the nearest segment within 1 NM and in the right direction.
   - Pure, nonisolated and unit-tested.
2. **Per-leg altitude adherence:** for each matched leg, compare the time-weighted GPS altitude against the published
   altitude for the direction flown.
   - Report the % of time within ±200 ft and within ±300 ft, the max deviation, and the leg's start and end times.
   - Exclude the first and last 3 NM near aerodromes.
   - Two-number altitude text: compare against the nearer value.
3. **Reporting-point passage:** the time and distance at closest approach to each reporting point on the route.
   - If the transcript mentions the point's name (Hebrew or English) or its code within ±2 min, mark the position report
     as heard.
   - Add the Israel reporting-point names (Hebrew and English from the CAAI data) to the transcription vocabulary in the
     Israel region.
4. **Debrief output:** a CVFR section in the flight's debrief:
   - a legs table (leg, published altitude, adherence, max deviation);
   - reporting points (time, closest distance, reported yes/no);
   - 2–3 plain-language observations;
   - feed these facts into `FlightSummaryBuilder` so the AI debrief mentions them, but the numbers come from code, not
     the model.
   - When Foundation Models is unavailable, the CVFR tables still show.
   - US flights are unchanged.
5. **Hebrew transcripts:** if a transcript is Hebrew (SpeechAnalyzer he-IL), make sure the point matching handles Hebrew
   text: final letters, niqqud-free matching.

## Tests
Route matching (planned and unplanned), adherence maths with exclusion zones, two-number altitudes, point-passage
detection, Hebrew/English report matching.

## Rules
Files you own: Services/Debrief/**, the flight detail/debrief views (Views/Flights/**), the Recording vocabulary, and the
RecordingDatabase additions (with a GRDB migration, if you need new columns or tables).
Other agents in parallel:
- FIX-1: MapService route colour, IsraelFlightPlanMessage, the FPL preview, the aircraft profile;
- IL-BRIEF: NOTAM briefing, weather;
- IL-ALERTS: navigation bar, alerts;
- IL-DIAG2: diagrams.
Re-read shared files before editing.

Full unit suite green. Screenshot in docs/design/screenshots/IL-DEBRIEF/: a CVFR debrief from a simulated flight
LLHZ→LLIB along the planned route. Record it in the simulator with a GPX/location feed that follows the route with some
altitude deviation. Follow docs/handoff/COMMON.md (claim a simulator with
`export SIM_TAG=$(tools/sim-test.sh claim DEBRIEF)` and release it). Close nothing; don't commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T22 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
