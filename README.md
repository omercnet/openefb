# OpenEFB

[![Swift 6](https://img.shields.io/badge/Swift-6.0-FA7343?logo=swift&logoColor=white)](https://swift.org)
[![iOS 26](https://img.shields.io/badge/iOS-26-000000?logo=apple&logoColor=white)](https://developer.apple.com)
[![License: MPL-2.0](https://img.shields.io/badge/License-MPL--2.0-brightgreen.svg)](LICENSE)

A free, open-source iPad VFR Electronic Flight Bag: a moving map on the FAA sectional, airport and weather information, flight recording, and an on-device post-flight debrief.

**Status: TestFlight beta (version 1.0, build 1).** See [Limitations](#limitations).

## The Problem

ForeFlight costs $120-360/yr. The data it uses -- FAA airports, VFR sectional charts, NOAA weather -- is **free and public domain**. Android pilots have Avare (free, open-source). iOS pilots have nothing. OpenEFB fills that gap.

## What Makes It Different

1. **Open-source and free** (MPL-2.0)
2. **Simplicity-first** -- VFR-focused, three tabs: Map, Flights, Settings
3. **Integrated flight recording** -- GPS track + cockpit audio + on-device radio transcription, built into the EFB
4. **On-device debrief** -- post-flight analysis written by Apple Foundation Models on supported devices; no audio, transcript or position is sent to any AI service

## Features

**Map and navigation**
- Moving map on the FAA VFR sectional (zoom 8-12), with Street, Satellite and Terrain base maps
- Airport database from FAA NASR (19,134 airports, runways, frequencies, navaids and Class B/C/D airspace), searchable, with spatial queries
- Ownship, track-up / north-up, instrument strip (ground speed, altitude, vertical speed, track), GPS status
- Nearest-airport readout and a nearest list with Direct-To; active navigation bar
- Day / night / auto display mode
- Offline map regions (sectional and Street)

**Airports and charts**
- Airport sheet: runways, frequencies, METAR and TAF, PIREPs, winds aloft
- NOTAMs, using the pilot's own free FAA API key (entered in Settings; OpenEFB doesn't provide one)
- FAA terminal charts (approach procedures, airport diagram) downloaded as PDFs from FAA d-TPP
- Georeferenced airport diagram overlay on the map (advisory: verify against the FAA diagram)

**Weather and advisories**
- TFR and AIRMET/SIGMET layers, advisory only
- A data-age badge on every weather and advisory item; expired chart cycles are marked

**Planning and profiles**
- Departure-to-destination route with distance, time and fuel
- Aircraft and pilot profiles with currency tracking (under Settings > Profiles)

**Flight recording, replay and debrief**
- GPS track and cockpit audio, with on-device transcription (`SpeechAnalyzer`, `SFSpeechRecognizer` fallback)
- Auto-start above a ground-speed threshold (15 kt by default), flight-phase detection
- Replay with track, readouts, scrub bar and transcript
- Digital logbook with draft entries created from recordings (in the Flights tab)
- On-device debrief with Apple Foundation Models, where the device supports it

## Limitations

- **TestFlight beta.** It has not been used in a cockpit by pilots yet, and hasn't been tried on a physical iPad in flight.
- **Not FAA-approved.** OpenEFB has not been tested, approved, or certified by the FAA or any other aviation authority. It is a supplemental reference, not a primary means of navigation. iPad GPS isn't TSO-certified, and Wi-Fi-only iPads have no GPS.
- **Airport diagrams:** 820 of the 925 FAA airport diagrams (88.6%, cycle 2611) pass the automatic georeferencing checks and can be overlaid on the map. The rest are viewable only as the FAA PDF. Charts and diagrams are downloaded on demand, not bundled.
- **Satellite and Terrain are online only.** Offline downloads cover the sectional and Street maps. Satellite and Terrain tiles come from third-party hosts and are slated for removal before a public release.
- **Needs the internet:** weather, TFRs, AIRMET/SIGMET, PIREPs, winds aloft, NOTAMs, FAA charts and any map area you haven't downloaded. Works offline: the airport database, downloaded map regions and charts you have already opened.
- **Debrief** needs a device that supports Apple Foundation Models.
- **NOTAMs** need your own free FAA API key.
- iPad only, iOS 26 or later. No IFR procedures, ADS-B traffic, weight and balance, or cloud sync.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Platform | iPad, iOS 26.0 |
| Language | Swift 6.0 language mode, SwiftUI |
| Architecture | MVVM with the Observation framework (`@Observable`); one root `AppState` |
| Map Engine | MapLibre Native iOS (open-source, no API fees) |
| Aviation Data | FAA NASR, imported offline by `tools/nasr-importer` into a bundled SQLite database |
| Database | GRDB (aviation data with R-tree and FTS indexes; recording data) + SwiftData (profiles, flights, plans, logbook, settings) |
| Weather | NOAA Aviation Weather API (free, no key) |
| Charts | FAA VFR sectional raster tiles (ArcGIS); FAA d-TPP terminal chart PDFs |
| Recording | In-app: `Services/Recording/` (GPS, audio, `SpeechAnalyzer` transcription) |
| Debrief | Apple Foundation Models (on-device) |

Swift packages: MapLibre Native iOS and GRDB.swift. Nothing else.

## Build and Run

Requires Xcode with the iOS 26 SDK.

```bash
git clone https://github.com/quartermint/openefb.git
cd openefb
open efb-212.xcodeproj    # SwiftPM resolves MapLibre and GRDB on first open

# Select an iPad simulator or device -> Cmd+R
# Run tests: Cmd+U
```

From a shell, use `tools/sim-test.sh` (it owns the simulator and derived-data handling):

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
tools/sim-test.sh build -quiet                        # compile app + tests
tools/sim-test.sh test -only-testing:efb-212Tests     # unit tests (555 test cases, 0 failed as of 2026-11-01)
tools/sim-test.sh demo                                # install and launch at KPAO on the simulator
tools/fly.sh                                          # feed a simulated VFR route (KPAO -> KSQL -> KOAK -> KSFO)
```

## Project Structure

```
openefb/
├── efb-212/
│   ├── efb_212App.swift       # App entry point
│   ├── ContentView.swift      # 3-tab root: Map / Flights / Settings
│   ├── Views/
│   │   ├── Map/               # Moving map, controls, instrument strip, airport sheet, layers
│   │   ├── Planning/          # Flight plan creation
│   │   ├── Flights/           # History, detail, replay, transcript, debrief
│   │   ├── Logbook/           # Logbook (shown in the Flights tab)
│   │   ├── Aircraft/          # Aircraft + pilot profiles (Settings > Profiles)
│   │   ├── Settings/          # Settings, offline maps
│   │   ├── Onboarding/        # First-run onboarding
│   │   └── Components/        # Badges, dots, search, banners
│   ├── ViewModels/            # @Observable @MainActor view models
│   ├── Services/              # Weather, TFR, NOTAM, charts, map, offline maps, currency
│   │   ├── Recording/         # Track, audio, transcription, auto-start, persistence
│   │   ├── Replay/            # Replay engine
│   │   └── Debrief/           # On-device debrief
│   ├── Data/                  # AviationDatabase, RecordingDatabase (GRDB), Models/ (SwiftData)
│   ├── Core/                  # AppState, types, errors, design tokens
│   └── Resources/             # Bundled aviation.sqlite, map style
├── efb-212Tests/              # Unit and integration tests (Swift Testing)
├── efb-212UITests/            # Xcode template stubs
├── tools/                     # sim-test.sh, fly.sh, nasr-importer/, apd-georef/
├── dist-prep/                 # TestFlight / App Store prep
└── docs/                      # Design, product, handoff briefs
```

## Data Sources

All free, all public domain except the map tiles:

| Source | Data | Update Cycle |
|--------|------|-------------|
| [FAA NASR](https://nfdc.faa.gov) | Airports, runways, frequencies, navaids (bundled database) | 28 days |
| FAA AIS Class Airspace | Class B/C/D airspace (bundled database) | with NASR |
| FAA VFR sectional tiles (ArcGIS) | Sectional raster tiles | 56 days |
| [FAA d-TPP](https://aeronav.faa.gov) | Terminal charts and airport diagrams (PDF) | 28 days |
| [NOAA Aviation Weather](https://aviationweather.gov/data/api/) | METARs, TAFs, PIREPs, AIRMET/SIGMET, winds aloft | Real-time |
| [FAA TFR](https://tfr.faa.gov) | Temporary flight restrictions | Real-time |
| FAA NOTAM API | NOTAMs (your own free API key) | Real-time |
| OpenFreeMap / OpenStreetMap, Esri, OpenTopoMap | Street, Satellite and Terrain base maps | n/a |

## Roadmap

| Phase | Focus | Status |
|-------|-------|--------|
| **Phase 1** | Core VFR EFB (map, airports, weather, planning) | Complete |
| **Phase 2** | Flight recording, replay, logbook and on-device debrief | Built; in TestFlight beta |
| **Phase 3** | IFR procedures, ADS-B traffic, advanced features | Planned |

Open work is tracked in beads (`bd ready`).

## Contributing

This project is in early development. Contribution guidelines coming soon. In the meantime, open an issue or start a discussion.

1. Fork the repository
2. Create a feature branch
3. Make your changes and run tests (`Cmd+U`)
4. Open a pull request

## License

[MPL-2.0](LICENSE) -- file-level copyleft. Use it, fork it, improve it, contribute back.

## Disclaimer

OpenEFB is a supplemental reference tool. It is **not** intended as a primary means of navigation. Pilots are responsible for maintaining situational awareness through all available means including current paper charts, ATC communication, and visual references. This software has not been tested, approved, or certified by the FAA or any other aviation authority.
