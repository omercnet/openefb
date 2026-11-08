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
- The DPR 2 row renders at 2x and downsamples to 1x, the way the reference was produced. Reported for context only;
  the DPR 1 numbers are the acceptance numbers.

| Screen | SSIM (full) | Differing px | SSIM (below status bar) | Differing px | SSIM DPR 2 downsampled (below status bar) |
| --- | --- | --- | --- | --- | --- |
| map (day) | 0.9606 | 1.82% | 0.9663 | 1.74% | 0.9730 |
| airport (KSQL) | 0.9161 | 3.69% | 0.9206 | 3.66% | 0.9179 |
| night | 0.9621 | 1.69% | 0.9677 | 1.61% | 0.9742 |

Side-by-side images (reference | ours | pixelmatch diff): `map-side-by-side.png`, `airport-side-by-side.png`,
`night-side-by-side.png`, and the `*-dpr2-side-by-side.png` variants.

Geometry check (ink bounding boxes of 30+ elements per screen, ours vs. reference): every element of the map and
night strips is within 1 px horizontally and 2 px vertically; the airport column is within 3 px (the drift is the
SF-set text, below).

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

## Notes for the native build

- Fonts load through `useFonts` keyed by the PostScript names DesignTokens uses (`ArchivoRoman-Medium`,
  `IBMPlexMono-SemiBold`, ...). Until they load the column shows bare paper, never text in a fallback face.
- Line heights are set explicitly to the fonts' natural values (Archivo 1.088 em, Plex Mono 1.3 em). Chromium rounds
  ascent and descent separately, so without this every Plex row was 0.5 pt short and the airport column drifted 10 pt
  by its bottom. On iOS the explicit value equals the natural one.
- Safe area: the iPad Pro 13-inch reference has a 32 pt status bar (not 24) and a 20 pt home indicator inset, measured
  from the screenshot. The strip uses `react-native-safe-area-context` insets and falls back to 32 / 20 only when the
  platform reports 0 (web).
- `minimumScaleFactor` has no RN web equivalent (`adjustsFontSizeToFit` is iOS-only); the NRST distance / bearing
  column computes the same shrink from Plex Mono's fixed 0.6 em advance (15 pt -> 13.3 pt in the 108 pt cell, as in
  the reference).
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

- No iOS or Android run (no simulator on this machine). Font registration by PostScript name, safe-area insets and
  SF fallback for system text are untested on device.
