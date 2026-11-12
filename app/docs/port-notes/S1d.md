# S1d port notes: weather, TFR, PIREP and winds aloft services

Sources -> targets (all under `src/services/`):

- `Services/WeatherService.swift` -> `weather.ts` (METAR parsing, flight category) + `weatherService.ts`
- `Services/TFRService.swift` -> `tfr.ts` (WFS and XNOTAM parsing, polygon/area join) + `tfrService.ts`; the XML reader is
  `terminal/xml.ts` (shared with the d-TPP metafile parser, S1c)
- `Services/PirepService.swift` -> `pirep.ts` (model, display summaries, parser, filter) + `pirepService.ts`
- `Services/WindsAloftService.swift` -> `windsAloft.ts` (FD decoder) + `windsAloftService.ts` + `windsAloftStations.ts`
  (the 233-station table, generated mechanically from the Swift array)

Tests (names kept; Swift fixtures are read in place with `swiftFixtures.ts`, no copies):

- `WeatherServiceTests` 21 of 21 (the two `WeatherCache` staleness cases are L1's model but live in this Swift suite and are
  ported here), `WeatherParsingTests` 5 of 5, `WeatherCacheClockCharacterizationTests` 7 of 7.
- `TFRServiceTests` 15 of 20 here. Not here: `pointInPolygon` and `distanceToEdgeInNauticalMiles` (L1's PolygonGeometry,
  covered by `domain/core/polygon.test.ts`) and the three proximity-alert cases (ported with S1e, `proximityAlert.test.ts`).
- `PirepServiceTests` 19 of 19. `WindsAloftServiceTests` 21 of 21.
- Dropped: `MockWeatherService`, `MockTFRService`, `MockPirepService`, `MockWindsAloftService` (test doubles; `fakeFetch`).
- `WeatherRefreshFailureTests` (12) is a `WeatherViewModel` suite (U4) and stays with that ticket.

## Differences from Swift

- Same ports as S1a (`FetchLike`, `Clock`); `WeatherCache.id` comes from an injected `newId` (default `uuidv4`).
- Clocks: `PirepService` and `WindsAloftService` read `Date()` in Swift (filter and bulletin reference); here they use the
  injected clock so tests need no wall-clock tricks.
- `Pirep.formatted()` integers use a small English digit-grouping helper (Hermes `Intl` is not guaranteed); `capitalized`
  becomes a first-letter upper-case. Wording is identical to Swift.
- `Pirep.id` keeps Swift's shape (`<epoch seconds as Double>-<raw text>`, e.g. `1793386320.0-...`).
- Dates: the metafile and XNOTAM formats are parsed by strict regexes with calendar checks (no `DateFormatter`).
- Swift `Int(Double)` of a half rounds away from zero (`.rounded()`); the port rounds half away from zero too.
- TFR: `TfrDetailArea` altitude equality is structural, as Swift's `Equatable`.
- The TFR detail cache is rebuilt aside and swapped in, so a failure part way through leaves the previous cache untouched.
- Winds aloft: day-of-month resolution uses `Date.UTC` month arithmetic instead of `Calendar`; the "31st in a 30-day month"
  rejection is kept and tested.
- Swift `Character.isNumber` (any Unicode digit) becomes ASCII digits where the next step is `Int(...)` anyway.

## JS-only guards

- Station ids are percent-encoded into the METAR/TAF query (an id such as `KPAO&format=raw` cannot add a parameter).
- A TFR NOTAM id (from the remote WFS document) only becomes a detail URL when it matches `[A-Za-z0-9/_-]+`; otherwise the
  polygon is still shown with "See NOTAM" and no request is made.
- Bounded detail-fetch pool of 6 workers (Swift: task group). Concurrent `currentTFRs()` and `currentAdvisories()` callers
  share one refresh; concurrent winds-aloft callers share one bulletin download; failures are never cached.
- Non-finite query values (`NaN` coordinates or radius) are refused before any PIREP request.
- Non-object `clouds` entries, booleans and non-finite numbers read as missing, never as 0.

## Preserved Swift behaviour worth knowing

- `fetchMETAR` after the cache window and a failed request throws; only the batch path serves stale entries (flagged by
  their original `fetchedAt`).
- Batch METAR fetch loses only the failed batch; results order is fresh-cached, then fetched, then stale fallbacks.
- A WFS feature with a non-polygon geometry, fewer than 3 vertices or no NOTAM key is skipped, not an error.
- A winds-aloft bulletin is not served from cache once its FOR USE window has ended, even inside 30 minutes of the fetch.

## Review follow-ups (PR #54)

- PIREP queries split at the antimeridian (`pirepBoundingBoxes`: two requests, results merged and de-duplicated). Swift clamps the
  longitudes and so drops in-radius reports across +-180 (a Swift bug fixed here as a safety guard; `pirepBoundingBox` keeps the
  Swift clamp for parity tests).
- Declined, Swift parity: when a NOTAM's `LAST_MODIFICATION_DATETIME` changes and its detail refetch fails, the previous detail is
  kept (Swift `details[id]` survives a failed refetch), so superseded altitude/time limits can show until the next successful
  refresh. Only the log wording was corrected. If the owner wants "See NOTAM" instead (drop the cached detail when its stamp no
  longer matches), it is a one-line change in `TfrService.refresh`; flagged as an owner decision.
