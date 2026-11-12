# L3b port notes (closure mapper, briefing filter, alert evaluator)

Ported: `Services/IsraelNotamClosureMapper.swift` -> `domain/israel/closureMapper.ts`, `Services/IsraelBriefingFilter.swift` -> `briefingFilter.ts`, `Services/IsraelAlertEvaluator.swift` -> `alertEvaluator.ts`. Exported through `domain/israel/l3b.ts` (also re-exports `notamTypes.ts`).

Supporting files:

- `notamTypes.ts`: the value types of `Services/IsraelNotamService.swift` (`IsraelLatLon`, `IsraelNotam`, `IsraelRouteClosure`, geometry, Q-line, altitude limits) and the pure closure helpers (`closureIsValidAt`, `closureLegs`, `closureKinds`, `closureCovers`, `closureSeverity`, `notamIsSuperseded`). The service, Codable decoding, `chartText` and `IsraelNotamReport` stay with S1, which should import these types. `closureMarks.ts` and `routePlanner.ts` already do.
- `l3bStandIns.ts`: `IsraelChartClosureMark`, `limitText` and `limitsText` from `Services/IsraelChartFeatures.swift` (M1). These are faithful copies. Replace them with M1's exports when that port lands.
- `crossTrack` comes from `./routeFollowing`.

## Tests

| Swift test file                                                                   | Ported | Dropped | Notes                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ServiceTests/IsraelNotamClosureMapperTests.swift                                  | 9/9    | 0       |                                                                                                                                                                                                                                                                                                          |
| DataTests/IsraelAviationDatabaseTests.swift (mapper cases)                        | 3/3    | 0       | Deferred from D5. In `tests/domain/israel/closureMapperDb.test.ts`, on the real israel-aviation.sqlite                                                                                                                                                                                                   |
| ServiceTests/IsraelBriefingFilterTests.swift                                      | 17/20  | 3       | `validityShowsLocalAndZuluAndPerm` and `localTimeIsTwoHoursAheadOfZuluInWinter` test `BriefingTimeFormat` (Views/Briefing/IsraelBriefingView.swift, U4). `aRouteClosureDrawsItsChainNotTheScopeCircleButAnAreaNotamKeepsItsCircle` tests `IsraelBriefingGeometry` (IsraelBriefingMapHighlight.swift, M1) |
| ServiceTests/IsraelAlertTests.swift                                               | 28/37  | 9       | All 24 IsraelAlertEvaluatorTests and all 4 IsraelSquawkReminderTests are ported. The 9 IsraelAlertServiceTests (region gate, 5 s throttle, 10 s hold, lost-fix suspend, closure raise, squawk on departure, haptics) belong to `IsraelAlertService.swift` (S1)                                           |
| ServiceTests/AirspacePredictorTests.swift, PredictionServiceTests.swift           | 0      | 0       | Neither file references the evaluator. Already ported by L7                                                                                                                                                                                                                                              |
| ViewModelTests/IsraelBriefingViewModelTests.swift (12), PredictionRowsTests.swift | 0      | n/a     | View-model tickets, not attempted here                                                                                                                                                                                                                                                                   |

Additions: closure mapper JS guard (1). Briefing `BriefingRoute` sources characterisation (2): aerodromes and `briefingRouteFromActive`. Alert JS guards (3). Total: 63 jest cases.

## API shape

- Times are epoch ms. Swift `.distantPast`/`.distantFuture` become `-Infinity`/`Infinity`. Positions are `{ lat, lon }`.
- Swift enums become string unions. The ranks are `Record` tables: closure class, section, alert severity and kind.
- `BriefingReference` is a tagged union (`{ kind: 'none' | 'route' | 'ownship' }`). `makeBriefingRoute` and `makeBriefingQuery` carry the Swift defaults (CVFR, 25 NM, and so on).
- `IsraelSquawkReminder` is an immutable state. `updateSquawkReminder` returns `{ state, fired }`, the same pattern as L2 `ActiveRoute`.
- `airspaceAlerts` and `borderAlerts` take one object with the Swift argument labels. `ctrContact` returns `{ name, twr } | null`.
- `closureAlerts` takes `ReadonlyMap<segmentID, IsraelChartClosureMark>`.
- `limitsText(area)` is renamed `airspaceLimitsText` so it does not collide with the chart `limitsText`.
- `IsraelBorderBuffers.bundled()` is not ported because loading the bundled asset is platform work. `parseBorderBuffers(json)` is the pure decoder. The RN asset wiring for `israel-border-lines.json` is still open; the test reads `efb-212/Resources` in place.
- The mapper is async because D5 `knowsPoint`/`segment` are async. A sync lookup works too (answers are awaited).

## Swift behaviour preserved (including quirks)

- **Mapper:**
  - Validity bounds are inclusive.
  - A D) schedule is not evaluated, so a scheduled closure counts as active for its whole window.
  - The reverse-direction segment is tried only when the forward one is missing.
- **Briefing route network:** `briefingRouteFromActive` always uses network CVFR, because `ActiveRoute` carries no network. An LSA pilot's active-route briefing therefore classifies closures as for CVFR. This is a likely Swift bug and is kept as is.
- **Briefing geometry and window:**
  - Distances use an equirectangular projection around the first reference point, so long routes distort slightly.
  - `segmentsIntersect` counts proper crossings only. Touching cases still come out as 0 through the edge distances.
  - `windowIncludes` keeps PERM NOTAMs regardless of dates.
- **Briefing route aerodromes:** only 4-letter codes starting `LL` count as route aerodromes.
- **Alerts, airspaces:**
  - An aircraft inside a prohibited area at unknown altitude gets an amber "Near prohibited area ...", never red.
  - The vertical check for the projected point uses the current altitude.
  - When neither airspace limit is published, the detail reads `" FT"` (empty limits plus the suffix).
- **Alerts, closures:** legs with `segmentID == 0` are skipped.
- **Border buffer title:** truncates the km figure (`Int(bufferKm)`), so 2.5 km would read "2 km".
- **`shortAerodromeName`:** applies the suffixes in sequence, each to the result of the previous one. A name that reduces to empty returns the original.
- **`towerContact`:** strips trailing zeros only when the value has a dot.

## JS-only guards and deviations

- **Mapper `knowsPoint` cache:** within one `matchClosure` call the answers are cached. Swift re-queries for every leg end. Results are the same and there are fewer DB round trips.
- **Mapper segment de-duplication:** uses `defaultSegmentKey`, which is `.id` when present, otherwise the value. This matches Swift `IsraelRouteSegment` Hashable (id only). Object segments from separate queries would otherwise never compare equal.
- **`closureAlerts` with `currentLeg` beyond `legs.length`:** Swift traps on the invalid range. Here the function returns nothing.
- **`parseBorderBuffers`:** validates every field and throws on bad JSON or a wrong type, mirroring `JSONDecoder` (extra keys such as `accuracy` are ignored).
- **`"%.1f"` formatting:** reproduced by `formatOneDecimal`, which rounds exact binary ties half to even (`toFixed` would round 0.25 up).
- **Whitespace trimming:** `trimmingCharacters(in: .whitespaces)` is reproduced as trimming Unicode Zs plus tab, not newlines (unlike `String.trim`).
- **Id ordering:** briefing and alert ids compare by UTF-16 code unit. Swift compares Unicode scalars. These are identical for the ASCII ids in use.

## Review decisions (CodeRabbit round 1)

Kept as Swift parity, not changed: the alert evaluator's endpoint-only two-minute projection for airspace and border entry; the briefing's CVFR network for an active route (a known Swift bug, see above); permanent NOTAMs always included; area-distance filtering before closure classification; a single-code closure chain counting as fully mapped (Swift test `aSinglePointChainHasNoLegs` asserts it); a missing departure point shortening the active-route corridor (ActiveRoute carries none).
Changed (JS-only guard): `parseBorderBuffers` now rejects lines with fewer than two vertices or non-finite coordinates, which could never produce a distance.
