# ALERTS: the proximity and Israel alert services as a runtime

The services were ported in Phase 1 (`services/proximityAlertService.ts`, `services/israelAlertService.ts`, rules in
`services/proximityAlert.ts` and `domain/israel/alertEvaluator.ts`). Nothing ran them. This ticket adds the wiring Swift did
in the views: `ui/shell/alertsRuntime.ts` (with its API documented at the top) and `ui/flightLog/IsraelAlertBanner.tsx`.
Track A mounts both (I1d); no existing file is edited.

## Swift references

- `MapContainerView.initializeServices`: builds `ProximityAlertService` (on the map view model) and `IsraelAlertService`,
  sets `israelAlerts.onRaised = { _ in Haptics.warning() }`.
- `.onChange(of: appState.ownshipPosition)`: `mapViewModel.checkProximityAlerts()` (the 10 s throttle is in the service) and
  `israelAlertService.update(region, route, position, altitudeFeet, trackTrue, groundSpeedKnots, now)`.
- `.onChange(of: israelAlertsSuspended)`: `suspend()` when it turns true. `israelAlertsSuspended` is
  `region == .israel && gpsStatus.isStale`.
- `MapViewModel.checkProximityAlerts`: altitude is nil without a vertical fix; the TFR check runs only while the TFR layer
  is visible; one warning haptic when an alert id appears that was not active before.
- `FlightLogNotices`: the "Airspace check unavailable" row, the "ALERTS OFF" row instead of the Israel alerts, else
  `IsraelAlertBanner`.

## What is ported

- `createAlertsRuntime({ proximity, israel, haptics })`: `start` / `stop`, `setContext({ region, gpsStale })`,
  `setTfrs(tfrs, layerVisible)`, `update(fix)`, `setNotamReport`, and `subscribe` / `getVersion` / `getSnapshot`
  (`useSyncExternalStore`). The snapshot carries `proximityAlerts`, `isInAirspace`, `nearestAirspaceDistance`,
  `airspaceCheckUnavailable`, `israelAlerts` (empty while suspended) and `israelAlertsSuspended`.
- One warning haptic per newly raised proximity alert, tracked by alert id across calls (Swift's before/after sets; the
  ids are kept in the runtime because the JS check is asynchronous and fixes can overlap). Israel's haptic is the
  service's own `onRaised`.
- `IsraelAlertBanner`: top alert in full (title up to 3 lines, detail up to 2), then at most two one-line rows, then
  "+N more"; red warning with white text, amber caution with black; a caution under a red top alert keeps its own amber.
- The NOTAM closures feed stays the Israel service's own (`notamFetcher`, refreshed every 5 minutes, as Swift); the runtime
  only forwards `setNotamReport` (Swift `setReport`, used by previews and tests).
- Settings toggles: Swift has none for these alerts, so there are none.
- Spoken alerts: Swift has none, so there are none.

## Swift behaviour kept

- **Proximity alerts have no banner in Swift.** They produce only the warning haptic; the alert list, `isInAirspace` and
  `nearestAirspaceDistance` are never shown (the only visible proximity state is the "check unavailable" row). The runtime
  exposes them in the snapshot, but nothing draws them. Not a regression of the port; fixing it is after cutover.
- The proximity check runs for every region (Swift calls it unconditionally); the airspace source Track A injects decides
  what it sees. The Israel service resets itself outside Israel.
- A stale GPS in the US does not suspend anything and shows no notice (Israel only), as in Swift.

## JS-only differences

- `update` is async (the airspace lookup is). A fix that arrives while the previous lookup is running is the service's
  concern (it drops the older result). The haptic is decided after the check settles, against the ids already shown.
- `stop()` suspends the Israel service and clears `onRaised`; the snapshot of a stopped runtime is empty. Swift has no stop:
  the services live as long as the map view.

## For Track A (I1d)

- Build the services: `new ProximityAlertService({ source: <aviation db airspaces(near, radiusNM)> })`,
  `new IsraelAlertService({ databaseProvider, notamFetcher, closureMarks })`; pass them with a `haptics` implementation.
- **Haptics needs a decision:** there is no haptics module in `app/package.json` (the Swift `Haptics.warning()` is
  `UINotificationFeedbackGenerator`). `expo-haptics` (`notificationAsync('warning')`) is the usual answer and would be a new
  dependency; until then pass `{ warning: () => {} }`. The recording store's "warning haptic" has the same gap.
- Call `setContext` when the region or `gpsStatus.isStale` changes, `setTfrs` when the TFR list or layer toggle changes,
  `update` on every ownship fix (`altitudeFeet: null` when `verticalAccuracy < 0`), `start` when the map appears.
- Feed FlightLogNotices with `airspaceCheckUnavailable` and `israelAlertsSuspended`, and stack `IsraelAlertBanner` with
  `israelAlerts` where Swift does (when not suspended).

## Tests

`alertsRuntime.test.ts` (15): fix and altitude routing, haptic once per new alert and not for a persisting one, TFR check
only with the layer on, check-unavailable state, Israel routing and haptic, suspend only on the change to stale and only in
Israel, stop/start/idempotence/unsubscribe, snapshot stability and listener isolation, and two runs over the real
`ProximityAlertService` (entering airspace, database failure). `IsraelAlertBanner.test.tsx` (6): empty, full top alert,
two secondary rows and "+N more", no count at exactly three, own amber under red, amber top. The Swift tests of the rules
(`IsraelAlertTests`, `ProximityAlertAltitudeTests`) were ported in Phase 1; Swift has no test of this wiring, which lives in
views. No reference capture exists for the banner (nothing in `app/reference`).
