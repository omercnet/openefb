# Native checks (T03)

Native half of the React Native spike: the MapLibre map, the capability self test, the native bottom sheet, the
Expo config and the CI workflow (`.github/workflows/rn-spike.yml`). This machine is Linux with no Xcode, Android SDK
or KVM, so no native build or run happened here. Everything marked "untested until CI" has only been
type-checked or statically inspected.

## What was verified here

| Check | How | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | passes |
| Expo config | `npx expo prebuild --no-install --clean` (both platforms) | succeeds; outputs below |
| Shell scripts | `shellcheck scripts/*.sh` (0.11.0) | clean |
| Workflow | `actionlint .github/workflows/rn-spike.yml` | clean |
| Comparison script | `node scripts/compare.mjs reference/ipad-map-day.png reference/ipad-map-day.png` | SSIM 1, diff share 0 (strip and frame); night vs day reference gives SSIM 0.03 strip / 0.32 frame, so it discriminates |
| Self-test SQL | the exact SQL strings from `src/native/SelfTestScreen.tsx` and `src/map/aviationDb.ts` run with Python's sqlite3 (3.46.1) against `assets/aviation.sqlite` | Bay R-tree count 31; FTS5 `"san"* "carlos"*` -> KSQL first (then P13); KSQL runway `12/30` 2621 x 75 ft asphalt; map bbox around the scenario -> KHAF KSFO KSQL KOAK KHWD KPAO KSJC |
| R-tree finding | compiled expo-sqlite's vendored `sqlite3.c` (3.53.3) with gcc, once with the stock flags from `ExpoSQLite.podspec` / `android/build.gradle`, once adding `-DSQLITE_ENABLE_RTREE=1`, and ran the queries | stock: `ENABLE_FTS5` only, R-tree query fails with `no such module: rtree`, FTS5 works; with the flag: `ENABLE_FTS5 ENABLE_RTREE`, count 31 |
| Minimal PDF | the generator in `SelfTestScreen.tsx` run under Node; xref offsets, `startxref` and stream `/Length` checked byte-exactly | consistent (578 bytes, 5 objects); no PDF renderer was available here |
| Web bundle | fetched the running web dev server's bundle | builds; contains the sheet screen, no expo-sqlite or react-native-pdf (SelfTestScreen.web.tsx and MapSurface.web.tsx are placeholders) |

## Prebuild findings

- **expo-sqlite has no R-tree by default** (confirmed above). `['expo-sqlite', { customBuildFlags: '-DSQLITE_ENABLE_RTREE=1' }]`
  lands in `ios/Podfile.properties.json` and `android/gradle.properties` (`expo.sqlite.customBuildFlags`). On Android, setting any
  `expo.sqlite.*` property also turns off the prebuilt AAR (`android/shouldUsePublication.groovy`), so SQLite builds from source
  with the flag. On iOS, `EXPO_USE_PRECOMPILED_MODULES` is `true` by default in SDK 58, but expo-sqlite ships no prebuilt
  xcframework (only expo-modules-core, expo-modules-jsi, expo-font and expo-file-system do), so ExpoSQLite compiles from source
  and the flag applies. If a later expo-sqlite ships a prebuilt, add it to `expo.autolinking.buildFromSource` or the flag is
  silently ignored. The self test reports `rtree` from `PRAGMA compile_options` to catch exactly that.
- **Info.plist** (`ios/KanafRNSpike/Info.plist`): `UIBackgroundModes = [location, audio]`, the same as the SwiftUI app.
  expo-task-manager adds `fetch`; a small `withInfoPlist` mod in `app.config.ts` resets the list. Usage strings:
  `NSLocationWhenInUse/AlwaysAndWhenInUse/Always` (Kanaf wording), `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription` copied from the root Info.plist. `NSMotionUsageDescription` and the full-accuracy
  dictionary are switched off (the SwiftUI app has neither). `UIAppFonts` lists the 12 bundled fonts like the SwiftUI app.
  expo-dev-client still adds `NSBonjourServices` / `NSLocalNetworkUsageDescription`; `expo-dev-client` is a parent-owned
  dependency and harmless for a spike. Deployment target 16.4 (`IPHONEOS_DEPLOYMENT_TARGET` and the Podfile platform):
  above MapLibre's 15.5 and equal to what Expo SDK 58 modules require.
- **AndroidManifest** (`android/app/src/main/AndroidManifest.xml`): `ACCESS_FINE/COARSE/BACKGROUND_LOCATION`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` (expo-location), `RECORD_AUDIO`, `FOREGROUND_SERVICE_MICROPHONE`
  (added in app.config.ts; expo-audio's plugin does not add it), `POST_NOTIFICATIONS`, the expo-audio
  `AudioRecordingService` (`foregroundServiceType="microphone"`), the `kanaf-rn` scheme, and the speech-service `<queries>`.
  Background playback is off, so no media-playback service. `targetSdkVersion=36`; compileSdk stays at the RN 0.88 default
  of 37 (the task allowed 35 or 36, but going below the React Native default risks AAR metadata failures; not tested);
  minSdk is the default 24. Fonts are copied to `android/app/src/main/assets/fonts`.
- `userInterfaceStyle: 'automatic'` needs `expo-system-ui` on Android (prebuild warning); not installed (parent-owned
  package.json). No splash config: SDK 58 moved it to `expo-splash-screen`, which is not installed. The icon is
  `assets/splash-icon.png` (there is no `assets/icon.png`).
- `expo prebuild` rewrites the `android` / `ios` scripts in package.json to `expo run:*`. They were restored after each local run;
  in CI it does not matter.

## The map (`src/map/MapSurface.tsx`)

MapLibre React Native v11 (`Map`, `Camera`, `GeoJSONSource`, `Layer`, `Images`) with `assets/base-style.json` as the style
object, camera from `scenario.map`. Layers added on top of the base style in MapService order: airport circles,
track-ruler line, track-ruler ticks (SDF tick icon rotated to track, labels `1 min`, `2`, `3`, `5`, Noto Sans from the style's
glyph server, anchor rule from `rulerLabelAnchor`), ownship chevron (the same 32 pt path and strokes as
`createOwnshipChevron`, rendered to PNG at 1x/2x/3x in `src/map/icons`). Airport dots come from `aviation.sqlite` with the
app's R-tree bbox query on every `onRegionDidChange` (and once after load), imported from the bundled asset on first use
(`importDatabaseFromAssetAsync`, kept afterwards). The dots are green with a white ring to match the reference screenshots.
Night: the sectional raster gets `raster-brightness-max 0.55` and `raster-saturation -0.35` (NightPalette) and the ruler
switches to the night ink and halo.

`kanaf-rn://map?animate=1` moves the ownship along its track at 10 Hz (96 kt) for 60 s, then logs
`SPIKE_ANIM {...}` and writes `spike-anim.json` with requestAnimationFrame deltas and 10 Hz timer deltas (n, p50, p95,
max in ms). The self test embeds that file as `animation`.

Untested until CI: everything visual (tiles render, icon scale, label placement, layer order relative to the sectional,
night look), whether `onRegionDidChange` fires on the first camera set (the load-time `getBounds` covers it), and frame
pacing numbers.

## The self test (`src/native/SelfTestScreen.tsx`, `kanaf-rn://selftest`)

Runs in order, each wrapped in try/catch and a 45 s timeout, shows PASS/FAIL in large type, then writes
`<documents>/spike-result.json` and logs one `SPIKE_RESULT {...}` line.

| Check | What it does | PASS when |
| --- | --- | --- |
| sqlite | import + open `aviation.sqlite` (ms), `sqlite_version()`, `PRAGMA compile_options`, R-tree count over the Bay (37.2-38.0 N, 122.6-121.8 W) with ms, FTS5 `"san"* "carlos"*` with ms, KSQL runway join | RTREE and FTS5 compiled in, count > 0, FTS first hit KSQL, runway 12/30 found |
| location | foreground permission, `watchPositionAsync` for 5 s counting fixes, background permission, `startLocationUpdatesAsync` with a foreground-service notification and a module-scope TaskManager task for 3 s, `hasStartedLocationUpdatesAsync` | foreground granted, at least one fix, updates started |
| audio | microphone permission, `setAudioModeAsync({ allowsRecording })`, record 2 s with `useAudioRecorder(HIGH_QUALITY)` | recorded file size > 0 |
| secureStore | set / get / delete a random value | round trip equal |
| pdf | renders a 1-page PDF generated in code (data URI, no network) with react-native-pdf | `onLoadComplete` with 1 page within 20 s |
| speech | `isRecognitionAvailable`, `supportsOnDeviceRecognition`, `supportsRecording`, permission status (no prompt), supported locales, Android recognition services | the module answers (flags are reported, not judged) |

Untested until CI: all of it at runtime. Known risks: the simulator and emulator have no real microphone (the Android
emulator runs without `-noaudio`, but a headless runner may still give silence or fail); the iOS simulator's speech
recognizer may report unavailable; Android logcat truncates lines near 4 KB, so the script checks the JSON parses
(release builds are not debuggable, so `run-as` to read the file usually fails).

## The sheet (`src/native/SheetScreen.tsx`, `kanaf-rn://sheet`)

`@expo/ui`'s universal `BottomSheet` covers both platforms, so no react-native-screens fallback was needed: on iOS it is
a SwiftUI `.sheet` with `medium`/`large` detents (system Liquid Glass chrome on iOS 26), on Android a Material 3
`ModalBottomSheet`. The content is native SwiftUI / Compose text (`Column`, `Row`, `Text`, `Spacer`) showing the KSQL summary
from `scenario.airport` (category, elevation and TPA, weather, runway, frequencies) in Archivo and IBM Plex Mono (PostScript
names on iOS, asset file names on Android). Untested until CI: the look, font resolution on both platforms.

## CI (`.github/workflows/rn-spike.yml`)

Triggers on pushes to `spike/react-native` touching `spikes/kanaf-rn/**` or the workflow, and on `workflow_dispatch`.

- **ios** (macos-26, Xcode 26.6 as in ci.yml): node 24, `npm ci`, `expo prebuild -p ios`, `pod install`, `xcodebuild` Release for
  `iphonesimulator` into `/tmp/rn-dd`, then `scripts/ios-capture.sh`: creates/boots an `iPad Pro 13-inch (M5)` on the newest iOS
  runtime (selection as in `tools/sim-test.sh`), installs, grants location, location-always and microphone, sets the location to
  37.4876,-122.2289, then starts each of map, airport, night, sheet with `simctl launch --terminate-running-process ...
  -KanafScreen <screen>`, waits for the map's fully-rendered status (45 s cap) and screenshots it, runs `-KanafAnimate 1` for
  70 s, then the self test (re-sending the simulator location every second), polling `Documents/spike-result.json` in the data
  container for up to 120 s. The app log and result files are collected even when the script fails.
- **android** (ubuntu-latest): node 24, JDK 21 (temurin), `npm ci`, `expo prebuild -p android`, `./gradlew assembleRelease`
  (the Expo template signs release with the debug keystore), KVM udev rule, then `reactivecircus/android-emulator-runner@v2`
  (API 35, google_apis, x86_64, `pixel_tablet`) running `scripts/android-capture.sh`: install, `pm grant` location,
  background location, RECORD_AUDIO and POST_NOTIFICATIONS, `adb emu geo fix`, the same screens via
  `am start -a VIEW -d kanaf-rn://...` with portrait re-asserted and checked before each `screencap`, waiting for the map's
  `SPIKE_MAP` fully-rendered line, the animation, then the self test from logcat (`SPIKE_RESULT`) with `geo fix` re-sent every
  second.
- Both jobs then run `scripts/compare.mjs --dir <screens>` (map, night, airport against the references; sheet and selftest have
  none) and upload screens, results, compare output and the build log tail as `rn-spike-ios` / `rn-spike-android`.

Run 1 (see "CI run 1 and fixes" below) built both platforms. Remaining risks: the Android symbol layers (below) and the
speech recognizer on the simulator.

## CI run 1 and fixes

Android ran end to end: sqlite PASS (`rtree` and `fts5` true, 31 Bay airports, KSQL first), audio PASS (26 KB m4a),
secureStore PASS, pdf PASS, speech available (on-device true, 31 locales); location FAIL with 0 updates. Animation on the
emulator: rAF p50 16.7 / p95 33 / max 623 ms, 10 Hz timer p50 117 / p95 140 / max 650 ms. iOS built but captured nothing.

- **`simctl openurl` cannot drive a headless iOS run.** Opening a custom-scheme URL shows a system "Open in Kanaf RN
  Spike?" alert that nothing in CI can accept, so the app never launched and every iPad screenshot was the home screen.
  iOS now uses launch arguments like the SwiftUI app's capture hooks: `simctl launch --terminate-running-process <sim>
  io.omer.efb.rnspike -KanafScreen map [-KanafAnimate 1]`. Launch arguments land in NSUserDefaults' argument domain, which
  React Native's `Settings.get` reads (App.tsx for the screen, MapSurface for the animation). Android and web keep URLs.
  Results are read from `get_app_container ... data`/Documents, which is where expo-file-system's `Paths.document` points.
- **No sectional chart: the base style hides it.** `assets/base-style.json` ships `base-vfr-sectional` with
  `layout.visibility: none`; the SwiftUI app turns it on at runtime (`MapService.setMapStyle(_:sectional:)` sets
  `isVisible = sectional`). The RN map used the style verbatim, so the raster was never drawn. Nothing was wrong with the
  tile source (the ArcGIS URL returns 200 with `application/octet-stream` for curl, okhttp and MapLibre user agents alike).
  `styleFor` now sets the layer visible (and still dims it at night). Untested until the next run.
- **Map status.** MapSurface logs `SPIKE_MAP {...}` and writes `map-status.json` at the first `willStartLoadingMap`,
  `didFinishLoadingStyle`, `didFinishLoadingMap`, `didFailLoadingMap`, `didFinishRenderingMapFully` and a 40 s snapshot,
  with up to 12 MapLibre native warnings/errors from `LogManager` (tile, glyph and sprite failures show up there). The
  scripts wait for `fullyRendered` or `failed` (45 s cap), print the status and keep `map-status-<screen>.json` (plus
  `logcat-<screen>.txt` on Android). The animation result carries the same status.
- **Android symbol layers missing (open).** In run 1 the ruler line and airport circles drew, but no symbol layer did:
  no ownship chevron, no ruler ticks or labels, no base-style place labels. Icon-only (ownship) and text-only (place labels)
  symbols both missing points away from glyphs or the `Images` component alone; a SwiftShader rendering problem or a
  capture before symbol placement are candidates. Not diagnosed: run 1 cleared logcat before the self test, so no map logs
  survived. The new native log capture and render wait should settle it.
- **Screen orientation.** All run-1 Android screenshots were already 1600x2560 portrait: the Pixel Tablet is
  landscape-natural, so portrait is user rotation 1 (rotation 0 would be landscape). The script now re-asserts rotation 1
  before every launch and prints and checks each screenshot's size.
- **Location 0 updates on Android.** The emulator emits a fix only when `geo fix` is sent. Both scripts now re-send the
  position every second during the self test. If Android still reports 0, the next suspect is the provider: on google_apis
  images expo-location uses Play services' fused provider, which may not pass emulator fixes through; untested.
- **Android result file.** `run-as` on a non-debuggable build printed its error to stdout, which the script took as the
  result. It now reads `SPIKE_RESULT` from logcat only.
- **Self-test JSON** now includes `rnVersion` (Platform.constants), `expoSdk` (expo-constants), `hermes`
  (`HermesInternal`) and `newArch` (`nativeFabricUIManager`, `__turboModuleProxy`).

## Round 2 (CI run 2) and fixes

Both jobs passed. iOS now matches the SwiftUI screens closely (sectional, ownship, ruler labels, airport dots). iOS self
test: sqlite, location (2 updates), audio, pdf PASS, speech on-device true; secureStore FAIL. Android: sqlite, audio,
secureStore, pdf, speech PASS; location FAIL (0 updates); symbol layers missing on the map.

- **iOS Keychain (`A required entitlement isn't present.`, errSecMissingEntitlement).** Cause: the simulator build was
  unsigned (`CODE_SIGNING_ALLOWED=NO`), and the Keychain refuses unsigned apps. The build now signs ad hoc ("Sign to Run
  Locally", no team): `CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM=`. A new step
  writes `signing.txt` (the CodeSign line from the build log, `codesign -dvv`, signed entitlements and the simulator's
  `__TEXT,__entitlements` section). The entitlements file is the empty dict prebuild generates; no keychain access group
  is declared. Untested: if the Keychain still refuses an ad-hoc app without a team, that is a harness limit (a real
  device build has a team and the default access group), not an expo-secure-store problem.
- **Android location, 0 updates.** Not resolved by reasoning. What is known: expo-location's legacy API uses Play
  services' `FusedLocationProviderClient` (google_apis image), the foreground service and task started, no error, no
  settings-resolution dialog in the screenshot. Changes to find out: the check now also reports `servicesEnabled`,
  `getProviderStatusAsync` (gps / network / passive), `getLastKnownPositionAsync`, a 10 s `getCurrentPositionAsync`
  (Balanced) and the `mocked` flag of each fix. The script turns location on (`cmd location set-location-enabled true`),
  prints `location_mode`, and every second feeds both `adb emu geo fix` (GNSS, unmocked) and a shell gps test provider
  (`cmd location providers set-test-provider-location`, mocked=true), so `watchMocked` / `current.mocked` tell which
  source the fused provider passed through. `dumpsys location` is saved after the self test (`dumpsys-location.txt`).
- **Android symbol layers (ownship, ruler ticks and labels, base-style place labels) not drawn; circles and lines are.**
  Not resolved. Ruled out by reasoning: icons alone (the ownship is icon-only) and glyphs alone (place labels are
  text-only, and `Noto Sans Regular` returns 200 from the style's glyph URL) cannot explain both; the style loads and
  MapLibre logged no native warnings. The same code draws all of them on iOS. Remaining suspects: the emulator's
  SwiftShader GLES renderer (maplibre-native issue #3939 reports symbol labels missing on an Android emulator while
  fill and circle layers draw) or symbol placement. New diagnostics: after the first fully-rendered event the map
  counts `queryRenderedFeatures` per layer (ownship, ruler ticks, ruler line, airport circles, place labels) and records
  `onImageMissing`; a symbol layer with a count above 0 that is not visible was placed but not drawn (renderer). The
  workflow also renders the map screen a second time on an emulator with `-gpu swangle_indirect` (ANGLE on SwiftShader)
  into `gpu-swangle/`; symbols there and not in the main pass would pin it on the GLES path of the emulator, not the app.
  The capture scripts now wait for this probe (`fullyRendered` is set after it).
- **Camera.** Fitting four airport dots (KOAK, KHWD, KSQL, KPAO) in `reference/ipad-map-day.png` to web-mercator (512 px
  tiles) gives zoom 10.00 and center -122.1593, 37.4777 for the 632 x 1376 pt map area (0.33 pt total residual; the same
  projection puts run 2's iOS dots within 0.6 pt of where they were drawn). The parent updated `scenario.map`. The
  reference's sixth dot is KNUQ (Moffett Federal), which the spike's public-airport query leaves out.
- **iOS sheet.** On iPad (regular width) SwiftUI ignores detents and showed a small form sheet with squeezed rows. The
  sheet now asks for `presentationSizing(.page)` (iOS 18+, passed as the `{ $type: 'presentationSizing', sizing: 'page' }`
  modifier; importing `@expo/ui/swift-ui/modifiers` at runtime would call `requireNativeModule('ExpoUI')` on web), keeps
  medium/large detents for iPhone and Android, wraps the content in a native `ScrollView`, and lays it out like the
  SwiftUI airport panel: KSQL title and MVFR, name, chips (elevation, type, TPA), WEATHER with age badge, a fixed
  92 pt label column, FREQUENCIES, RUNWAYS, Day palette from `src/ui/tokens.ts`. Untested until the next run.
- **Result JSON.** Adds `deviceInfo` (model, OS, screen in points, scale, font scale from Platform.constants, Dimensions,
  PixelRatio, expo-constants; no new dependency). `rnVersion` read the version fields in object order and printed
  `88.1.0`; it now prints `major.minor.patch`. On Android the result is also logged as numbered
  `SPIKE_RESULT_PART` chunks plus `SPIKE_RESULT_END`, which the script reassembles, because logcat truncates long lines.

## Compare script

`node scripts/compare.mjs <shot.png> [reference.png] [--out dir]` or `--dir <screens>`: resizes both images to 1032x1376,
scores the left 400 pt strip and the whole frame (SSIM via ssim.js, differing-pixel share via pixelmatch at threshold 0.1),
prints JSON and writes `<name>-side-by-side.png` and `<name>-diff.png` (default `reports/out/compare`, gitignored).
