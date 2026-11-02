# Testing

Phase 1 artifact of `docs/IMPROVE-CODE-QUALITY-PLAN.md` (CQ-1, 2026-11-02). Built by reading the
production modules and every test that exercises them. Pinned means a test calls the production code
and asserts the value. Tests that only recompute arithmetic or compare local variables are not counted.

## Test Strategy

| Layer | Tooling | Where | Gates |
|---|---|---|---|
| Unit and service | Swift Testing (`@Test`, `#expect`), `@testable import efb_212` | `efb-212Tests/{ServiceTests,DataTests,ViewModelTests,IntegrationTests}` | `tools/sim-test.sh test -only-testing:efb-212Tests` must be green before any merge |
| Characterization | Swift Testing | `efb-212Tests/CharacterizationTests/` | Same command. A red test here means behavior changed: decide deliberately (see rules below) |
| Network | `StubURLProtocol.session { request in (status, data) }` | `efb-212Tests/Mocks/StubURLProtocol.swift` | No real network in any test |
| Data | GRDB temp-file pools, in-memory/on-disk SwiftData containers in temp dirs | `DataTests`, `CharacterizationTests` | Each test cleans up its files |
| Relay | Vitest (88 tests, run 2026-11-02) | `web/notam-relay` | `npm test` in that directory |
| Charts | 6 tests, run 2026-11-02 | `web/charts` | `npm test` |
| UI | XCUITest stubs only (template) | `efb-212UITests` | Throwaway visual-proof tests per `docs/handoff/COMMON.md`; none are kept |

Total: 967 `@Test` occurrences at the end of CQ-1 (763 at intake): 90 added by CQ-1 in
`CharacterizationTests/` (five tautological tests deleted), the rest by concurrent tickets. The last full run
executed 967 test cases (966 passed). The one failure, `CVFRDebriefTests.plannedLLHZToLLIBFlownHighIsMeasuredAgainstTheBundledAltitudes`
(adherence 0.98 vs 1), belongs to the in-flight IL-DEBRIEF work, not to CQ-1.

**Rules for tests in this repo**
1. Test behavior the pilot depends on: wrong or stale data shown as current, a lost recording, a wrong
   alert. Do not test wiring, mock echoes or incidental defaults.
2. Characterization tests pin what the code does today, wrong or not. A pinned bug carries a comment
   `// BUG(<slug>): pins current behavior; <what is wrong>` and a ticket on the Paseo Progress dashboard.
   Fixing it is a separate behavior change: flip the assertion in the same commit.
3. Structure-only and behavior-only changes never share a commit.
4. Inject clocks and streams (`now:`, `updates:`); never sleep over 100 ms except where a grace timer is the
   subject (these use 25-250 ms).
5. Swift 6 with default MainActor isolation: suites touching `AppState`, SwiftData or services built on
   the main actor are `@MainActor`; pure parsing and model code is `nonisolated`.

**Known weak spots in the existing suite (not worth keeping as they are)**
- `ViewModelTests/MapViewModelTests` (4 tests) asserts on fixtures and a mock database, not on
  `MapViewModel`. Its comments say `MapService` cannot be constructed in tests; `MapService()` is built inert in
  `MapLoadingFlowTests`. Rewrite when `MapViewModel` enters Phase 2.
- `AutoStartTests`: three tests compare local `Double`s and never run the monitoring loop.
- `AudioRecorderTests.recordingsDirectoryIsInAppSupport` builds the path inline and never calls production code.
- `LocationManagerTests` (five tests that recomputed `* 1.94384` inline) was deleted in CQ-1 and replaced by
  `LocationServiceCharacterizationTests`, which drives the real service.

## Safety Net Map

Risk order follows the intake: wrong or stale in-flight data, then a lost recording. "Pin after the Israel
epic lands" marks modules other agents are editing now; add no seams or tests there until the epic lands.

### In-flight awareness

| Module | Pinned behaviors | Test files | Gaps |
|---|---|---|---|
| `GPSStatus` / `GPSFailureReason` (`Services/GPSStatus.swift`) | Status order: no fix, then stale (>5 s, not stationary), then no altitude, then accuracy (>50 m or negative), then OK. Age boundary 5 s; stationary fix never ages. Labels. Failure reason priority denied > restricted > unavailable; only denial offers Settings. | `GPSStatusTests`, `MapGPSRecordingFixesTests` | `accessibilityDescription`; `GPSFailureReason.title/message` copy; `MapViewModel.gpsStatus` 1 Hz clock wiring (not read). |
| `LocationService` (`Services/LocationService.swift`) | Unit conversion m/s to knots, m to feet rounded to 10, invalid course/speed become 0. Failure flags map to reasons. A fix clears failure. Stationary notice only sets the flag. Bare update ignored. Stream error sets `.streamFailed` and tracking is never restarted. No-fix grace timer. VSI from arrival time. Stop ends updates. | `LocationServiceCharacterizationTests` | `CLLocationUpdate` mapping in `liveUpdates()` (needs a device); background-session lifecycle; VSI reset on restart; `updateActiveRouteProgress()` effects. |
| `WeatherService` + `WeatherCache` (`Services/WeatherService.swift`) | Parsing, flight category thresholds, batching (40), partial batch failure, 900 s cache boundary (899 cached, 900 refetches) for single and batch paths, throw on failure after expiry, batch drops expired stations offline, `cachedWeather` serves any age. | `WeatherParsingTests`, `WeatherServiceTests`, `WeatherCacheClockCharacterizationTests`, `AviationModelTests` | `parseCeiling` ignores `VV` and string `base`; `WeatherCache.isStale` (60 min from fetch) is unused in production and conflicts with the 75/180 min observation thresholds. |
| `DataFreshness` (`Core/DataFreshness.swift`) | METAR 75/180 min, TFR 30/120 (red at expiry), NOTAM 60/360, PIREP 60/120, AIRMET 30/120, winds/TAF `validUntil`, chart cycle days, missing timestamp = unknown, boundaries take the worse level, TAF 7 h, NOTAM 359/360, PIREP 119, `validUntil` precedence, `EXPIRES Nd` rounding, spoken names. | `DataFreshnessTests`, `DataFreshnessEdgeCharacterizationTests` | `DataAgeBadge` rendering (view). A TAF has no badge in the UI at all. |
| Weather UI (`AirportInfoSheet`, `WeatherViewModel`, `MapViewModel.loadWeatherDots`) | Region altimeter units in `RegionTests`; stale cache fallback with the mock service in `CrossCountryFlowTests`. | `RegionTests`, `CrossCountryFlowTests` | Fetch error hidden when a stale cache exists (view logic, no seam). `loadWeatherDots` failure keeps old dots and old oldest-time: zero tests. |
| `NearestAirportViewModel` | Israel path (heliports and strips dropped, PPR, closure flag arrives, failure leaves it unflagged, region switch re-queries); `LandableAirportFilter`; clear Direct-To. | `IsraelNearestAndSearchTests`, `LandableAirportFilterTests`, `NearestAirportViewModelTests`, `MapGPSRecordingFixesTests` | US `updateNearest`: 0.5 NM requery gate, keep stale list on database error (silent), no-candidates path; `rankLandable` ordering; `setDirectTo` below 10 kt. Testable today with `MockDatabaseManager` (add a throw switch). |
| `ProximityAlertService` | Altitude shelves (`verticalRelation`), inclusive limits, unknown altitude never INSIDE, 10 s throttle, TFR near/inside/expired. | `ProximityAlertAltitudeTests`, `TFRServiceTests` | Database error clears alerts silently (fails open); Class C/D thresholds (3/2 NM); TFR + airspace merge; `formatAltitude`. **Pin after the Israel epic lands** (IL-ALERTS edits this file). |
| `MapService` / `MapContainerView` | Layer loading and debounce through `MapViewModel` (`MapLoadingFlowTests`); query-region math. | `MapLoadingFlowTests`, `MapQueryRegionTests`, `RegionTests` | `MapService` methods are inert without a map view, so stale-ownship greying, TFR expiry filter (`updateTFRs(_, now:)`) and weather-dot skip have no observable output. Extract pure filters when entering Phase 2. `MapContainerView`: none. **Pin after the Israel epic lands.** |
| `AviationDatabase` / `DatabaseManager` | Queries (nearest, search, airspace containment), install on missing/same version/new version/new size, missing bundle throws, unavailable service throws on every call, garbage install with matching marker throws and is not replaced, garbage with stale marker is replaced, same-size regeneration keeps old copy, `dataCycle()` edge cases. | `AviationDatabaseTests`, `AviationDatabaseRobustnessTests`, `BundledAirportQueriesTests`, `BundledAviationDataTests`, `AviationDatabaseInstallCharacterizationTests` | No schema migration exists (the file is replaced wholesale); non-atomic install (crash between copy and marker); expired NASR cycle is not surfaced anywhere tested. |
| Offline maps (`OfflineMapService`) | Cycle maths and expiry boundaries, tile maths, status resolution (ready/partial/expired/not downloaded), pack style, bounds normalisation and high-latitude clamp, complete-but-partial reads ready. | `OfflineMapTests`, `OfflinePackStatusCharacterizationTests` | `refresh/download/delete/redownload` (MapLibre singleton; extract `summary(state:progress:context:)`); no integrity check beyond MapLibre's own state. |

### Recording and user data

| Module | Pinned behaviors | Test files | Gaps |
|---|---|---|---|
| `RecordingCoordinator` | Start/stop state, double stop returns nil, summary carries audio URL and flight ID, audio and transcription start failures are swallowed and recording continues, stop during countdown is a no-op, auto-start gate, sync loop. | `RecordingCoordinatorTests`, `RecordingStopPathCharacterizationTests`, `MapGPSRecordingFixesTests` | The summary with real fixes (TrackRecorder is built inside `startRecording` from `CLLocationUpdate`; seam: an injectable factory). Auto-start monitor loop, 3 s countdown, 1 s sustained speed. `handleAudioFailure`. **No crash or kill recovery exists and nothing pins that** (orphaned `track_points` and `.m4a`). |
| `TrackRecorder` | Phase detection, vertical speed, points stored, phase markers in memory vs database (rows never closed), write failure still counted. | `TrackRecorderTests`, `RecordingStopPathCharacterizationTests` | Stream error exit is silent; insert error swallowed. |
| `FlightPersistenceService` | One `FlightRecord` plus one draft logbook entry; empty flight discarded; DB track count wins over the summary count; heliport/seaplane preference; audio path relative vs absolute; unreadable track deletes the flight; discard keeps the debrief row; inserts left unsaved. | `FlightPersistenceTests`, `FlightPersistenceStopPathCharacterizationTests` | A real read error (seam: a track reader). `RecordingViewModel.confirmStop` silently drops the recording when persistence or the context is nil (file edited by another agent). |
| `RecordingDatabase` (GRDB, `v1`, `v2_debrief`, `v3_nullable_transcript_confidence`, and a later migration that adds `flight_route_legs`) | v2 database upgraded; v1-only database upgraded through every migration with track points and phase markers byte-identical; indexes survive; reopening is a no-op; empty file gets every table; debrief round trip. | `RecordingDatabaseMigrationTests`, `RecordingDatabaseChainMigrationCharacterizationTests` | `RecordingDatabase.init()` production path (file creation under Application Support); `AppState.getOrCreateRecordingDatabase` caches the first failure for the launch. |
| `AudioRecorder` | Profile constants, initial state, idle write failure. | `AudioRecorderTests` | Write failure while recording, interruption began/ended and `shouldResume`, `didBecomeActive` fallback (needs an engine seam). |
| SwiftData user data (`SchemaV1`) | Plan is `[SchemaV1]` with no stages; settings defaults; every model round-trips through an on-disk store reopened the way the app opens it and through the versioned schema plus plan. | `ProfileModelTests`, `LogbookEntryTests`, `RegionTests`, `SwiftDataMigrationCharacterizationTests` | App creates three containers with a hard-coded list and no plan; a V2 would not run through the declared plan. A store-open failure crashes in the SwiftUI modifier (inferred, not tested). |
| `DebriefEngine` / `FlightSummaryBuilder` / `ReplayEngine` / `FlightPhaseDetector` | Prompt budgets, interruption exclusion, schema round trip, availability messages, replay interpolation and tick, phase hysteresis. | `FlightSummaryBuilderTests`, `DebriefAvailabilityTests`, `DebriefSchemaTests`, `ReplayEngineTests`, `FlightPhaseDetectorTests` | Generation is not fakeable (session built inline). Replay heading interpolation is linear across 0/360. Go-arounds and GPS gaps in phase detection. **Pin after the Israel epic lands** (IL-DEBRIEF edits `Services/Debrief`). `CVFRDebrief` has no tests at all. |

### Israel modules (mapped, not pinned in CQ-1)

| Module | Pinned behaviors | Test files | Gaps (pin after the Israel epic lands) |
|---|---|---|---|
| `IsraelRoutePlanner` | Shortest open path, one-way and by-request/military rules, closures as detour/caution/block, closure window, stale feed gives no marks, bundled network route length | `IsraelRoutePlannerTests` (20) | **Unresolved closures (unknown code or unmatched leg) yield no mark, so the route stays fileable** (efb-qpk); `.old` feeds (up to 6 h) count as checked |
| `IsraelNotamService` / `IsraelNotamClosureMapper` | Fetch, cache, freshness, decode; mapping with unknown codes and unmatched legs | `IsraelNotamServiceTests` (20), `IsraelNotamClosureMapperTests` (9) | Concurrent `fetchFeed` both download; view-model default fetcher builds a new service per call |
| `IsraelRouteFollowing` / alerts | none | none | `crossTrack`, `hasReachedEnd`, altitude deviation, 30 s grace, 3 NM terminal suppression, ETA below 30 kt, multi-leg sequencing. Pure with injected `now`, cheap to pin. |
| `IsraelFlightPlanMessage` + validator | Golden FPL layout, Hebrew summary, filing blockers and warnings | `IsraelFlightPlanMessageTests` (16) | Midnight rollover of DOF/ETA, ETE of 24 h or more, remark sanitising, empty plan |
| `ChartPackService` / diagram pack | Unpublished never served, SHA-256 mismatch installs nothing, Range resume, new edition removes old | `IsraelChartServiceTests` (13), `IsraelAirportDiagramTests` (12) | HTTP 4xx/5xx, bad Range reply, path traversal, concurrency, `IsraelChartStore/IsraelDiagramStore` flows |
| `IsraelAviationDatabase` | Counts, endpoints resolve, airspace altitude edges, search | `IsraelAviationDatabaseTests` (21), `IsraelAerodromeDatabaseTests` (16) | Hard-coded counts are a trip-wire by design |
| `AppState`, `MapViewModel`, `ContentView` | DB error recording and sharing, layer loading and debounce | `AviationDatabaseRobustnessTests`, `MapLoadingFlowTests` | `tfrLoadFailed`/`advisoriesLoadFailed`, `loadedTFRs` after a failed refresh, haptic on new alert, `chooseInitialSection`, banner when `databaseError` set |

## Characterization Backlog

Ranked by risk (worst failure first). CQ-1 pinned rows 1-13 where a test could reach them without a seam in
a file another agent owns. Open rows need a seam or wait for the Israel epic.

- [x] 1. Recording: unreadable track deletes the flight and its audio (P1, efb-7xe)
- [x] 2. Aviation DB: same-size regeneration keeps old data; corrupt install never heals (P1/P2, efb-0xs, efb-91u)
- [x] 3. Weather: 900 s boundary, throw after expiry, batch drops expired stations offline (P2, efb-dv5)
- [x] 4. GPS: `LocationService` conversions, failure flags, stream error, no-fix grace (P2, efb-71b, efb-hql)
- [x] 5. Recording: phase markers never closed; failed writes still counted (P2, efb-df8, efb-5ql)
- [x] 6. Recording: no `save()` after persist (P2, efb-cul)
- [x] 7. GRDB: v1 database upgraded through every migration with data intact
- [x] 8. SwiftData: store reopens through the app's container and the declared plan (P3, efb-lrq)
- [x] 9. Offline maps: complete-but-partial reads ready; expiry boundaries (P2, efb-asl)
- [x] 10. Freshness: TAF 7 h, NOTAM 359, PIREP 119, `validUntil` precedence
- [ ] 11. Israel planner unresolved closures (P1, efb-qpk): pin and fix after the Israel epic lands
- [ ] 12. `ProximityAlertService` database-error path fails open (P2, efb-8lm): needs a throwing mock; after IL-ALERTS lands
- [ ] 13. Weather UI error hidden behind stale cache (P2, efb-bgb): extract view decision into a pure function
- [ ] 14. `MapViewModel.loadWeatherDots` failure keeps old dots and time; `loadedTFRs` after a failed refresh
- [ ] 15. US `NearestAirportViewModel.updateNearest` gate and database-error path
- [ ] 16. `RecordingCoordinator` stop with real fixes (needs a TrackRecorder factory seam); auto-start loop and countdown
- [ ] 17. Crash/kill recovery: orphaned `track_points` and `.m4a` after a kill (no recovery exists; decide behavior first)
- [ ] 18. `IsraelRouteFollowing` (pure, cheap) after the epic lands
- [ ] 19. `CVFRDebrief` numbers (altitude adherence, 1 NM match radius): no tests today
- [ ] 20. `AudioRecorder` interruption flows (needs an engine seam)

## Seams

Production edits made in CQ-1. Each is Parameterize Constructor with a production default, so no caller changed.

| File | Seam | Default | Used by |
|---|---|---|---|
| `Services/LocationService.swift` | `init(appState:updates:noFixGrace:)`; new `LocationUpdateSnapshot` value and `LocationService.liveUpdates()` wrapping `CLLocationUpdate.liveUpdates(.otherNavigation)` | live CoreLocation stream; 15 s grace | `LocationServiceCharacterizationTests` |
| `Services/WeatherService.swift` | `init(session:now:)`; clock used for the 900 s window and `fetchedAt` | `{ Date() }` | `WeatherCacheClockCharacterizationTests` |

Seams still needed (not added): track reader for `FlightPersistenceService`; `TrackRecorder` factory for
`RecordingCoordinator`; audio engine for `AudioRecorder`; `summary(state:progress:context:)` for
`OfflineMapService`; a single `makeModelContainer()` for the three SwiftData containers; a throw switch on
`MockDatabaseManager`.

## CI Gates

- `tools/sim-test.sh test -only-testing:efb-212Tests` green (all suites, including `CharacterizationTests`).
- `tools/sim-test.sh build -quiet` compiles app and tests.
- `web/notam-relay` and `web/charts` unit tests green when those directories change.
- No phase after Phase 1 may edit a module that is absent from the Safety Net Map or listed under its Gaps column
  without first pinning the touched behavior.
