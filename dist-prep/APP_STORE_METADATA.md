# App Store Connect metadata: draft, 2026-10-31; Israel-mode corrections 2026-11-02

Plain claims, no bravado. Review and trim before submitting. Character limits noted.

## Name (30 max)
`OpenEFB` (7)

## Subtitle (30 max)
`VFR moving map and debrief` (26)

## Categories
Primary **Navigation**. Secondary **Utilities** (alt: Travel).

## Promotional text (170 max, editable without review)
`Free, open-source VFR flight bag for iPad. FAA sectionals, airport charts, live weather and TFRs, and an on-device debrief after you land.` (138)

## Description (4000 max)
```
OpenEFB is a free, open-source VFR electronic flight bag for iPad.

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
- NOTAMs, using your own free FAA API key (add it in Settings; OpenEFB does not provide one)

WEATHER AND ADVISORIES
- TFRs and AIRMET/SIGMET on the map, shown for awareness only
- Every weather and advisory item shows how old its data is

PLANNING
- Build a route, see distance, time and fuel
- Instrument strip with ground speed, altitude and track
- Aircraft and pilot profiles with currency warnings

FLIGHT RECORDING AND DEBRIEF
- Records your GPS track and cockpit audio
- Transcribes audio on the device, so audio never leaves your iPad
- Replay a flight with its track and transcript
- On-device debrief on supported devices (Apple Foundation Models)
- Digital logbook

PRIVACY
- No account, no analytics, no ads, no tracking
- Location, audio, transcripts, flights and logbook stay on your device
- Weather, TFR, NOTAM and chart requests go to NOAA and the FAA; map tiles come from the FAA sectional service (ArcGIS), OpenFreeMap, Esri and OpenTopoMap; in Israel mode, NOTAMs come from a relay the developer runs on Cloudflare and chart packs download from Cloudflare R2. None of these requests carries your position
- Open source under MPL-2.0

NEEDS THE INTERNET: weather, TFRs, NOTAMs, PIREPs and any map area you have not downloaded. Works offline: the airport
database, downloaded map regions and FAA charts you have already opened.

IMPORTANT
OpenEFB is provided as a supplemental reference tool. It is NOT intended to be used as a primary means of navigation.
Pilots are responsible for maintaining situational awareness through all available means including current paper
charts, ATC communication, and visual references.

Aviation data (charts, airports, frequencies, airspace) is sourced from the FAA and is subject to change. Always verify
information against official FAA publications. Expired data is clearly marked but should not be relied upon for
navigation.
In Israel mode the data comes from CAAI and the Israel Airports Authority; the binding sources are the Israeli AIP and NOTAMs.

Weather information is provided for planning purposes only and may not reflect current conditions. Always obtain an
official weather briefing from 1800wxbrief.com or FSS before flight.

iPad GPS accuracy varies by model and conditions. WiFi-only iPads do not have GPS hardware. Cellular iPad GPS is not
TSO-certified. Do not rely on iPad GPS as a sole means of position awareness.

OpenEFB has not been tested, approved, or certified by the FAA or any other aviation authority. Use at your own risk.

DATA SOURCES
FAA (charts, airport data, TFRs, NOTAMs, terminal procedures), NOAA Aviation Weather Center (METAR, TAF, PIREP,
AIRMET/SIGMET, winds aloft), map data (c) OpenStreetMap contributors via OpenFreeMap and OpenMapTiles, imagery (c) Esri,
Maxar, Earthstar Geographics, terrain (c) OpenTopoMap (CC-BY-SA). In Israel mode: Civil Aviation Authority of Israel (CAAI)
GIS layers, chart and aerodrome diagrams (chart (c) CAAI, base map (c) Mapa Ltd), and NOTAMs from the Israel Airports
Authority through a relay run by the developer.
```

## Keywords (100 max, comma-separated, no spaces after commas)
`efb,vfr,aviation,pilot,flight,moving map,sectional,metar,taf,tfr,notam,airport diagram,logbook,chart` (100)

## URLs
- Support: `https://github.com/quartermint/openefb` (matches the link in Settings; confirm it is public)
- Marketing: blank or the same repo

## Copyright
`2026 Quartermint`

## Privacy policy URL
Required for the listing. Point to a `PRIVACY.md` in the repo or a page that repeats `PRIVACY_NUTRITION_LABELS.md`.
Not created here.

## App Review notes (private)
```
OpenEFB is a VFR electronic flight bag. No login is needed.
- Location (While Using): centres the moving map on the device position. Background location keeps a recorded
  flight track running with the screen off.
- Microphone and Speech Recognition: used only to record and transcribe cockpit audio on the device during a flight
  recording. Transcription is on-device (SpeechAnalyzer, or SFSpeechRecognizer with requiresOnDeviceRecognition = true).
  The debrief uses Apple Foundation Models on the device. No audio, transcript or location is sent to a server.
- Network: NOAA aviationweather.gov (keyless), FAA TFR, terminal chart and NOTAM services, and map tile hosts.
  The default region is US. In Settings > Region = Israel the app also reads a NOTAM feed from a Cloudflare Worker run
  by the developer (openefb-notam-relay.omerc.workers.dev), checks small manifest files on a Cloudflare R2 bucket for
  newer chart and diagram packs, and downloads a pack only when the user taps Download. None of these requests carries
  a position, an account or credentials.
  NOTAMs need a free FAA API key that the user enters in Settings > NOTAM API (a link there opens the FAA portal).
  Without a key the airport sheet says "NOTAMs need a free FAA API key. Add it in Settings > NOTAM API."
- To see the map without moving, use Xcode or simulator location Palo Alto (37.4611, -122.1150).
- TFR, AIRMET/SIGMET and airport diagram overlay are advisory and are labelled as such in the app.
```

## Age rating
Expected 4+. Confirm in the questionnaire.

## Screenshots (iPad 13-inch, 2064x2752)
See `screenshots/README.md`. Apple's current spec: 13-inch iPad accepts 2064x2752 or 2048x2732 (portrait) and the
landscape equivalents. Captured at 2064x2752.

## To confirm before submitting
- Public repo URL, privacy policy URL.
- Display name: set `OpenEFB` as the home-screen name (currently `efb-212`).
- Public release only: remove Satellite and Terrain, then delete the Esri and OpenTopoMap lines from the data sources
  paragraph (efb-zfm.8).
- Owner decision: whether the listing names Israel (see `README.md`, "Pending owner decision"). The description above names no Israeli feature and is otherwise US-only; only its privacy, data-source and data-accuracy lines, and the review notes, cover Israel mode.
- Public release only: CAAI/Mapa permission to host the CVFR chart and aerodrome diagrams (`NOTICE`).
