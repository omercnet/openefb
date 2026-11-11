# S1e port notes: proximity alerts, reachability (IsraelAlertService pending)

Sources -> targets (under `src/services/`):

- `Services/ProximityAlertService.swift` -> `proximityAlert.ts` (pure: alert model, thresholds, airspace and TFR evaluation)
  - `proximityAlertService.ts` (throttle, state, "check unavailable")
- `Services/ReachabilityService.swift` -> `reachabilityService.ts` (service + `NetworkStatusSource` port; no native adapter yet)

Tests: `ProximityAlertAltitudeTests` 10 of 10; the 3 proximity cases of `TFRServiceTests` (`proximityAlertUsesPolygonBoundary`,
`proximityAlertIgnoresInactiveTFRs`, `proximityAlertsSortedNearestFirst`) 3 of 3, with the TFR fixtures read in place.
`ReachabilityService` has no Swift test (it wraps `NWPathMonitor`); 3 new tests cover the port.

## IsraelAlertService: NOT in this change yet

`IsraelAlertService` (221 lines) and its 9 cases in `IsraelAlertTests` (suite `IsraelAlertServiceTests`: outsideIsraelNothingIsEvaluated,
raisesOnceAndCallsTheHapticOnlyForNewAlerts, evaluationIsThrottledToOncePerFiveSeconds, anAlertStaysUpForTenSecondsAfterItStopsApplying,
theHeldAlertClearsAfterTheHoldTime, leavingIsraelClearsEverything, suspendingForALostFixDropsTheAlertsAndTheNextFixEvaluatesAtOnce,
aClosureNewlyCoveringALegAheadRaisesOnceAndIsRedWhenFull, and the evaluator-area helper) depend on L3's `IsraelAlertEvaluator`
(`domain/israel/alertEvaluator.ts`, `closureMarks.ts`, `notamTypes.ts`), which is in PR #42 and not on main. It is ported
after #42 merges. L3 also asks S1 to import its Israel NOTAM value types instead of redefining them: at that point
`services/israelNotam.ts` (S1b) drops its duplicate model types and re-exports L3's, keeping only the decoder.

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
