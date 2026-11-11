# Plan: rewrite Kanaf in React Native (iOS + Android, one codebase)

Status: DRAFT for owner review. Author: planner agent, 2026-11-09. Inputs: /tmp/spike/rewrite-brief.md, AGENTS.md,
docs/research/cross-platform.md, web/ota/README.md, and the code in efb-212/, efb-212Tests/, tools/, .github/workflows/,
fastlane/, spikes/kanaf-rn/, web/. Facts below were checked in the tree; items I could not verify are marked UNVERIFIED.

Measured baseline (verified):
- efb-212/ Swift: 175 files, ~40.7k lines (Core 24 files/3.5k, Data 13/2.6k, Services 70/19.3k, ViewModels 12/3.0k,
  Views 56/12.2k).
- efb-212Tests/: 114 files, 20.6k lines; grep of `func test`/`@Test` finds 1,181 (brief and cross-platform.md say 1,065;
  parameterized and nested counts differ, so use "about 1,100" and let the first port ticket produce a definitive count).
  Folders: CharacterizationTests, DataTests, IntegrationTests, Mocks, ServiceTests (53 files), Simulation, ViewModelTests.
- Spike app: spikes/kanaf-rn/ ~1.9k lines TS, no Jest, no unit tests; CI in .github/workflows/rn-spike.yml (ios + android jobs).
- Bundle id io.omer.efb (efb-212.xcodeproj/project.pbxproj, TARGETED_DEVICE_FAMILY "1,2", iOS deployment target 26.0,
  MARKETING_VERSION 1.0 managed by release-please via release-please-config.json and version.txt).

## 1. Problem, goals, non-goals, success criteria

Problem. Kanaf (VFR EFB, iPad first) exists only as a SwiftUI iOS app. Android demand is confirmed and the owner
approved a React Native rewrite (brief, owner decisions 2026-11-09). Two codebases are not affordable.

Goals.
1. One TypeScript codebase shipping iOS (TestFlight, same bundle id io.omer.efb) and Android (Play internal testing).
2. iOS users upgrade in place with their data (aircraft, plans, flights, logbook, recordings, settings) intact.
3. Domain logic is pure TypeScript, unit-testable on the Linux dev host with Jest, ported test-first from Swift.
4. OTA JS updates via web/ota with signed manifests (no new paid services).

Non-goals.
- Mac / Vision Pro "Designed for iPad" setting (PR #21, separate).
- Features not in the Swift app today. No redesign: docs/DESIGN.md and the SwiftUI screens are the spec.
- Android Wear, tablet-specific Android layouts beyond what the iPad layout gives, web target, Skip or Kotlin paths.
- Re-litigating the stack (Expo SDK 58, RN 0.88, Hermes, new arch, MapLibre RN v11, expo-sqlite+R-tree, etc.).
- Paid services (TelemetryDeck replacement must be free; see 3.7).

Parity definition (gate for replacing the SwiftUI app on TestFlight). All of the following, in this order of weight:
- P1 Data: migration importer passes on fixture stores from every shipped schema (section 4). No data loss, ever.
- P2 Behaviour: ported characterisation tests green. Every Swift test in the "port" classes of section 5 has a TS
  counterpart or a written drop reason in docs/ (a mapping file `app/docs/test-port-map.md`, one line per Swift test file).
- P3 Scenarios: all 8 scenarios in tools/flight-sim/scenarios/ (il-border-approach, il-closed-leg, il-ctr-entry,
  il-cvfr-llhz-llib-deviations, il-cvfr-llhz-llib-nominal, il-gps-loss, il-lsa-llbs-llrs, us-kpao-ksql) fly through the RN
  app on iOS simulator and Android emulator with the same asserted outcomes as tools/ci/fly-scenarios.sh.
- P4 Fidelity: screenshot gate (spike compare.mjs, SSIM against SwiftUI references) on every screen in
  tools/ci/capture-screens.sh at thresholds in section 5.4. Map and night already 0.94/0.95; airport column 0.72 must be
  fixed or explicitly waived by the owner.
- P5 Feature checklist: every feature in docs/PRODUCT.md and the Israel set (CVFR routes, LSA, NOTAM relay, chart packs,
  flight plan message) present, except features the owner explicitly drops in section 8.
- P6 Device: owner flies one real flight on iPad (30 min screen-off GPS plus audio recording survives) and one on an
  Android phone. This is the only manual gate; everything else is automated.
- P7 Accessibility floor: VoiceOver and TalkBack can reach and operate the flight log, search, and recording controls;
  Hebrew/RTL does not break layout on the primary screens. (Today sizes are fixed per cross-platform.md "Not covered";
  this is no regression for iOS, and is new work for Android.)

"Matches" means: fidelity tests for look, characterisation tests for logic, scenario sims for end to end. Nothing is
judged by eye except P6.

## 2. Repo layout and fate of the Swift app

Decision: promote the spike to `app/` at the repo root (git mv spikes/kanaf-rn app, keep history), not a new tree.
Reasons: the spike already holds the working config (app.config.ts, metro.config.js, scripts/, compare.mjs, assets,
fonts, aviation.sqlite), and rn-spike.yml paths only need renaming. spikes/ keeps only deliberately throwaway work.
Prerequisite cleanup in the same ticket: change the spike bundle id io.omer.efb.rnspike to a build variant (see Q2),
because the production app must be io.omer.efb.

Layout inside app/:
```
app/
  app.config.ts, package.json, tsconfig.json, metro.config.js, eslint config, jest config
  src/
    domain/      pure TS, NO react / react-native / expo imports (enforced by eslint no-restricted-imports + tsc project ref)
    data/        SQLite schema, migrations, repositories (uses a small Db interface; expo-sqlite adapter lives in adapters/)
    adapters/    platform wrappers: location, audio, speech, secure-store, files, map-offline, pdf, telemetry, ai-debrief
    ui/          tokens, primitives, screens, navigation (existing src/ui, src/screens, src/map move here)
  tests/ (or *.test.ts colocated)  jest; fixtures/ (swift-generated stores, scenario files)
  scripts/       existing ios-capture.sh, android-capture.sh, compare.mjs, ota-smoke.sh + new migration/scenario scripts
```
ios/ and android/ stay gitignored (CNG), as the spike already does. Native customisation (R-tree sqlite flag,
foreground service) lives in config plugins under app/plugins/, not in generated folders.

Swift app during the rewrite: keeps shipping from main until parity, but frozen to fixes (bugs, data-safety, OS
compatibility, and release-please version bumps). No new features in Swift; new features go to the RN track once it
reaches foundation phase end, else wait. Reason: a moving 41k-line target makes parity unmeasurable.
Deletion: a single PR after the RN app has been on TestFlight production-channel for 2 weeks with no P1 data issue and
the owner's go. That PR removes efb-212/, efb-212Tests/, efb-212UITests/, efb-212.xcodeproj, Gemfile/fastlane Swift
lanes, tools/ that only serve Swift (tools/sim-test.sh, tools/sim-preview.sh; keep nasr-importer, caai-*, apd-georef,
flight-sim generators if they feed the shared aviation.sqlite and scenarios). Until then the Swift app stays the only
thing the migration fixtures generator can run (section 4), so the Swift project must not be deleted before the
importer is proven in the field.

Release train: both apps cannot upload under the same bundle id and version stream. The RN build continues the same
CFBundleShortVersionString sequence (release-please already tags vX.Y.Z); CFBundleVersion (CURRENT_PROJECT_VERSION)
must stay monotonic per ASC. First RN TestFlight build gets the next minor (see Q3).

## 3. Architecture

### 3.1 Module boundaries
- domain/: ports of Swift logic that is Foundation-only (43 files/7.1k lines per cross-platform.md): route planner,
  Israel route following, NOTAM closure mapper, briefing filter, LSA time rules, alert evaluator, CVFR debrief math,
  flight phase detector, vertical speed estimator, currency, TAF validity, metar visibility, polygon geometry, region
  logic, flight scenario/playback model. Inputs and outputs are plain objects and `Date`-free (epoch ms numbers) so tests
  are deterministic. Coordinates are `{lat, lon}` (replaces CLLocationCoordinate2D).
- data/: SQLite schema + repositories for the six models, aviation DB access, recording DB. Takes a `Db` interface
  (`all/get/run/transaction`); expo-sqlite adapter in production, better-sqlite3 or node:sqlite in Jest (Linux, no
  device needed). The aviation DB needs R-tree; Jest can only use a Node sqlite that has it (UNVERIFIED: check
  better-sqlite3 default build; it ships R-tree enabled, node:sqlite also; confirm in ticket F4).
- adapters/: one file per platform capability, each behind an interface defined in domain/data: LocationSource
  (expo-location), AudioRecorder (expo-audio), SpeechTranscriber (expo-speech-recognition), SecretStore
  (expo-secure-store, replaces Services/KeychainStore.swift), FileStore, PdfViewer (react-native-pdf), OfflineMaps
  (MapLibre OfflineManager), Telemetry, AiDebrief, Clock. Fakes of all of them are the Swift `efb-212Tests/Mocks/` (17
  files) equivalent and drive scenario sims.
- ui/: React components only; no business rules. Reuse spike tokens (src/ui/tokens.ts), primitives, map surface.

Enforcement: eslint `no-restricted-imports` bans react*, expo*, @maplibre* inside src/domain and src/data (except
src/data/adapters). Same pattern AGENTS.md uses for other lint rules (read lefthook.yml for how hooks are declared).

### 3.2 State management
Swift uses @Observable AppState (efb-212/Core/AppState.swift) plus 12 view models (efb-212/ViewModels/). Choose Zustand
stores for app state (small, no provider boilerplate, trivially testable outside React) and derive from repositories;
view models become hooks over a store plus domain functions. Rationale over Redux: YAGNI. UI-only state stays in
components. Time-critical streams (GPS at ~1 Hz, map follow mode) must not go through React state per tick: the
following-state machine (Services/FollowModeState.swift) is a domain reducer fed by LocationSource, and only the
resulting camera/props reach the map.

### 3.3 Navigation
expo-router (file based, deep links already needed: Android `am start -d kanaf-rn://<screen>` and iOS -KanafScreen
launch args are the spike's CI hooks and must keep working under the production scheme). The app is a map-first single
screen with sheets and a rail/column layout (docs/DESIGN.md), not a tab app: model it as one root screen plus native
sheets (@expo/ui, iPad page sizing noted in the spike) and a few stack screens (logbook, settings, replay, debrief).
UNVERIFIED: whether expo-router adds weight over react-navigation for this shape; ticket F3 decides with a 1 hour
spike and records it. Default if undecided: expo-router (already in Expo template).

### 3.4 Data layer (SQLite schema replacing six SwiftData models)
One app database `kanaf.sqlite` in expo-sqlite default directory, separate from aviation.sqlite (read-only, bundled,
R-tree) and recording.sqlite (high-frequency writes, WAL). Tables (one per model in efb-212/Data/Models/, listed in
SchemaV1.models at UserSettings.swift:16): user_settings, aircraft_profile, pilot_profile, flight_plan_record,
flight_record, logbook_entry. Rules:
- Explicit schema_version via `PRAGMA user_version`, forward-only SQL migrations in src/data/migrations/NNN_name.sql,
  each with a Jest test that upgrades from the previous fixture. Mirrors how Swift uses EFBSchemaMigrationPlan.
- Columns keep the Swift property names in snake_case; enums stay strings (UserSettings already stores
  defaultMapMode as "northUp"/"trackUp"). Dates are epoch ms integers. UUIDs as text.
- Recording DB keeps the GRDB table shapes (track_points, transcript_segments, phase_markers, debrief_results,
  flight_route_legs in efb-212/Data/RecordingDatabase.swift) 1:1 so the importer is a file move plus an
  idempotent "run remaining migrations" step, not a data copy. This is the cheapest high-volume path.
- Aviation DB: reuse the bundled aviation.sqlite and israel-aviation.sqlite generated by tools/nasr-importer and
  tools/caai-importer (efb-212/Resources). The spike already opens aviation.sqlite via expo-sqlite with R-tree.
  Swift copies it to Application Support (efb-212/Data/AviationDatabase.swift:42); RN does the same on first launch or
  on asset version change.

### 3.5 Background work
- Location: expo-location background task + Android foreground service (proven in spike). A single
  RecordingCoordinator domain machine (port of Services/Recording/RecordingCoordinator.swift, AutoStartGate,
  FlightPhaseDetector, FlightRecoveryService) owns start/stop/recovery; adapters only supply samples.
- Crash recovery: FlightRecoveryService semantics preserved (an unfinished recording is detected at launch and
  closed). Add a test that kills the JS runtime mid-flight in the scenario harness.
- Audio: expo-audio recording with the iOS audio background mode and an Android foreground service type microphone.
- Periodic data refresh (Core/DataRefreshScheduler.swift): foreground timers plus expo-background-task for chart/NOTAM
  freshness only; nothing safety-critical depends on background refresh.
- Android battery/Doze and 30 min screen-off behaviour is the biggest unknown (risk R1).

### 3.6 Error handling
Port EFBError (Core/EFBError.swift) as a discriminated union in domain/errors.ts; repositories and adapters return
`Result`-style values or throw typed errors caught at store boundaries; UI shows the same banners as Swift. Corrupt
store policy from ModelContainerFactory.makeForApp is kept: never delete or recreate a user store on open failure, log
it and run on an in-memory fallback with a visible banner. No silent catch.

### 3.7 Platform capability decisions (gaps listed in the brief)
- Offline map packs: MapLibre RN v11 OfflineManager. Ticket M3 proves create/resume/delete and tile-failure
  tracking (port of Core/TileFailureTracker.swift). Packs cover regions from Core/Region.swift.
- Airport diagram overlay: Swift georeferences PDFs on device with PDFKit + Vision
  (Services/AirportDiagramGeoreferencer.swift, AirportDiagramOverlay.swift). Decision: move georeferencing offline into
  tools/apd-georef and tools/caai-apd (both exist) so the app only displays a precomputed affine transform plus
  rendered image/PDF; on device the overlay is a MapLibre image source. This removes the Vision dependency on both
  platforms. See Q6 (affects chart pack format, BIG).
- AI debrief (Apple FoundationModels, Services/Debrief/DebriefEngine.swift): iOS via react-native-apple-llm
  (UNVERIFIED maturity: ~800 weekly downloads per cross-platform.md; fall back to a tiny local Expo module that
  calls FoundationModels). Android: hide the feature in v1 (CVFR debrief numbers in Services/Debrief/CVFRDebrief.swift
  do not need an LLM). Gemini Nano via ML Kit is a post-parity ticket, off by default.
- Speech transcription: Swift uses iOS 26 SpeechAnalyzer in Services/Recording/TranscriptionService.swift, with
  AviationVocabulary.swift contextual strings. expo-speech-recognition (spike-proven) on both platforms; on iOS 26 ticket
  S2 compares word accuracy on 3 recorded cockpit clips against the Swift output and, if worse by an owner-set margin,
  writes a small Expo module for SpeechAnalyzer. Default: ship expo-speech-recognition and measure.
- Telemetry and crash signal (replaces TelemetryDeck + MetricKit, Services/ analytics file(s); UNVERIFIED exact
  filenames): free only. Use `expo-updates` embedded/launch events plus a first-party counter endpoint on the existing
  Cloudflare Worker (web/ota or a sibling in web/) with anonymous event names, no user ids, and crash reports from the
  OS stores (App Store Connect crashes via tools/testflight-crashes.py already; Play vitals on Android). No Sentry
  paid tier. See Q7.
- Hebrew/RTL: I18nManager.allowRTL, logical (start/end) styles throughout ui/, a Hebrew string table matching the
  Swift Localizable resources (UNVERIFIED: check efb-212/Resources has no .strings today; Resources lists only Fonts,
  aviation.sqlite, base-style.json, israel-*.json, so Hebrew may be hard-coded in Swift; ticket U6 inventories it).
  Fonts must keep the unique alias rule (Kanaf-<PostScript>).
- VoiceOver/TalkBack/Dynamic Type: accessibilityLabel/Role on primitives in ui/Primitives.tsx; font scaling capped
  per component (maxFontSizeMultiplier) because the map UI is fixed-geometry; line heights rounded to 0.5 pt (spike rule).
- iPhone rail layout: separate layout branch driven by window width class from useWindowDimensions, designed in
  docs/DESIGN.md; ticket U5. The spike covers iPad only.
- Israel features: pure logic ports (route following, LSA, closure mapper, briefing filter, flight plan message) into
  domain/israel/; chart packs from R2 (Services/IsraelChartService.swift, IsraelChartStore.swift, web/charts) use
  expo-file-system + react-native-blob-util (already in spike deps); NOTAM relay stays web/notam-relay unchanged.
- Flight recording/replay/debrief, logbook, currency, aircraft profiles: ports as in section 7 tracks.

## 4. User data migration (same bundle id, in-place upgrade)

> Cancelled: see "No import of Swift user data" in section 10. The text below is kept for reference only.

Where the data lives (verified in code):
1. SwiftData store: opened by EFBModelContainer.make()/makeForApp() in efb-212/Data/Models/ModelContainerFactory.swift
   with `ModelConfiguration()` and no URL, i.e. SwiftData's default store: `default.store` (SQLite, Core Data table
   layout: ZUSERSETTINGS, ZAIRCRAFTPROFILE, ZPILOTPROFILE, ZFLIGHTPLANRECORD, ZFLIGHTRECORD, ZLOGBOOKENTRY plus Z_PRIMARYKEY,
   Z_METADATA, Z_MODELCACHE) in the app's Application Support directory. UNVERIFIED exact path/file names on device;
   ticket D1 confirms by running the Swift app in CI and listing the container.
   Schema is VersionedSchema SchemaV1 (UserSettings.swift:14); the six types are AircraftProfile, FlightPlanRecord,
   FlightRecord, LogbookEntry, PilotProfile, UserSettings.
2. GRDB recording DB: `<Application Support>/efb-212/recording.sqlite` (efb-212/Data/RecordingDatabase.swift:133-135),
   WAL mode, tables track_points, transcript_segments, phase_markers, debrief_results, flight_route_legs (with
   additive migrations including a transcript_segments rebuild at line ~225). GRDB records applied migrations in
   `grdb_migrations`.
3. Other Application Support files (re-downloadable, import optional): Israel NOTAM cache
   (Services/IsraelNotamService.swift:278), chart store (IsraelChartService.swift:111), terminal procedures
   (TerminalProcedureService.swift:170), remote config (RemoteConfigStore.swift:49), flight persistence/recording audio
   files (Services/Recording/FlightPersistenceService.swift:186, RecordingCoordinator.swift:426), aviation DB copy
   (AviationDatabase.swift:42).
4. UserDefaults: keys found by grep include hasSeenOnboarding, offlineBlockNetwork, simulateDatabaseFailure, plus
   NotamReadStateStore (Services/NotamReadStateStore.swift) and flight-log / layer toggles in Views (AppStorage in
   FlightLogStrip.swift, LayersColumnView.swift, SettingsView.swift, MapContainerView.swift). Ticket D1 produces the full
   key list; unknown keys are ignored, known keys map into user_settings.
5. Keychain: service "quartermint.efb-212.faa-notam-api" (Services/NotamService.swift:65; KeychainStore.swift). expo-secure-store
   uses a different keychain service/namespace, so the importer must read the old service (via a tiny native module or
   expo-secure-store keychainService option set to the old service name; UNVERIFIED option name, ticket D3 confirms)
   and re-save. Otherwise the user must re-enter the key; acceptable fallback, log it.

Importer design (src/data/import/swift/, runs once at first RN launch, gated by a `migration_state` row):
- Step 0: detect legacy files; if none, mark done (fresh installs and all Android).
- Step 1: open default.store READ-ONLY via expo-sqlite attached by path, never modify or delete it. Map Z-columns to
  our tables using a column map table-driven by model; convert Core Data timestamps (seconds since 2001-01-01) to epoch ms;
  decode UUID blobs; arrays/dictionaries stored by SwiftData as binary plist or JSON blobs get decoded per column in the
  map (ticket D1 enumerates the column types from the fixture, so this plan does not guess them).
- Step 2: recording.sqlite: copy file(s) (including -wal/-shm after a checkpoint) to the RN location, run remaining RN
  migrations, verify row counts and a checksum of track_points per flight.
- Step 3: in one transaction mark migration_state=complete. Any failure: leave legacy files intact, show a recoverable
  banner with "retry import" and "export legacy data" (share the original files). Old files are deleted only by a later
  app version after 2 releases with success telemetry (counter only).
- Idempotent and resumable; no partial state visible to the UI.
Tests:
- Fixture generator: a CI job on macos runner builds the Swift app (existing build) and runs a new XCTest or launch
  hook (a DEBUG-only seed command, same style as ScreenCaptureHooks.swift / the -KanafScreen launch arg) that populates
  SwiftData with a deterministic dataset (3 aircraft, 2 pilots, 5 plans, 10 flights, 20 logbook rows, non-default settings,
  one flight with 3,600 track points and transcript segments) and uploads `fixtures/swift-store-v1.zip` as an artifact;
  the RN CI downloads it. Also commit a small checked-in copy (< 200 KB) so Linux Jest never needs macOS. Regenerate when
  Swift schema changes; since Swift is frozen, effectively once.
- Jest importer tests run on Linux with the checked-in fixture; field-level equality assertions per model.
- A device test: install the last TestFlight Swift build on an iPad, create data, upgrade to the RN build, and the
  importer banner shows "complete" (P6, manual, once).
- Corrupt/partial fixtures: empty store, store with only recording.sqlite, truncated -wal, future schema version.
Android: no legacy data; importer is a no-op.

Risk: a SwiftData store written by a newer OS can have schema metadata our importer does not know. Mitigation: the
importer reads by column name and ignores unknown columns, and records Z_METADATA version in telemetry counter.

## 5. Porting method

### 5.1 Classification (from cross-platform.md measured buckets, to be re-verified by script in ticket P0)
- Portable (Foundation/GRDB only, 43 files, 7.1k lines): port 1:1 to domain/ test-first.
- Apple, no UI (60 files, 13.6k lines): split into pure logic (kept, ported) and adapter (rewritten against Expo APIs).
- UI (all of Views/, 56 files, 12.2k; the doc counts 74 files/20k including UIKit/map files in Services): rewritten in
  React, driven by tokens and the screenshot gate.

P0 ticket writes `tools/port/inventory.mjs` that lists every Swift source and test file with its class and its target
TS path in a checked-in table (`app/docs/port-map.md`). The table is the progress tracker and the parity P2 evidence.

### 5.2 Test-first characterisation
For each domain module: (1) read the Swift tests under efb-212Tests/ServiceTests, DataTests, ViewModelTests,
CharacterizationTests; (2) translate each case to Jest with the same name and the same inputs/expected values
(table-driven, same fixtures from efb-212Tests/Fixtures, copied or referenced from a shared location); (3) watch it fail;
(4) port the Swift implementation until green. Translate mechanically; do not "improve" behaviour. Differences found
(a Swift bug) become an explicit decision recorded in the port map, with default = preserve Swift behaviour.

Dropped tests (listed in the port map with reasons):
- Tests of Apple frameworks (SwiftData container, @Observable, PrivacyManifestTests.swift is replaced by a config
  assertion on app.config.ts privacy manifest keys).
- Mocks/ files; replaced by TS fakes, not ported.
- ViewModel tests that only test SwiftUI binding plumbing; keep the ones asserting domain decisions.
- UI tests (efb-212UITests) replaced by the scenario smoke and screenshot gate.
Expected result: about 700 to 900 of ~1,100 cases port; the rest are dropped or replaced. The ratio is reported by P0.

### 5.3 Scenario sims
Today tools/ci/fly-scenarios.sh (158 lines) launches the DEBUG iOS app with a scenario from tools/flight-sim/scenarios/
(8 files), plays it via Services/Simulation/ScenarioPlayback.swift and asserts via logs/screens. RN rebuild:
- Scenario format: reuse the existing JSON from tools/flight-sim (generated by gen.py) unchanged so both apps run the same
  files during the transition and the format is the shared contract.
- Two levels: (a) pure Jest: feed scenario samples through the domain RecordingCoordinator/route-following with a fake
  Clock and LocationSource, assert emitted events (alerts, phases, closures) against golden JSON; runs on every PR on
  Linux in seconds. (b) device-level smoke: a DEV build flag (`-KanafScenario <name>` on iOS / intent extra on Android,
  matching the spike's `-KanafScreen` and `kanaf-rn://` hooks) plays the scenario through the real UI, captures screens,
  and fails on crash or missing expected on-screen alert. Run on macOS simulator and Android emulator jobs.
- Goldens for (a) are produced by running the Swift scenario path once (Swift frozen) and checked in; ticket S1.

### 5.4 Screenshot fidelity gate
Spike scripts: spikes/kanaf-rn/scripts/ios-capture.sh, android-capture.sh, compare.mjs (pixelmatch, ssim.js, sharp),
references in spikes/kanaf-rn/reference. Promote to app/. Rules: references come from the SwiftUI app via
tools/ci/capture-screens.sh (151 lines) and are committed once per screen/orientation/appearance; thresholds start at
SSIM >= 0.90 for map-heavy screens and >= 0.85 for text-heavy columns, ratcheted up, per-screen overrides in a JSON file.
Android is compared against the same SwiftUI references (the design is shared), with a looser Android threshold set by the
owner (font rendering differs), see Q9. The airport column (0.72, row drift) is fixed in ticket U2 first, because it is
the largest known fidelity gap and its cause (line height / row metrics) likely affects every text column.

## 6. CI/CD

Current state (verified): .github/workflows/ci.yml (193 lines) jobs: lint (gitleaks, Conventional Commits, lefthook
checks), web (matrix), unit-tests on macos-latest (iPad simulator), simulation (fly scenarios, capture screens),
build-release-xcode (macos-26, advisory), gate (the required "CI gate"). release.yml (121 lines): release-please
tags vX.Y.Z on main, then a macOS job in environment `testflight` runs fastlane `beta` (fastlane/Fastfile:149) with secrets ASC_KEY_ID,
ASC_ISSUER_ID, ASC_KEY_P8, DIST_CERT_P12_BASE64, DIST_CERT_P12_PASSWORD (release.yml:104-108). rn-spike.yml (281 lines): `ios` and
`android` jobs plus web/ota tests. testflight-crashes.yml (47 lines) polls crashes.

### 6.1 PR checks
- Linux (ubuntu-latest, fast, required): `tsc --noEmit`, eslint (including the boundary rule), Jest (domain, data,
  importer, scenarios level a), web/ota tests (existing), an Expo `expo-doctor` and `expo prebuild --no-install --clean`
  dry run to catch config drift. Target under 5 minutes.
- macOS (required once stable): `expo prebuild` + xcodebuild simulator build + capture screens + compare.mjs gate
  + scenario smoke (b). Already done in rn-spike.yml ios job; promote and cache pods/derived data.
- Android: ubuntu with KVM (reactivecircus/android-emulator-runner pattern, UNVERIFIED which action rn-spike.yml uses; it
  has an `android` job at line 140) running the same gate and smoke. KVM is free on public-repo Linux runners.
- Path filters so Swift-only and web-only PRs skip RN jobs and vice versa; the single "CI gate" job keeps working by
  treating skipped as success (same pattern already in ci.yml gate).
- Dev host (Linux): `tools/check.sh` already exists for local checks; extend with `npm --prefix app test` so the same
  command runs in lefthook (lefthook.yml) and CI.

### 6.2 Release
- iOS: adapt Fastfile `beta` to build from the prebuilt `app/ios` workspace: same ASC API key and cert secrets, same
  `testflight` environment. Add `expo prebuild --platform ios` before build; signing and upload steps unchanged. The
  version comes from release-please (version.txt) written into app.config.ts at build time (not committed twice).
- Android: Gradle `bundleRelease` + upload to Play internal track via fastlane supply or the Google Play Developer API
  using a service-account JSON in a GitHub environment secret `play`. Needs the owner to register the $25 Play
  account (Q4) and to create the app listing, upload key and (recommended) Play App Signing. Until then Android builds
  attach an AAB/APK artifact to the release for sideload testing.
- release-please: keep as is; the extra-files list in release-please-config.json adds app/app.config.ts or package.json
  version once the app moves.
- Build number: derive from the GitHub run number plus offset above the highest existing CURRENT_PROJECT_VERSION from ASC
  (ticket R1 reads the real current value; do not guess).

### 6.3 OTA publish workflow (web/ota)
- Workflow `ota-publish.yml`, manual (workflow_dispatch) plus optional on-tag, inputs: channel (production|beta), runtime
  version, platform. Steps: install, `expo export`, run web/ota/cli/ota.mjs publish. The CLI signs with the private key and
  writes R2 directly (web/ota/README.md "Keys"). The Worker has no upload route and no key (verified in README).
- Key custody options: (A) owner-only: the owner runs the publish CLI from the host that has ~/.config/kanaf/ota; the
  workflow only builds and uploads the export as an artifact. (B) GitHub environment secret `ota` holding the PKCS#8 key
  and an R2 API token scoped to the bucket, with required reviewers. Recommendation: B for beta channel (low risk,
  required reviewer = owner) and A-equivalent for production at first (owner approves the environment deployment, so the key
  is still gated by a human). The key never lives in the repo; certificate.pem is public and is embedded in the app.
  This is Q5 (BIG: determines whether anyone but the owner can ship OTA).
- Guardrails: (1) apply on cold start only (`checkAutomatically: ON_LOAD`, no reload mid-flight; a flying app must never
  swap JS during a recording; additionally the updater checks `RecordingCoordinator.isActive` and defers), (2) staged
  channels: every update goes to beta first, soak 48 h with the crash signal, then promote to production by
  re-pointing the channel pointer (R2 `channels/<channel>/...json`), (3) rollback runbook: publish a directive
  (rollBackToEmbedded) or re-point the pointer to the previous archived `updates/<channel>/<rv>/<platform>/<id>.json`; written as
  docs/RUNBOOK-OTA.md with exact commands and tested in CI against wrangler dev (exists for publish; add rollback test),
  (4) crash signal per update: the app records the active updateId in the telemetry counter and in the crash report context,
  and a daily job compares crash-free sessions between updateIds, alerting in an issue when the new id is worse (free:
  GitHub Actions schedule), (5) runtime version policy `fingerprint` or manual, so a native change cannot receive a JS
  update (web/ota README states native changes need a store release; make it enforced in the publish workflow by checking
  runtimeVersion equality), (6) OTA must never ship changes to the data schema migrations without a paired binary test
  (migrations ship in JS; a bad migration cannot be rolled back by OTA after it ran, so migrations are gated: they run only
  when the binary's `maxSchemaVersion` allows, set per store release).
- Review constraint: Apple guideline 3.3.2 permits interpreted-code updates that do not change the app's primary purpose;
  keep OTA to bug fixes and data/UX tweaks, no feature changes in the primary purpose.

## 7. Milestones

Sizing: each ticket 0.5 to 2 agent days. IDs: P = process/port, F = foundation, D = data, M = map, S = services, U = UI,
R = release, Q = quality. "Owned files" prevents merge conflicts. Dependencies in `needs`. Tickets marked || can run in
parallel with others in the same phase.

### Phase 0: Foundation (unblocks parallel tracks; mostly sequential spine, three parallel lanes)
- F1 Promote spike to app/ (git mv, rename scheme/bundle variants, fix rn-spike.yml paths to app/, keep spike CI green).
  Owned: spikes/kanaf-rn -> app/, .github/workflows/rn-spike.yml (renamed rn.yml). Accept: CI green on all existing jobs;
  `npm --prefix app run tsc` passes; no file left under spikes/kanaf-rn. needs: none. (1 d)
- F2 Tooling: Jest (ts-jest or jest-expo), eslint with the domain-boundary rule, prettier config matching repo, `app/package.json`
  scripts (test, lint, typecheck), lefthook entries, tools/check.sh extension. Owned: app/jest.config.*, app/eslint.config.*,
  lefthook.yml, tools/check.sh. Accept: a sample domain test runs on Linux in CI; importing react-native from domain fails lint.
  needs F1. (1 d)
- F3 App skeleton: directory layout of section 2, router decision, Zustand store, error types, Db interface plus
  expo-sqlite adapter plus node sqlite test adapter. Owned: app/src/data/db*, app/src/domain/errors.ts, app/app/ (router). Accept:
  in-memory Db contract test passes with both adapters (R-tree query works in both). needs F2. (1.5 d)
- P0 Port inventory script and port-map.md with counts and mapping (see 5.1). Owned: tools/port/, app/docs/port-map.md. Accept:
  every Swift file has a class and target; totals reproduce 175 source files / 114 test files. needs none; || with F1-F3. (1 d)
- D1 Swift fixture generator and schema discovery: DEBUG seed hook in Swift (frozen exception, Swift fix lane), macos CI job that
  produces swift-store fixtures and lists actual on-device store paths, UserDefaults keys, keychain service names.
  Owned: efb-212/Services/Simulation/ (seed hook), tools/ci/make-fixtures.sh, .github/workflows/fixtures.yml, app/tests/fixtures/swift-store-v1/.
  Accept: fixture checked in (<200 KB), doc `app/docs/swift-store-layout.md` with real table/column types. needs none; ||. (2 d)
- S0 Scenario goldens: run the 8 scenarios through the Swift app, export event logs as golden JSON. Owned: tools/ci/fly-scenarios.sh
  (export step), app/tests/goldens/. Accept: 8 golden files, reproducible twice byte-identical. needs none; ||. (1.5 d)
- Q1 Fidelity gate promotion: move compare.mjs/captures to app/, add per-screen threshold file, make CI fail below. Owned:
  app/scripts/, app/reference/, ci job. Accept: gate red/green demonstrably on a deliberately broken token. needs F1. (1 d)
- R1 Release plumbing on a scratch track: fastlane `beta` adaptation to expo prebuild project, TestFlight upload of an empty
  RN shell under io.omer.efb with a build number above the Swift one, on an internal-only group; Android AAB artifact. Owned:
  fastlane/, .github/workflows/release.yml. Accept: shell build visible in TestFlight internal. needs F1, owner Q2/Q3. (2 d)

Exit criterion for Phase 0: F1-F3 merged, fixtures and goldens exist, release plumbing proven.

### Phase 1: Core tracks (parallel; each track is owned by one agent)
Track A - Data (needs F3, D1)
- D2 Schema + migrations + repositories for six models, with Jest per repository. Owned: app/src/data/schema, repos. (2 d)
- D3 Importer for default.store plus UserDefaults plus keychain note (section 4). Owned: app/src/data/import/. Accept: fixture
  equality tests, corrupt-case tests, idempotent re-run. needs D2. (2 d)
- D4 Recording DB port (GRDB shapes, WAL, recovery queries) + importer step 2. Owned: app/src/data/recording/. needs D2. (1.5 d)
- D5 Aviation/Israel DB access layer, asset versioning, copy-on-first-launch, spatial queries. Owned: app/src/data/aviation/.
  Accept: ports of DataTests aviation tests pass. needs F3. (2 d)
Track B - Domain ports (needs F3, P0; all parallel by module)
- L1 Geometry/region/units/metar/taf (Core/*): 2 d. L2 Route planner + flight plan model (Services/ route files): 2 d.
  L3 Israel route following, CVFR routes, LSA rules, closure mapper, briefing filter, alert evaluator: 2 d each in two
  tickets. L4 Recording logic: phase detector, vertical speed, auto start gate, recovery, coordinator state machine: 2 d.
  L5 Debrief: CVFRDebrief, FlightSummaryBuilder, TranscriptTextMatcher: 1.5 d. L6 Currency + logbook rules: 1 d. L7 Prediction
  (AirspacePredictor): 1.5 d. L8 Replay engine: 1 d. Acceptance for each: the Swift tests mapped in port-map.md pass in Jest;
  scenario goldens (a) for modules they affect.
Track C - Map and adapters (needs F3)
- M1 Production MapSurface with layers (sectional visible at runtime, airspace, TFR, METAR dots, Israel overlays) driven by domain output.
  2 d. M2 Follow mode + ownship + camera reducer. 1.5 d. M3 Offline packs. 2 d. M4 Airport diagram overlay with precomputed
  georeferencing (tools/apd-georef) and PDF chart viewer. 2 d.
- A1 Location adapter + background + foreground service. 1.5 d. A2 Audio recorder adapter. 1 d. A3 Speech adapter + vocabulary
  (S2 measurement). 1.5 d. A4 SecretStore. 0.5 d. A5 Telemetry/crash signal (Q7). 1.5 d. A6 AI debrief iOS adapter. 1.5 d.
Track D - UI (needs Q1; screens consume repos/domain through hooks; can start with fakes)
- U1 Tokens/primitives audit and accessibility roles. 1 d. U2 Airport column fidelity fix (0.72 -> target). 1.5 d.
  U3 Flight log strip/columns/footer production versions. 2 d. U4 Search, nearest airport, weather, briefing sheets. 2 d x2.
  U5 iPhone rail layout. 2 d. U6 Hebrew/RTL string table and layout pass. 2 d. U7 Settings, onboarding, aircraft/pilot profiles,
  logbook, currency screens. 2 d x2. U8 Recording UI, replay UI, debrief UI. 2 d x2. U9 Accessibility pass (VoiceOver/TalkBack,
  Dynamic Type caps) 2 d.
Track E - Services glue
- S1 Data refresh scheduler, NOTAM service (+ relay client), Air/SIGMET, chart packs from R2 download/store, remote config,
  terminal procedures; 1.5 d each, split by service. Owned: app/src/services/*.

### Phase 2: Integration
- I1 Wire the full app: navigation, stores, startup sequence (migration first, then DB open, then UI), error banners. 2 d.
- I2 Scenario smoke level (b) on both platforms in CI. 2 d. I3 Flight recording end to end on devices (battery/Doze, screen
  off 30 min), tuning. 2 d. I4 Telemetry counters and OTA guardrail wiring (cold start apply, defer during recording). 1.5 d.
- R2 OTA publish workflow + rollback runbook + tests. 2 d. R3 Android release lane (needs Q4). 1.5 d.
- Q2 Full fidelity sweep across all screens, thresholds ratcheted. 1.5 d. Q3 Performance budget: cold start, map FPS on iPad
  Air-class and a low-end Android (owner device), memory. 1 d.

### Phase 3: Beta and cutover
- B1 TestFlight beta via OTA beta channel, internal then external group. Importer telemetry watched. B2 Owner P6 device flights.
- B3 Production cutover on TestFlight (RN build replaces Swift). B4 Two weeks soak, then Swift deletion PR (section 2).
- B5 Post-parity: Android Gemini Nano debrief (optional), iPad/Android tablet polish.

Parallelism summary: Phase 0 has F1->F2->F3 as spine and P0, D1, S0 off-spine. Phase 1 runs Tracks A-E concurrently with at
most one agent per owned directory. The schedule is dominated by L-tickets and U-tickets; the critical path is
F1 -> F2 -> F3 -> D2 -> D3 -> I1 -> B1.
Rough size: ~65 tickets, 90 to 110 agent days sequential, calendar about 6 to 8 weeks with 4 to 5 agents (ESTIMATE, not measured).

## 8. Open questions for the owner

Q1 (BIG: public names). App identity on Android and display name. Options: (a) package `io.omer.efb`, name "Kanaf" matching iOS;
(b) new package. Recommend (a): it is permanent on Play and matches iOS. Cannot change after first upload.
Q2 (BIG: data formats, public names). Bundle id during development. Options: (a) RN dev variant `io.omer.efb.dev` and production `io.omer.efb`,
(b) develop under io.omer.efb.rnspike until cutover then rename. Recommend (a): avoids a rename at cutover and keeps an installable dev build beside the TestFlight app.
Q3 (BIG: store listing). Version numbering at cutover. Options: (a) continue as next minor (e.g. 1.x), (b) 2.0.0. Recommend (a) so users see an update, not a different product,
and release-please history stays linear.
Q4 (approval needed, cost). Register Google Play ($25 one-time) now or after parity? Recommend register during Phase 1 so internal testing
and Play App Signing are ready by Phase 2; until then artifacts only.
Q5 (BIG: affects who can ship). OTA key custody: A owner-only host, B GitHub environment secret with required reviewer. Recommend B for beta, owner approval
gates production (section 6.3). Key rotation plan needed either way (new cert requires a store release).
Q6 (BIG: data formats, chart packs). Move airport diagram georeferencing offline into the chart pack (precomputed transforms) instead of on-device Vision.
Options: (a) offline (recommend; one implementation for both OSes, tools/apd-georef exists), (b) keep on-device iOS only (Android no diagrams), (c) port with an OCR lib.
Q7 (BIG: privacy). Telemetry replacement. Options: (a) first-party counters on the existing Worker, no ids (recommend), (b) PostHog free tier (third party, privacy
policy PRIVACY.md changes), (c) none. Needs PRIVACY.md update either way; the policy is public so this is a public commitment.
Q8. Android AI debrief: hide (recommend) or Gemini Nano on a device list in v1.
Q9. Fidelity thresholds on Android: owner sets minimum SSIM (recommend 0.85 map, 0.80 text) since system fonts and rendering differ.
Q10 (BIG: most remaining work). Swift freeze policy: (a) fixes only until parity (recommend), (b) keep adding features to both. (b) roughly doubles the work and makes parity unmeasurable.
Q11. Minimum OS: iOS 26.0 today (pbxproj IPHONEOS_DEPLOYMENT_TARGET = 26.0). Keep iOS 26 (recommend; SpeechAnalyzer and FoundationModels need it) and set Android minSdk to 29 or 30?
Recommend 30 (about 95%+ of devices UNVERIFIED) for background location behaviour; owner confirms who the Android pilots are.
Q12. Is the owner ok that the first RN TestFlight builds go to an internal group only until P1-P6 are met? Recommend yes.

## 9. Risks

R1 Background GPS and audio for 30+ minutes with screen off, especially Android Doze and OEM battery killers. Mitigation: foreground service + exemption prompt
copy; test on a real low-end Android. Earliest ticket: A1/I3; start a 30-minute soak test in A1.
R2 Data loss or mis-import from SwiftData store. Mitigation: read-only import, fixtures, no deletes, export fallback. Earliest: D1/D3.
R3 SwiftData store layout/path assumptions wrong. Mitigation: D1 discovers from a real Swift build before D3 starts. Earliest: D1.
R4 Apple FoundationModels and SpeechAnalyzer access via RN libs immature. Mitigation: small local Expo modules fallback; AI debrief is non-critical. Earliest: A6, A3.
R5 Fidelity gap (airport column 0.72) and Android rendering differences. Mitigation: U2 early, per-platform thresholds. Earliest: U2/Q1.
R6 Map performance with many overlays on RN bridge. Mitigation: layers as MapLibre style data, not React children; perf budget Q3. Earliest: M1.
R7 expo-sqlite R-tree custom build drifts with SDK upgrades. Mitigation: config plugin with a test that queries an R-tree table in CI. Earliest: F3.
R8 OTA pushes a bad JS bundle to an airborne user. Mitigation: cold start only, defer while recording, beta soak, rollback runbook. Earliest: R2/I4.
R9 Port of ~1,100 tests slips or silently drops behaviour. Mitigation: port-map table, per-module gate, goldens from Swift. Earliest: P0, L1.
R10 Scope creep during rewrite (Swift features added). Mitigation: Q10 freeze. Earliest: now.
R11 App Store review: OTA policy (3.3.2) or the rebuild being flagged; background modes justification stays the same (location, audio per Info.plist).
Mitigation: keep OTA limited to fixes, keep entitlements identical. Earliest: R1 shell build submitted to TestFlight external review.
R12 macOS runner cost/time: iOS jobs on public repo are free, but queue time rises. Mitigation: path filters, caching. Earliest: R1.
R13 Security: OTA signing key exposure, SSRF/URL handling in chart pack and NOTAM relay clients, secrets (FAA NOTAM API key) stored in secure-store only,
never in JS bundle or repo; deep link handlers (kanaf-rn://, production scheme) must be debug-only for screen launching or must validate inputs.
Mitigation: gitleaks already in CI lint; add a test that production builds do not register the debug launch hooks. Earliest: F1, A4.

## Summary (15 lines)
1. Promote spikes/kanaf-rn to app/ at repo root (git mv); Swift app keeps shipping from main, frozen to fixes until parity, deleted after 2 weeks of RN soak.
2. Parity = migration importer green + ported tests + 8 flight scenarios + screenshot SSIM gate + owner device flights (P1-P6) plus an accessibility floor.
3. Architecture: pure-TS domain/ and data/ (lint-enforced, no RN imports), adapters/ for Expo APIs, ui/ for React; Zustand state; expo-router.
4. Data: kanaf.sqlite with six tables and PRAGMA user_version migrations; recording.sqlite keeps GRDB table shapes 1:1; aviation DBs reused.
5. Migration: SwiftData default.store (Core Data layout) read-only import, GRDB file copy, keychain service quartermint.efb-212.faa-notam-api re-save; never delete legacy data.
6. Fixture stores are produced by a Swift DEBUG seed hook in CI and checked in small, so Linux Jest tests the importer; D1 verifies real paths before D3.
7. Porting: mechanical test-first translation of Swift tests, port-map.md as tracker; expect about 700-900 of ~1,100 cases to port (grep found 1,181, not 1,065).
8. Scenarios: reuse tools/flight-sim JSON; Jest level with Swift-generated goldens on every PR, plus device smoke on iOS sim and Android emulator.
9. CI: Linux tsc/eslint/Jest required; macOS and KVM Android jobs run capture + compare gate; "CI gate" stays the single required check.
10. Release: fastlane beta adapted to expo prebuild with existing ASC secrets; Android via Play internal after the $25 registration; release-please unchanged.
11. OTA: workflow_dispatch publish, beta then production, cold-start only and deferred during recording, rollback runbook, per-updateId crash signal, key never in repo.
12. Plan has ~65 tickets in 4 phases; Phase 0 (F1-F3 spine plus P0, D1, S0 in parallel) unblocks 5 tracks; critical path F1->F2->F3->D2->D3->I1->B1.
13. Decisions I made that need confirmation: airport diagram georeferencing moved offline (Q6), first-party telemetry (Q7), Android AI debrief hidden (Q8).
14. BIG owner questions: Android package/name (Q1), dev bundle id (Q2), version numbering (Q3), OTA key custody (Q5), Swift freeze policy (Q10).
15. Unverified items flagged inline: SwiftData file path, UserDefaults key list, keychain option name, Android minSdk share, telemetry filenames.

## 10. Owner decisions (2026-11-09)

| Question | Decision |
|---|---|
| Q1 Android identity | Package `io.omer.efb`, display name "Kanaf EFB" (same as iOS) |
| Q2 Dev bundle id | `io.omer.efb.dev` for development builds, `io.omer.efb` for production |
| Q3 Version at cutover | Next minor (1.x); release-please history stays linear |
| Q4 Google Play | Owner already has a developer account (account details to be supplied for R3) |
| Q5 OTA key custody | GitHub environment secret with a required reviewer; CI publishes `beta`, owner approves `production`; key also stays on the owner host |
| Q6 Airport diagrams | Precompute georeferencing offline into the chart packs (tools/apd-georef); no on-device Vision |
| Q7 Telemetry | First-party counters on our Worker, no identifiers; PRIVACY.md updated accordingly |
| Q10 Swift app | Fixes only until parity, then deleted per section 2 |
| No import of Swift user data | The RN app starts with a clean slate (owner, 2026-11-10). Section 4 and ticket D3 are cancelled; D4 has no importer step. |
| Q8, Q9, Q11, Q12 | Recommendations adopted: hide the AI debrief on Android in v1; Android SSIM floors 0.85 map / 0.80 text; iOS 26 and Android minSdk 30; first RN TestFlight builds to an internal group until P1-P6 |

Also decided: Android demand is confirmed and the owner ran the real-device checks on the spike (2026-11-09). The current SwiftUI app is offered on Apple Silicon Macs and Vision Pro as "Designed for iPad" (PR #21).
