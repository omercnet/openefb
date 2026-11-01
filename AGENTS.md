# OpenEFB — Open-Source iPad VFR Electronic Flight Bag

## Project Overview

- **Product:** Free, open-source VFR EFB for iPad — moving-map navigation + flight recording + AI debrief
- **Bundle ID:** io.omer.efb (tests: quartermint.efb-212Tests)
- **Target:** iPad only, iOS 26.0, Swift 6.0 language mode, SwiftUI
- **License:** MPL-2.0
- **Full product specification:** See `PRD.md` in this directory (source of truth for ALL product decisions)

## Architecture

- **Pattern:** MVVM + SwiftUI with the Observation framework. `AppState` and the view models are `@Observable` (not `ObservableObject`); views read `AppState` with `@Environment(AppState.self)`. Combine is imported in one file (`Views/Map/DisplayModeModifier.swift`).
- **State:** `@Observable @MainActor final class AppState` — one flat class organised by `// MARK:` sections (navigation, map, location/ownship, flight plan, profile, recording, shared services, currency warning, system). It has no sub-state objects. It also owns the shared database service, recording database and map service.
- **Data:** Dual store — GRDB for aviation data (`AviationDatabase`: airports, runways, frequencies, navaids, airspace, with R-tree and FTS indexes) and recording data (`RecordingDatabase`); SwiftData (`SchemaV1` with a migration plan) for user data (profiles, flight records, flight plans, logbook, settings). CloudKit sync is not enabled.
- **Map:** MapLibre Native iOS (`MLNMapView`) driven by `MapService`; FAA sectional as a raster source, Street as OpenFreeMap vector tiles, Satellite/Terrain as online raster sources.
- **Concurrency:** Swift 6 language mode (`SWIFT_VERSION = 6.0`) with `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`, so pure parsing and model code used off the main actor must be `nonisolated`. Actors for recording (`RecordingCoordinator`, `TrackRecorder`, `AudioRecorder`) and `WeatherService`; `@MainActor` for view models.
- **Communication:** Views observe `@Observable` state; services are injected into view models and `AppState`, and return values via `async/await`. There is no Combine publisher layer.
- **Testability:** Network, weather, recording and database services sit behind protocols (`WeatherServiceProtocol`, `TFRServiceProtocol`, `NotamServiceProtocol`, `DatabaseServiceProtocol`, …) with mocks in `efb-212Tests/Mocks/`. Some services (`MapService`, `CurrencyService`, `ProximityAlertService`) are concrete types.

## Build & Run

Paseo scripts (`paseo.json`; run from the Paseo app or `paseo script start <name>`):

| Script | What it does |
|---|---|
| `simulator` (service) | Builds the app, runs it on this worktree's simulator at KPAO, and streams the simulator to the service URL (serve-sim). If the tree doesn't compile mid-edit, shows the last good build. |
| `fly` | Feeds a simulated VFR route (KPAO → KSQL → KOAK → KSFO) to the simulator. `tools/fly.sh stop` stops it. |
| `test` | Full unit suite on the worktree simulator. |
| `build` | Compile app + tests (no simulator). |
| `ready` | `bd ready`: unblocked work. |

Worktree setup resolves SwiftPM packages and creates the worktree's simulator; teardown deletes it.

From a shell, all simulator work goes through `tools/sim-test.sh` (test, build, demo, id, claim, release, teardown). Agents
claim a reusable simulator with `export SIM_TAG=$(tools/sim-test.sh claim <ticket>)` and release it when done; see docs/handoff/COMMON.md.

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
tools/sim-test.sh test -only-testing:efb-212Tests          # unit tests on the worktree sim
SIM_TAG=T07 tools/sim-test.sh test -only-testing:efb-212Tests/MapQueryRegionTests   # an agent's own sim
open efb-212.xcodeproj                                     # Xcode (Cmd+R / Cmd+U)
```

## File Organization

```
efb-212/
├── efb_212App.swift               # App entry point, scene setup
├── ContentView.swift              # 3-tab root: Map / Flights / Settings; FlightsTabView (History / Logbook / Plans)
├── Views/
│   ├── Map/                       # Moving map, controls, instrument strip, airport sheet and sections, layers
│   ├── Planning/                  # Flight plan creation, summary card
│   ├── Flights/                   # Flight history, detail, replay, transcript, debrief
│   ├── Logbook/                   # Logbook list and entry editing (shown in the Flights tab)
│   ├── Aircraft/                  # Aircraft + pilot profiles (reached from Settings > Profiles)
│   ├── Settings/                  # Settings, offline maps
│   ├── Onboarding/                # First-run onboarding
│   └── Components/                # Reusable UI components (badges, dots, search, banners)
├── ViewModels/                    # @Observable @MainActor view models
├── Services/                      # API clients, location, map, offline maps, currency
│   ├── Recording/                 # RecordingCoordinator, TrackRecorder, AudioRecorder, TranscriptionService
│   ├── Replay/                    # ReplayEngine
│   └── Debrief/                   # DebriefEngine (Apple Foundation Models), FlightSummaryBuilder
├── Data/
│   ├── AviationDatabase.swift     # GRDB — airports, runways, frequencies, navaids, airspace (bundled aviation.sqlite)
│   ├── RecordingDatabase.swift    # GRDB — track points, transcript segments, phase markers, debrief results
│   ├── DatabaseManager.swift      # DatabaseManager (DatabaseServiceProtocol) + UnavailableDatabaseService fallback
│   └── Models/                    # SwiftData @Model classes (SchemaV1: profiles, flight records, plans, logbook, settings)
├── Core/
│   ├── AppState.swift             # Root state (@Observable, one flat class)
│   ├── Types.swift, AviationModels.swift, Protocols.swift
│   ├── EFBError.swift             # Centralized error types
│   ├── DesignTokens.swift, DisplayMode.swift, Disclaimers.swift, DataFreshness.swift
│   └── Extensions/                # Swift extensions
├── Resources/                     # aviation.sqlite, base-style.json
└── Assets.xcassets/
efb-212Tests/                      # Swift Testing suites (ServiceTests, ViewModelTests, DataTests, IntegrationTests, Mocks)
efb-212UITests/                    # Xcode template stubs
tools/                             # sim-test.sh, fly.sh, sim-preview.sh, nasr-importer/, apd-georef/
dist-prep/                         # TestFlight / App Store prep
docs/                              # design, product, handoff briefs
```

## Naming Conventions

| Type | Convention | Example |
|------|-----------|---------|
| Views | PascalCase + "View" suffix | `MapView.swift` |
| ViewModels | PascalCase + "ViewModel" suffix | `MapViewModel.swift` |
| Services | PascalCase descriptive name | `WeatherService.swift`, `TerminalProcedureService.swift` |
| Protocols | PascalCase + "Protocol" suffix | `DatabaseServiceProtocol` |
| Actors | PascalCase descriptive name | `RecordingCoordinator`, `TrackRecorder` |
| Files | Match primary type name | `MapViewModel.swift` contains `MapViewModel` |
| Aviation units | Always documented in comments | `// knots`, `// feet MSL`, `// degrees true` |

## Key Dependencies

Two remote SwiftPM packages, both in the Xcode project (versions pinned in `efb-212.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`):

| Package | Purpose | Source |
|---------|---------|--------|
| **MapLibre Native iOS** | Map rendering, raster and vector tile sources | `maplibre/maplibre-gl-native-distribution` (6.x) |
| **GRDB.swift** | SQLite with R-tree and FTS for aviation data; recording database | `groue/GRDB.swift` (7.x) |

Not dependencies: SwiftNASR (NASR is parsed offline by `tools/nasr-importer`, which uses GRDB and swift-argument-parser), SFR packages. Apple frameworks used: SwiftData, FoundationModels, Speech, CoreLocation, AVFoundation, PDFKit.

Network services (free, no key unless noted): NOAA Aviation Weather (METAR, TAF, PIREP, AIRMET/SIGMET, winds aloft), FAA TFR, FAA d-TPP charts, FAA NOTAM API (the pilot's own key, stored in Keychain), tile hosts OpenFreeMap, ArcGIS (FAA sectional), Esri and OpenTopoMap.

## Development Standards

- All ViewModels are `@MainActor`
- All manager/service actors use Swift concurrency (`async/await`)
- Protocol-first design for testability (every service has a protocol)
- Test coverage targets: >80% for services, >60% for ViewModels
- No force unwraps (`!`) in production code
- All aviation units documented in comments (knots, feet MSL, degrees true, nautical miles, etc.)
- Errors use the centralized `EFBError` enum conforming to `LocalizedError`
- Weather data always displays age/staleness badges
- Chart data always displays expiration status

## Critical Files

| File | Role |
|------|------|
| `PRD.md` | Product spec, architecture, data models, sprint plan (see the dated note at the top for where the shipped app differs) |
| `AGENTS.md` | This file — agent instructions and project conventions |
| `efb_212App.swift` | App entry point; creates `AppState` and injects it with `.environment(appState)` |
| `Core/AppState.swift` | Global state coordinator — modify with care, shared across all views |
| `Data/AviationDatabase.swift` | GRDB aviation database — airports, navaids, airspace |
| `Data/DatabaseManager.swift` | `DatabaseManager` — wraps `AviationDatabase` behind `DatabaseServiceProtocol` (Core/Protocols.swift) |
| `Services/MapService.swift` | MapLibre integration — chart layers, airspace, ownship |

## SFR Code Reuse

- The PRD planned to extract the Sovereign Flight Recorder (`~/sovereign-flight-recorder/`) into SPM packages (PRD Section 10). That extraction never happened: the project has no SFR packages, and no `import SFR*` anywhere.
- Recording, audio, transcription, replay and debrief are implemented in the app itself: `Services/Recording/` (`RecordingCoordinator`, `TrackRecorder`, `AudioRecorder`, `TranscriptionService`, `AviationVocabulary`), `Services/Replay/`, `Services/Debrief/`, and `Data/RecordingDatabase.swift`.
- Treat PRD Section 10 as history, not a plan.

## Agent Team Guidelines

### Working with the PRD

- **PRD.md is the product spec** and the source of product intent; where the shipped app differs, the dated note at the top of the PRD says so, and the code wins
- **Section 8.5** holds early implementation sketches (`ObservableObject`, Combine, `EFBRecordingCoordinator`) that were not built that way; follow the code in `efb-212/`, not those sketches
- **Section 18** (Phase 1 sprints) is complete; the PRD's header note lists where the shipped app differs from it
- **Section 19** has visual verification — check each component against criteria before marking done

### Sprint Execution

- Each agent should own **1 slice** (e.g., "map layer" or "weather service") described in a `docs/handoff/T*.md` brief
- Read `docs/handoff/COMMON.md` first: concurrent agents share this worktree, so edit only the files your brief owns
- **Avoid modifying AppState without coordinating** — it's shared state, changes affect everything
- Run tests after every significant change
- Do not commit unless your brief says so; the integrator snapshots the tree

### Agent Specialization

| Agent Role | Focus Area | Key Files |
|------------|-----------|-----------|
| **Foundation** | AppState, models, database schema, project structure | Core/, Data/, Package dependencies |
| **Map** | MapLibre integration, tile rendering, layers, ownship | Views/Map/, Services/MapService.swift |
| **Aviation Data** | NASR import, airport DB, search, spatial queries | Data/AviationDatabase.swift, tools/nasr-importer/ |
| **Weather** | NOAA API, METAR/TAF, caching, map dots | Services/WeatherService.swift, ViewModels/WeatherViewModel |
| **Planning** | Flight plans, route rendering, instrument strip | Views/Planning/, ViewModels/FlightPlanViewModel |
| **Recording** | Recording, replay, debrief | Services/Recording/, Services/Replay/, Services/Debrief/, Data/RecordingDatabase.swift |

### Coordination Rules

1. One agent owns `AppState.swift` — others propose changes via PR/review
2. Database schema changes must be reviewed (affects all data consumers)
3. Service protocol changes require updating both the protocol and all mocks
4. New SPM dependencies require updating the Xcode project file
5. Visual verification (Section 19) is required before any slice is "done"

## Current State (as of 2026-11-01)

**Status:** TestFlight beta preparation (version 1.0, build 1). Not FAA-approved; supplemental reference only.
**Built:** 112 app Swift files, 63 test files. Last full unit run (`tools/sim-test.sh test -only-testing:efb-212Tests`, 2026-11-01): **555 test cases, 0 failed**. The UI test target holds only Xcode template stubs.
**UI:** three tabs, Map / Flights / Settings (`ContentView.swift`). Flights holds a History / Logbook / Plans picker; Aircraft & Pilot profiles are under Settings > Profiles. Onboarding runs once.
**Shipped:**
- Moving map: FAA VFR sectional (zoom 8-12) plus Street, Satellite and Terrain base maps, ownship, track-up/north-up, instrument strip, nearest-airport HUD and list with Direct-To, airspace from NASR, day/night/auto display mode.
- Airport sheet: METAR/TAF, frequencies, runways, PIREPs, winds aloft, NOTAMs (the pilot's own free FAA API key), FAA d-TPP charts and diagram PDFs, georeferenced diagram overlay on the map.
- Layers: TFRs, AIRMET/SIGMET with data-age badges. Offline map regions (sectional and Street).
- Flight planning and active navigation bar; aircraft and pilot profiles with currency tracking.
- Flight recording (GPS track, cockpit audio, on-device transcription with `SpeechAnalyzer` and an `SFSpeechRecognizer` fallback), auto-start above 15 kt, phase detection, replay, digital logbook, and an on-device debrief with Apple Foundation Models.
- Data: bundled `aviation.sqlite` built from FAA NASR cycle 2026-10-29 (19,134 airports, 1,287 airspaces, 1,468 navaids) by `tools/nasr-importer`.
**Next:** TestFlight upload (`dist-prep/`), then the public-release items under Known Issues.

## Issue Tracking (beads)

This project uses bd (beads) for issue tracking. The database lives in the main checkout at `/Users/omer/dev/openefb/.beads` and is shared by all worktrees.

- Run `bd prime` for workflow context and command guidance.
- Use `bd ready`, `bd show <id>`, `bd update <id> --claim`, and `bd close <id>`.
- Use `bd remember "insight"` for durable project facts; keep per-operator preferences in your harness's own memory.
- Do not use markdown TODO lists for task tracking.

## Known Issues

Open work is tracked in beads (`bd ready`, `bd list`). Notable open items as of 2026-11-01:

- **Satellite and Terrain base maps** use Esri World Imagery and OpenTopoMap tiles whose terms don't allow a public release; remove them before the public release (efb-zfm.8, `docs/TILE-SOURCES.md`). Both are online-only; offline downloads cover the sectional and Street only.
- **Airport diagrams:** 820 of the 925 FAA airport diagrams (88.6%, cycle 2611) pass the georeferencing gates; the rest show only as PDFs (`docs/design/apd-georef-report.md`).
- **Private-use flag:** `airports.ownership` is not populated, so the NRST private-use flag can't fire (efb-23t).
- **Home-screen name** is still `efb-212`; set `INFOPLIST_KEY_CFBundleDisplayName` to `OpenEFB` before the public release (`dist-prep/README.md`).
- **Debrief** needs a device that supports Apple Foundation Models; elsewhere the app says the debrief is unavailable.
- **Unvalidated with pilots:** the cut list and fix list from the design pass rest on documented assumptions (efb-77r.34).
- `EFBError.databaseCorrupted` copy mentions a Settings re-import that doesn't exist (efb-yxv).

## Ecosystem Role

- **Tier:** T1 / Perception
- **Produces:** Flight telemetry and navigation data (local SwiftData)
- **Vault pipeline:** Not yet connected to lifevault
- **Throughline ref:** See ~/throughline/architecture/data-flows.md

## Swift/iOS Patterns (session-mined)

- The project builds with `xcodebuild` through `tools/sim-test.sh` (there is no root `Package.swift`); `xcodebuild` output is the truth. The project is Xcode-managed (no xcodegen `project.yml`): edit entitlements and Info.plist directly.
- SourceKit cross-file errors ("No such module", unresolved types in another file) are IDE noise, not compile failures. Check with `tools/sim-test.sh build -quiet`.
- Type explosion (2x error spike) after a large edit almost always = duplicate type definitions; grep for the type name first.
- iOS 26 beta: 7-16s WebContent launch time is OS-level; `NSInvalidArgumentException nil` on WebContent is an OS bug, not your code
- iOS Bonjour/mDNS discovery silently fails without local network permission — trigger the prompt with a short-lived UDP NWConnection to a LAN address before starting NWBrowser
- iOS app version in UI won't update after OTA deploy if old app is cached — uninstall and reinstall
