# S1e port notes: proximity alerts, reachability, Israel alerts

Sources -> targets (under `src/services/`):

- `Services/ProximityAlertService.swift` -> `proximityAlert.ts` (pure: alert model, thresholds, airspace and TFR evaluation)
  - `proximityAlertService.ts` (throttle, state, "check unavailable")
- `Services/ReachabilityService.swift` -> `reachabilityService.ts` (service + `NetworkStatusSource` port; no native adapter yet)

Tests: `ProximityAlertAltitudeTests` 10 of 10; the 3 proximity cases of `TFRServiceTests` (`proximityAlertUsesPolygonBoundary`,
`proximityAlertIgnoresInactiveTFRs`, `proximityAlertsSortedNearestFirst`) 3 of 3, with the TFR fixtures read in place.
`ReachabilityService` has no Swift test (it wraps `NWPathMonitor`); 3 new tests cover the port.

## IsraelAlertService (`israelAlertService.ts`)

Ported after L3 (#42) merged. Tests: the 9 cases of `IsraelAlertServiceTests` (suite inside `IsraelAlertTests.swift`) 9 of 9, names
kept, plus 3 JS-only tests. Differences:

- `update` and `setReport` are async: the aviation database (D5) is async. A fix evaluated while a newer fix, `suspend()` or a
  region change took over is dropped (epoch token), so an old position never publishes.
- Closure marks: Swift rebuilds `IsraelChartFeatureBuilder.closures(...).marks` (M1, not ported) synchronously at each
  evaluation. Here a `ClosureMarkBuilder` is injected; the default is a STAND-IN (CVFR closures valid now mapped through L3's
  `mapClosures`, text "CLSD"/"CHECK NOTAM", a stale feed gives none). Marks rebuilt during an evaluation are used from the next
  one (5 s later at most). M1 supplies the real chart wording through `closureMarks`.
- CTR contacts are looked up before evaluation (the evaluator's callback is sync, `aerodrome()` is async).
- The DEBUG-only `IsraelChartDebugNotamsPath` feed override is not ported (launch-argument plumbing, Apple/DEBUG only).
- A database that fails to open is retried at the next evaluation; a failing airspace lookup still yields the border, closure and
  squawk alerts. `onRaised` exceptions are logged, not propagated.

## Shape

- `ProximityAlertService.checkProximity` is async (the airspace lookup is a database call); `AirspaceSource` is the one method it
  needs (`airspaces(near, radiusNM)`). Observation: `subscribe` / `getVersion`.
- Time is epoch ms; positions are `{ lat, lon }`; `CLLocation` is not needed.

## Differences from Swift

- Em dash in a TFR alert name is written as `\u2014`; wording is unchanged.
- `Double.greatestFiniteMagnitude` is `Number.MAX_VALUE`.

## JS-only guards

- A database answer that arrives after a newer check started is dropped (sequence token), so an old position cannot overwrite a
  new one or clear a newer "check unavailable".
- A non-finite altitude reads as unknown (never INSIDE).
- `ReachabilityService.start()` is idempotent, a status delivered after `stop()` is ignored, and a throwing observer cannot stop
  the others.
