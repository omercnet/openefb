# UI fidelity: flight log strip and airport column (T02)

React Native port of the SwiftUI strip (`efb-212/Views/Log/FlightLogStrip.swift`, `FlightLogRows.swift`,
`FlightLogFooter.swift`, `AirportColumnView.swift`, `Core/DesignTokens.swift`) in `src/ui/`, compared with the iOS
reference screenshots through react-native-web.

## How it was measured

- `npx expo start --web --port 8099` (localhost), headless Chromium at 1032x1376 CSS px, DPR 1,
  `?screen=map|airport|night`, screenshot after `document.fonts` reports loaded.
- Left 400 px of ours vs. `reference/*.png` (the 2x iOS screenshots downscaled to 1x), with `compare.mjs`
  (ssim.js mean SSIM; pixelmatch at threshold 0.1, anti-aliased pixels counted).
- "Below status bar" drops the top 32 px: the iOS status bar text (time, date) is in the reference and is not
  something the app draws.

Web render after iOS round 2 (round 1 web numbers in parentheses):

| Screen | SSIM (full) | Differing px | SSIM (below status bar) | Differing px |
| --- | --- | --- | --- | --- |
| map (day) | 0.9755 (0.9606) | 1.42% | 0.9816 (0.9663) | 1.34% |
| airport (KSQL) | 0.9206 (0.9161) | 3.44% | 0.9252 (0.9206) | 3.41% |
| night | 0.9761 (0.9621) | 1.30% | 0.9821 (0.9677) | 1.21% |

Side-by-side images (reference | ours | pixelmatch diff): `map-side-by-side.png`, `airport-side-by-side.png`,
`night-side-by-side.png` (web, round 2) and `ios-round1-*-side-by-side.png` (the CI iOS 26.5 simulator screenshots
from round 1, downscaled to 1x, before the fixes below).

Geometry check (ink bounding boxes of 30+ elements per screen, ours vs. reference): on web every row of the map,
night and airport columns lands within 1 px of the reference vertically; the only horizontal differences are
SF-set text widths in the airport column (below).

## Remaining visible differences and their cause

- **iOS status bar** (time, date): present in the reference, not drawn by the app. Accounts for the
  full vs. below-status-bar gap.
- **Font rasterization**: iOS renders at 2x and the reference was downscaled; Chromium on Linux renders at 1x with
  its own hinting. Glyph edges differ by about 1 px everywhere, which is most of the remaining pixel diff on the map
  and night strips. Same faces, sizes and positions.
- **SF vs. fallback sans (airport column only)**: the SwiftUI airport column sets several texts in the system font
  (MVFR, the METAR age badge, the NOTAM hint, chart rows such as "AIRPORT DIAGRAM"). On iOS RN uses SF for these too;
  this Linux machine has no SF, so the web render uses Liberation Sans. This is why the airport SSIM is lower.
- **SF Symbols** (list, magnifier, layers, plus/minus, chevrons, arrows, airplane, fuel pump, key, warning triangle)
  are redrawn as react-native-svg paths sized from the screenshots. Close, not identical stroke shapes.
- **U+25B8 in "DIRECT > KOAK"**: no bundled face has the glyph (iOS falls back to a system face); it is drawn as an
  SVG triangle in the same 9 pt advance.
- **Clipped chart group at the bottom of the airport column**: the reference shows the top 1 px of a further chart
  group label under the footer; the fixture lists only the diagram and approaches, so ours ends there.
- **Night VS**: the night reference reads +473 fpm, the shared fixture +475.

## iOS round 2

CI ran round 1 in the iOS 26.5 simulator (iPad Pro 13-inch M5). Measured on those screenshots (downscaled to
1032x1376 with sharp, same as the reference): strip SSIM map 0.9447, night 0.9464, airport 0.6683. Per-element ink
boxes and horizontal-rule scans (`rules` / `boxes` measurements against `reference/*.png`) found these causes; every
change below is in `src/ui/` and addresses a measured delta.

| # | Measured on iOS round 1 | Cause | Change | Expected effect on iOS |
| --- | --- | --- | --- | --- |
| 1 | KOAK 15 pt too wide; GS / TRK / ALT readouts in normal-width Archivo, so TRK moved -13 pt and ALT -19 pt; KSQL title too wide | app.config embeds the fonts (UIAppFonts), so `useFonts` skipped the PostScript-named keys as already loaded and expo-font registered no alias. RN iOS then resolves `ArchivoRoman-CondensedSemiBold` to its family, and all six Archivo files share the typographic family "Archivo" (name ID 16). RN matches by weight only, so the three 600-weight faces (SemiBold, Condensed SemiBold, ExtraCondensed SemiBold) collapse into one. The 700 ExtraCondensed Bold "9:12" was unaffected | Fonts are keyed `Kanaf-<PostScript name>` (`tokens.ts` `FontFiles`). expo-font registers each alias against exactly one PostScript name (the duplicate-name registration is handled in `FontUtils.registerFont`), so RN's weight match has a single candidate | KOAK, KSQL and the readouts in their condensed faces. Horizontal readout positions back to the reference (0 / -13 / -19 pt deltas removed) |
| 2 | Every Plex Mono row 0.5 pt tall: weather rows pitch 28.0 vs 27.4, frequency rows 28.0 vs 27.6, NEXT row +0.5. Airport rules at +6 / +10 / +10 / +12 pt | `15 * 1.3 = 19.500000000000004` in floating point. RN iOS ceils each text height to the 0.5 pt pixel grid, so 19.5 became 20 | `lineHeight()` rounds every line height to the nearest 0.5 pt (Plex 15 = 19.5, Archivo 11 = 12, 13 = 14, 15 = 16.5, 42 = 45.5, 100 = 109, 34 = 37, 28 = 30.5; SF 15 = 18, 17 = 20.5, 13 = 15.5). No value is left for iOS to ceil | About -6.5 pt of the airport drift (13 Plex rows); NEXT / NOW rows back by 0.5 to 1 pt on the map and night strips |
| 3 | Footer GPS cell 120 pt and NRST 96 pt (SwiftUI 108 / 108); NRST distance / bearing shrunk to about 10 pt; GPS content +6 pt | Yoga on iOS gave the 120-capped flex cell its cap instead of an equal split; the NRST font size followed the narrower cell | GPS and NRST widths computed from the strip width: `min(120, (width - 3 * 60 - 4) / 2)` and the rest (108 / 108 at 400 pt). The NRST shrink uses that width, not `onLayout` | Footer cell boundaries at 109 / 217 as in the reference; NRST data at 13.3 pt |
| 4 | Direct button 75 pt tall vs 74 pt | borderedProminent padding estimated from the web render | `minHeight` 60 + 14 | -1 pt for everything below the button |
| 5 | Chips about 1.5 pt wider each (chip 3 ends 347 vs 344.5) | icon-to-text gap of Space.xs + 1 added on web in round 1 | Back to Space.xs (the SwiftUI value) | Chip edges within 0.5 pt |
| 6 | Airport header 1 to 1.5 pt taller (rule at 94.5 vs 93); "San Carlos Airport" +1 | The MVFR container's first child was the dot (a View without text), so Yoga used the dot's bottom edge as the container baseline | The dot is positioned out of flow; the container's baseline is the "MVFR" text baseline, as SwiftUI's `firstTextBaseline` aligns it | Header rule at 93.5 (SwiftUI 93.3) [INFERENCE: not measurable without an iOS run] |
| 7 | TAF row 1.2 pt short (rule 1 one pt high on web) | The SF caption triangle's frame is 15.2 pt, our SVG 14 pt | TAF row `minHeight` 4 + 15 | Rule 1 at 587 as in the reference |

Expected effect, by layout arithmetic: all line heights are now 0.5 pt multiples, so iOS should reproduce the web
layout, which is within 1 pt of the reference for every row on all three screens. I could not run iOS here, so the
targets (airport > 0.9, map and night > 0.96 on the simulator) are not verified. Residual iOS-only differences to
expect: SVG icons vs. SF Symbols, and RN-iOS vs. SwiftUI text rasterization.

## Notes for the native build

- Fonts load through `useFonts` under the `Kanaf-` aliases (see iOS round 2, #1). Until they load the column shows
  bare paper, never text in a fallback face. The same family collapse applies to any other screen that names an
  embedded Archivo 600-weight face by its PostScript name on iOS.
- Line heights are explicit and rounded to 0.5 pt (see iOS round 2, #2). Chromium rounds ascent and descent
  separately; RN iOS ceils text heights to the pixel grid.
- Safe area: the iPad Pro 13-inch reference has a 32 pt status bar (not 24) and a 20 pt home indicator inset, measured
  from the screenshot. The strip uses `react-native-safe-area-context` insets and falls back to 32 / 20 only when the
  platform reports 0 (web).
- `minimumScaleFactor` has no RN web equivalent (`adjustsFontSizeToFit` is iOS-only); the NRST distance / bearing
  column computes the same shrink from Plex Mono's fixed 0.6 em advance and the computed cell width (15 pt -> 13.3 pt
  in the 108 pt cell, as in the reference).
- Pressed state (PressableButtonStyle): verified on web with a mouse-down on Clear: opacity 0.55, scale 0.97,
  transition 0 s. Controls carry `accessibilityRole="button"` and the SwiftUI labels ("Flight log",
  "Search airports", "Stop recording", "Clear DIRECT KOAK", "Nearest airport KPAO, 2.0 nautical miles, bearing
  116 degrees", "Map layers", "Zoom in", "Zoom out", "Back to flight log", "Direct to KSQL", ...).

## What React Native could not match, or does differently

- No Dynamic Type: the SwiftUI roles scale with the user's text size (`relativeTo:`, capped sizes such as the
  120 pt next time); here sizes are fixed at the default (Large) values. RN's `allowFontScaling` scales all text
  uniformly and has no per-role caps, so a faithful port needs a small `UIFontMetrics`-style table.
- `ViewThatFits` (wrap ALT under GS / TRK at large type) and `minimumScaleFactor` have no direct equivalent and would
  need manual measurement.
- No SF Symbols on web or Android; on iOS a native symbol view (e.g. expo-symbols) would give exact glyphs but is not
  among the allowed dependencies for this spike.
- The Hebrew cascade (Archivo / Plex Mono -> IBM Plex Sans Hebrew) is not wired: RN has no per-font cascade list;
  Hebrew text would need its own `fontFamily`.
- Better in RN: one code path renders the strip on web for pixel diffs in CI without a Mac, which is how these numbers
  were produced.

## Not verified

- The round 2 changes have not run on iOS (no simulator here); the expected iOS effects above come from measurements
  and layout arithmetic. Android has not run at all.
