# Technical Debt

Single queue for code-quality work. Created in Phase 1 (CQ-1, 2026-11-02). Ranking rule from the intake:
wrong or stale data shown as current in flight, or a lost recording, outranks everything else. Every row with a
bead was found while characterizing (`discovered-from:efb-dzz`) and is **pinned at its current wrong value** by a
test; fix it as its own behavior change and flip the pinned assertion in the same commit.

## Debt Ledger

Priority: P1 = data loss or stale/wrong data shown as current in flight; P2 = degraded behavior; P3 = quirk.
Effort: S under half a day, M a day or two, L more.

| Item | Location | Type | Risk | Effort | Priority | Status |
|---|---|---|---|---|---|---|
| Unreadable track is treated as empty; flight rows and audio deleted (efb-7xe) | `Services/Recording/FlightPersistenceService.swift:65,118,120` | bug, data loss | A transient read error loses a recorded flight | S | P1 | open; pinned by `unreadableTrackTableDiscardsFlightAndDeletesAudio` |
| Same-size, same-version regenerated `aviation.sqlite` never installs (efb-0xs) | `Data/AviationDatabase.swift:88-94,109-113` | bug, stale data | Old airport/airspace data served as current after a refresh | S | P1 | open; pinned |
| Israel planner ignores unresolved closures; route stays fileable (efb-qpk) | `Services/IsraelRoutePlanner.swift` `closures(...)` | bug, wrong data | A NOTAM-closed route reads open | M | P1 | open; **not pinned** (Israel epic in flight) |
| Corrupt installed aviation DB with matching marker never self-heals (efb-91u) | `Data/AviationDatabase.swift:63-67,90-94` | bug | Airport database unavailable every launch until reinstall | S | P2 | open; pinned |
| FlightRecord and logbook draft inserted, never saved (efb-cul) | `FlightPersistenceService.swift:89-103` | bug, data loss | Kill right after stop loses History row and logbook draft, keeps audio and track | S | P2 | open; pinned |
| Phase marker rows never get an end time (efb-df8) | `Services/Recording/TrackRecorder.swift:135`; `RecordingDatabase.updatePhaseMarkerEnd` has no callers | bug | Debrief phase durations read 0 s | S | P2 | open; pinned |
| Failed track writes still counted (efb-5ql); a thrown location stream ends the track silently | `TrackRecorder.swift:125-126` and stream catch | bug | Summary reports points that do not exist; pilot not told the track stopped | M | P2 | open; count pinned |
| Offline pack marked complete with missing resources reads ready (efb-asl) | `Services/OfflineMapService.swift:341` | bug, stale data | "Offline: ready" with holes in the map | S | P2 | open; pinned |
| Offline weather: batch drops expired stations instead of serving them with age (efb-dv5); `loadWeatherDots` keeps old dots and old oldest-time on failure | `Services/WeatherService.swift` batch loop; `ViewModels/MapViewModel.swift` | bug | Map shows no weather offline, or old dots under an old badge | M | P2 | open; service half pinned, view model half unpinned |
| Weather refresh failure over a stale cache (efb-bgb) | `Views/Log/AirportColumnView.swift` `weatherDataView`; `ViewModels/WeatherViewModel.swift` | test gap | None in the app: the column shows "Weather refresh failed. Showing the last report." with Retry above the cached METAR. No test pins it | S | P3 | fixed; unpinned (view logic) |
| Location stream error is terminal; `isTracking` stays true (efb-71b) | `Services/LocationService.swift` catch block | bug | "GPS stopped" until relaunch | M | P2 | open; pinned |
| Proximity check fails open: database error clears alerts (efb-8lm) | `Services/ProximityAlertService.swift` | bug | No alert and check-failed look the same | S | P2 | open; unpinned (IL-ALERTS editing) |
| `RecordingViewModel.confirmStop` returns silently when persistence or context is nil | `ViewModels/RecordingViewModel.swift` | bug (from survey; file under edit) | Recording missing from History | S | P2 | open; no bead yet: confirm after the Israel epic lands |
| No crash/kill recovery for recordings | `RecordingCoordinator`, `efb_212App` | missing feature | Orphaned `track_points` and `.m4a`, nothing in History | L | P2 | open; decide desired behavior first |
| VSI computed from arrival time, not fix timestamps (efb-hql) | `LocationService.swift` | bug | Distorted VSI on delayed delivery | S | P3 | open; pinned |
| Debrief `generatedAt` written as seconds since 2001, read as 1970 (efb-6io) | `Data/RecordingDatabase.swift:357`, also `:316` | bug | Date ~31 years early; not shown today | S | P3 | open; pinned |
| `deleteFlightData` leaves the debrief row (efb-bep) | `RecordingDatabase.swift:381-388` | bug | Orphan debrief | S | P3 | open; pinned |
| `EFBSchemaMigrationPlan` never passed to a container; list hard-coded three times (efb-lrq) | `efb_212App.swift:27-57` | latent bug | A SchemaV2 would not migrate through the plan | S | P3 | open; pinned |
| Failed or removed pack reads partial (efb-epd); sectional pack with no cycle never expires | `OfflineMapService.swift:340-347,293` | quirk | Misleading status text | S | P3 | open; pinned |
| TAF has no freshness badge; age-only TAF never reads EXPIRED (efb-8d4) | `Core/DataFreshness.swift:42`, `AirportColumnView` | quirk | Old TAF shown with no age | S | P3 | open; freshness pinned |
| `WeatherCache.isStale` (60 min from fetch) unused and contradicts 75/180 min observation thresholds | `Core/AviationModels.swift:436` | smell | Two stale definitions | S | P3 | open; decision needed |
| `IsraelFlightPlanViewModel` default fetcher builds a new `IsraelNotamService()` per call, bypassing its 5 min cache | `ViewModels/IsraelFlightPlanViewModel.swift` | smell | Extra network calls | S | P3 | open; after the epic |
| Nearest-airport list keeps the old list on database error with no stale indicator | `ViewModels/NearestAirportViewModel.swift` | bug | NRST can show old airports as current | S | P2 | open; unpinned (testable today) |
| Replay heading interpolates linearly across 0/360 | `Services/Replay/ReplayEngine.swift` | bug | Replay chevron swings the long way | S | P3 | open; unpinned |
| Hard-coded NASR anchor for `SectionalCycle` | `OfflineMapService.swift` | smell | Cycle table needs a build per 56 days | S | P3 | open |

## Smell Inventory

Seeded from the highest-churn files. Phase 2 (readability) and Phase 3 (refactorings) are deferred until the Israel
epic lands; entries below are what the survey found, not yet worked.

| Smell | Location | Refactoring | Status |
|---|---|---|---|
| Highest churn: 19 changes | `ContentView.swift` | Extract Method for `chooseInitialSection`, banner logic (pin first) | deferred: Phase 2 |
| 15 changes; no observable output without a map view | `Services/MapService.swift` | Extract pure filters (`updateTFRs(_, now:)`, weather-dot skip) | deferred: Phase 3 |
| 13 changes; `MapViewModelTests` does not test it | `ViewModels/MapViewModel.swift` | Pin load-failed flags and haptic logic, then split | deferred: Phase 2-3 |
| `AppState` flat class, 12 changes, no sub-state | `Core/AppState.swift` | Extract sections only after Phase 5 | deferred |
| `efb_212App` repeats the same six-model `.modelContainer` list three times | `efb_212App.swift` | Replace Magic Number with one `makeModelContainer()` | deferred: Phase 3 |
| Tests that recompute arithmetic or compare locals | `AutoStartTests` (3 tests), `AudioRecorderTests.recordingsDirectoryIsInAppSupport`, `MapViewModelTests` | Delete or replace with real tests | deferred: with the owning module's Phase 2 |
| `try?` swallowing on persistence and track writes | `FlightPersistenceService`, `TrackRecorder`, `RecordingDatabase` callers | Replace with typed `EFBError` and a surfaced problem | tied to beads above |

## Sprout / Wrap Register

Code added beside legacy so it can be folded back in later.

| Sprout / Wrap | Host (still thin on tests) | Pay back when |
|---|---|---|
| `LocationUpdateSnapshot` + `LocationService.liveUpdates()` (Parameterize Constructor; the host now has a harness) | `LocationService.startTracking` | Phase 2 on `LocationService`: split conversion from the loop |
| `WeatherService.now` clock | `WeatherService` cache | Add a throwing/offline test double when `loadWeatherDots` is pinned |
| `AdvancingClock`, `FailureSwitch` test helpers in `WeatherCacheClockCharacterizationTests` | tests only | Move to `efb-212Tests/Mocks` if a second suite needs a clock |
| Nothing sprouted into other agents' modules in CQ-1 | Israel, Debrief, Diagram, Planning, alerts files | The Israel epic's own tickets must sprout tested code, not weave into the hosts above |

## Debt Budget & Broken-Windows Policy

- Budget (proposed; owner to confirm): one P1 or P2 bead from this ledger per feature ticket, before the
  feature touches the same module.
- No untracked `// TODO`. A hack that ships gets a bead in this ledger the same day.
- A pinned bug is not a license to leave it: P1 rows are TestFlight blockers unless the owner records a decision here.

## Adopted Conventions

- Pin before you change: nothing in a module's Gaps column is edited until the gap is pinned (TESTING.md).
- Pinned bug comment form: `// BUG(<slug>): pins current behavior; <what is wrong>` plus a bead.
- Seams are Parameterize Constructor with a production default; listed in TESTING.md §Seams.
- Clocks and streams are injected (`now:`, `updates:`); tests do not sleep to cross a boundary.
