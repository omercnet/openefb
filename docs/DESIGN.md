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
SF Pro system text styles; numeric readouts in SF Mono. (Phase 4 / HIG pass fills this in.)

## Tokens
(Phase 4 fills this in.)

## Components
| Component | Decision | Status |
|---|---|---|

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
| F9 | **The record control uses warning red at rest** (red mic, top-left) and gave no visible state change when tapped in the walkthrough. The pilot can't tell whether they are recording. (`08-recording.png`) | H1 status; H4 (red = warning); V | 3 | Neutral idle style; while recording, a clear "REC 00:12:34" pill. A permission-denied message that says how to fix it. Verify recording actually starts. | open (efb-77r.12) |
| F10 | Flight planning (J2) is buried under Flights → "Plans", and the segmented control defaults to History. | H6 recognition; E | 2 | Plan entry point on the map (route button) and Flights opening on Plans when there are no flights. Revisit in the cut review. | open (efb-77r.4) |
| F11 | Airport sheet: frequency type labels hyphenate ("AP-PROACH", "DEPAR-TURE"); the weather age badge is yellow text on yellow (low contrast); secondary text ("Asphalt") is too faint; the sheet is long, with charts, NOTAMs, PIREPs and winds below the fold. | H8 minimalist; contrast | 2 | Phase 4 (refactoring-ui): fixed label column, standard abbreviations (APP, DEP, GND, TWR), contrast ≥ 4.5:1, section order by flight-phase relevance. | open (efb-77r.4) |
| F12 | Staleness is shown four different ways (yellow/red WeatherBadge text, "STALE", winds "Current / Not current", layer "Data age"). Yellow and red are used for age, not for caution and warning. | H4 consistency | 2 | One freshness component used everywhere: neutral when fresh, amber "OLD" when past the product's useful life, never red unless unsafe. | open (efb-77r.5) |
| F13 | At 70% opacity the sectional overpowers our data layers: cyan airport dots and the ownship chevron get lost on yellow city tint. | H8; V | 2 | Ownship with a halo/outline; airport symbols with a contrasting outline; default sectional opacity reviewed in the night/day palettes. | open (efb-77r.4) |
| F14 | The beta banner takes the top strip until dismissed. | H8 | 1 | Move to Settings / About after first dismissal (it already persists); shorten the copy. | open (efb-77r.8) |
| F15 | Map controls are 44pt and the zoom halves are 40pt tall: below the in-flight target size. | H5 (slips in turbulence) | 3 | ≥ 60pt in-flight controls (HIG pass, efb-77r.3). | open (efb-77r.3) |
| F16 | No night mode: a white UI at night destroys dark adaptation. | H5; context | 3 | Night palette and dimmed map (HIG pass, efb-77r.3). | open (efb-77r.3) |
| F17 | "Map Style: VFR" mixes the base map and the sectional, and the opacity slider only affects the sectional, which isn't obvious. | H2 match; E | 2 | Separate "Base map" (Street / Satellite / Terrain) from a "Sectional" toggle with opacity. | open (efb-77r.4) |
| F18 | Instrument strip labels are 11pt `.caption2` and values `.title3`: small at arm's length on an iPad mini in a yoke mount. | H8; legibility | 2 | Larger values (≥ 28pt), labels ≥ 13pt, high-contrast background (Phase 4 / HIG). | open (efb-77r.4) |

Trunk Test (map screen): what app ✔ (tab bar), what screen ✔, options ✔. **Where am I** passes
only while ownship is on screen (F3). Search ✔. **Is my data current** fails (F5, F6).

## Microinteraction Inventory
| Interaction | Trigger/Rules/Feedback/Loops | Fix | Status |
|---|---|---|---|
