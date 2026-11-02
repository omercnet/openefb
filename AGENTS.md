# Kanaf (כנף) — Open-Source iPad VFR Electronic Flight Bag

> Kanaf began as a fork of OpenEFB by Ryan Stern. Internal identifiers (repo `omercnet/openefb`, Xcode target `efb-212`, bundle ID `io.omer.efb`, R2 bucket, Worker, Vercel project) still say openefb/efb-212; user-facing text says Kanaf.

## Project Overview

- **Product:** Kanaf — free, open-source VFR EFB for iPad and iPhone (US + Israel CVFR): moving-map navigation + flight recording + AI debrief. App Store Connect name: "Kanaf EFB"
- **Bundle ID:** io.omer.efb (tests: quartermint.efb-212Tests)
- **Target:** iPad primary, iPhone supported (portrait, compact-width layouts), iOS 26.0, Swift 6.0 language mode, SwiftUI
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
| `fly-israel` | Flies the Israel CVFR scenario `il-cvfr-llhz-llib-nominal` at 4x through the DEBUG scenario player (`tools/fly.sh israel <scenario> [--speed N] [--start S] [--notams FILE] [--sim udid\|tag]`; `tools/fly.sh list` shows the scenarios in `tools/flight-sim/`). |
| `test` | Full unit suite on the worktree simulator. |
| `build` | Compile app + tests (no simulator). |
| `ready` | `paseo-progress show`: open tickets and questions on the dashboard. |
| `check` | `tools/check.sh`: the pre-commit checks (gitleaks, forbidden files, plist/JSON/shell/Python lint, swift-format report, web tests) over the whole tree, plus a full-history gitleaks scan. See "Hooks". |

Worktree setup resolves SwiftPM packages and creates the worktree's simulator; teardown deletes it.

From a shell, all simulator work goes through `tools/sim-test.sh` (test, build, demo, id, claim, release, teardown). Agents
claim a reusable simulator with `export SIM_TAG=$(tools/sim-test.sh claim <ticket>)` and release it when done; see docs/handoff/COMMON.md.
`SIM_DEVICE` picks the model (default iPad Pro 13-inch; `SIM_DEVICE="iPhone 17 Pro" tools/sim-test.sh claim <ticket>` claims an iPhone
simulator, `"iPhone 17e"` the narrowest). Layouts switch on `horizontalSizeClass`, never on the device.

```bash
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
tools/sim-test.sh test -only-testing:efb-212Tests          # unit tests on the worktree sim
SIM_TAG=T07 tools/sim-test.sh test -only-testing:efb-212Tests/MapQueryRegionTests   # an agent's own sim
open efb-212.xcodeproj                                     # Xcode (Cmd+R / Cmd+U)
```

`web/` has its own `package.json` and lockfile per folder (no workspace tooling); each folder's README has the details:

```bash
cd web/notam-relay && npm ci && npm test      # Vitest on saved IAA samples; npm run dev = wrangler dev --test-scheduled
cd web/charts && npm ci && npm test           # manifest rules (node --test)
cd web/interviews && npm ci && npm run build  # Next.js build; npm run lint = tsc --noEmit
```

Deploys: the Worker with `npx wrangler deploy` from `web/notam-relay` (owner login required); packs with `web/charts/publish.sh` (see its README; `--approve` is the owner's go-ahead). `web/interviews` deploys from git pushes on the Vercel project `openefb-interviews`.

## File Organization

```
efb-212/
├── efb_212App.swift               # App entry point, scene setup
├── ContentView.swift              # 3-tab root: Map / Flights / Settings; FlightsTabView (History / Logbook / Plans)
├── Views/
│   ├── Map/                       # Moving map, controls, instrument strip, airport sheet and sections, layers
│   ├── Planning/                  # Flight plan creation, summary card
│   ├── Briefing/                  # Israel pre-flight NOTAM briefing (filters, read/unread, show on map, IMS link)
│   ├── Flights/                   # Flight history, detail, replay, transcript, debrief
│   ├── Logbook/                   # Logbook list and entry editing (shown in the Flights tab)
│   ├── Aircraft/                  # Aircraft + pilot profiles (reached from Settings > Profiles)
│   ├── Settings/                  # Settings, offline maps
│   ├── Onboarding/                # First-run onboarding
│   └── Components/                # Reusable UI components (badges, dots, search, banners)
├── ViewModels/                    # @Observable @MainActor view models
├── Services/                      # API clients, location, map, offline maps, currency; Israel* files = Israel mode
│   ├── Israel*.swift              # chart packs (IsraelChartService/Store/Manifest), diagrams (IsraelDiagramPack/Store), NOTAMs (IsraelNotamService, IsraelNotamClosureMapper), routing (IsraelRoutePlanner, IsraelFlightPlanMessage, IsraelRouteFollowing), alerts, overlays, LSA rules
│   ├── Recording/                 # RecordingCoordinator, TrackRecorder, AudioRecorder, TranscriptionService
│   ├── Replay/                    # ReplayEngine
│   └── Debrief/                   # DebriefEngine (Apple Foundation Models), FlightSummaryBuilder
├── Data/
│   ├── AviationDatabase.swift     # GRDB — airports, runways, frequencies, navaids, airspace (bundled aviation.sqlite)
│   ├── RecordingDatabase.swift    # GRDB — track points, transcript segments, phase markers, debrief results
│   ├── DatabaseManager.swift      # DatabaseManager (DatabaseServiceProtocol) + UnavailableDatabaseService fallback
│   ├── IsraelAviationDatabase.swift  # GRDB — Israel points, route segments, airspace, runways, curated aerodromes (bundled israel-aviation.sqlite)
│   └── Models/                    # SwiftData @Model classes (SchemaV1: profiles, flight records, plans, logbook, settings)
├── Core/
│   ├── AppState.swift             # Root state (@Observable, one flat class)
│   ├── Types.swift, AviationModels.swift, Protocols.swift
│   ├── EFBError.swift             # Centralized error types
│   ├── DesignTokens.swift, DisplayMode.swift, Disclaimers.swift, DataFreshness.swift
│   ├── Extensions/                # Swift extensions
│   └── Region.swift, RegionStore.swift, ActiveRoute.swift, DataRefreshScheduler.swift, OverlayStaleness.swift, TileFailureTracker.swift
├── Resources/                     # aviation.sqlite, israel-aviation.sqlite, israel-border-lines.json, base-style.json
└── Assets.xcassets/
efb-212Tests/                      # Swift Testing suites (ServiceTests, ViewModelTests, DataTests, IntegrationTests, Mocks)
efb-212UITests/                    # Xcode template stubs
tools/                             # sim-test.sh, fly.sh, sim-preview.sh, nasr-importer/, apd-georef/ (FAA diagrams), caai-importer/ (Israel GIS + aerodromes), caai-chart/ (official CVFR chart pack), caai-apd/ (Israeli diagrams)
dist-prep/                         # TestFlight / App Store prep
docs/                              # design, product, handoff briefs
web/                               # Server side, not in the app: notam-relay/ (Cloudflare Worker), charts/ (R2 publish), interviews/ (Next.js on Vercel)
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

Network services (free, no key unless noted): NOAA Aviation Weather (METAR, TAF, PIREP, AIRMET/SIGMET, winds aloft), FAA TFR, FAA d-TPP charts, FAA NOTAM API (the pilot's own key, stored in Keychain), tile hosts OpenFreeMap, ArcGIS (FAA sectional), Esri and OpenTopoMap. Israel adds two services the project runs itself: the NOTAM relay (`openefb-notam-relay.omerc.workers.dev`, Cloudflare Workers free plan; it scrapes the IAA site, the app doesn't) and the chart and diagram packs on Cloudflare R2 (`pub-cdfb51548498487fa9fdb9794192c8ef.r2.dev`, rate-limited dev URL). Vercel hosts only the pilot-interviews site, which the app doesn't call. The relay URL and the R2 base URL are overridable through the `israelNotamFeedURL` and `israelChartBaseURL` defaults.

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

## Current State (as of 2026-11-02)

**Status:** TestFlight beta preparation (version 1.0, build 1). Not FAA-approved; supplemental reference only.
**Built:** 166 app Swift files, 102 test files, 2 UI-test template stubs. Last full unit run (`tools/sim-test.sh test -only-testing:efb-212Tests`, 2026-11-02): **1065 tests, 0 failed** (1078 counting parameterized arguments). The UI test target holds only Xcode template stubs.
**UI:** three tabs, Map / Flights / Settings (`ContentView.swift`). Flights holds a History / Logbook / Plans picker; Aircraft & Pilot profiles are under Settings > Profiles. Onboarding runs once. Settings > Region switches between US and Israel (`Core/Region.swift`, `RegionStore`); the region decides which data layers, weather stations, units (hPa in Israel) and NOTAM provider the app uses.
**Shipped (US):**
- Moving map: FAA VFR sectional (zoom 8-12) plus Street, Satellite and Terrain base maps, ownship, track-up/north-up, instrument strip, nearest-airport HUD and list with Direct-To, airspace from NASR, day/night/auto display mode.
- Airport sheet: METAR/TAF, frequencies, runways, PIREPs, winds aloft, NOTAMs (the pilot's own free FAA API key), FAA d-TPP charts and diagram PDFs, georeferenced diagram overlay on the map.
- Layers: TFRs, AIRMET/SIGMET with data-age badges. Offline map regions (sectional and Street).
- Flight planning and active navigation bar; aircraft and pilot profiles with currency tracking.
- Flight recording (GPS track, cockpit audio, on-device transcription with `SpeechAnalyzer` and an `SFSpeechRecognizer` fallback), auto-start above 15 kt, phase detection, replay, digital logbook, and an on-device debrief with Apple Foundation Models.
- Data: bundled `aviation.sqlite` built from FAA NASR cycle 2026-10-29 (19,134 airports, 1,287 airspaces, 1,468 navaids) by `tools/nasr-importer`.
**Shipped (Israel, epic efb-aac):**
- Bundled `israel-aviation.sqlite` (CAAI GIS layers, data of 25 Oct 2026, imported 2026-11-01, no AIP amendment recorded) built by `tools/caai-importer`: 198 CVFR points and 275 route segments, 221 LSA points and 229 LSA routes, CTR/ATZ/CTA, TMA, FIR, P/R/D areas, runways, and 49 curated aerodromes (`tools/caai-importer/curated/aerodromes-il.csv`, searchable in Hebrew and English, `review_status` unreviewed until the owner reviews). Read through `Data/IsraelAviationDatabase.swift`; the aerodromes reach the app through `Services/IsraelAerodromeAdapter.swift`.
- CVFR overlay drawn from the vectors (`Services/IsraelChartOverlay.swift`, `IsraelChartFeatures.swift`, `IsraelChartStyle.swift`); official CAAI CVFR chart raster from a downloaded pack (`IsraelOfficialChartLayer.swift`).
- Chart and diagram packs: `Services/IsraelChartService.swift` (`ChartPackService`) downloads a published, validated edition from Cloudflare R2 (public dev URL `https://pub-cdfb51548498487fa9fdb9794192c8ef.r2.dev`, bucket `openefb-charts`), checks each file's SHA-256 and installs it. Two products are live: `israel-cvfr` (edition 2025-02, 15 MB MBTiles) and `il-diagrams` (edition 2026-08b). The app installs an edition only when it is published and its validation gate passed (`isServable`).
- Aerodrome diagrams (`IsraelDiagramPack.swift`, `IsraelDiagramStore.swift`, `Views/Map/IsraelDiagramSection.swift`): 5 of 13 CAAI charts are georeferenced at the ±100 ft gate, the rest open as sheet-only PDFs.
- NOTAMs: `Services/IsraelNotamService.swift` reads `https://openefb-notam-relay.omerc.workers.dev/notams.json`, the feed of `web/notam-relay` (a Cloudflare Worker that scrapes the Israel Airports Authority NOTAM pages every 15 minutes). The app never contacts the IAA. `IsraelNotamClosureMapper` maps route closures onto route segments; the briefing (`Views/Briefing/IsraelBriefingView.swift`, `IsraelBriefingFilter`) and map alerts (`IsraelAlertService`, `IsraelAlertEvaluator`, `IsraelAlertBanner`) use them.
- Routing and filing: `Services/IsraelRoutePlanner.swift` plans a CVFR or LSA route between aerodromes; `IsraelFlightPlanMessage.swift` builds the ICAO FPL text for the pilot to send to ais@iaa.gov.il (the app sends nothing); route following with leg altitude and next-point cautions (`IsraelRouteFollowing.swift`, `Views/Map/IsraelRouteFollowingBar.swift`).
- Israel CVFR debrief (`Services/Debrief/CVFRDebrief.swift`, `CVFRDebriefLoader`; `Views/Flights/CVFRDebriefContent.swift`): matches the recorded track to the activated plan's legs (stored in `RecordingDatabase.flight_route_legs`) or to the nearest route segments, then reports per-leg altitude adherence (±200/±300 ft, aerodrome zones excluded) and reporting-point passage with Hebrew/English position-report matching. Numbers come from code; the AI debrief only receives them as facts. Shown without Apple Intelligence.
- Israel sport-aviation (LSA) routes (`Services/IsraelRoutePlanner.swift`, `IsraelLSATimeRules.swift`, `IsraelLSAOverlay.swift`): a CVFR / LSA choice per plan (the aircraft's usual network, kept in `IsraelAircraftNetworkPreference`, preselects it), weekend-only routes left out on weekdays and checked per leg, closures naming LSA / ULTRALIGHT / SPORT, the LSA network on the map in purple. A NOTAM closure the planner cannot place on the network blocks filing ("Unresolved closure: check NOTAM <id>").
- Weather for Israel reads the same NOAA API with the Israel station list; products an aerodrome doesn't publish aren't requested.
**Server side (`web/`):** `web/notam-relay` (Cloudflare Worker + KV, live at `https://openefb-notam-relay.omerc.workers.dev`; `/health` reported 200 on 2026-11-02), `web/charts` (R2 publish tooling; the R2 bucket is live with both products published), `web/interviews` (Next.js pilot-interview app on Vercel Hobby, live at `https://openefb-interviews.vercel.app`, git-connected to omercnet/openefb with Root Directory `web/interviews`). The iPad app uses the first two; the interviews site is not part of the app. See `web/README.md`.
**Next:** TestFlight upload (`dist-prep/`), then the public-release items under Known Issues.

## Hooks

lefthook (`lefthook.yml`) runs on each clone after `mise use -g lefthook@latest && lefthook install` (details in `tools/hooks/README.md`).

- **pre-commit** (staged files only): gitleaks (`.gitleaks.toml`), forbidden files (`*.p8`, `.env*`, `*.mobileprovision`, `*.xcarchive`, `*TmpTests.swift`, CAAI artwork and inputs, new files over 5 MB), `plutil -lint`, JSON, shellcheck, Python syntax, web tests/lint for the changed package. swift-format lint is report-only: the tree has about 4,400 findings and this ticket doesn't reformat it.
- **pre-push:** Conventional Commits for every pushed commit, gitleaks over the pushed range, `tools/sim-test.sh build -quiet`, web tests for changed packages. The full unit suite (about 4 minutes) is not run: `tools/sim-test.sh test -only-testing:efb-212Tests`.
- **commit-msg:** [Conventional Commits](https://www.conventionalcommits.org): `<type>(<scope>)!: <description>`, type one of `feat fix docs style refactor perf test build ci chore revert`, subject at most 100 characters. Check a range by hand with `tools/hooks/commit-msg.sh --range origin/main..HEAD`. **post-checkout / post-merge:** reminder to run `npm ci` when a `web/*/package-lock.json` changed.
- Skip: `git commit --no-verify`, or `LEFTHOOK_EXCLUDE=<job>,<job>`.
- The integrator commits with `git commit-tree`, which bypasses hooks: run `tools/check.sh` first (`--staged` for staged files only, `--quick` to skip the history scan) and write a Conventional Commit message; pre-push rejects any pushed commit that isn't one. Scopes in use: `israel`, `iphone`, `recording`, `map`, `release`, `hooks`, `interviews`, `relay`, `charts`, `skills`, `progress`.

## Issue Tracking (Paseo Progress)

Work is tracked on the Paseo Progress dashboard with `paseo-progress` (run it from the checkout the work happens in; `paseo-progress show` lists tickets and open questions). Beads is retired: its database at `/Users/omer/dev/openefb/.beads` is kept read-only as history, and the `efb-*` IDs in older docs refer to it.

- The integrator adds tickets (`ticket add`), asks the owner questions (`question ask`), and marks tickets done after verifying.
- Agents update their ticket's stage, the ticker, activity and deliverables as described in `docs/handoff/COMMON.md`, and never mark a ticket done.
- Do not use markdown TODO lists for task tracking.

## Known Issues

Open work is on the Paseo Progress dashboard (`paseo-progress show`). Notable open items as of 2026-11-02 (`efb-*` IDs are the retired beads records):

- **Satellite and Terrain base maps** use Esri World Imagery and OpenTopoMap tiles whose terms don't allow a public release; remove them before the public release (efb-zfm.8, `docs/TILE-SOURCES.md`). Both are online-only; offline downloads cover the sectional and Street only.
- **FAA airport diagrams:** 820 of the 925 (88.6%, cycle 2611) pass the georeferencing gates; the rest show only as PDFs (`docs/design/apd-georef-report.md`).
- **Israeli aerodrome diagrams:** 5 of 13 charts place on the map (LLBG, LLHA, LLIB, LLBS, LLEY) at the ±100 ft gate; the other 8 are sheet-only until CAAI supplies surveyed thresholds and ARPs (efb-aac.17, `docs/design/caai-apd-report.md`, `docs/research/israel-caai-data-fixes.md`).
- **Israel mode, from the UX review (T28):** 10 open sev 1-2 findings, efb-aac.21 to efb-aac.30 (chart edition shown without an age, slow "Checking for the latest edition" against an unreachable host, red tint on the closure layer toggle, "Age EXPIRED" on the Weather layer row, diagram pack reachable only from the airport sheet, 125-row briefing without a plan, FPL message as the plan's primary action, route network read from the plan only, unexplained "800/1600" leg altitude and a 100% debrief summary over a 0% leg, six "Not available in Israel yet" layer rows). Two more are in progress: efb-aac.19 (CVFR debrief position-report count) and efb-aac.20 (other-network closures in the briefing).
- **Israel mode is unreviewed by an Israeli CFI** (efb-aac.13); 49 curated aerodromes carry `review_status = unreviewed` and the airport sheet shows an amber "Unreviewed data" note until the owner marks a field reviewed in `tools/caai-importer/curated/aerodromes-il.csv`.
- **Home-screen name** is `Kanaf` (`INFOPLIST_KEY_CFBundleDisplayName`); the App Store Connect name is "Kanaf EFB" (app 6829641724). Internal identifiers keep the old names (`efb-212`, `io.omer.efb`).
- **Debrief** needs a device that supports Apple Foundation Models; elsewhere the app says the debrief is unavailable. The CVFR debrief numbers show without it.
- **Unvalidated with pilots:** the cut list and fix list from the design pass rest on documented assumptions (efb-77r.34); a real-device VoiceOver and Increase Contrast walkthrough is pending (efb-77r.35).
- **Recorded flight status** (damaged/recovered) is stored as marker text in notes, so a pilot edit can erase it (efb-zfm.19).
- **r2.dev rate limits:** the chart packs are served from the R2 dev URL; attach a custom domain before pilots depend on it (`docs/RELIABILITY.md`).

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
