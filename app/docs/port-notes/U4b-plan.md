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
- The departure DatePicker (`in: Date()...`, Asia/Jerusalem) is a real picker from `@expo/ui` (already a dependency,
  ~58.0.27; no package change): `@expo/ui/community/datetime-picker`, its drop-in for
  `@react-native-community/datetimepicker`. iOS: two compact SwiftUI DatePickers (`mode` date and time, the zone through
  `timeZoneName` = the `\.timeZone` environment, `minimumDate` = now), the same two grey pills as the reference. Swift
  draws one DatePicker with both components; two let the tests address each pill (`il-departure-date`,
  `il-departure-clock`) and the sheet recombines the picked day or time with the other half in Israel time
  (`withIsraelDay`, `withIsraelTime`). Android: Material has no compact picker and the Compose dialogs have no time zone,
  so the pills are drawn in the sheet ("Nov 12, 2026", "10:00 AM", Israel time: `departureDateText`,
  `departureClockText`) and open `@expo/ui`'s date or time dialog on a device-local mirror of the Israel wall clock
  (`deviceDateShowingIsraelTime`, read back with `israelEpochOfDeviceDate`). Both go through the store's
  `pickDepartureTime`, which refuses a past time: the departure becomes now (`pickedDeparture`, the stepper's old rule).
  `setDepartureTime` stays unclamped like the Swift view model's property (the LSA tests set past days). The 15-minute
  stepper (`stepDepartureTime`, `steppedDeparture`, `departureTimeText`) is gone. The picker is a native view: the
  ExpoUI module is in the dev client already (BottomSheet uses it), so no rebuild beyond the current one; Jest mocks
  the picker module in the sheet test.
- The preview is a React Native `Modal` (page sheet on iOS), its `onAppear: refreshMessage()` an effect on opening.
- The issue icons are the existing OctagonWarning and WarningTriangle (SF `xmark.octagon.fill` and
  `exclamationmark.triangle.fill`). The NOTAM briefing button has its `doc.text.magnifyingglass` (Icons.tsx
  `DocTextMagnifier`); the other labels lose their SF Symbols (doc.text, envelope, wind, ...).
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

The route `israel-plan` is a gate screen (Q1: `LAUNCH_SCREENS`, scripts/fidelity-thresholds.json, reference
`reference/ipad-israel-plan.png`) and renders the empty form, as the SwiftUI capture does. Measured against the
reference (2x pixels / 2 = points) and fixed in the empty form:

- Background: the SwiftUI ScrollView sits on systemBackground (white; black at night), not the app's grey `paper`.
  The route's SafeAreaView takes the same colour. The iOS system colours the form uses live in `formColors`
  (IsraelFlightPlanSheet.tsx).
- Text: SF body 17 / caption 12 (field text, labels, buttons; the field captions and the disclaimer), not Archivo 15 / 13.
- Fields (`.roundedBorder`): white, a hairline #CCCCCC border (1 px at 2x), radius 4, 34 pt tall, 7 pt text inset,
  placeholderText (secondary label at 0.3) placeholders. Before: 44 pt, a 1 pt `rule` border, radius 8, 12 pt inset.
- Buttons (`.bordered`): capsules in secondarySystemFill, the label in SF body regular. Add is 34 pt (hit area 44 pt);
  NOTAM briefing is 58 pt with its leading `doc.text.magnifyingglass` (`il-notam-briefing-icon`). Before: radius 10,
  `fill`, semibold.
- Network picker (`.segmented`, `.controlSize(.large)`): a 49 pt capsule track in tertiarySystemFill, a 41 pt white
  thumb inset 4 pt with a soft shadow, SF 13. The LSA day picker keeps its 44 pt height in the same shape.
- Departure: the "Departure (local)" label in SF body at the left, the date and time pills at the right (36 pt, 10 pt
  apart) in a 47 pt row; see Swift differences for the picker.
- Route options (DisclosureGroup): the title in the accent colour, the chevron in the primary colour, a 22 pt row (hit
  area 44 pt). Before: black title, accent chevron, 44 pt row.
- Clock: the route's store runs on `ISRAEL_PLAN_CAPTURE_NOW` (06:31Z, the reference's status bar), so the default
  departure reads 10:00 AM in Israel like the reference pills; FIXTURE_NOW (06:26Z) would give 9:00 AM. The tests keep
  FIXTURE_NOW.

Not checked on a device in this change (no simulator here): the compact pickers' exact frame inside the 47 pt row, and
the Android dialogs. The new frame scores need the next capture run before the floors ratchet.

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

The Feed row showed "Fee" on Android (CI run 43366825392 and run 43377482551, both with the native sheet and with the
first RN overlay). The row has no numberOfLines or width on the label, and Yoga's flexShrink already defaults to 0, so no
layout constraint explains it; `textBreakStrategy="simple"` (the first guess) did not change it on the next device run
(43402642037). Remaining cause, still a hypothesis until the next run: the sheet rendered before the bundled faces were
registered, so Android measured the content-sized label in a fallback face and drew the wider Archivo into that box; texts
that stretch to their parent (every other row) are not clipped. `BriefingOverMap` now renders the sheet only once
`useFonts(FontFiles)` reports loaded or failed, the same rule the strip and the log screen use, and the label and the count
keep `flexShrink: 0` (Swift's HStack: label, badge, Spacer, count).

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

## Review decisions (PR #64)

- Departure time in the Israel zone: a time pick on the departure's own Israel day IS the new departure, and a date pick on
  the same day changes nothing, so an instant inside the repeated hour (the end of Israel DST, 01:00 to 01:59 occurs twice)
  is kept; a wall time entered afresh that falls in the repeated hour takes the FIRST occurrence (`israelEpoch`); a wall time in
  the spring gap lands an hour later. Swift's `DatePicker` binds the instant, so the first rule is its behaviour.
- The Android dialogs no longer edit a mirror of the Israel wall clock as a device-local Date (that skipped or repeated an
  hour on the DEVICE's own DST change: Israel Mar 14 2027 02:30 showed as 03:30 on a New York device). The date dialog gets
  local noon of the Israel day and the time dialog a fixed Jan 15 2000 date with the Israel hour and minute; only the
  matching fields are read back (`israelDayMirror`, `israelTimeMirror`, `withDialogDay`, `withDialogTime`). The tests assert
  the anchors, which hold in every device zone (checked with TZ set to UTC, New York, Jerusalem and Kiritimati).
- TalkBack: `accessibilityViewIsModal` is iOS only, so while the Android briefing overlay is presented `BriefingOverMap` hides
  the map and strip behind it (`importantForAccessibility="no-hide-descendants"`) and restores them on dismiss.
