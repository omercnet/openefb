# Design System

## Design Direction
A cockpit instrument first, an app second. Anchor job: J1 in-flight awareness (docs/CUSTOMER.md).
The worst gap is trust, so every screen must answer "is what I see true right now?" before anything else.

Rules (the EFB lens):
- Glanceable in sunlight.
- In-flight controls ≥ 60pt, larger than the 44pt minimum (turbulence).
- Night palette that preserves dark adaptation.
- **Red = warning, amber = caution**, nothing else.
- Standard aviation abbreviations stay.
- Stale or unvalidated data is never shown as current.
- No decorative animation in flight.

## Typography
SF Pro system text styles (Dynamic Type); numeric readouts monospaced. Roles live in `Core/DesignTokens.swift` (`TypeRole`):

| Role | Style | Use |
|---|---|---|
| title | largeTitle rounded semibold | Airport identifier |
| sectionHeader | caption bold, uppercase text | FREQUENCIES, RUNWAYS, BASE MAP |
| label | footnote medium, secondary color | "Wind", "TWR": labels are quiet |
| value | title3 monospaced-digit semibold | Frequencies, runway idents |
| valueSmall | callout monospaced-digit medium | Decoded weather, runway size |
| body / caption | subheadline / footnote | Prose, validity lines |

Rule: value louder than label. Never `.tertiary` for text (below 4.5:1 on the material).

## Tokens
Defined in `efb-212/Core/DesignTokens.swift`.

| Token | Value | Use |
|---|---|---|
| `Space.xs/s/m/l/xl/xxl` | 4 / 8 / 12 / 16 / 24 / 32 pt | Between groups > within groups |
| `Palette.primaryText` / `secondaryText` | `.primary` / `.secondary` | All text |
| `Palette.caution` | `.orange` (amber) | Old data, expired cycle |
| `Palette.warning` | `.red` | Closures, urgent PIREPs, lost GPS |
| `Palette.fill` | secondary at 12% | Chips, quiet rows |

All are SwiftUI semantic colors, so the night-mode ticket can retheme in one place.

## Components
| Component | Decision | Status |
|---|---|---|
| SectionHeader | One uppercase section heading, used by the airport sheet and layer panel | done |
| Frequency row | 72pt label column, abbreviations (CTAF, UNICOM, ATIS, AWOS, ASOS, TWR, GND, CD, APP, DEP, CTR, FSS), value large | done |
| DataAgeBadge | One freshness badge for every dated product: neutral fresh, amber OLD/EXPIRED with a triangle glyph, red only when unsafe; thresholds in `## Freshness thresholds` | done |
| Layer panel | BASE MAP picker, SECTIONAL toggle + opacity, DATA LAYERS toggles, 300pt wide | done |
| Map symbols | Ownship: dark halo, fill, white edge. Airports/navaids: dark ring | done |
| Transcription panel | Sits in the map's bottom stack above the instrument strip, never over it | done |

## UX Audit Findings

Phase 2 (ux-heuristics) and Phase 3 (design-everyday-things) audit, 2026-10-31. Flows walked in the
simulator (iPad Pro 13", iOS 27.0, position KPAO): map → nearest list → search → airport sheet →
charts; track-up toggle; pan away; zoom out; record; layer panel. Screenshots are in
`docs/design/screenshots/audit/`. Severity 0-4 (4 = catastrophic). Heuristic numbers are Nielsen's
(H1 visibility of status … H10); Norman gulfs are E (execution) and V (evaluation).

| # | Issue | Heuristic | Severity | Fix | Status |
|---|---|---|---|---|---|
| F1 | **Nearest Airports lists heliports first.** From KPAO, #2 and #3 are hospital heliports ("Stanford Health Care East Heliport", "US-2776"); in LA the HUD showed "CL71 Hughes/Corporate Heliport". In an emergency the pilot is pointed at a helipad. (`05-nearest-list.png`) | H5 error prevention; V | 4 | Nearest = landable for a fixed-wing aircraft: exclude heliports and seaplane bases; require a runway (min length from the aircraft profile, default 1,500 ft). Show longest runway length and surface on each row. Flag private fields. | open (efb-77r.9) |
| F2 | **The emergency entry point is an 11pt capsule** in the bottom-right corner (~20pt tall), with no "Nearest" label. Hard to find and hit under stress. | H6 recognition; E | 4 | Persistent **NRST** button, ≥60pt, fixed position; the top entry shows ident, distance, bearing and runway. One tap opens the list; one tap on a row starts Direct-To. | open (efb-77r.9) |
| F3 | **The map doesn't follow the aircraft** and there's no recenter control. After a pan, ownship stays off-screen indefinitely. (`03-map-after-pan.png`) | H1 status; H3 control; V | 3 | Follow-ownship mode, on by default. Panning suspends it and shows a large "Recenter" button; recenter re-engages. Show the mode on screen. | open (efb-77r.10) |
| F4 | **Track-up shows a second ownship.** It switches MapLibre's user-tracking mode, which draws the system blue location puck instead of our chevron, and the puck stays after switching back. Two ownship symbols is a mode error. (`02-map-trackup.png`) | H4 consistency; V | 3 | Implement track-up by rotating the camera to GPS track and keep our chevron. Never enable the system user-location puck. North indicator visible when rotated. | open (efb-77r.10) |
| F5 | **No GPS / position-quality status.** When the fix is lost or degraded (Wi-Fi iPad, no altitude), the only signal is dashes and a small "No GPS" that overlaps the TRK label. Ownship doesn't show it's stale. | H1 status; V | 3 | GPS status chip: OK / Degraded (no altitude or poor accuracy) / Lost (age). Grey out ownship and instrument values when stale (> 5 s). | open (efb-77r.11) |
| F6 | **Nothing works offline, and nothing says so.** Base maps and sectionals are online-only; the pilot can't tell what will be there in the air. Chart cycle and database version aren't visible. | H1 status; V | 3 | Offline region downloads (efb-zfm.5), an "offline ready" indicator, and the chart cycle shown in the layer panel and Settings. | open (efb-zfm.5) |
| F7 | **The north-up / track-up button is ambiguous.** `location.north.fill` vs `location.north.line.fill` with no text; it sits above zoom, where pilots expect "recenter". | H6 recognition; E | 3 | Text button "N↑" / "TRK↑" showing the current mode; separate Recenter button (F3). | open (efb-77r.10) |
| F8 | Airport dots load only within ~6 NM of the map centre at zoom 10 (radius = 200/2^(z-5) NM). The screen edges are empty, and airports pop in only after panning. | H1 status | 2 | Size the query radius from the visible map bounds. Thin small private fields at low zoom instead of clipping the radius. | open (efb-77r.4) |
| F9 | **The record control uses warning red at rest** (red mic, top-left) and gave no visible state change when tapped in the walkthrough. The pilot can't tell whether they are recording. (`08-recording.png`) | H1 status; H4 (red = warning); V | 3 | Neutral idle style; while recording, a clear "REC 00:12:34" pill. A permission-denied message that says how to fix it. Verify recording actually starts. | fixed (efb-77r.12): neutral idle button, REC pill with elapsed time and level meter, microphone-denied notice with Open Settings, failure notices; start/stop verified in the simulator |
| F10 | Flight planning (J2) is buried under Flights → "Plans", and the segmented control defaults to History. | H6 recognition; E | 2 | Plan entry point on the map (route button) and Flights opening on Plans when there are no flights. Revisit in the cut review. | fixed (efb-77r.4): "Plan a flight" button under search opens Flights on Plans; Flights opens on Plans when there is no history |
| F11 | Airport sheet: frequency type labels hyphenate ("AP-PROACH", "DEPAR-TURE"); the weather age badge is yellow text on yellow (low contrast); secondary text ("Asphalt") is too faint; the sheet is long, with charts, NOTAMs, PIREPs and winds below the fold. | H8 minimalist; contrast | 2 | Phase 4 (refactoring-ui): fixed label column, standard abbreviations (APP, DEP, GND, TWR), contrast ≥ 4.5:1, section order by flight-phase relevance. | fixed (efb-77r.4): 72pt label column with abbreviations, values emphasized, `.tertiary` text removed, badge text is primary on a tint, order is identity, weather + frequencies, runways, NOTAMs, charts, PIREPs, winds; opens at 62% |
| F12 | Staleness is shown four different ways (yellow/red WeatherBadge text, "STALE", winds "Current / Not current", layer "Data age"). Yellow and red are used for age, not for caution and warning. | H4 consistency | 2 | One freshness component used everywhere: neutral when fresh, amber "OLD" when past the product's useful life, never red unless unsafe. | fixed (efb-77r.5): `DataAgeBadge` + `DataFreshness`, per-product thresholds in `## Freshness thresholds`; WeatherBadge and ChartExpirationBadge deleted |
| F13 | At 70% opacity the sectional overpowers our data layers: cyan airport dots and the ownship chevron get lost on yellow city tint. | H8; V | 2 | Ownship with a halo/outline; airport symbols with a contrasting outline; default sectional opacity reviewed in the night/day palettes. | fixed (efb-77r.4): ownship has a dark halo + white edge, airport/navaid dots a dark ring. Opacity default review stays with the night-palette ticket |
| F14 | The beta banner takes the top strip until dismissed. | H8 | 1 | Move to Settings / About after first dismissal (it already persists); shorten the copy. | fixed (efb-77r.8): one-line banner with a 44pt dismiss, the same line permanently in Settings > About |
| F15 | Map controls are 44pt and the zoom halves are 40pt tall: below the in-flight target size. | H5 (slips in turbulence) | 3 | ≥ 60pt in-flight controls (HIG pass, efb-77r.3). | fixed (efb-77r.3): every map control 60pt (`MapControlMetrics.size`); other tappables ≥ 44pt |
| F16 | No night mode: a white UI at night destroys dark adaptation. | H5; context | 3 | Night palette and dimmed map (HIG pass, efb-77r.3). | fixed (efb-77r.3): Day / Night / Auto (sun elevation < -6°), 60pt map toggle, Settings picker, dimmed raster + muted dots, night accent tokens |
| F17 | "Map Style: VFR" mixes the base map and the sectional, and the opacity slider only affects the sectional, which isn't obvious. | H2 match; E | 2 | Separate "Base map" (Street / Satellite / Terrain) from a "Sectional" toggle with opacity. | fixed (efb-77r.4): layer panel has BASE MAP and SECTIONAL groups; the sectional is an overlay on any base (`visibleLayers.contains(.sectional)`), opacity shows only while it is on |
| F18 | Instrument strip labels are 11pt `.caption2` and values `.title3`: small at arm's length on an iPad mini in a yoke mount. | H8; legibility | 2 | Larger values (≥ 28pt), labels ≥ 13pt, high-contrast background (Phase 4 / HIG). | fixed (efb-77r.3): 28pt values, 13pt labels via `@ScaledMetric`; stale values grey and announced, not faded |

Trunk Test (map screen): what app ✔ (tab bar), what screen ✔, options ✔. **Where am I** passes
only while ownship is on screen (F3). Search ✔. **Is my data current** fails (F5, F6).

## Microinteraction Inventory
| Interaction | Trigger/Rules/Feedback/Loops | Fix | Status |
|---|---|---|---|
| Freshness badge (`DataAgeBadge`) | Trigger: none (passive, glanceable). Rules: `DataFreshness.evaluate` per product (see Freshness thresholds); neutral fresh, amber OLD/EXPIRED, red only for unsafe. Feedback: text + triangle glyph when not fresh (never colour alone). Loops: re-evaluates on every redraw; layer rows tick with the 1 s map clock | F12: replaced WeatherBadge, winds "Current/Not current", layer "Data age" rows, ChartExpirationBadge | fixed |
| Record button | Trigger: 60pt circle top-left. Rules: idle → start (asks for microphone once); recording → confirm → stop; countdown → cancel. Feedback: neutral idle glyph, accent stop square while recording, success haptic on start/stop, warning haptic on failure. Loops: auto-start countdown unchanged | F9: red mic at rest removed; pressed state added | fixed |
| REC pill | Rules: shown only while recording. Feedback: "REC 00:12:34", flight phase, 5-segment input level meter (no pulse animation). Mode: visible, it is the only recording-state indicator | F9: replaces red pulsing dot + bare timer | fixed |
| Microphone denied | Rules: checked on start and every sync tick while recording (covers auto-start, Settings change). Feedback: amber "Microphone is off" notice with "Open Settings"; GPS track keeps recording | F9: previously silent (no audio, no message) | fixed |
| Recording failure | Rules: start failure or mid-flight audio failure sets `lastError`. Feedback: amber dismissible notice; "Recording unavailable" chip when the recording database cannot open (previously the button silently vanished) | F9 | fixed |
| Async states (airport weather, PIREPs, winds aloft, NOTAMs, charts, TFR / AIRMET layers, offline downloads) | loading spinner → loaded / empty sentence → error (amber, says what failed) with a 44pt Retry; stale is the freshness badge on loaded data. Weather shows cached data with its OLD/EXPIRED badge when a refresh fails | Red error text removed (red = warning); Retry added where it was missing (PIREPs, winds, weather, layers, failed offline packs) | fixed |
| Layer / orientation / night toggles | Trigger: switch or 60pt button. Feedback: light impact haptic, instant state change. No loop | Haptic added | fixed |
| Proximity / TFR alert haptic | Rules: one warning haptic when an alert id first appears; an alert that stays active never repeats. (No alert banner exists yet; tracked separately) | Haptic added | fixed |
| Pressed states | Every custom button (map controls, NRST, search rows, expand rows, record) uses `PressableButtonStyle`: dim to 55% and scale 0.97, instant, no animation | Added | fixed |
| Map animation | Pulsing record ring and dot removed; the map camera only animates for user-initiated zoom / recenter | Removed | fixed |

## Freshness thresholds
Implemented in `Core/DataFreshness.swift` (`DataProduct`), tested in `DataFreshnessTests`. Age is time since observation (METAR, PIREP) or since fetch (NOTAM, TFR, AIRMET/SIGMET); window products use their validity end.

| Product | Fresh (neutral) | OLD (amber) | EXPIRED | Red (unsafe) |
|---|---|---|---|---|
| METAR | < 75 min | 75 min – 3 h | ≥ 3 h | never |
| TAF | inside valid period | n/a | past valid period | never |
| PIREP | < 60 min | 60 – 120 min | ≥ 2 h (the query window) | never |
| Winds aloft | inside FOR USE window ("NOT YET VALID" before it) | n/a | past FOR USE end | never |
| TFR layer | < 30 min since fetch | 30 min – 2 h | none | ≥ 2 h: TFR data too old to avoid |
| AIRMET/SIGMET layer | < 30 min since fetch | 30 min – 2 h | ≥ 2 h | never |
| NOTAM | < 60 min since fetch | 60 min – 6 h | ≥ 6 h | never |
| Chart cycle (56-day sectional, offline packs) | > 7 days left | ≤ 7 days left ("EXPIRES 3d") | past cycle end | never (amber, per `Palette.caution`) |

A missing timestamp reads "N/A" in neutral, never "current". A future timestamp (clock skew) reads "<1 min".

## HIG pass (efb-77r.3, ticket T10)
Skill: `ios-hig-design`, through the EFB lens. Screenshots: `docs/design/screenshots/T10/` (`b-day-chrome`, `b-night-chrome`, `b-ax5-airport-sheet`, `b-ax5-night-nearest`, `b-ax5-map`).

### Night palette
Night = the dark colour scheme set by `DisplayModeModifier` (Day / Night / Auto). Tokens in `Palette` (`Core/DesignTokens.swift`) swap by scheme:

| Token | Day | Night | Contrast |
|---|---|---|---|
| `accent` (NRST label, Direct, Recenter, Play, REC stop, Save, onboarding button) | systemBlue | #2E4A6E | with `onAccent`: day 4.6:1, night 5.4:1 |
| `onAccent` | white | grey 85% | see above |
| `accentText` (info glyphs, selected check, REC label) | systemBlue | #8FB4E0 | night ≥ 9:1 on black |
| `infoFill` (beta banner, active transcript row) | blue 15% | #2E4A6E 35% | text stays `primaryText` |
| Map airport dot | systemCyan | `NightPalette.airportDot` #388D9E | dark ring kept |
| Map navaid dot | systemPurple | `NightPalette.navaidDot` #735299 | dark ring kept |

Red (`warning`) and amber (`caution`) are unchanged in both palettes (GPS LOST stays red). Contrast ratios are computed from the sRGB values (WCAG relative luminance), not measured on a device with Increase Contrast.

### Dynamic Type
- Sheets, lists and forms use semantic styles only and scale to AX5 (`accessibility-XXXL`). Rows with side-by-side critical data (airport frequencies, runways, weather, nearest rows, logbook/aircraft fields, transcript rows, offline packs) switch to a vertical layout at accessibility sizes (`dynamicTypeSize.isAccessibilitySize`).
- Map chrome (`MapContainerView` overlay layer, NRST, Recenter) is capped at `.xxxLarge` so it never covers the map; instrument readouts use `@ScaledMetric` (28pt value, 13pt label).

### Baseline counts (efb-212/Views unless noted)
| Measure | Before (2026-10-31) | After |
|---|---|---|
| `.caption2` | 52 | 0 |
| `.tertiary` text | not counted | 2 (decorative, VoiceOver-hidden empty-state glyphs) |
| `.system(size:)` | 5 (baseline) / 29 (full grep) | 8, all `@ScaledMetric` (instrument readouts, hero icons) |
| `accessibilityLabel` | 19 | 77 |
| haptic call sites (Views, Core, Services) | 0 | 11 |
| frames < 44pt | 4 | 8, none interactive (tick marks, status dots, stop glyph, level meter, bullet column) |
| bare `.blue` | not counted | 0 |

### ios-hig-design score
Before: 4/10 (Quick Diagnostic: safe areas ✔, nav ✔; touch targets, Dark Mode, Dynamic Type, VoiceOver ✘; +1 system controls, +1 SF Symbols; no semantic colours, no haptics).
After: 9/10 (all six diagnostic rows ✔, +1 semantic colours/text styles, +1 system controls, +1 haptics, +1 SF Symbols).
To reach 10/10: a real-device VoiceOver walkthrough of every flow and an Increase Contrast check (only the accessibility hierarchy and simulator screenshots were verified); remaining data-layer toggle tints (cyan, orange, red, purple, green, teal) are layer identity colours, not checked against 4.5:1; NOTAM closure chip red-on-light-red may sit under 4.5:1 in day.

## Back-of-the-fence audit (T14)
Final cut review, 2026-11-01, iPad Pro 13-inch simulator. Screenshots: `docs/design/screenshots/T14/` (prefix A = cold walk, B = flight and recording, C = replay). Rests on documented assumptions; no pilot has used a build. Beads under epic efb-77r (efb-77r.17 to .34).

| Surface | Finding | Fix / status |
|---|---|---|
| First run (A01) | Four swipe-only pages; no Next button; page dots white on white, so invisible. Five interactions to the map | One page, one button. Done (efb-77r.17) |
| Location prompt (first Map appear) | Prompt text is fine, but a denied pilot sees only "GPS LOST / waiting for GPS"; no cause, no Open Settings (mic-denied has both) | Open (efb-77r.27) |
| Map without a fix (B cold shots) | A live blue ownship arrow sat at 39N 98W (Kansas) | Done (efb-77r.24) |
| TFR layer | Off by default, so proximity alerts never ran | On by default. Done (efb-77r.25) |
| Empty states | Logbook ("No entries yet", A11), Aircraft ("No aircraft profiles yet", A12), Plans ("No saved plans", A10), Flight History, Offline Maps ("Nothing downloaded yet. Without a region, the map needs the internet.", A16): all say what to do next | Pass |
| Errors | Weather, PIREP, winds, NOTAM, TFR, charts show amber text with Retry. A 0-point recording shows a "Recording not saved" notice | Done (efb-77r.31) |
| Settings (A13) | Version, Build, a second beta line, feedback with TestFlight hint, display mode, cycles, NOTAM key, disclaimers, license, source. Honest and complete | Beta line duplicates the banner; banner is on all 5 tabs (efb-77r.18) |
| Disclaimers (A15) | All five PRD texts verbatim, reachable in 2 taps; the first is on the first-run screen | Pass |
| About | Version and build only; no data-cycle summary beyond Charts | Acceptable |
| Usage strings | Location (when in use, always), microphone and speech are present in `Info.plist` and `project.pbxproj` | Pass |
| Flight detail (C01) | Generate Debrief offered on a 48 s flight with 0 transcript segments; duration "0h 0m" | Debrief gating done (efb-77r.31); duration open (efb-77r.33) |
| Logbook badge | Red badge for an unconfirmed draft; red is for warnings only | Open (efb-77r.32) |
| Recording (B05, B07) | After End Recording at speed the auto-start countdown re-arms ("2"); phase reads Taxi at 97 kt when altitude is missing | Open (efb-77r.29, .30) |
| Direct-To | No way to clear it once set | Open (efb-77r.28) |
| Replay (C03, C05) | Transcript panel opened expanded and empty over the readouts | Collapsed unless the flight has segments; readouts scoped to the map. Done (efb-pva) |

### Quick Diagnostic (steve-jobs-design-review)
Before T14: 2/7 = 3/10. After: 4/7 = 6/10. Verdict NOT DONE. Full table in `docs/PRODUCT.md` under `## Outcome Roadmap`.

### T23: accessibility and touch targets (efb-77r.14)
- **In-flight hit targets** measured by XCUITest (pt): Clear 74x60, NRST 282x64, layers/zoom in/zoom out/north-up/night/REC/search/plan 60x60. Raised to 60: Clear (bar is now 60 tall, was 52), Plan a flight (was 44), GPS and microphone "Open Settings", recording Dismiss buttons, currency-warning dismiss. "End Recording" is a system confirmation-dialog button.
- **Labels:** every icon-only Button in Views already had one. Added "Dismiss recording problem" and "Dismiss recording not saved notice"; the offline wifi glyph is now hidden from VoiceOver.
- **Contrast** (WCAG, against the light #F2F2F7 / dark #1C1C1E panel). Failing before: day toggle tracks cyan 2.3, orange 2.0, green 2.0, teal 2.3, red 3.2, purple 3.7 (need 3:1); NOTAM closure chip text red on red tint 2.2 day, 3.4 night (need 4.5); amber text 2.0 day; white on amber offline pill 2.2. Fixed with `Palette.layer*`, `Palette.warning`, `Palette.caution`, `Palette.onWarning`: day tracks 4.2-5.2, night keeps system tints; closure chip is solid red with white (day 6.1) or black (night 6.2) text; amber text 4.9 day; offline pill black on amber 9:1. Night `accent` as a toggle track is 1.9, so the sectional toggle uses `layerSectional` (3.8).
- **Left:** real-device VoiceOver pass (efb-77r.14 item 4) needs hardware. REC pill phase text ("Preflight") is caption secondary on thin material over the map at night: legible in the screenshot, not measured.
- Screenshots: `docs/design/screenshots/T23/`.

### T25: the 60pt rule needs the frame inside the Button label (efb-uil)
- **Rule:** to make a button's hit area ≥ 60pt, put `.frame(minWidth:minHeight: MapControlMetrics.size)` on the *label* (`Button { … } label: { Text("…").frame(…) }`). A `.frame(minHeight:)` applied to the `Button` itself only reserves layout space; the tappable bordered capsule stays at its natural size. Measure the `Button`'s XCUITest `frame`, never the surrounding container.
- **T23's claim was wrong** for three buttons. Measured before (XCUITest `frame`, pt, iPad): microphone "Open Settings" 149.0x50.5, GPS "Open Settings" 149.0x50.5, recording-not-saved "Dismiss" 99.5x50.5. Fixed in `RecordingOverlayView.swift` and `GPSFailureNotice.swift`; after: 149.0x90.0, 149.0x90.0, 100.0x90.0. The `.bordered` / `.controlSize(.large)` chrome adds about 30pt to the 60pt label, the same as T24's error-notice "Dismiss", so the pills are taller than the minimum.
- **Sweep of in-flight Map overlays**, unchanged and already ≥ 60pt (measured): Direct-To Clear 74.0x60.0, NRST HUD 282.0x64.0, NRST list "Direct" 125.0x74.0. The currency-warning dismiss already has its frame and `contentShape` inside the label (not measured: needs an expired-currency profile). Record, zoom, layer, orientation and night buttons are 60pt circles from T23.
- **Not swept:** non-overlay sheet buttons ("Retry", "Done") stay at 44pt (async-state rule above).
