# Positioning & Messaging

## Competitive Alternatives
See docs/CUSTOMER.md `## Competing Alternatives` (ForeFlight, Garmin Pilot, FltPlan Go, panel GPS, paper + phone weather, Avare).

## Unique Attributes → Value Themes
| Attribute | Value ("so what") | Proof |
|---|---|---|
| Free, MPL-2.0 source | No $120-360/yr subscription; the pilot can read what the app does | Settings › Legal › Source Code |
| VFR-only | One map, one flight: no IFR procedure clutter | Map tab is the whole in-flight surface |
| Honest data state | Every dated product carries its age; offline coverage is spelled out | `DataAgeBadge`, Settings › Charts, layer panel offline line |
| Recording + debrief | GPS track and cockpit audio in one tap, replay after landing | Record button, Flights tab |

## Best-Fit Customer
Weekend VFR pilot, single-engine piston, iPad mini in the cockpit (docs/CUSTOMER.md). Dominant anxiety: "will it fail me in flight?"

## Market Category
Existing category (iPad EFB), subcategory "free VFR EFB". Pilots already know what an EFB is; the message is what it does *not* do (paywall, IFR bloat) and what it is honest about (data age, offline).

## One-Liner
A free VFR moving map that tells you what it knows, how old it is, and what works offline.

## Brand Script (StoryBrand)
Character: VFR pilot with an iPad on the yoke · Problem: external, a subscription for a map; internal, "can I trust a new app in flight?"; philosophical, safety tools should be open · Guide: Kanaf, open source and plain about its limits · Plan: install, see your position, download your region, fly · Call to action: Record the flight · Failure: a blank map or stale data in the air · Success: position, airspace and the nearest runway at a glance, with a track to review after landing.

## Key Messages

In-app copy pass (improve-app phase 6, made-to-stick, ticket T09, beads efb-77r.8), 2026-10-31.

### Rules applied
- Commander's Intent per surface is in the table. Every error says what happened and what to do next; it never blames the pilot ("your network", "ensure", "please" removed).
- Aviation terms and abbreviations stay (CTAF, METAR, TAF, TFR, NOTAM, PIREP, AIRMET/SIGMET, NRST, MSL, AGL, VFR, GS, TRK, VS).
- One term per concept: **NRST** on the map button, "Nearest airports" in titles and sentences; **Recording** is the noun, "Start/End recording" the verbs, "REC" the in-flight pill; **Offline Maps** is the Settings screen, "downloaded" describes a region; the **sectional cycle** is always "valid to <date>"; **the internet** (not "network", "connection", "online").
- `Settings › Kanaf › Microphone`-style paths use `›` everywhere.
- SUCCESs score for in-app copy (author estimate, not user-tested): before 22/60 (Simple 5, Unexpected 2, Concrete 4, Credible 5, Emotional 3, Stories 3) · after 38/60 (Simple 8, Unexpected 5, Concrete 8, Credible 8, Emotional 5, Stories 4). Unexpected and Stories are deliberately low: in-flight copy is read under stress and must be predictable; the only "unexpected" message is the onboarding page that tells a new user what will *not* work in the air. Validate with pilot interviews (efb-77r.7).

### Disclaimers (PRD §12)
Source of truth is `Core/Disclaimers.swift`. All five appear in Settings › Legal › Disclaimers (full text, always reachable). The primary-navigation disclaimer is also the last onboarding page, which every pilot sees before the map, with an "I understand" button. Expired charts carry "Do not use for navigation" inline (`AirportChartsSection`). Onboarding and Settings are the two places a pilot reads before and between flights; the map itself stays clear of prose.

### Before / after
Status: done = shipped in this pass; kept = reviewed, unchanged. Screenshots: docs/design/screenshots/T09/.

| Surface | Commander's Intent | Before | After | Status |
|---|---|---|---|---|
| Onboarding p1 | You will see yourself on the sectional | "Navigate with GPS" / "Kanaf uses your location to show your position on VFR sectional charts in real time." | "See where you are" / "Your position on the FAA sectional, with airspace, airports, TFRs and METARs around you." | done |
| Onboarding p2 | Know what works in the air | "Your Moving Map" / "Airports, weather, airspace, and TFRs at your fingertips. Works offline with downloaded charts." | "Know what works offline" / "Airports and the map regions you download work in the air. Weather, TFRs and NOTAMs need the internet." | done |
| Onboarding p3 | One tap records | "Record Every Flight" / "One tap to capture GPS track and cockpit audio. Get an AI-powered debrief after landing." | "Record the flight" / "One tap records the GPS track and cockpit audio. Replay and debrief after landing." (red tint removed: red is for warnings) | done |
| Onboarding p4 (new) | Not for primary navigation | (none) | "Not for primary navigation" / "Kanaf is a supplemental reference. Fly with current charts, ATC and what you see outside. iPad GPS is not certified, and this app is not FAA-approved." Button "I understand" | done |
| Beta banner | Expect bugs, know where to report | "Beta -- Report issues via TestFlight feedback" | "Beta build. Report problems in Settings › Feedback." Dismiss button labelled "Dismiss beta notice". After dismissal the same line lives in Settings › About. | done |
| Settings › About | Version and beta status | Version, Build | Version, Build, "Beta build. Report problems with Send Feedback below." | done |
| Settings › Feedback | How to reach us | "Send Feedback" / "You can also take a screenshot in TestFlight to send feedback directly to the developer." | "Send Feedback" / "In TestFlight, a screenshot also opens the feedback form." | done |
| Settings › Charts | What works offline | "Offline on this iPad: the airport database, map regions you download under Offline Maps, and FAA charts and airport diagram PDFs you have opened. Needs the internet: weather, TFRs, NOTAMs, PIREPs, and any map area you have not downloaded. Sectionals are revised every 56 days." | "Works offline: the airport database, regions downloaded under Offline Maps, and FAA charts you have opened. Needs the internet: weather, TFRs, NOTAMs, PIREPs and map areas not downloaded. Sectionals change every 56 days." | done |
| Settings › NOTAM API footer | Why a key, where it is kept | "NOTAMs come from the FAA NOTAM API, which needs a free client ID and secret from the FAA developer portal. They are stored in the iPad Keychain." | "The FAA NOTAM API needs a free client ID and secret from the FAA developer portal. Kanaf keeps them in the iPad Keychain." | done |
| Settings › NOTAM saved | Where NOTAMs show | "Saved. NOTAMs appear in airport details." | "Saved. NOTAMs appear in the airport sheet." | done |
| Settings › Legal | Disclaimers reachable | License, Source Code | + "Disclaimers" screen with the five PRD §12 texts | done |
| Offline Maps footer | Expired packs | "FAA sectionals are revised every 56 days. A downloaded sectional from an earlier cycle is marked Expired and must be downloaded again." | "FAA sectionals change every 56 days. A downloaded sectional from an earlier cycle is marked EXPIRED; download it again." | done |
| Offline Maps empty | Nothing downloaded | "Nothing downloaded. The map needs the internet." | "Nothing downloaded yet. Without a region, the map needs the internet." | done |
| Offline Maps › What works offline | Same as Settings › Charts | "Offline on this iPad: the airport and navaid database, regions you download here (FAA sectional and street maps), and FAA charts and airport diagram PDFs you have opened." / "Needs the internet: …" / "Satellite and Terrain tiles come from third-party servers with usage limits (Esri, OpenTopoMap). They are off by default; download only small areas." | "Works offline: the airport and navaid database, regions downloaded here (sectional and street), and FAA charts and airport diagrams you have opened." / "Needs the internet: weather (METAR, TAF, winds aloft), TFRs, NOTAMs, PIREPs, AIRMET/SIGMET and map areas not downloaded." / "Satellite and Terrain tiles come from Esri and OpenTopoMap, which limit bulk downloads. Keep those regions small." | done |
| Layer panel › Airport diagrams | Advisory only | "Advisory, verify against the charted diagram" | "Advisory. Verify against the FAA diagram." | done |
| Layer panel › TFR / AIRMET row | Layer failed | "Unavailable" + Retry | "Not loaded" + Retry (amber) | done |
| Layer panel › Data age | Age of the layer | "Data age:" | "Age" (label before the badge) | done |
| Database banner | Nothing aviation will show | "Airport database unavailable — reinstall the app" / "No airports, airspace or navaids can be shown." | "Airport database could not be opened" / "No airports, airspace or navaids will show. Reinstall Kanaf." | done |
| Recording stop dialog | Ending is final | "End flight recording?" / "End Recording" / "This will stop recording GPS track, audio, and transcription." | "End recording?" / "End Recording" / "Stops the GPS track, cockpit audio and transcript. The flight is saved to Flights." | done |
| Microphone denied | Flight still records | "Microphone is off" / "No cockpit audio or transcript will be recorded. Enable it in Settings › Kanaf › Microphone." | "Microphone is off" / "The GPS track still records. For cockpit audio, turn the microphone on in Settings › Kanaf › Microphone." | done |
| Recording error | Something failed | "Recording problem" + error | "Recording problem" + error (errors rewritten below) | done |
| Weather error (airport sheet) | Weather failed, retry | "Weather unavailable" + error + Retry | "Weather not loaded" + error + Retry | done |
| Weather empty | No report exists | "No weather reported for this airport" | "No METAR for this airport." | done |
| NOTAM not configured | Needs a key | "Add a free FAA NOTAM API key in Settings to see NOTAMs" | "NOTAMs need a free FAA API key. Add it in Settings › NOTAM API." | done |
| NOTAM rejected | Key wrong | "The FAA rejected the NOTAM API key. Check the client ID and secret in Settings." | "The FAA rejected the NOTAM API key. Check the client ID and secret in Settings › NOTAM API." | done |
| NOTAM failed | Retry | "NOTAMs unavailable: <message>" | "NOTAMs not loaded: <message>" + Retry | done |
| NOTAM empty | None active | "No active NOTAMs for <loc>" | kept | kept |
| PIREP failed | Retry | "PIREPs unavailable: <message>" | "PIREPs not loaded: <message>" | done |
| Winds aloft failed | Retry | "Winds aloft unavailable: <message>" | "Winds aloft not loaded: <message>" | done |
| Charts expired | Do not use | "Charts expired <date>. Do not use for navigation." | kept | kept |
| Chart PDF failed | File broken | "This chart file could not be opened." | "The chart file could not be opened. Retry downloads it again." | done |
| Flights empty | Where recordings come from | "No flights recorded yet." / "Start a recording from the Map tab." | "No flights yet" / "Recordings from the Map tab appear here." | done |
| Logbook empty | Where entries come from | "No Flights Yet" / "Your flights will appear here after recording. You can also add entries manually." | "No entries yet" / "Recorded flights appear here. Add an entry with +." | done |
| Plans empty | How to make one | "No Saved Plans" / "Create a flight plan above to get started." | "No saved plans" / "Pick a departure and destination above, then Save Plan." | done |
| Aircraft empty | Add one | "No aircraft profiles yet" | kept | kept |
| Debrief idle | What the debrief does | "Ready to analyze your flight" / "The AI will review your GPS track, transcript, and flight phases to provide personalized feedback." | "Debrief this flight" / "Apple Intelligence reviews the GPS track, transcript and flight phases on this iPad. Nothing leaves the device." | done |
| Debrief failed | Retry | "Debrief generation failed" + error / "Try Again" | "Debrief failed" + error / "Try Again" | done |
| Debrief unavailable (Flight detail) | Why, what still works | "AI Debrief requires Apple Intelligence." / "You can still review your flight track, transcript, and logbook entry." | "Debrief needs Apple Intelligence." / <reason> / "Track, transcript and logbook still work." | done |
| Debrief reasons (DebriefEngine) | What to do | "This device does not support Apple Intelligence." / "Apple Intelligence is not enabled. You can enable it in Settings." / "Apple Intelligence is still setting up. Please try again later." / "AI Debrief is currently unavailable." | "This iPad does not support Apple Intelligence." / "Apple Intelligence is not enabled. Turn it on in Settings › Apple Intelligence & Siri." / "Apple Intelligence is still downloading its model. Try again later." / "Debrief is unavailable right now." | done |
| DebriefError | What to do | "AI debrief session is not available. Please check Apple Intelligence settings." / "The AI debrief returned no content. Please try again." / "Debrief generation failed: …" | "Apple Intelligence did not start a session. Check Settings › Apple Intelligence & Siri." / "The debrief came back empty. Try again." / "Debrief failed: …" | done |
| Replay guard | Stop first | "Stop recording before replaying a flight." / "An active flight recording is in progress. End the recording from the Map tab to enable replay." | "End the recording first" / "A recording is running. End it from the Map tab, then replay." | done |
| Replay error | Retry | "Could not load flight" / "Could not access recording database." / "Failed to load flight data: …" | "Flight not loaded" / "The recording database could not be opened. Reinstall Kanaf." / "Track data could not be read: …" | done |
| Flight detail › replay guard | Stop first | "Stop the current recording to replay a flight" | "End the recording to replay a flight" | done |
| Flight detail › DB | DB failed | "Recording database unavailable" | "Recording database could not be opened" | done |
| EFBError.gpsUnavailable | Fix location | "GPS is unavailable. Ensure Location Services are enabled for this app." | "No GPS position. Turn on Location for Kanaf in Settings › Privacy & Security › Location Services." | done |
| EFBError.chartExpired | Download again | "Chart expired on <date>. Download the latest chart for current navigation data." | "Chart expired <date>. Download the current chart before using it." | done |
| EFBError.chartDownloadFailed | Retry | "Failed to download chart for <region>. Check your network connection and try again." | "Chart download for <region> failed. Check the internet connection and try again." | done |
| EFBError.chartCorrupted | Re-download | "Chart data for <region> is corrupted. Delete and re-download the chart." | "The <region> chart file is damaged. Delete it and download it again." | done |
| EFBError.weatherStale | Refresh | "Weather data is <n> minutes old and may be unreliable. Refresh when possible." | "Weather is <n> min old. Refresh before relying on it." | done |
| EFBError.weatherFetchFailed | | "Unable to fetch weather: …" | "Weather download failed: …" | done |
| EFBError.recordingFailed | | "Flight recording error: …" | "Recording failed: …" | done |
| EFBError.audioSessionFailed | | "Audio session configuration failed: …" | "Cockpit audio could not start: …" | done |
| EFBError.transcriptionUnavailable | Flight still records | "Speech recognition is not available on this device. Transcription will be skipped." | "Speech recognition is not available on this iPad. The flight records without a transcript." | done |
| EFBError.microphonePermissionDenied | | "Microphone access is required for cockpit audio recording. Enable in Settings > Privacy > Microphone." | "Microphone is off, so no cockpit audio is recorded. Turn it on in Settings › Kanaf › Microphone." | done |
| EFBError.databaseCorrupted | (no NASR import exists in Settings) | "Aviation database is corrupted. Re-import NASR data from Settings." | "The airport database could not be opened. Reinstall Kanaf." | done |
| EFBError.databaseMigrationFailed | (no support contact exists) | "Database migration failed: …. Please reinstall the app or contact support." | "The flight database could not be updated: …. Reinstall Kanaf." | done |
| EFBError.nasrImportFailed | | "NASR data import failed: …. Try again or download a fresh data set." | "FAA airport data import failed: …. Try again with a fresh NASR download." | done |
| EFBError.tfrFetchFailed | | "Unable to fetch TFR data: …" | "TFRs could not be loaded: …" | done |
| EFBError.networkUnavailable | What still works | "No network connection. Weather and chart downloads are unavailable." | "No internet. Weather, TFRs and downloads are unavailable; downloaded maps and the airport database still work." | done |
| EFBError.debriefFailed | | "AI debrief generation failed: …" | "Debrief failed: …" | done |
| EFBError.airportNotFound | | "Airport "<icao>" not found in the database. Verify the identifier or update your aviation data." | "<icao> is not in the airport database. Check the identifier." | done |
| RecordingCoordinator errors | | "A recording is already in progress." / "Recording is in an invalid state for this operation." / "No recording is currently active." | "A recording is already running." / "The recording cannot do that in its current state." / "No recording is running." | done |
| AudioRecorder | | "No audio input available. Audio recording requires a microphone." | "No microphone found. The flight records without cockpit audio." | done |
| Currency banner | | "Could not read the pilot profile. Check currency in the Aircraft tab." | kept | kept |
| Offline pill (map) | | "Offline — using cached data" | kept | kept |
| NRST HUD | | "NRST", "no landable airport in range", "waiting for GPS" | kept | kept |
| Instrument strip / GPS chip | | GS KT, ALT FT, VS FPM, TRK °, GPS OK / DEGR / LOST | kept (standard abbreviations) | kept |
