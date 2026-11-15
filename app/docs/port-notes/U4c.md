# U4c: Swift screens Phase 1 never ported

Found by the coordinator audit; all reachable in the Swift app. Three parts, each a self-contained component with its view model, not mounted anywhere yet (Track A, I1c, mounts them; none edits MapScreen, routes or the existing airport sections). No SwiftUI reference capture exists for any of them in app/reference, so none is in the screenshot gate.

## Flight plan (US)

The US flight planner (the "Flight Plans" screen the log pushes; `FlightPlanView`). Like the other U4 screens it reads
its data through a Zustand store with fakes behind it; I1 wires the real database, repository, aircraft store, navigation
and map.

### Ported

- ViewModels/FlightPlanViewModel.swift (325 lines) ->
  - app/src/ui/sheets/flightPlan/logic.ts: the pure steps. Search threshold (`searchableQuery`, `SEARCH_MIN_CHARACTERS`,
    `SEARCH_LIMIT`), route math (`activeAircraft`, `cruiseSpeedKts`, `routeEstimate`, `formattedETE`), what
    calculateAndDrawRoute writes into AppState (`publishPlan`) and clearPlan takes out of it (`withdrawPlan`), the
    restore-over-Direct-To rule (`publishesRoute`), the camera fit (`routeBounds`, `ROUTE_EDGE_PADDING`), savePlan's
    record (`planRecord`), and the text the views show (`summaryMetrics`, `routeLabel`, `savedPlanDistanceText`,
    `relativeText`, `savedPlanAccessibilityLabel`, the empty-list strings).
  - app/src/ui/sheets/flightPlan/store.ts: `createFlightPlanStore(deps)` with the Swift state and action names
    (`departureQuery`, `departureResults`, `selectedDeparture`, `distanceNM`, `estimatedTimeSeconds`,
    `estimatedFuelGallons`, `savedPlans`, `activePlanID`; `configure`, `searchDeparture`, `searchDestination`,
    `selectDeparture`, `selectDestination`, `calculateAndDrawRoute`, `savePlan`, `loadSavedPlans`, `loadPlan`,
    `loadMostRecentPlan`, `clearPlan`, `deletePlan`, `formattedETE()`), the field bindings as `setDepartureQuery` /
    `setDestinationQuery` (set and search, the view's `onChange`), plus `FlightPlanProvider`, `useFlightPlan` and
    `useFlightPlanStore`.
- Views/Planning/FlightPlanView.swift (264 lines) -> app/src/ui/sheets/flightPlan/FlightPlanSheet.tsx. Props are documented
  at the top of the file (`region`, and `openURL` / `share` for the Israel planner). Swift has no accessibility
  identifiers here; the testIDs are new: `flight-plan`, `fp-departure`, `fp-destination`, `fp-departure-results`,
  `fp-destination-results`, `fp-summary`, `fp-save`, `fp-clear`, `fp-saved-plans`, `fp-saved-<id>`, `fp-delete-<id>`,
  `fp-active-mark`, `fp-saved-empty`. Labels are Swift's ("Departure airport", "Destination airport", the placeholder,
  "Save Plan", "Clear", "No saved plans" and its description, "Active plan").
- Views/Planning/FlightPlanSummaryCard.swift (90 lines) -> app/src/ui/sheets/flightPlan/FlightPlanSummaryCard.tsx, the
  same props (`distanceNM`, `ete`, `fuelGallons`, `departure`, `destination`) and accessibility labels and values
  (`Route KPAO to KMOD`, `Distance` / `125.4 nautical miles`, `Estimated time en route`, `Fuel` / `12.3 gallons`). The
  Swift header says the card is also a map overlay; nothing in Swift uses it outside the planner.
- Region: `FlightPlanView` shows `IsraelFlightPlanView` in Israel. `FlightPlanSheet` does the same with `region` (default:
  `regionSlice`), rendering `IsraelFlightPlanSheet` (U4b), so it needs an `IsraelPlanProvider` in Israel and a
  `FlightPlanProvider` in the US.
- Fixture: app/src/ui/sheets/flightPlan/fixture.ts (FAKE). The Swift test airports KPAO, KSQL, KOAK (plus KMOD from the
  card preview), `MockDatabaseManager` (`createFakeAviationDatabase`: ICAO contains the upper-cased query or the name
  contains it in any case) and `UnavailableDatabaseService` (`createUnavailableAviationDatabase`: every query rejects with
  `databaseCorrupted`), an in-memory plan repository in D2's order, a navigation port over a plain `ActiveNavigation`,
  the active aircraft N4543A (120 kt, 9 gph), two saved plans and `createFixtureFlightPlanStore`. Clock: FIXTURE_NOW
  (2026-11-12T06:26Z).
- Icons: `CheckmarkCircleFill` (checkmark.circle.fill, the active plan) and `ArrowRight` (arrow.right, between route ends)
  in `planIcons.tsx` beside the sheet (the shared ui/Icons.tsx is untouched).
- No route and no capture: there is no SwiftUI reference capture of this screen, so it is not in `LAUNCH_SCREENS` or the
  fidelity gate. Track A mounts `FlightPlanSheet` (I1).

Tests (64 in 4 files, all green):

- FlightPlanViewModelTests.swift: 24 of 24, same names and inputs, in flightPlan/flightPlanViewModel.test.ts. The SwiftData
  in-memory container is the fixture's in-memory repository; `AppState` is the fake navigation (its fields keep the D2/L2
  names: `activePlanDestination` is `planDestination`, `activePlanFuelGallons` is `planFuelGallons`,
  `directToAirport` is `directTo`, `activePlanDestinationCoordinate` is `planDestinationCoordinate`); dates are epoch ms
  (`Date(timeIntervalSince1970: 1_700_000_000)` is `1_700_000_000_000`). `loadingPlanTouchesLastUsedAt` reads the stored
  record back from the repository (Swift reads the mutated model object).
- New: logic.test.ts (19: search threshold, route math, navigation publish and withdraw, camera fit, the saved record,
  the display text), FlightPlanSummaryCard.test.tsx (4: values, units, no fuel cell without an estimate, rounding,
  accessibility), FlightPlanSheet.test.tsx (16: the empty planner, search and pick, the summary card, Save Plan, Clear,
  restore on opening, load by tap, Delete and its accessibility action, the ticking relative time, the search failure and
  the missing-airport plan, the Israel region, the route).

### Not waypoints

The ticket asked for "add/remove waypoint" tests. The US planner has no waypoints: it is departure and destination only
(the via points are the Israel planner's, U4b). What the screen adds and removes are its two ends (pick and Clear) and its
saved plans (Save Plan and Delete); those are what the sheet tests cover.

### Swift differences

- Async: search, airport lookups and the repository are async in JS. Each field's search takes a token and only the
  latest writes (Swift searched synchronously on each keystroke). `loadPlan` takes a generation; a pick, a clear or a
  newer load makes it stale, so a slow lookup cannot overwrite what the pilot did meanwhile. A pick also drops a search
  still in flight for either field.
- The dropdown after a pick: Swift's `.onChange(of: departureQuery)` also fires when `selectDeparture` / `loadPlan` write
  the ICAO into the field, so the list reopens with the airport just picked (and with the restored plan's airports when the
  planner opens). React Native's `onChangeText` fires on typing only, so the list stays closed. Not reproduced on purpose.
- `configure()` is the ModelContext handover: before it the store reads no aircraft and touches no repository, like Swift
  with a nil `modelContext`. It runs once per store (Swift's `guard viewModel == nil`).
- `activeAircraft` is Swift's `isActive == true` fetch: a single inactive profile is not used (the Israel planner's
  `activeProfile` falls back to a lone profile; this one does not, `inactiveAircraftIsIgnored`).
- Swipe to delete: React Native has no List swipe. Each saved row has a visible Delete button
  (`Delete KPAO to KSQL`) and the row offers `delete` as an accessibility action (the swipe for VoiceOver and TalkBack),
  as the log rows do. No confirmation, as in Swift.
- `Text(date, style: .relative)` is `relativeText`: the two largest units in full words ("2 hours, 5 minutes", "3 days"),
  the second only when not zero, re-read every second while there are saved plans. Days are the largest unit (SwiftUI
  goes on to weeks, months and years).
- `isCreating` and `lastError` are not ported: Swift never sets them and no view reads them.
- A failed repository write is silent (`try? context.save()`): `savePlan` then marks nothing active; a failed list reads
  as no saved plans; a failed delete or last-used update changes nothing.
- SF Symbols: the buttons lose `square.and.arrow.down` and `xmark.circle`; the empty view's `airplane.circle` is the
  existing `Airplane` icon.

Kept as in Swift: loading a plan whose airport left the database selects what it finds, shows no summary and does not
touch navigation, so an earlier plan stays published; the distance numbers of the previous plan stay in the store
(hidden, since the card needs both ends).

### Not ported

- Map: `updateRoute`, `addRoutePins`, `clearRoute` and the `setVisibleCoordinateBounds` camera fit (0.5 degree margins,
  80 pt padding) go through the optional `FlightPlanMap` port (`showRoute(departure, destination, bounds)`,
  `clearRoute()`); the map side that implements it draws the magenta line and fits the camera.
- `ProgressView("Loading...")` while the Swift view model is created: the store exists before the sheet renders.
- `.navigationTitle("Flight Plans")`: `FLIGHT_PLANS_TITLE` for the pushing stack.

### Wiring for I1

`createFlightPlanStore(deps)` and `FlightPlanProvider` around `FlightPlanSheet`, opened by the log's `openPlanner`.
`deps`: `database` (the opened `AviationDatabase`; it satisfies `FlightPlanDatabase`), `plans` (D2
`flightPlanRepository(db)`), `aircraft` (`() => aircraftStore.getState().profiles`), `navigation` (`current: () =>
app.getState().navigation`, `set: app.getState().setNavigation`; the live fix loop then refreshes DTG/ETE from
`planDestinationCoordinate` with `updateActiveRouteProgress`), `now`, optionally `map` and `newId`. In Israel the
same screen needs the Israel plan store's `IsraelPlanProvider` (U4b).

## Airport column sections (PIREP, winds aloft)

Ports `Views/Map/PirepSection.swift` and `Views/Map/WindsAloftSection.swift`, which `AirportColumnView` stacks under the
other sections. Both Swift views own their load (`@State state`, `.task(id:)`, a service); here the load state is lifted
into props so Track A can feed the sections from the airport column store. The sections are not wired into
`AIRPORT_SECTIONS` yet (`sections.tsx`, `store.ts`, `logic.ts` are untouched): Track A adds the store fields and two
entries.

### Files

- `src/ui/columns/airport/sections/PirepSection.tsx`: `PirepSection({ airport, loading, error, pireps, now, onRetry,
onLoad? })`, props documented at the top. Header PIREPS with a 44 pt refresh button (`Refresh PIREPs`), then a spinner,
  the failure (amber triangle, `PIREPs not loaded: <message>`, Retry), the empty line or one row per report: URGENT label,
  altitude, aircraft, the PIREP age badge, the location line, the decoded lines and the Raw report disclosure (expanded rows
  are local state, like Swift's `@State expandedIDs`). Urgent rows sit on a 15% warning fill with a 1 pt warning stroke.
- `src/ui/columns/airport/sections/WindsAloftSection.tsx`: `WindsAloftSection({ airport, forecast, onSelectForecast,
loading, error, report, now, onRetry, onLoad? })`, props documented at the top. Header WINDS ALOFT, the 6 / 12 / 24 h
  picker (the Layers column's `SegmentRow`, 60 pt segments instead of the small segmented Picker, as LayersColumn does),
  then a spinner, the failure with Retry, or the report: station line with the winds aloft badge, the period line, the
  "Outside the forecast's for-use period" notice, the ALT / DIR / SPD / TEMP grid and the blank level footnote.
- `src/ui/columns/airport/sections/pirepLogic.ts` and `windsAloftLogic.ts`: every decision of the two views (query window,
  body states, location / compass, summary lines, row tone, VoiceOver labels; station / period lines, FOR USE check, the
  badge input, grid cells and tone, spoken level, footnote, the task key). Nothing reads the clock.
- `src/ui/columns/airport/sections/parts.tsx`: the section header, spinner row, caution label, Retry button and failure
  block. `sections.tsx` keeps its own copies private and was not to be edited; when Track A touches it, it can export its
  `SystemHeader` / `RetryButton` and these can go.
- `src/ui/columns/airport/sections/fixture.ts`: FAKE data from the Swift test inputs: the PirepServiceTests field values
  (CL30 urgent, E75S, F2TH, the UAL2164 AIREP) placed around its KDEN coordinate at its `now`, and an excerpt of
  WindsAloftServiceTests.conus06 (ABQ, ALS, BIH, SFO rows) parsed at its `reference`.
- Tests: `pirepLogic.test.ts` (27), `windsAloftLogic.test.ts` (21), `PirepSection.test.tsx` (12),
  `WindsAloftSection.test.tsx` (11).

### Swift tests ported

No Swift test targets either view. The logic tests reuse the inputs of the tests that reach what the views show:
`PirepServiceTests` (the captured AWC fixture through `swiftRawFixture`, `makePirep` around KDEN: urgent flag and descent
altitude, climb / descent / unknown levels, icing and turbulence summaries, present weather, the AIREP wind, newest first),
`WindsAloftServiceTests` (`conus06` and `conus12Header`: header times, the SFO row, blank low levels at ABQ / ALS / AMA,
light and variable at ALS / BIH, `forUsePeriodCheck` boundaries, the window spanning midnight), `DataFreshnessTests`
(`pirepThresholds`, `windsAloftWindow`, `windsAloftUnknown`) and `DataFreshnessEdgeCharacterizationTests`
(`pirepAt119MinutesIsOld`). The parsers themselves stay tested in `services/`.

### States

| State   | PIREPs                                                                | Winds aloft                                                                 |
| ------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| loading | spinner before the first result; a loaded list stays during a refresh | spinner on every load, also over a report (Swift sets `.loading` each time) |
| error   | `PIREPs not loaded: <message>` + Retry, replacing the list            | `Winds aloft not loaded: <message>` + Retry                                 |
| empty   | `No PIREPs within 50 NM in the last 2 hours.`                         | a report without levels: the grid headings only (as Swift's Grid)           |
| data    | rows newest first                                                     | station, badge, period, grid, footnote                                      |
| stale   | badges OLD from 60 min, EXPIRED from 2 h as `now` advances            | outside FOR USE: notice + EXPIRED (after) / NOT YET VALID (before); N/A     |

### Swift differences and decisions

- The PIREP query window: `PIREP_MAX_AGE_SECONDS` is `productExpiredAfter('pirep')` (7200 s) from `domain/core/freshness.ts`,
  the port of DataFreshness.swift, whose PIREP EXPIRED threshold is documented as `PirepSection.maxAge`; a test pins both.
  The store calls `PirepService.fetchPireps(near, PIREP_RADIUS_NM, PIREP_MAX_AGE_SECONDS)`.
- Load state as three props (`loading`, `error`, data). PIREPs: an error wins, then any loaded list, then the spinner,
  which reproduces Swift's `if case .loaded = state {} else { state = .loading }`. Winds: `loading` wins, as Swift resets
  to `.loading` in every `load()`. The store should clear `error` when a load starts or succeeds.
- `.task(id:)` becomes the optional `onLoad` prop, called in an effect keyed like the Swift id (ICAO; ICAO-forecast). The
  refresh button and Retry both call `onRetry` (Swift: `load()` in both). The winds picker is controlled (`forecast`,
  `onSelectForecast`) so the store keeps one report per period; Swift's default is `DEFAULT_FORECAST` (6 h).
- `now` replaces `Date()` in the badges and the FOR USE check, so a list left on screen goes OLD / EXPIRED when the store
  ticks `now` (Swift re-evaluates on redraw).
- The list is sorted newest first again in `pirepBody` (stable). PirepService already returns that order and Swift shows
  it as is; the sort only guards a store that merges reports.
- The location line uses `services/pirep.ts` `distanceNm` (PirepParser.distanceNM) and `domain/core` `bearingDeg`
  (CLLocation.bearing). Under 1 NM the line reads "Over KDEN · PIREP".
- The PIREP row header is one VoiceOver element whose label joins URGENT, altitude, aircraft and `PIREP age <text>`
  (Swift `.accessibilityElement(children: .combine)` over the same children).
- Grid: React Native has no `Grid`; the DIR / SPD / TEMP columns are 64 pt wide, right aligned, 16 pt apart, the altitude
  column takes the rest; "Light & variable" spans two columns plus the gap. Each level row is one accessible element with
  the Swift label ("12,000 feet") and value (`spokenLevel`).
- Not ported: accessibility-size Dynamic Type layouts (both headers stack vertically in Swift; there is no fontScale
  plumbing in the strip, as in U4b), and the `withAnimation` on the raw report disclosure.

### For Track A (airport column store)

Add per-ICAO `pireps: { loading, error, pireps }` and `winds: { forecast, loading, error, report }` to the column data, feed
them from `PirepService` / `WindsAloftService` (error text from `errorDescription`), wire `onRetry` / `onLoad` /
`onSelectForecast`, and append the two entries to `AIRPORT_SECTIONS` after the charts (and the Israel diagrams), in
Swift's order: `{ id: 'pireps', layer: 'pireps' }`, then `{ id: 'windsAloft', layer: 'windsAloft' }`
(AirportColumnView: `region.isAvailable(.pireps)` / `.windsAloft`).

## Israel chart tap sheet

Ports `Views/Map/IsraelChartSheets.swift` (IL-3), which `MapContainerView` shows with `.sheet(item:)` over
`mapService.israelChart.selection` (medium and large detents) whenever a tap on the Israel chart produced a selection. Only
the content of the sheet: the caller presents it and clears the selection on close.

### Files

- `src/ui/sheets/israelChart/IsraelChartSheet.tsx`: `IsraelChartSheet({ selection, onClose })`, props documented at the top.
  `selection` is the domain's `IsraelChartSelection` (`domain/map/israel/chartDetails.ts`), the same union the map tap
  produces (`israelSelectionFromFeature` for a point symbol, `israelAirspaceSelection` for the fill features under the
  finger). A point shows code, English and Hebrew names (right to left), kind, then either "No CVFR route segment ends
  here." or the ROUTE SEGMENTS header and one 44 pt row per direction (from -> to, published altitude, route type, closure
  with a red octagon for full or an amber triangle for partial / check, closure notes). Airspaces show, each separated by a
  divider: title, English name unless it repeats the title, Hebrew name, type, a Ceiling / Floor / Authority / Chart text
  grid (the last two only when published) and the inferred-reference warning.
- `src/ui/sheets/israelChart/logic.ts`: the fixed strings, which optional lines show, the grid rows, closure styling, the
  divider rule and the combined VoiceOver labels (Swift `.accessibilityElement(children: .combine)` on rows and airspaces).
- `src/ui/sheets/israelChart/fixture.ts`: FAKE selections built through `pointDetail` / `airspaceDetails`, so the sheet
  shows the domain's text: a compulsory point with six rows (full and partial closures, by-request, military, an
  unpublished direction), a lonely sport-aviation point, three overlapping airspaces (R, D, TMA), and an aerodrome tap.
- Tests: `logic.test.ts` (12) and `IsraelChartSheet.test.tsx` (9).

### Swift tests ported

No Swift test targets the sheet view. The tests of the values it shows (`IsraelChartFeaturesTests`, "Tap sheets":
`pointSheetListsEverySegmentDirectionWithItsPublishedAltitude`, `airspaceSheetKeepsPublishedTextAndFlagsAnInferredReference`,
`overlappingAirspacesListProhibitedRestrictedAndDangerFirst`) were already ported with the domain in
`domain/map/israel/chartFeatures.test.ts` and are not duplicated. No UI test references `israel-chart-sheet`.

### Swift differences and decisions

- No units or clock props: Swift formats nothing in the sheet. Altitudes and limits are CAAI's published feet (the header
  says so), and closure times arrive formatted from `domain/map/israel/closures`. Unit preferences do not apply here.
- The sheet takes the whole `IsraelChartSelection` (not a narrower point | airspaces union) so a caller can pass the map's
  selection state unchanged; `{ kind: 'aerodrome' }` renders an empty body like Swift's `EmptyView()` (never presented: the
  map opens the airport sheet for it).
- The airspace case is a list (overlapping airspaces under the finger), as in Swift, not a single airspace.
- The NavigationStack toolbar becomes a row with a trailing Done button (44 pt target); there is no inline title.
- `.monospaced()` text uses IBM Plex Mono SemiBold (the app's bundled monospace; no Bold face is bundled). SF roles
  (largeTitle, title2/3, body, subheadline) are system font sizes; `TypeRole.caption` and `sectionHeader` use `Type`.
- The SwiftUI `Grid` is two columns of Views: the label column sizes to its widest label, as Grid does.
- Not done: presentation (detents, backdrop) is the caller's, as for the briefing sheet (`BriefingPresentation`); wiring
  the map's tap to this sheet is I1.
