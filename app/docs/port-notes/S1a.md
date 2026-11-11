# S1a port notes: data refresh scheduler + remote config

Sources: `Core/DataRefreshScheduler.swift`, `Core/RemoteConfig.swift`, `Services/RemoteConfigService.swift`,
`Services/RemoteConfigStore.swift` -> `src/services/{dataRefreshScheduler,remoteConfig,remoteConfigService,remoteConfigStore}.ts`.
Tests: `DataRefreshSchedulerTests` 6 of 6 and `RemoteConfigTests` 27 of 27 ported (names kept; parameterised Swift
tests are `test.each`). `MockRemoteConfigService` is replaced by `FakeConfigService` in the test file (dropped, not ported).

## Shape

- Services take `FetchLike`, `Clock` (`() => epoch ms`, from `data/ids`), `TextStorage` and an optional logger, all
  declared in `services/ports.ts`. Native pieces: global `fetch`, and `adapters/fileTextStorage.ts` (expo-file-system).
- Config bodies are UTF-8 strings where Swift used `Data`. Times are epoch ms; durations stay in seconds.
- The store is a class with `subscribe`/`getVersion` for `useSyncExternalStore` (replaces `@Observable`).

## Differences

- `RemoteConfigStore.open()` is async: Swift read the saved file synchronously in `init`.
- The saved file is `{ fetchedAtMs, body }` JSON under key `RemoteConfig/last-config.json`, not Swift's Codable
  `{fetchedAt, body(base64)}`. Clean slate (no import of Swift data). Writes are chained so an older write never lands
  after a newer one; `flush()` waits for them. A failed write is logged and the in-memory config stays.
- `RemoteText.resolved` takes the language from an injected `preferredLanguage()` (default `en`).
- `sourceDescription` uses a small "N min. ago" formatter instead of `RelativeDateTimeFormatter` (not available on
  Hermes). Only the `Serial N, checked ...` prefix is tested.
- ISO 8601 parsing is a strict regex (full date-time with a zone, optional fractional seconds, `Z` or `+hh:mm`/`+hhmm`),
  with calendar validation. Swift's `ISO8601FormatStyle` accepts exactly one zone spelling by default; the port is a
  superset on zone spelling and rejects the same date-only and zone-less text.
- `RemoteConfigService` reads the URL override from an injected `urlOverride()` (Swift read UserDefaults key
  `remoteConfigURL`); the default is the deployed relay URL (a public URL, no key).
- Not ported: the `-remoteConfigURL` launch argument plumbing (Apple-only).

## JS-only guards

- A request timeout that also aborts the request (`services/http.ts`; Swift: URLSession 10 s). The 20 s resource
  timeout has no equivalent and is not emulated.
- Body size is checked in UTF-8 bytes after the read; Swift checked `Data.count`.
- `refresh()` while a check runs joins the running one (Swift is MainActor-serialised but could still double-fetch from
  a direct `refresh()` call). A synchronous throw from the service is recorded like a rejection.
- Listener exceptions in `subscribe` callbacks are logged, not propagated into the refresh.
- Scheduler: failures and attempts are tracked per product (tested), `-Infinity` stands in for `.distantPast`.

## Handoffs

- I1 wires `createRemoteConfigService({ fetch })`, `RemoteConfigStore.open({ storage: fileTextStorage, buildNumber })`
  and calls `refreshIfDue(recordingActive)` at launch and on app active. `DataRefreshScheduler` is pure; the map view
  model (M-track/I1) owns lastData and calls `recordAttempt`.
