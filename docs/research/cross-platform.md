# Cross-platform without a second codebase

Research note, 2026-11-08. No code changed.

## Problem

Kanaf is an iPad/iPhone app: about 41k lines of Swift 6 / SwiftUI in `efb-212/`. Pilots with Android tablets, and
pilots who plan on a laptop, can't use it. The question is what it would take to ship on more platforms while keeping
one codebase.

## Non-goals

- Keeping a second UI codebase (SwiftUI plus a separate Kotlin or other UI). A rewrite was ruled out at first. As of
  2026-11-08 it is back in scope if the result feels native on both platforms (option 4).
- A web EFB. SwiftUI does not run in the browser, and the FAA sectional and OpenFreeMap tiles would need their own
  terms review for web distribution.
- Windows and Linux desktop. Swift compiles there, but SwiftUI does not exist there.

## Where the code stands (measured)

Files classified by their imports (`import` lines in `efb-212/**/*.swift`):

| Bucket | Files | Lines | Meaning |
|---|---|---|---|
| Portable | 43 | 7,123 | Foundation and GRDB only: parsers, route planner, NOTAM mapping, CVFR debrief math |
| Apple frameworks, no UI | 60 | 13,604 | SwiftData, CoreLocation, AVFoundation, Speech, FoundationModels, Keychain, MetricKit |
| UI | 74 | 20,067 | SwiftUI, UIKit, MapLibre iOS, PDFKit (all 56 files in `Views/`) |

The Apple dependencies that matter for Android:

| Dependency | Files | Android path |
|---|---|---|
| CoreLocation | 52 (47 outside `Views/`) | No file uses `CLLocationManager`. Live updates go through `CLLocationUpdate` in `LocationService` and `TrackRecorder`. Everywhere else it is the coordinate types (`CLLocationCoordinate2D`, `CLLocation`). Those need a portable coordinate type in the model layer, which is a mechanical change. Live GPS: SkipDevice wraps Android `LocationManager`. |
| SwiftData | 30 | No Android implementation (closed source, per Skip's maintainer). Port the 6 `@Model` types in `Data/Models/` to GRDB, which the app already uses for aviation and recording data. This is the largest data change. |
| MapLibre iOS | 13 | MapLibre Native has an Android SDK, but Skip has no MapLibre module (its showcase map uses Google Maps Compose). Needs an Android map view wrapped for Compose, plus a port of the layer and style code in `MapService` and the `Israel*Overlay` files. Largest single item. |
| UIKit | 11 | Mostly colors and images in the map layer files; the work goes along with the MapLibre port. 3 files are `UIViewRepresentable` bridges (`MapView`, `ReplayMapView`, `ChartPDFView`) that need Compose counterparts. |
| AVFoundation | 6 | SkipAV covers "a small subset" (playback). Cockpit audio recording needs Android `MediaRecorder` code. |
| PDFKit, Vision | 3, 1 | No Skip module. Chart PDFs need an Android PDF viewer. `AirportDiagramGeoreferencer` (Vision) would stay iOS-only or move to the offline tool. |
| Speech | 1 | No Skip module. Android `SpeechRecognizer` or an on-device model. |
| FoundationModels | 2 | Apple-only. Hide the AI debrief on Android; the CVFR debrief numbers don't depend on it. |
| Security (Keychain) | 1 | SkipKeychain module. |
| MetricKit, TelemetryDeck | 1, 1 | Need an Android check; not verified. |
| GRDB | 4 | GRDB 7.10.0 (Feb 2026) announced Android support. The project pins 7.9.0. Swift Package Index shows the Android build of 7.12.0 failing, so treat it as unproven until a spike builds it. |

Background modes are `location` and `audio` (`Info.plist`). On Android, continuous background recording needs a
foreground service with a notification [INFERENCE: standard Android rule, not checked against Skip].

## Options

### 1. Mac and Vision Pro as an iPad app (near zero cost)

`SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD = NO` and `SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD = NO` in
`project.pbxproj`. Changing them lets Apple Silicon Macs and Vision Pro run the unmodified iPad binary from the
App Store. This is not Android, but it is a cross-platform gain for one build setting and a QA pass. Macs have no
GPS, so this targets planning, the briefing and reviewing flights.

### 2. Skip Fuse: one Swift codebase, native Android (recommended to spike)

Skip compiles the Swift natively with the official Swift SDK for Android (shipped in Swift 6.3, March 2026) and
renders SwiftUI views as Jetpack Compose through SkipFuseUI. It has been free and open source since Skip 1.7
(2026-01-21), and the build engine (skipstone) is public too. Modes are chosen per module: Fuse (native) for the
app's logic, Lite (transpiled to Kotlin) for small Android adapters.

Costs and limits from Skip's docs:

- About 60 MB added to the Android app for the Swift runtime and Foundation.
- Slower builds, harder native debugging, and no Kotlin codebase to fall back on if Skip goes away (Fuse is not
  "ejectable" the way Lite is).
- Minimum Android API 28; targets API 34.
- The project has to become SwiftPM modules with a `Skip/skip.yml` each. Today everything is one Xcode target
  (`efb-212`).

What it would take, in order:

1. **Restructure into modules.** Move the portable code (the 43 files, plus the coordinate-type cleanup) into a
   `KanafCore` SwiftPM package. The iOS app keeps building from Xcode against it. This is useful even if Android
   never ships.
2. **Replace SwiftData with GRDB** for profiles, flight records, plans, logbook and settings, with a migration from
   the existing store. The one change visible to users is a data migration, so it needs its own release and tests.
3. **Platform seams.** `Protocols.swift` already hides weather, NOTAM, TFR and database services behind protocols.
   Add the same for location, audio capture, speech, PDF display and the map. Android implementations go in a Lite
   module that calls Kotlin.
4. **Map.** Wrap MapLibre Android in a Compose view and port the source and layer setup. Writing a shared
   "layer spec" in `KanafCore` that both renderers read keeps the styles in one place.
5. **UI pass.** SkipFuseUI covers the common SwiftUI API. Only 2 files use iOS 26-gated APIs, but the app has custom
   layout (the log strip, the altitude tape). Expect `#if os(Android)` branches in some views. The share of views that need them
   is unknown until the first build.
6. **CI.** Add an Android build and test job; Skip runs the same XCTest/Swift Testing suites on Robolectric or an
   emulator.

Rough size [INFERENCE, not estimated against a build]: steps 1-2 are weeks; the map port is the biggest single
risk; the rest depends on how many views SkipFuseUI renders unchanged.

### 3. Swift SDK for Android without Skip

Share `KanafCore` through the official SDK and write the Android UI in Kotlin/Compose. This shares the logic, but
the UI becomes a second codebase, which rules it out under this question's constraint. It stays the fallback if
SkipFuseUI coverage turns out too thin, and step 1 of option 2 is the same work.

### 4. Full rewrite in one cross-platform language (added 2026-11-08)

Cost common to every rewrite: all 41k lines and the 1,065 unit tests are redone, and the TestFlight iOS app is
replaced by the new build, so iOS can regress. Swift to Kotlin is the closest language pair (Skip's transpiler maps most
of Swift onto Kotlin), so translation is likelier to be mechanical there than into Dart or TypeScript [INFERENCE].

All three candidates draw the map with MapLibre Native on both platforms, so map frame rate does not separate them.
They differ in the chrome around the map, the data layer and the platform plumbing.

| | Kotlin Multiplatform + Compose Multiplatform | Flutter | React Native |
|---|---|---|---|
| UI | Compose on Android. On iOS Compose draws its own pixels (stable since CMP 1.8, May 2025). iOS 26 Liquid Glass tab and nav bars need a native SwiftUI shell around Compose screens (JetBrains tutorial). | Draws its own pixels on both. Liquid Glass only through third-party packages that host native UIKit views. | Real native widgets on each platform. |
| Map | `maplibre-compose` 0.20.0: Android, iOS, desktop, web; offline downloads on all but web. The docs say the API is not yet stable. | `maplibre_gl` 0.27, MapLibre org plugin. The map is a platform view; the docs have tuning pages for it (Android platform view modes, "Hybrid Composition++"). | `maplibre-react-native` v11, official MapLibre org, New Architecture only. |
| Language | Kotlin | Dart | TypeScript |
| Data | Room KMP or SQLDelight. The bundled SQLite driver is compiled with R-tree and FTS5, so `aviation.sqlite` and `israel-aviation.sqlite` should load unchanged [not smoke-tested]. | Not checked. | Not checked. |

Plumbing every stack still needs as platform code: background GPS and cockpit audio together (Android requires a
foreground service with a notification [INFERENCE]; KMP libraries exist, e.g. `abc-kmm-location` and Anchor; React
Native has `expo-persistent-background-location`; Flutter not checked), speech recognition (SpeechAnalyzer on iOS,
Android `SpeechRecognizer`), PDF display and Keychain. The AI debrief has no cross-platform engine: Android's
equivalent is Gemini Nano through ML Kit GenAI, limited to a device list (for example Galaxy Z Fold7, OnePlus 13,
Xiaomi 15, Razr 60 Ultra), so most Android tablets would get the CVFR numbers only.

How much "native" matters here: the design is a custom cockpit instrument (`docs/DESIGN.md`), with its own button
style, log strip and altitude tape. Stock controls appear mainly in settings and planning: `NavigationStack` in 13
view files, `.sheet` in 7, `Form` in 6, `Picker` in 9, `.toolbar` in 11. A toolkit that draws its own UI loses little
on the map screen and more in those forms. Accessibility on drawn-UI toolkits is not verified, and the real-device
VoiceOver walkthrough (efb-77r.35) is still pending.

#### Remote updates without a store release (added 2026-11-08)

| | Can ship over the air | Still needs a store release |
|---|---|---|
| React Native (Expo Updates, or a self-hosted server speaking the same protocol) | JavaScript code, styles, translations, bundled images and fonts, JS-read config | Native code and modules, new native dependencies, permissions, framework version, icons |
| Flutter (Shorebird Code Push) | Dart and widget code. On iOS the changed Dart runs in Shorebird's own interpreter; a patch that shares less than 20% of its Dart code with the release fails to publish. | Native Swift/Kotlin, plugin native code, `Info.plist`, permissions, native dependencies |
| Kotlin Multiplatform, Skip, native Swift | Nothing found in this research | Everything |

Store rules. Apple guideline 2.5.2: apps "may not download, install, or execute code which introduces or changes
features or functionality of the app". Expo and Shorebird both rely on the Developer Program License Agreement
exception for interpreted code that does not change the app's primary purpose. The two vendors cite different DPLA
sections (3.3.2 and 3.3.1(B)), and I could not read the DPLA itself (it needs a developer login). Google Play's
policy bars downloading executable code but says the restriction "does not apply to code that runs in a virtual machine
or an interpreter" (read from the policy page). Practical limit: fix and iterate on what App Review already saw; do not
change what the app is.

Tooling. EAS Update has channels, an exact runtime-version match between update and binary, percentage rollouts,
rollback, and signed manifests (signing is on the Production and Enterprise plans; the free plan covers 1,000 monthly
active update users). The protocol is public, so a self-hosted server works; CodePush was retired on 2025-03-31.
Shorebird has staging and stable tracks, percentage rollouts, rollback and patch signing, with a free plan that has a
monthly patch-install limit.

What it would and would not change for Kanaf:

- It removes Beta App Review and the store build for JavaScript-only changes. Today each release goes
  release-please -> tag -> `fastlane ios beta` -> TestFlight, and the external group is submitted for Beta App Review
  per build (`docs/CI.md`).
- It does not cover the native side, and much of this app's risk lives there: the MapLibre native SDK, background
  location and audio (`UIBackgroundModes`), permissions, speech, Xcode and iOS SDK bumps. Those still need a build and
  review, and on any stack they are written in Swift or Kotlin (an Expo native module, a Flutter plugin).
- Aviation data already ships without a release: charts and diagrams from R2, NOTAMs from the relay. The bundled
  `aviation.sqlite` does not; whether it could ride an OTA bundle is unverified, and the R2 pack pattern already exists.
- Safety: this is a flight tool, labelled supplemental. OTA removes the review gate between a bug and every pilot's
  device. Guardrails to require: signing with a key the project controls, staged rollouts, a rollback path, apply on the
  next cold launch only (Expo's default is background download, run next launch), and crash telemetry per update
  (TelemetryDeck and MetricKit would need equivalents). A launch-breaking update on an iPad that is offline in the
  cockpit cannot be rolled back until it reconnects [INFERENCE].
- Cheaper alternatives to OTA for the same pain: server-driven config and kill switches for features, and Apple's
  expedited review for hotfixes. Neither needs a rewrite.

Ranking if a rewrite is chosen, with OTA weighed as a priority: React Native first (real native widgets, OTA through
an open protocol, official MapLibre binding), at the cost of a JavaScript runtime, porting the aviation logic to
TypeScript, and native modules for location, audio and speech. Kotlin Multiplatform with Compose Multiplatform second
(closest language, shared SQLite files, no OTA). Flutter with Shorebird third (OTA and drawn UI, but Dart and the map
as a platform view). With OTA not weighed, Kotlin Multiplatform moves to first. None of this was run against the app.

## React Native spike results (2026-11-08)

Setup. Branch `spike/react-native` (pushed to origin, no PR), app in `spikes/kanaf-rn`: Expo SDK 58, React Native
0.88.1, Hermes, new architecture (Fabric). Final CI run: https://github.com/omercnet/openefb/actions/runs/42517243480
(artifacts kept 14 days). iOS: Release build on the iPad Pro 13-inch (M5) simulator, iOS 26.5. Android: Release build on
a Pixel Tablet API 35 emulator. Reference: screenshots the SwiftUI app's own CI produced on the same iPad model. Scope:
iPad portrait, the map screen (flight log strip, footer, ownship, track ruler, sectional), the airport column, night
mode, one native sheet, and a native self test.

### Look and feel

| iOS, strip region vs the SwiftUI screenshot (SSIM, 1.0 is identical) | Strip | Whole frame |
|---|---|---|
| Map, day | 0.942 | 0.915 |
| Map, night | 0.948 | 0.874 |
| Airport column | 0.715 | 0.822 |

Side by side the map and night screens are hard to tell apart (same bundled Archivo and IBM Plex Mono, same layout,
sectional, ownship, ruler). The airport column scores lower because its rows run about 0.5 pt taller each, which adds up
to 7 to 9 pt by the bottom; SSIM punishes shifted text, so 0.715 overstates the visual gap. I tuned it twice and did
not get it closed. SF Symbols are redrawn as SVG. Two pitfalls found: expo-font skips fonts already embedded natively,
and React Native picks a face by weight inside a family, so the three Archivo semibold widths collapsed until each was
registered under a unique alias; and floating-point line heights (`15 * 1.3`) round up to the next 0.5 pt on iOS.

Android renders the same components. SSIM is not comparable there (the Pixel Tablet is 800x1280 dp, a different aspect
from the iPad's 1032x1376 pt), so Android is judged by eye: same layout, Roboto instead of SF for system text.

### Native functionality (same app, run on both platforms)

| Check | iOS | Android | Notes |
|---|---|---|---|
| Bundled `aviation.sqlite` with R-tree and FTS5 | pass | pass | SQLite 3.53.3. Bay R-tree query: 31 airports in 10 ms (iOS) and 3.5 ms (Android); FTS for "san carlos" returns KSQL. Stock `expo-sqlite` ships without R-tree; the config flag `-DSQLITE_ENABLE_RTREE=1` fixes it. |
| MapLibre: style, sectional raster, ownship, ruler, airport dots from the R-tree | pass | pass | `base-style.json` ships the sectional layer hidden and the SwiftUI app switches it on at runtime; the port initially missed that. |
| Location, foreground and background updates | pass | pass | Simulated fixes. On Android, updates arrived only with both the emulator fix and a test provider running; whether the emulator fix alone works was not isolated. |
| Audio recording | pass | pass | Simulated microphone, m4a written. |
| Secure storage | pass | pass | iOS needed an ad-hoc signed simulator build for the keychain entitlement. |
| PDF display | pass | pass | `react-native-pdf`. |
| Speech recognition availability | pass | pass | On-device flag true on both. No transcription ran. The iOS module does not mention SpeechAnalyzer, which the SwiftUI app uses on iOS 26. Android has 0 of 31 on-device locale models installed in the emulator. |
| Native bottom sheet (`@expo/ui`) | pass | pass | Real SwiftUI sheet on iOS (grabber, rounded corners, Liquid Glass chrome comes from the system), Material sheet on Android. On iPad it needed page sizing. The content layout is close, not identical (labels centered, not leading). |

Android map symbols (ownship arrow, ruler labels) did not draw under the default emulator GPU mode and do draw under
`swangle_indirect` (`gpu-swangle/` in the artifact). That points at the emulator's software renderer, not the app or
React Native; confirm on a real device.

Frame pacing while the ownship moved at 10 Hz for 60 s (JS-thread `requestAnimationFrame`): iOS simulator p50 16.7 ms,
p95 18.5, max 105; Android emulator p50 16.7, p95 26.9, max 554. Emulators are not representative of tablets, so this
shows no regression, not smoothness.

### Not covered

Real devices (smoothness, thermals, battery); 30 minutes of screen-off GPS plus audio; the iPhone rail layout;
offline map packs (the MapLibre `OfflineManager` exists, not exercised); the georeferenced diagram overlay (PDFKit and
Vision today); the Apple Foundation Models debrief (`react-native-apple-llm`, about 800 weekly downloads, Jan 2026);
TelemetryDeck (only a 2023 JavaScript SDK); Hebrew and RTL; VoiceOver and Dynamic Type (sizes are fixed); OTA updates
(researched, not run); and the other roughly 54 view files and the Swift logic, which a rewrite must port.

Verdict. On the surface tested, React Native matches the SwiftUI look to within a fraction of a point on the map screen
and has every tested native capability on both platforms, with a native sheet and OTA available. The open risks are
device-level smoothness, the long-running background behaviour, and the size of the port (about 41k lines of Swift and
1,065 tests), not feasibility of the look.

## OTA updates on Cloudflare, no paid services (2026-11-09)

Built: `web/ota`, a read-only Cloudflare Worker that serves the Expo Updates protocol v1 from R2, and a publisher CLI
(`web/ota/cli/ota.mjs`) that signs on the publisher's machine and writes R2 directly. Modelled on
Daniel-Griffiths/cloudflare-expo-ota-updates, minus D1, KV, the upload endpoint and the Worker-held signing key. Plan by a
Fable agent, built by two agents in parallel, reviewed by an Opus agent (no blockers; two should-fix items fixed). Not
deployed: proven against `wrangler dev` with local R2 on the CI runners. Details in `web/ota/README.md`.

Design. The Worker has `GET /manifest`, `GET /assets/<sha256>` and `/health`, no secret and no write route. Manifests and
rollback directives are signed at publish time (RSA-SHA256, Expo's certificate format); the app embeds the certificate and
rejects anything unsigned or signed with another key. Someone with Cloudflare write access can delete or replay older
signed updates but cannot make the app accept a new one. Runtime version uses Expo's fingerprint policy, so a binary with
different native code looks up a different pointer and gets no update. Channels (`production`, `beta`) are the staging;
there is no percentage rollout. Assets keep Metro's md5 keys, so assets already in the binary are not downloaded again
(only the JS bundle was fetched in CI).

Evidence: https://github.com/omercnet/openefb/actions/runs/42580669123 (both jobs green after a re-run for GitHub and
Maven download timeouts), artifacts `rn-spike-ios/ota` and `rn-spike-android/ota`. The runtime version baked into each
binary matched the publisher's (`runtime-version-check.txt`).

| Step | Server state | iOS | Android |
|---|---|---|---|
| 1 | Nothing published (204) | embedded bundle | embedded bundle |
| 2 | Update A published | runs A | runs A |
| 3 | Update B signed with another key | refused, "Code signing incorrect signature", stays on A | refused, "Code signing verification failed for manifest: Incorrect signature", stays on A |
| 4 | `rollback --embedded` | back to the embedded bundle | back to the embedded bundle |
| 5 | Update on another channel | ignored, embedded | ignored, embedded |

Before a real deploy (owner's call): create the `openefb-ota` bucket and deploy the Worker on the free plan; generate the
production key pair once and keep the private key off Cloudflare (owner machine or a GitHub environment secret); ship the
certificate in the first store build; decide who may publish.

## Recommendation

1. Turn on "Designed for iPad" for Mac and Vision Pro now: one setting, one QA pass.
2. Extract `KanafCore` (the 43 portable files, coordinate types free of CoreLocation). It is the first step of
   option 2 and also reduces the rewrite surface for option 4.
3. React Native passed the spike (above), which makes it the leading rewrite candidate when OTA updates and native
   widgets matter. Skip Fuse and Kotlin Multiplatform were not spiked. If the iOS app must stay SwiftUI untouched, take
   Skip Fuse (option 2). If one Kotlin codebase matters most and drawn UI on iOS is acceptable, take Kotlin
   Multiplatform with Compose Multiplatform. Before committing to React Native, run it on a real iPad and a real
   Android tablet for the items under "Not covered", and measure how long Beta App Review actually delays the last 10
   builds.
4. Same spike for any stack, pass or fail: (a) open the bundled `aviation.sqlite` and answer an R-tree and an FTS
   query; (b) MapLibre shows the FAA sectional raster with ownship updating at 10 Hz and the track ruler, panning
   smoothly on a mid-range Android tablet; (c) 30 minutes of screen-off GPS plus audio recording on Android without
   the process being killed; (d) one real screen (the airport sheet) built in the toolkit and compared with the
   SwiftUI one on an iPad. If (a) or (b) fails on Skip, switch to Kotlin Multiplatform.

## Open questions

- Is there demand? Android EFB users in the US and Israel are not measured; the interviews site could ask.
- Data and tile terms on Android: the FAA sectional (ArcGIS) and OpenFreeMap terms were reviewed for iOS
  distribution only.
- Does GRDB build for Android with the bundled SQLite at the version we would pin? (Swift Package Index: failing.)
- Is the AI debrief needed on Android, or is the CVFR debrief enough there?
- Who owns Android QA? There are no Android devices in the current test setup.
- If rewriting: the 1,065 unit tests and the flight-sim scenarios do not port, so the new stack needs its own suite
  before iOS can switch over.
- `maplibre-compose` is pre-1.0 and its API changes between minor releases. Who absorbs that churn?
- OTA: is the goal to skip Beta App Review, or only to ship JavaScript-sized fixes faster? Internal TestFlight builds
  skip Beta App Review already, and the review delay per build has not been measured.
- OTA: who holds the update signing key, and who may publish a patch to pilots?

## Agent skills for this work

- `skiptools/skills` (official, Apache-2.0, 11 skills: `skip-fuse`, `skip-frameworks`, `building-skip-ui`,
  `skip-lite-transpilation`, `skip-testing`, `skip-deployment`, ...). Install with
  `npx skills add skiptools/skills -g -y`. Low install count (9 GitHub stars), but it is the vendor's own.
- Already installed and relevant: `software-design-philosophy` and `clean-architecture` (module boundaries for
  `KanafCore`), `working-with-legacy-code` (seams before moving code), `swiftui-pro`.
- Kotlin Multiplatform and Compose Multiplatform skills exist (`vitorpamplona/amethyst@kotlin-multiplatform`, 1.6K
  installs; `affaan-m/ecc@compose-multiplatform-patterns`, 11.1K) and apply if option 4 is chosen. For React Native:
  `wshobson/agents@react-native-architecture`, 15.5K. Install counts as listed by `npx skills find`, quality not
  reviewed.

## Sources

- Skip free and open source: https://skip.dev/blog/skip-is-free
- Fuse vs Lite modes, app size, ejectability: https://skip.dev/docs/modes/
- Skip FAQ (agent skills, minimum Android API): https://skip.dev/docs/faq/
- SwiftData on Skip (maintainer reply): https://github.com/orgs/skiptools/discussions/567
- SkipDevice (location): https://skip.dev/docs/modules/skip-device/
- SkipAV (subset of AVFoundation): https://skip.dev/docs/modules/skip-av/
- Skip map showcase (Google Maps Compose): https://github.com/skiptools/skipapp-showcase-fuse
- Swift 6.3 with the Android SDK: https://swift.org/blog/swift-6.3-released
- GRDB 7.10.0 Android support: https://forums.swift.org/t/grdb-v7-10-0-android-linux-windows-and-sqlcipher-swiftpm/84754
- GRDB build matrix: https://swiftpackageindex.com/groue/GRDB.swift/builds
- MapLibre Native Android: https://www.maplibre.org/maplibre-native/android/examples/configuration
- MapLibre Compose (0.20.0, API not yet stable): https://maplibre.org/maplibre-compose/
- Compose Multiplatform for iOS stable (1.8): https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready
- Liquid Glass in Compose Multiplatform: https://kotlinlang.org/docs/multiplatform/ios-liquid-glass.html
- KMP for iOS FAQ: https://kotlinlang.org/docs/multiplatform/kmp-for-ios.html
- Room KMP: https://developer.android.com/kotlin/multiplatform/room
- androidx.sqlite bundled driver build flags (R-tree, FTS5): https://android.googlesource.com/platform/frameworks/support/+/refs/heads/androidx-main/sqlite/sqlite-bundled/build.gradle
- Flutter MapLibre performance notes: https://maplibre.org/flutter-maplibre-gl/advanced/performance/
- MapLibre React Native v11: https://maplibre.org/maplibre-react-native/docs/setup/migrations/v11/
- Gemini Nano device support (ML Kit GenAI): https://developers.google.com/ml-kit/genai
- Apple App Review Guidelines (2.5.2): https://developer.apple.com/app-store/review/guidelines/
- Google Play Device and Network Abuse policy: https://support.google.com/googleplay/android-developer/answer/16559646
- Expo, over-the-air updates (limits, runtime versions, plans, CodePush retirement): http://expo.dev/articles/updates-and-rollouts/over-the-air-updates
- Expo EAS Update rollouts: https://docs.expo.dev/eas-update/rollouts/
- Shorebird Code Push guide (iOS interpreter, signing, rollbacks, limits): https://docs.shorebird.dev/code-push/guides/code-push-guide/
