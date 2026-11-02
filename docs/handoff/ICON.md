# ICON: OpenEFB app icon (blocks the TestFlight upload; dashboard T30)

App Store Connect rejected build 76:
- ITMS 90023: missing required icon file (iPad 152x152 png);
- ITMS 90713: missing Info.plist value CFBundleIconName.

Cause: `efb-212/Assets.xcassets/AppIcon.appiconset/Contents.json` declares the iOS universal 1024 slots (default, dark,
tinted), but **there are no image files at all**. `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` is set. Once the
catalog has images, actool generates the iPad sizes and CFBundleIconName.

## Design
A simple, legible, original icon. Use the `refactoring-ui` and `ios-hig-design` skills in .claude/skills/. Read the
product: free, open-source iPad VFR moving map for pilots (README.md).
- **Concept:** a clean aircraft/ownship chevron (like the app's own ownship symbol) over a minimal moving-map motif: a
  compass ring or a subtle sectional-style airspace arc. No text, no Apple or FAA marks, and nothing copied from
  ForeFlight or other EFBs.
- **Palette:** sky or aviation blue with high contrast; it must read at 60 px on the home screen.
- **Variants:**
  - default: opaque, no transparency, no rounded corners (the system masks it);
  - dark: dark background, light glyph;
  - tinted: grayscale glyph on transparent, per the iOS 18+ tinted-icon guidance.
- **Production:** draw it as SVG or with CoreGraphics in a small Swift script, so it's reproducible. Keep the source in
  `tools/app-icon/` (SVG plus a render script) and render 1024x1024 PNGs with no alpha for default and dark. Check with
  `sips -g hasAlpha`.
- Put the PNGs in AppIcon.appiconset and reference them in Contents.json.

## Verify
- `tools/sim-test.sh build` succeeds. The built app's Info.plist has `CFBundleIconName = AppIcon` and CFBundleIcons;
  check `Assets.car` with `xcrun assetutil --info`.
- A Release archive (`xcodebuild archive -configuration Release -destination generic/platform=iOS
  CODE_SIGNING_ALLOWED=NO`) contains the iPad icon sizes, including 152x152 and 167x167.
- Screenshot the home screen in the simulator, light and dark, into docs/design/screenshots/ICON/. Also save a
  1024 preview.
- Run the full unit suite once.

Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim ICON)` and release it).
Don't commit or upload. Report the files changed and the archive check result.

Record progress on the Paseo dashboard as you work:
- cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Never end your turn on an intention.
