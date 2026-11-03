# Archive configuration: verified 2026-10-31

Read from `efb-212.xcodeproj/project.pbxproj` and from the Info.plist of the archived app.

## Release settings (app target)
| Setting | Value | Notes |
|---|---|---|
| PRODUCT_BUNDLE_IDENTIFIER | `io.omer.efb` | set by the owner; keep |
| DEVELOPMENT_TEAM | `6F8N897928` | set by the owner; keep. Test targets and the project-level default still carry the old team `SKGLKG576D`; harmless for the app archive |
| CODE_SIGN_STYLE | `Automatic` | development; the release lane switches the Release config to manual signing (Apple Distribution, `io.omer.efb AppStore`) for the archive and restores the file |
| MARKETING_VERSION | `1.0` | overridden at release by `version.txt` |
| CURRENT_PROJECT_VERSION | `1` | overridden at release by the commit count |
| IPHONEOS_DEPLOYMENT_TARGET | `26.0` | |
| TARGETED_DEVICE_FAMILY | `1,2` | iPad and iPhone (was `2`; re-verified 2026-11-02, archived `UIDeviceFamily [1, 2]`) |
| SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD | `NO` | no Mac listing |
| ITSAppUsesNonExemptEncryption | `NO` | standard HTTPS only; no per-upload export question |
| PRODUCT_NAME | `efb-212` | file/bundle name only |
| INFOPLIST_KEY_CFBundleDisplayName | `Kanaf` | home-screen name (set by T30) |
| Info.plist category | `public.app-category.productivity` | metadata doc proposes Navigation as primary category in App Store Connect (separate setting) |

## Usage strings (present)
- `NSMicrophoneUsageDescription`: "Kanaf records cockpit audio during flights for transcription and debrief."
- `NSSpeechRecognitionUsageDescription`: "Kanaf transcribes cockpit audio in real-time to create flight transcripts."
- `NSLocationWhenInUseUsageDescription`: "Kanaf uses your location to show your position on the aviation map and provide navigation guidance."
- `NSLocationAlwaysAndWhenInUseUsageDescription`: "Kanaf uses your location in the background to continue tracking your flight when the screen is off."
- `UIBackgroundModes` = `location`, `audio` (cockpit audio recording continues with the screen off; Info.plist).

## Release archive check (run 2026-10-31)
```
xcodebuild archive -project efb-212.xcodeproj -scheme efb-212 -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/efb.xcarchive \
  CODE_SIGNING_ALLOWED=NO
```
Result: **ARCHIVE SUCCEEDED**. The archived `efb-212.app` reports:
`CFBundleIdentifier io.omer.efb`, `CFBundleShortVersionString 1.0`, `CFBundleVersion 1`,
`ITSAppUsesNonExemptEncryption false`, `UIDeviceFamily [2]`, `MinimumOSVersion 26.0`, and contains
`PrivacyInfo.xcprivacy`. Two deprecation warnings only (`allowBluetooth` in `AudioRecorder.swift`,
`setVisibleCoordinateBounds` in `FlightPlanViewModel.swift`). Nothing was uploaded.

Re-run 2026-11-02 (same command, output `/tmp`, deleted afterwards): archive succeeded; `CFBundleShortVersionString 1.0`,
`CFBundleVersion 1` (the upload script overrides the build number), `MinimumOSVersion 26.0`, `UIDeviceFamily [1, 2]`,
`UIBackgroundModes [location, audio]`, `ITSAppUsesNonExemptEncryption false`.

## Versions
Project value: `1.0 (1)`. Releases override both on the command line (`fastlane/Fastfile`): the version from
`version.txt`, which release-please bumps from Conventional Commits, and the build number from `git rev-list --count HEAD`
(or `BUILD_NUMBER`), which must exceed every earlier upload of the version. Build 88 is version 1.0.

## Archive and upload
`bundle exec fastlane ios beta` (CI: `.github/workflows/release.yml`). Export options live in the lane: app-store,
manual signing with team `6F8N897928`, `uploadSymbols` true, `manageAppVersionAndBuildNumber` false.

## Open items
- None for the display name (set by T30). `PrivacyInfo.xcprivacy` now declares FileTimestamp `C617.1`.
- MapLibre and GRDB both ship their own privacy manifests (inspected 2026-11-02).
