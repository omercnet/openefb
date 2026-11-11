# L3a port notes (Israel route following, planner, LSA rules, flight plan message, aerodrome adapter)

Target: `app/src/domain/israel/`. Depends on `domain/route` (L2), `domain/core` (L1) and the D5 database types in `data/aviation/israelTypes.ts`. L3b (closure mapper, briefing filter, alert evaluator) has its own notes file.

## Files

| Swift                                                               | TS                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Services/IsraelRouteFollowing.swift                                 | `routeFollowing.ts`                                                                                   |
| Services/IsraelRoutePlanner.swift                                   | `routePlanner.ts` (planner, plan/leg/caution types, errors), `closureMarks.ts` (`closures(from:...)`) |
| Services/IsraelLSATimeRules.swift                                   | `lsaTimeRules.ts`                                                                                     |
| Services/IsraelAircraftNetworkPreference.swift                      | `aircraftNetworkPreference.ts`                                                                        |
| Services/IsraelFlightPlanMessage.swift (message, issues, validator) | `flightPlanMessage.ts`                                                                                |
| Services/IsraelAerodromeAdapter.swift                               | `aerodromeAdapter.ts`                                                                                 |

## Tests (Swift -> Jest, same names)

| Swift suite                                             | Cases | Ported                                                                                                                                                                   | Not ported                                                                                                                  |
| ------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| IsraelRouteFollowingTests                               | 19    | 19                                                                                                                                                                       |                                                                                                                             |
| IsraelRoutePlannerTests                                 | 24    | 24 (the report-driven ones in `closureMarks.test.ts`, the validator one in `flightPlanMessage.test.ts`, the bundled one in `tests/domain/israel/routePlannerDb.test.ts`) |                                                                                                                             |
| IsraelLSAPlannerTests                                   | 25    | 20                                                                                                                                                                       | 5 "Israel LSA view model" cases (FlightPlanViewModel, U-track)                                                              |
| IsraelFlightPlanMessageTests                            | 16    | 16                                                                                                                                                                       |                                                                                                                             |
| IsraelNearestAndSearchTests (adapter part)              | 18    | 9                                                                                                                                                                        | 2 UI-wording cases (port-map: dropped); 7 NRST list / region switch / NOTAM fetch / search cases belong to U4 (view models) |
| CVFRDebriefTests bundled LLHZ -> LLIB (was `test.todo`) | 1     | 1, in `tests/domain/israel/routePlannerDb.test.ts`                                                                                                                       |                                                                                                                             |

Extra JS-only cases (guards and edges the Swift suites do not cover) are marked in the test names or comments.

## Swift differences (all deliberate, none change a published result)

- **Time**: `Date` becomes epoch ms; `TimeInterval` stays seconds. Israel local time uses `Intl.DateTimeFormat` with `Asia/Jerusalem` (`israelClock` in `lsaTimeRules.ts`). JS-only guard: a runtime without the zone database falls back to UTC, like Swift's `?? .gmt`. Verified across the IST/IDT change in `lsaTimeRules.test.ts`.
- **Errors**: Swift `throws(IsraelRouteError)` becomes a thrown `IsraelRouteError` class carrying the Swift enum case in `.info`; `message` is `errorDescription`, `.hebrewDescription` is kept.
- **Closure marks**: Swift `IsraelRoutePlanner.closures(from: IsraelNotamReport?, network: IsraelChartNetwork, ...)` read S1's report type (freshness) and the chart builder (`drawableFreshness`, `closureText`). `closureMarks()` takes `{ freshnessLevel, closures }` and a `closureText` callback instead, and is async because the D5 lookup is. `IsraelNetworkLookup` is the in-memory `IsraelChartNetwork`. When S1 and the chart ticket land they pass their report/label through these seams.
- **UserDefaults**: `configuredOffRouteThresholdNM(UserDefaults)` becomes `configuredOffRouteThresholdNm(stored)`; `IsraelAircraftNetworkPreference` reads and writes a `NetworkPreferenceStore` interface with the same `israel.routeNetwork.<profileId>` key. A settings adapter implements it.
- **`DEFAULT_OFF_ROUTE_THRESHOLD_NM`** is re-exported from `domain/route/activeRoute.ts` (carry-forward item), not duplicated.
- **Planner API**: `route(from, to, cruiseSpeedKnots, options, via)`; `via` moved last so the options default stays positional. Segment closure marks are a `Map<number, IsraelSegmentClosure>`. Plan and leg computed properties are functions (`planPointCodes`, `legAltitudeText`, ...).
- **Aerodrome adapter**: `Frequency.id` is a UUID in Swift; the domain generates none, so the id is `israel-frequency-<db id>`. `megahertz` (Swift `Double(mhz)`) is implemented in the adapter with a strict decimal pattern. The NOTAM report is a structural slice (`AerodromeNotamReport`: freshness level plus items) until S1 ports `IsraelNotam`.
- **Flight plan message**: `registrationField`/`sanitised` use Unicode property classes where Swift uses `Character.isLetter/isNumber`; `picName.trimmingCharacters(in: .whitespaces)` becomes `trim()` (also trims newlines). JS-only guard: a non-finite cruise speed prints `N0000` instead of trapping like `Int(...)`.
- **Dijkstra tie-breaking** is kept (first minimum in the frontier, edges in segment order), so equal-length routes resolve like Swift.
- `IsraelRouteLeg.id` / `Identifiable` become `legId(leg)`.

## Swift behaviour kept that looks like a bug

- The altitude caution compares against the nearest published number only; on a two-number leg a fix between the two values never warns.
- No other defect was found in the ported code; none was fixed.

## Carry-forward items closed

- `domain/debrief/types.ts`: the `TODO(L3)` Israel point/segment types are now re-exports of the data-layer models. `cvfrDebrief.test.ts` fixtures gained the new required fields (`SEGMENT_DEFAULTS`, `network`).
- `domain/prediction/predictionService.ts`: the structural `IsraelAirspaceInput` stand-in is replaced by the data layer's `IsraelAirspace` (vertices are `{ lat, lon }`; the source stays synchronous, the caller prefetches). Minimal diff, called out in the PR.
- The bundled LLHZ -> LLIB debrief case is enabled from Node. The route-legs round trip `test.todo` stays with the recording database.
