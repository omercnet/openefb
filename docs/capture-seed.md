# SwiftUI capture data (Q6)

What each SwiftUI reference screenshot shows, and the launch arguments that produce it. All hooks are DEBUG only
(`efb-212/Services/Simulation/`: `ScreenCaptureHooks.swift`, `CaptureRouteHost.swift`, `CaptureSeed.swift`); the shots are
taken by `tools/ci/capture-screens.sh` on an iPad Pro 13-inch simulator (iPhone 17 Pro for `iphone-*`), portrait, day mode,
`-hasSeenOnboarding YES -OpenEFBNoAudio YES` unless noted. Reference file: `app/reference/<device>-<name>.png`.

## Flight scenario shots

Every shot flies a flight scenario from a start offset (`-OpenEFBScenario <tools/flight-sim/scenarios/NAME.json> -OpenEFBScenarioStart S`).
`us-kpao-ksql` from 150 s: ownship near Redwood City, 97 kt, climbing, 12 s wait. `il-cvfr-llhz-llib-nominal` from 600 s: on the
Herzliya to Rosh Pina CVFR route at 1500 ft. The scenario clock is simulated; the strip's wall-clock text (UTC time, data ages)
moves with the run.

| name | scenario | extra arguments |
| --- | --- | --- |
| map-day | us-kpao-ksql 150 | `-OpenEFBScreen map -OpenEFBStripColumn log -OpenEFBDirectTo KOAK` (NEXT is KOAK) |
| map-night | same | `-OpenEFBDisplayMode night` |
| airport-KSQL | us-kpao-ksql 150 | `-OpenEFBStripColumn airport:KSQL` |
| nearest, layers, search | us-kpao-ksql 150 | `-OpenEFBStripColumn nearest` / `layers` / `search` |
| log | us-kpao-ksql 150 | `-OpenEFBScreen log` (empty logbook unless a flight was recorded in this simulator) |
| map-layers | us-kpao-ksql 150 | `-OpenEFBDirectTo KOAK -OpenEFBLayers all` |
| briefing | il-cvfr-llhz-llib-nominal 600 | `-OpenEFBBriefing YES` (NOTAMs are whatever the app has cached: none on a fresh runner) |
| israel-plan | il-cvfr-llhz-llib-nominal 600 | `-OpenEFBRoute israel-plan` (no stored data) |
| onboarding | us-kpao-ksql 150 | `-hasSeenOnboarding NO` (first page) |
| recording | us-kpao-ksql 150 | `-OpenEFBDirectTo KOAK -OpenEFBRecording notices`: "Microphone is off" and "Audio stopped" |
| recordingstopped | same | `-OpenEFBRecording stopped` (auto start off): "Recording failed" and "Recording not saved" |
| recordingstop | same | `-OpenEFBRecording stop`: the "End recording?" dialog |
| iphone-map, iphone-log, iphone-airport | us-kpao-ksql 150 | the iPhone set: `map-day`, `log`, `airport-KSQL` on the iPhone 17 Pro |

## Seeded pages (`-OpenEFBSeed`, `CaptureSeed.swift`)

The seed replaces the six SwiftData model types and the recording database on every launch and writes no UserDefaults and no
Keychain. Dates are offsets from the start of the run day (UTC) because the currency rules use the real clock: the dates and day
counts below are offsets, the layout does not depend on them. Scenario `us-kpao-ksql 150` runs underneath; the page covers the map,
and auto start is off so ReplayView (which only loads while nothing records) works.

`-OpenEFBSeed capture-fresh`, used by **settings** (`-OpenEFBRoute settings`): a fresh install in Israel. Region Israel, no
aircraft, no pilot, no flights, no logbook. Nothing downloaded, no NOTAM key, defaults for everything else.

`-OpenEFBSeed capture` plus `-OpenEFBRoute <name>`:

- Region Israel. Active aircraft N172KF.
- Aircraft: N172KF (C172S, ICAO C172, 53 gal, 9 gph, 110 kt, 2 persons, annual due in 120 days, transponder due in 200 days,
  Vr 55 Vx 62 Vy 74 Va 99 Vne 163 Vfe 85 Vs0 40 Vs1 48), N28PA (PA28, nothing else), 4X-ABC (blank). N172KF is active.
- Pilot: one, "Test Pilot", active, private certificate, third class medical expiring in 20 days, flight review 200 days ago,
  412.5 h, night landings: 1 at 30 days ago and 1 at 45 days ago.
- Flight: LLHA (Haifa) to LLMG (Megiddo), starts 08:00 UTC the day before, 15 min (900 s), 900 track points at 1 Hz in a straight
  line (climb, cruise at 95 kt and up to 1500 ft, descent), 6 transcript lines, no AI debrief, aircraft N172KF.
- Logbook: a signed entry LLIB (Rosh Pina) to LLHZ (Herzliya) 10 days ago, 1 h 24 m, C172S, 1 day and 1 night landing, note "Smooth
  air, a little haze on the coast."; a draft (unsigned) entry for the flight above, LLHA to LLMG, 15 min, 1 day landing.

| name | route argument | shows |
| --- | --- | --- |
| disclaimers | `disclaimers` | DisclaimersView |
| aircraft | `aircraft` | AircraftListView: three aircraft |
| aircraftedit | `aircraftedit` | AircraftEditView of N172KF |
| pilot | `pilot` | PilotProfileView: Test Pilot |
| logbookentry | `logbookentry` | LogbookEntryEditView, the draft, editable |
| logbooklocked | `logbooklocked` | LogbookEntryEditView, the signed entry, read only |
| flightdetail | `flightdetail` | FlightDetailView of the Haifa flight (Replay Flight, CVFR section if the bundled route data matches the track, AI Debrief row shows the simulator's availability) |
| cvfr | `cvfr` | CVFRDebriefContent alone (blank if the loader finds no report for the track) |
| debrief | `debrief` | DebriefView with the on-device model unavailable (the simulator): the unavailable or error state, no generated debrief |
| replay | `replay` | ReplayView of the flight at its start, 1x, transcript panel open |
| replayfast | `replayfast` | same at 4x, transcript panel closed |

Differences from the RN fixtures that remain: the Swift replay starts at the beginning, not at the Afula turn; the Swift flight is a
straight Haifa-Megiddo line, not the Haifa pattern flight; recording notices use the app's own wording.

The importer fixtures (`-OpenEFBSeed small|full`, `SeedDataHook.swift`) are unchanged; they also set UserDefaults such as night mode
and hidden panels, so do not combine them with the capture shots.
