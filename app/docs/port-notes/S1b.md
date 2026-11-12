# S1b port notes: NOTAM service (FAA + Israel relay client), Air/SIGMET

Sources -> targets (all under `src/services/`):

- `Services/NotamService.swift` -> `notam.ts` (models, closure rules, geoJson decoder) + `notamService.ts` (client, cache, credentials)
- `Services/IsraelNotamService.swift` -> `israelNotam.ts` (feed models and decoder) + `israelNotamService.ts` (relay client)
- `Services/NotamReadStateStore.swift` -> `notamReadStateStore.ts`
- `Services/AirSigmetService.swift` -> `airSigmet.ts` (models, parser, colours) + `airSigmetService.ts`
  The relay itself (`web/notam-relay`) is read, not changed. Wire format: `web/notam-relay/src/types.ts`.

Tests: `NotamServiceTests` 14 of 14, `AirSigmetServiceTests` 12 of 12, `IsraelNotamServiceTests` 23 of 23 ported with the
Swift names. `MockNotamService`, `MockAirSigmetService`, `MockIsraelNotamService` are dropped (test doubles; TS fakes are
`fakeFetch` and friends in `testSupport.ts`). `NotamReadStateStore` has no Swift test of its own (its cases sit in
`IsraelBriefingViewModelTests`, a U-ticket), so four store tests are new. The kpao page and both AWC captures are read in
place from the Swift test files (`swiftFixtures.ts`); the live relay sample is read in place from `docs/research`.
No test uses the network.

## Shape

- Same ports as S1a (`FetchLike`, `Clock`, `TextStorage`). The FAA key is read through the A4 `SecretStore`
  (`loadNotamCredentials`, same Keychain service/account names); nothing is hardcoded.
- Times are epoch ms. `Date?` becomes `number | null`.
- `Notam.briefingOrder` becomes `compareBriefingOrder` (a sort comparator with the same ordering).
- Errors: `NotamError` and `IsraelNotamError` are classes with a `code` (Swift enums); transport failures are `AppFailure`
  (`networkUnavailable`, `weatherFetchFailed`) as in Swift.

## Differences

- Offline detection: Swift maps `URLError.notConnectedToInternet` (and `networkConnectionLost` for Israel NOTAMs) to
  `networkUnavailable`. JS has no error codes, so a `TypeError` with the usual fetch wording ("Network request failed",
  "Failed to fetch", ...) is offline (`isOfflineError`). The FAA client maps it too (Swift mapped only for the FAA
  client's `notConnectedToInternet`, the same case). Any other transport error from the Israel client is rethrown as is.
- Persisted Israel feed: `{ fetchedAtMs, body }` (the relay body is stored verbatim and decoded on load) under
  `IsraelNotam/last-feed.json`, instead of a Codable re-encode. Read-state keys are a JSON array under
  `IsraelNotam/read-keys.json` (Swift: UserDefaults).
- Feed URL override: injected `feedUrl()` (Swift read UserDefaults). Omit it to use the deployed relay URL.
- `effectiveWindowDescription` is hand-formatted `MMM d HHmm'Z'` (UTC, English months) to match `en_US_POSIX`.
- Date parsing uses the shared strict ISO 8601 parser (see S1a): a superset of the zone spellings Swift accepts.
- `IsraelNotamService` persists on every successful fetch with chained writes; Swift wrote synchronously inside the actor.
- Decoding is strict where Swift Codable is strict (required fields, wrong types reject the whole page or feed) and
  lenient where Swift is (`IsraelRouteClosure` conditions, FAA items without a `notam` object are skipped).
- Swift `Int(Double)` on advisory altitudes traps on NaN or huge values; JS truncates, and non-finite numbers read as
  missing (JS-only guard, tested). Booleans are never numbers in `advisoryNumber`.

## JS-only guards

- Concurrent calls join one in-flight download: FAA per airport, Israel feed (a forced refresh joins a running one),
  advisories (Swift already did this for advisories). The in-flight slot is released only by its own owner.
- Failed refreshes are never cached (tested for the FAA client: a 500, then a malformed body, then a good page).
- Storage reads and writes never throw into the caller; a failed save is logged and the in-memory copy stays.
- A request timeout that aborts the request (`http.ts`), 15 s as in Swift.

## Preserved Swift behaviour worth knowing

- A failed FAA refresh serves the last good copy even when the failure is `credentialsRejected` (flagged
  `refreshFailed`, original `fetchedAt`). The first fetch with nothing cached throws.
- The FAA closure regex `\bA[DP]\s+CLSD\b` also matches "AP CLSD" anywhere in a NOTAM body.
- The advisory snapshot is only replaced when BOTH feeds succeed.

## Not ported

- `NotamCredentials.registrationURL` is exported as `FAA_REGISTRATION_URL` (a constant); the Settings UI is a U-ticket.
- `Services/TFRService`, `PirepService`, `WindsAloftService`, `WeatherService`, `ProximityAlertService`, `IsraelAlertService`,
  `ReachabilityService` are S1 rows that are not in this PR (see the PR body for what is left).

## After L3 (#42)

`services/israelNotam.ts` now re-exports L3's Israel NOTAM value types and closure helpers (`domain/israel/notamTypes.ts`;
`closureIsValid` and `isSuperseded` are aliases of `closureIsValidAt` and `notamIsSuperseded`). It keeps the relay decoder, the report,
the freshness badge, `altitudeChartText` and `makeRouteClosure`.
