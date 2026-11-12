# U4b part 1: the production airport column (AirportColumnView)

Replaces the U2 stub column (a fixed KSQL scenario) with the production column over a store keyed by
`appStore.selectedAirportId`. Sheets (Israel briefing, Israel flight plan) are the next PR.

## Files

- `src/ui/columns/AirportColumn.tsx`: `ColumnHeader` plus the body: Direct, info chips, weather, then `shownSections(model)`
  each under a rule. A station-only branch (the region's weather station without an airport record) and a loading branch.
- `src/ui/columns/airport/sections.tsx`: title, Direct button, info chips, the WEATHER section (age badge, decoded rows, raw
  METAR disclosure, TAF block, loading, failed, unpublished and stale states), frequencies, runways, charts.
- `src/ui/columns/airport/logic.ts`: the pure decisions (frequency labels, spoken names and order, chips, runway rows, the
  weather section state, decoded wind, visibility, ceiling, temperature, altimeter, the charts grouping and cycle line).
  Nothing reads the clock; region, freshness and METAR rules come from `domain/core`.
- `src/ui/columns/airport/store.ts`: slice `airport` (columns by ICAO, region, now, the raw-METAR disclosure, and the
  callbacks Direct, refresh weather, open chart, retry charts) and the hook the column reads, keyed by `selectedAirportId`.
- `src/ui/columns/airport/fixture.ts`: the FAKE KSQL column matching `reference/ipad-airport-KSQL.png`; the store's default
  until I1 feeds the database, weather, charts and NOTAMs (like every other store behind the strip, see U3.md).
- Tests: `logic.test.ts` (32) and `AirportColumn.test.tsx` (24).

## Swift tests ported

No Swift test targets `AirportColumnView`. Cases ported because they reach these helpers: the `MetarVisibilityTests` Israel
and US cases, the Israel weather row (knots, Celsius, hectopascals), variable wind and the frequency ordering.

## Swift differences and decisions

- The title block has NO `flex: 1` inside the header wrapper (pinned by a test): under React Native's `YGErrataAll` a flexing
  block there is stretched to the row's 60 pt minimum instead of its 61.5 pt content (found in PR #47, see U3.md).
- The runway row's baseline is clamped to `Type.data.lineHeight` like the other rows (20 vs 19.5 pt unclamped).
- The fixture adds an "Arrivals" chart group: the reference shows its label clipped by the footer at about 1290 pt.
- Not ported yet: accessibility-size Dynamic Type layouts (Swift stacks label above value and lifts the name's two-line
  limit; there is no fontScale plumbing in the strip), the NOTAM list, PIREPs, winds aloft, the Israel diagrams and the Israel
  aerodrome section (U4b later: add entries to `AIRPORT_SECTIONS`; the runways entry is the one the Israel section replaces),
  and the chart PDF viewer (`openChart` is a callback only).

## Fidelity

`airport` is already in the gate (floors iOS 0.85, Android 0.80, `reference/ipad-airport-KSQL.png`). Measured in PR #47's
App run 43121063023 on the stub column: iOS 0.9496, Android 0.9813; the production column reproduces the same fixture and is
measured by this PR's App run. The web strip render scored 0.9091 in the first measurement of the column. The remaining
iOS gap on the old stub was a 1.5 pt low tail (FAA CHARTS and below); this column re-measures it.

## For I1

Feed `airport.store` (columns by ICAO, region, `now` ticking for the badges) and wire the callbacks.
