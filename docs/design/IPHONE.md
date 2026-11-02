# iPhone support: audit (T34)

Scope: "some support" (docs/handoff/IPHONE-1.md). The iPad stays the primary device; iPhone portrait gets compact-width layouts.
Layouts switch on `horizontalSizeClass == .compact`, never on the device, so the iPad layouts are unchanged.

Audited on iPhone 17 Pro (393 pt wide) and iPhone 17e (narrowest), iOS 26, light and dark, Israel and US regions, with a
simulated fix at LLBG / KPAO. Screenshots: `docs/design/screenshots/IPHONE/` (`before-*` are the unfixed state, `pro-*` and
`se-*` the final state). None shows CAAI artwork (no chart or diagram pack was installed), so they are committed.

Severity: 0 fine, 1 cosmetic, 2 awkward, 3 a core flow is hard or a number is truncated, 4 unusable.

## Project and tooling

- `TARGETED_DEVICE_FAMILY = "1,2"` for the app and both test targets; `INFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone`
  = portrait + both landscapes (landscape is not verified, see "Left over"). The single 1024 icon covers iPhone; the app builds.
  No iPad-only Info.plist keys exist (`UIRequiresFullScreen`, `UIDeviceFamily` absent).
- `tools/sim-test.sh`: `SIM_DEVICE="iPhone 17 Pro"` (or `"iPhone 17e"`) makes `claim` reuse or create a simulator of that model;
  pool tags are `iphone17pro-pool1`, `iphone17e-pool1`. Default stays the iPad Pro 13-inch.

## Screen table

| Screen | Finding on iPhone | Sev before | After |
|---|---|---|---|
| Onboarding | Fits; copy says "iPad GPS is not certified" | 1 | 1 (copy, left over) |
| Map: top-right control column | 7 stacked 60 pt controls (orientation, zoom x2, layers, briefing, night) ran into the left column and the NRST area | 3 | 0: orientation + zoom + one 60 pt "..." menu (layers, NOTAM briefing, day/night) |
| Map: instrument strip | Six cells (GPS chip, GS, ALT, VS, TRK, DTG, ETE) do not fit 393 pt | 4 | 0: GS, ALT, TRK (+ DTG, ETE on a second row with a route), unit moved next to the label |
| Map: Recenter button | "Recen-ter" wrapped onto two lines and took half the row | 3 | 0: icon-only 60 pt button on compact |
| Map: NRST readout | "KP... 0.0... 30..." truncated ICAO, distance and bearing | 3 | 1: ICAO + distance, then bearing + runway; runway length can still shrink next to PPR/PVT tags |
| Map: layers panel | Panel ran under the tab bar and was offset for an iPad column that is not there | 2 | 0: right aligned, stops above the strip, scrolls |
| Map: banners (Beta, chart hint, no-GPS notice, alerts, route bar) | All visible and none hides ownship, but together they use about 40% of the height | 2 | 2 (left over) |
| Map: search | Search bar fits next to the control column | 0 | 0 |
| Nearest list | "Direct" hyphenated to "Di-rect" on two lines, distance squeezed | 3 | 0 |
| Direct-To bar / route bar | Fits; Clear is 60 pt | 0 | 0 |
| Airport sheet: weather + frequencies | Two columns: "132.500" wrapped to "132.50 / 0" | 3 | 0: stacked on compact width |
| Airport sheet: runways, NOTAMs, charts, operations | Scroll in one column | 0 | 0 |
| NOTAM briefing | "Show on map" wrapped to three lines | 2 | 0: buttons wrap to a second row when they do not fit |
| Flights: History / Logbook / Plans picker | Fits, add button beside it | 0 | 0 |
| Plans (Israel): form | Fits | 0 | 0 |
| Plans (Israel): legs table | Scrolling rows with the leg split over two lines; readable | 1 | 1 |
| Plans (Israel): FPL preview and actions | Buttons wrap into three rows; messages readable | 1 | 1 |
| Settings, Region, chart downloads, Offline Maps | Single column grouped list; fine | 0 | 0 |
| Logbook list | Empty state fine; entry editor not exercised (no entries) | ? | ? (left over) |
| History, Replay, Debrief, recording start/stop, Aircraft & Pilot profiles | Not exercised: needs a recorded flight / profile data on the simulator | ? | ? (left over) |

## What changed (files)

- `Views/Map/InstrumentStripView.swift`: `InstrumentStripLayout.fields(compact:routeActive:)`, compact two-row strip, compact `InstrumentCell`.
- `Views/Map/MapControlsView.swift`: compact "more" menu; `RecenterButton` icon-only on compact.
- `Views/Map/MapContainerView.swift`: layers panel placement on compact.
- `Views/Map/NearestAirportHUD.swift`, `NearestAirportView.swift`: no-wrap badge/readout, two-line compact HUD, fixed-size Direct and distance.
- `Views/Map/AirportInfoSheet.swift`: weather and frequencies stack on compact width.
- `Views/Briefing/IsraelBriefingView.swift`: action buttons wrap instead of squeezing.
- Tests: `efb-212Tests/ViewModelTests/InstrumentStripLayoutTests.swift`.

## Left over

Tracked as the iPhone ticket on the Paseo Progress dashboard (originally filed as beads efb-zfm.21 to .24).
