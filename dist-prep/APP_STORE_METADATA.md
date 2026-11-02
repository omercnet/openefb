# App Store Connect metadata: draft, 2026-10-31; Israel-mode corrections 2026-11-02

Plain claims, no bravado. Review and trim before submitting. Character limits noted.

## Name (30 max)
`Kanaf EFB` (9). Plain "Kanaf" is taken on the App Store; "Kanaf EFB" is claimed for app 6829641724. The home-screen name stays `Kanaf`.

## Subtitle (30 max)
`VFR moving map and debrief` (26)

## Categories
Primary **Navigation**. Secondary **Utilities** (alt: Travel).

## Promotional text (170 max, editable without review)
`Free, open-source VFR flight bag for iPad and iPhone. Israel CVFR and US sectionals, airport charts, live weather and NOTAMs, and an on-device debrief after you land.` (166)

## Description (4000 max)
```
Kanaf is a free, open-source VFR electronic flight bag for iPad and iPhone.

MOVING MAP
- FAA VFR sectional chart with your position and track
- Airports, navaids and airspace from FAA data
- Nearest-airport readout and a nearest list with direct-to
- Night mode for the cockpit
- Download map regions for use without internet

AIRPORTS AND CHARTS
- Runways, frequencies, METAR and TAF for each airport
- FAA airport diagrams and terminal procedure charts
- Airport diagram overlaid on the map where the diagram can be placed automatically (advisory: verify against the FAA diagram; the rest open as the FAA PDF)
- PIREPs and winds aloft near the airport
- NOTAMs, using your own free FAA API key (add it in Settings; Kanaf does not provide one)

WEATHER AND ADVISORIES
- TFRs and AIRMET/SIGMET on the map, shown for awareness only
- Every weather and advisory item shows how old its data is

PLANNING
- Build a route, see distance, time and fuel
- Instrument strip with ground speed, altitude and track
- Aircraft and pilot profiles with currency warnings

FLIGHT RECORDING AND DEBRIEF
- Records your GPS track and cockpit audio
- Transcribes audio on the device, so audio never leaves your iPad or iPhone
- Replay a flight with its track and transcript
- On-device debrief on supported devices (Apple Foundation Models)
- Digital logbook

PRIVACY
- No account, no analytics, no ads, no tracking
- Location, audio, transcripts, flights and logbook stay on your device
- Weather, TFR, NOTAM and chart requests go to NOAA and the FAA; map tiles come from the FAA sectional service (ArcGIS) and OpenFreeMap; in Israel mode, NOTAMs come from a relay the developer runs on Cloudflare and chart packs download from Cloudflare R2. These requests can reveal the map area on screen or the airport you selected, and your IP address, to those hosts; none carries your GPS coordinates, and the developer receives none of it
- Open source under MPL-2.0

NEEDS THE INTERNET: weather, TFRs, NOTAMs, PIREPs and any map area you have not downloaded. Works offline: the airport
database, downloaded map regions and FAA charts you have already opened.

IMPORTANT
Kanaf is provided as a supplemental reference tool. It is NOT intended to be used as a primary means of navigation.
Pilots are responsible for maintaining situational awareness through all available means including current paper
charts, ATC communication, and visual references.

Aviation data (charts, airports, frequencies, airspace) is sourced from the FAA and is subject to change. Always verify
information against official FAA publications. Expired data is clearly marked but should not be relied upon for
navigation.
In Israel mode the data comes from CAAI and the Israel Airports Authority; the binding sources are the Israeli AIP and NOTAMs.

Weather information is provided for planning purposes only and may not reflect current conditions. Always obtain an
official weather briefing from 1800wxbrief.com or FSS before flight.

iPad and iPhone GPS accuracy varies by model and conditions. WiFi-only iPads do not have GPS hardware. Device GPS is not
TSO-certified. Do not rely on it as a sole means of position awareness.

Kanaf has not been tested, approved, or certified by the FAA or any other aviation authority. Use at your own risk.

DATA SOURCES
FAA (charts, airport data, TFRs, NOTAMs, terminal procedures), NOAA Aviation Weather Center (METAR, TAF, PIREP,
AIRMET/SIGMET, winds aloft), map data (c) OpenStreetMap contributors via OpenFreeMap and OpenMapTiles. In Israel mode:
Civil Aviation Authority of Israel (CAAI) GIS layers, chart and aerodrome diagrams (chart (c) CAAI, base map (c) Mapa Ltd),
and NOTAMs from the Israel Airports Authority through a relay run by the developer.
```

## Keywords (100 max, comma-separated, no spaces after commas)
`efb,vfr,aviation,pilot,flight,moving map,sectional,metar,taf,tfr,notam,airport diagram,logbook,chart` (100)

## URLs
- Support: `https://github.com/omercnet/openefb` (matches the link in Settings; confirm it is public)
- Marketing: blank or the same repo

## Copyright
`2026 Quartermint`

## Privacy policy URL
Required for the listing: `https://github.com/omercnet/openefb/blob/main/PRIVACY.md` (the repo's `PRIVACY.md`, written 2026-11-02;
it works only after `PRIVACY.md` is pushed to `main` and the repo is public). Keep it in step with `PRIVACY_NUTRITION_LABELS.md`.

## App Review notes (private)
```
Kanaf is a VFR electronic flight bag. No login is needed.
- Location (While Using): centres the moving map on the device position. Background location keeps a recorded
  flight track running with the screen off.
- Microphone and Speech Recognition: used only to record and transcribe cockpit audio on the device during a flight
  recording. Transcription is on-device (SpeechAnalyzer, or SFSpeechRecognizer with requiresOnDeviceRecognition = true).
  The debrief uses Apple Foundation Models on the device. No audio, transcript or location is sent to a server.
- Network: NOAA aviationweather.gov (keyless), FAA TFR, terminal chart and NOTAM services, and map tile hosts.
  A new install starts in the Israel region (Settings > Region switches to United States). In Settings > Region = Israel the app also reads a NOTAM feed from a Cloudflare Worker run
  by the developer (openefb-notam-relay.omerc.workers.dev), checks small manifest files on a Cloudflare R2 bucket for
  newer chart and diagram packs, and downloads a pack only when the user taps Download. None of these requests carries
  a position, an account or credentials.
  NOTAMs need a free FAA API key that the user enters in Settings > NOTAM API (a link there opens the FAA portal).
  Without a key the airport sheet says "NOTAMs need a free FAA API key. Add it in Settings > NOTAM API."
- A position outside the selected region is drawn but does not move the map. For the US features, switch Settings > Region to United States and simulate Palo Alto (37.4611, -122.1150); for Israel, simulate Herzliya LLHZ (32.1794, 34.8344).
- TFR, AIRMET/SIGMET and airport diagram overlay are advisory and are labelled as such in the app.
```

## Age rating
Expected 4+. Confirm in the questionnaire.

## Screenshots (iPad 13-inch, 2064x2752; iPhone 6.9-inch still to capture)
See `screenshots/README.md`. Apple's current spec: 13-inch iPad accepts 2064x2752 or 2048x2732 (portrait) and the
landscape equivalents. Captured at 2064x2752. The build targets iPhone too, so the public listing also needs an iPhone set (not captured). TestFlight needs none.

## To confirm before submitting
- Public repo URL (also the privacy policy URL above): push `PRIVACY.md` and confirm the repo is public.
- Display name: `Kanaf` is set as the home-screen name (`INFOPLIST_KEY_CFBundleDisplayName`, T30).
- Owner decision: whether the listing names Israel (see `README.md`, "Pending owner decision"). The description above names no Israeli feature and is otherwise US-only; only its privacy, data-source and data-accuracy lines, and the review notes, cover Israel mode.
- Privacy label (owner decision Q13 = B): declare Coarse Location, not linked to you, not used for tracking, purpose App Functionality; nothing else (see `PRIVACY_NUTRITION_LABELS.md`).
- CAAI approved in-app use of the CVFR chart and aerodrome diagrams (`NOTICE`). Screenshots that show that artwork stay out of git (`docs/handoff/COMMON.md`).
