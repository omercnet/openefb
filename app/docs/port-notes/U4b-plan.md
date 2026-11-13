# U4b: Israel flight plan sheet

Part of U4b: the Israel flight plan screen (IL-PLAN) with its view model. Like the other U4 screens it reads its data
through a Zustand store with fakes behind it; I1 wires the real database, NOTAM service, profiles, navigation and map.

## Ported

- ViewModels/IsraelFlightPlanViewModel.swift (433 lines) ->
  - app/src/ui/sheets/israelPlan/logic.ts: the pure steps. `defaultDeparture`, `cruiseSpeedKnots`, `activeProfile`
    (the `aircraftProfile` / `pilotProfile` lookups), the picker filter (`searchableQuery`, `plannableAerodromes`,
    `SEARCH_LIMIT`), `viaRefusal`, `messageInput`, `computePlan` (the body of `computeRoute`: closure marks for the
    departure window, the planner, `validate`, `fpl`, `hebrewSummary`), `planActivation` (what `activate()` writes into
    AppState), `flightPlanMailURL` (see the deviation below), `windyURL`.
  - app/src/ui/sheets/israelPlan/store.ts: `createIsraelPlanStore(deps)`, the view model's state and actions with the
    Swift names (`selectDeparture`, `addVia`, `removeVia`, `selectNetwork`, `computeRoute`, `reroute`, `planReturn`,
    `activate`, `clear`, `refreshMessage`, `mailURL`, `configure`), the didSet reroutes as setters
    (`setDepartureTime`, `setAllowByRequest`, `setAllowMilitary`, `setDayOverride`), plus `IsraelPlanProvider`,
    `useIsraelPlan` and `useIsraelPlanStore`.
- Views/Planning/IsraelFlightPlanView.swift (395 lines) -> app/src/ui/sheets/israelPlan/IsraelFlightPlanSheet.tsx, with
  the Swift accessibility identifiers as testIDs (`il-route-network`, `il-departure-time`, `il-day-override`,
  `il-weekend-rule`, `il-no-route`, `il-summary`, `il-legs`, `il-fpl-preview`, `il-return`, `il-activate`,
  `il-notam-briefing`, `il-fpl-text`; new: `il-fpl-share`, `il-fpl-email`) and the same labels. The text it shows is in
  logic.ts (`summaryCells`, `legRows`, `cautionBadgeText`, `departureTimeText`, `FILING_NOTE`, `WEEKEND_RULE_FALLBACK`).
- `IsraelChartFeatureBuilder.closureText` (Services/IsraelChartFeatures.swift) -> logic.ts `closureText`: the planner
  needs it for partial-closure labels (closureMarks.ts takes it as a parameter). Move it to the chart port when that lands.
- Fixture: app/src/ui/sheets/israelPlan/fixture.ts (FAKE). The CVFR route LLHZ -> LLIB as
  efb-212/Resources/israel-aviation.sqlite has it (12 legs: point ids, codes, names, segment ids, lengths, bearings and
  published altitudes copied; each polyline reduced to its two end points, which are the points' positions), the LLHZ,
  LLIB and LLHA aerodromes (text fields, runways and frequencies left empty), the database's LSA weekend rule, one active
  aircraft (4X-CXA, C172) and one active pilot (with an e-mail, so the sheet shows where the draft does not go). Clock:
  the capture seed's 2026-11-12T06:26Z. Also the builders the tests use (`planPoint`, `planSegment`, `planAerodrome`,
  `createFakeIsraelPlanDatabase`, the Swift `MockIsraelAviationDatabase`).
- Route: app/src/app/israel-plan.tsx, the sheet over the fixture store seeded with LLHZ -> LLIB routed on CVFR.

Tests (58 in 3 files, all green):

- IsraelFlightPlanViewModelTests.swift: 8 of 8 (routesTheShortPathWithoutAFeed,
  fullClosureDetoursAndReturnReversesTheRoute, bothWaysClosedGivesNoRouteWithClosureReason,
  closureNamingAnUnknownPointBlocksFilingWithAnUnresolvedIssue, unknownViaPointIsRefused,
  activateFeedsNavigationStateAndClearResetsIt, activateIsRefusedWithoutAircraftAndPilotProfiles,
  routeProgressAdvancesToTheNextLegNearThePoint) in israelPlan/israelFlightPlanViewModel.test.ts. AppState is a small
  fake behind the store's navigation port; `FlightLogStrip.routeTitle` is `routeTitle` from ui/flightLog/logic.ts and
  `AppState.updateActiveRouteProgress` is `progress` from domain/israel/routeFollowing.ts.
- IsraelLSAPlannerTests.swift, suite "Israel LSA view model": 5 of 5 (theNetworkChoiceDecidesWhichRoutesArePlanned,
  aWeekdayDepartureOnTheLSANetworkHasNoRouteBecauseTheFirstLegIsWeekendOnly,
  switchingNetworkClearsViaPointsThatBelongToTheOtherNetwork, theActiveAircraftsUsualNetworkPreselectsUntilThePilotChooses,
  anAircraftWithoutAPreferenceStartsOnCVFR), the 5 cases L3a left for the view-model ticket, in the same file. The
  UserDefaults-backed preference is a Map behind `NetworkPreferenceStore`.
- New (no Swift counterpart): the issue #39 case in the view-model file (`mailURLIsAddressedToTheFilingAddressNotThePilot`),
  logic.test.ts (mailto, defaults, pickers, message input, closure labels, plan text, activation, computePlan) and
  IsraelFlightPlanSheet.test.tsx (render tests over the fixture store, including the E-mail button and the route).

## Deviation: the FPL e-mail goes to the IAA (issue #39)

Swift's `mailURL(to:)` builds `mailto:` with `components.path = address ?? pilotProfile?.email ?? ""`, and the view calls
it without an address, so the draft is addressed to the pilot's own e-mail ("the pilot forwards it to the filing address
himself"). That is a bug: https://github.com/omercnet/openefb/issues/39. `IsraelFlightPlanMessage.filingAddress`
(`FILING_ADDRESS` in domain/israel/flightPlanMessage.ts) is `ais@iaa.gov.il` and the preview's help text already names it.

The port does not carry the bug over. logic.ts `flightPlanMailURL(fplText, input)` is a pure function that always
addresses the draft to `FILING_ADDRESS`: `mailto:ais@iaa.gov.il?subject=FPL%20<reg>&body=<FPL>`. It takes the whole
message input, pilot e-mail included, and ignores the e-mail on purpose. There is no `to` parameter, so no caller can put
the pilot back as recipient. The store's `mailURL()` and the preview's E-mail button use it. The app still only opens the
draft; the pilot taps Send.

Cc: U4.md left open whether the pilot's own address goes in Cc (the issue lists it as optional). Not added: the pilot
already gets a copy in his Sent folder, Share gives him the text, and leaving the pilot's address out of the link
entirely means the tests can assert one simple rule: the link contains no pilot address at all.

Pinned by tests: logic.test.ts checks the exact link for a known message (recipient, subject, encoded body); the parsed
recipient is `ais@iaa.gov.il`; the only query keys are `subject` and `body` (no `to`, `cc`, `bcc`); the pilot's address
does not appear anywhere in the link, plain or percent-encoded, even when it looks like the filing address; the link is
the same with or without a pilot e-mail; message text with `&cc=...`, `?`, `+`, `=` or `#` stays inside the body. The
view-model test and the render test check the same through the store and through the E-mail button.

Encoding: subject and body are percent-encoded as RFC 6068 asks, which `encodeURIComponent` almost does; `!'()*` are also
encoded, and line breaks go out as `%0D%0A` (Swift's URLComponents sent `%0A` and left some reserved characters such as `+` unencoded). Mail
apps decode both forms to the same text.

## Swift differences

- Async: the database and the NOTAM feed are async in JS. Every routing run takes a generation number and only the latest
  writes (Swift cancels the previous Task, and checks cancellation only after the feed); `clear()` bumps it too, so a run
  still waiting cannot refill a cleared sheet. Picker searches carry a token per field. `addVia`, `searchDeparture` and
  `searchDestination` return promises.
- The departure DatePicker (`in: Date()...`, Asia/Jerusalem) is a 15-minute stepper with the time in Israel local time
  (`departureTimeText`, `steppedDeparture`, store `stepDepartureTime` on the store's clock). The app has no date picker
  dependency, and adding a native module needs a dev client rebuild; the picker can come with the reference.
- The preview is a React Native `Modal` (page sheet on iOS), its `onAppear: refreshMessage()` an effect on opening.
- The issue icons are the existing OctagonWarning and WarningTriangle (SF `xmark.octagon.fill` and
  `exclamationmark.triangle.fill`). Labels lose their SF Symbols (doc.text, envelope, wind, ...).
- `computePlan` rethrows anything that is not an IsraelRouteError; the store reports a database failure in
  `lastNetworkFailure` as Swift does.
- `canFile` is a stored field the store keeps in step with `plan` and `issues`. Swift computes it on read.
- `cruiseSpeedKnots` is not stored: it is read from the active aircraft when routing (logic.ts `cruiseSpeedKnots`).

## Not ported

- Map: `draw(_:)` (route line, pins, and MapLibre `setVisibleCoordinateBounds` with 0.05 degree margins and 80 pt
  padding) and the LSA layer emphasis go through the optional `IsraelPlanMap` port (`showRoute`, `clearRoute`,
  `setPlanUsesLSA`); the camera fit belongs to the map side that implements it.
- `Telemetry.signal("FlightPlan.activated")` and `("Israel.fplShared", method)` go to the optional `signal` dependency; no
  telemetry adapter exists yet.
- The NOTAM briefing button calls the optional `openBriefing(route)` with `briefingRouteFromPlan(plan, departure)`; the
  briefing sheet is its own U4b part.
- `.presentationDetents([.large])` and `.scrollDismissesKeyboard(.interactively)` map to the page-sheet Modal and
  `keyboardDismissMode="interactive"`; there is no detent API to match.

## Wiring for I1

`createIsraelPlanStore(deps)` and `IsraelPlanProvider` around the sheet. `deps`: `database` (the opened
IsraelAviationDatabase; it satisfies `IsraelPlanDatabase`), `fetchNotams` (IsraelNotamService's report), `now`,
`profiles` (aircraft and pilot profiles from the user database), `networkPreferences` (a settings adapter),
`navigation` (AppState: set the active route and plan fields from `PlanActivation`, then run the route progress;
`clear` = clearActiveNavigation), and optionally `map`, `signal`, `openBriefing`. The sheet takes `openURL` and `share`
props (defaults: `Linking.openURL`, React Native `Share`).

## Fidelity

No reference and no gate registration in this change: the `ipad-israel-plan` reference comes later. The route
`israel-plan` is not in `LAUNCH_SCREENS` (src/app/index.tsx) nor in scripts/fidelity-thresholds.json; add both with the
reference, and align the fixture to the capture seed then. Web preview: the route renders the fixture plan (summary,
12 legs, the amber "closures were not checked" note, actions).

## Review decisions (PR #58)

Fixed, each with a test that fails without the change: a zero or negative fuel burn publishes no fuel estimate (Swift
multiplies it through); an `addVia` lookup that finishes after a network switch changes nothing; Activate is ignored while
the route is being recomputed (the button is disabled too) and re-validates against the CURRENT profiles first
(`refreshMessage`), so a profile edited after routing cannot be activated on a stale `canFile`; a network load failure also
clears the FPL text and Hebrew summary (so no e-mail draft carries the old route), clears the map route and the LSA
emphasis, and shows "The route network could not be loaded" in the sheet. Briefing row labels now speak CLOSED, PARTIAL,
CHECK NOTAM and the other-network status (Swift keeps the badges as separate children, `children: .contain`; the RN row is
one element with hidden children).

Not done: while a reroute is in flight the previous plan stays visible (dimming it is a UI choice; activation is blocked
instead), and a reroute does not re-sync an already active plan with navigation: Swift's `isActive` also drops on reroute
(`isActive: false`) and the pilot activates again.

## Briefing sheet on Android (device findings)

Two Android findings on the briefing route (kanaf-dev://briefing), compared with app/reference/ipad-briefing.png and
Views/Briefing/IsraelBriefingView.swift.

The Feed row showed "Fee". The row had no numberOfLines or width on the label, and Yoga's flexShrink already defaults to 0,
so no RN layout constraint explains the clip. The label and the count now set `flexShrink: 0` explicitly (Swift's HStack:
label, badge, Spacer, count; only the spacer gives way) and the label uses `textBreakStrategy="simple"`: the likely cause
is Android's highQuality line breaker wrapping the last glyph of a tightly measured word onto a second line that the
one-line measured height hides. The Compose-hosted RNHostView (below) was the other suspect and is gone on Android.
Test: the label renders the whole word at a 320 dp width with no numberOfLines, width, maxWidth, flex or flexBasis on it
or on anything up to the row, and the count and spacer are where Swift has them.

The sheet was a Material 3 ModalBottomSheet (@expo/ui's BottomSheet on Android): capped width, centred, grab handle. The
reference is an iPad page sheet: inset from the edges, rounded on all corners, map and strip dimmed behind, Done at the
left and Mark all read at the right. @expo/ui's ModalBottomSheet exposes no width (no sheetMaxWidth), so
`BriefingPresentation` draws the sheet in React Native on Android: an absolute-fill overlay, an rgba(0,0,0,0.3) backdrop
that swallows touches (a tap on it does not dismiss, like the iPad sheet), and the sheet container 16 dp from the left,
right, top and bottom safe-area edges, radius 28 (Material's extra-large shape; the iOS 26 sheet corners are a bit
larger), grouped background. The system back gesture dismisses. iOS and the web preview keep the BottomSheet exactly as
before (full detent, #F2F2F7, presentationSizing page on iOS). Tests: Android container and backdrop styles, back and
dismissed states; iOS props unchanged; web without the iOS modifier.

Unverified without a device: that "Feed" now renders whole on the device that clipped it (if it still clips, the next
step is measuring the Text's onLayout width against the glyph advance on that device); the look of the overlay on a
phone and a tablet (the top inset is 16 dp below the status bar, where the iPad reference is about 18 pt below it);
edge-to-edge insets with gesture navigation; that the backdrop keeps MapLibre's native view from taking gestures; no
enter or exit animation (the native sheet slid up). `expo export --platform web` could not be run here: it stops on the
missing built asset assets/aviation.sqlite before reaching this code.
