# Archive configuration: verified 2026-10-31

Read from `efb-212.xcodeproj/project.pbxproj` and from the Info.plist of the archived app.

## Release settings (app target)
| Setting | Value | Notes |
|---|---|---|
| PRODUCT_BUNDLE_IDENTIFIER | `io.omer.efb` | set by the owner; keep |
| DEVELOPMENT_TEAM | `6F8N897928` | set by the owner; keep. Test targets and the project-level default still carry the old team `SKGLKG576D`; harmless for the app archive |
| CODE_SIGN_STYLE | `Automatic` | |
| MARKETING_VERSION | `1.0` | store version |
| CURRENT_PROJECT_VERSION | `1` | build number |
| IPHONEOS_DEPLOYMENT_TARGET | `26.0` | |
| TARGETED_DEVICE_FAMILY | `2` | iPad only |
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
- `UIBackgroundModes` includes `location`.

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

## Versions and proposal
Current: `1.0 (1)`. Proposed first TestFlight upload: `1.0 (1)`. Next uploads: `1.0 (2)`, `1.0 (3)` and so on.
Bump `MARKETING_VERSION` only when starting a new release (for example `1.1`).

## Archive steps
1. Scheme `efb-212`, Release configuration.
2. Destination: Any iOS Device (arm64).
3. Product > Archive.
4. Organizer > Distribute App > App Store Connect > Upload.
5. Automatic signing with team `6F8N897928` handles provisioning.

## Open items
- None for the display name (set by T30). `PrivacyInfo.xcprivacy` now declares FileTimestamp `C617.1`.
- MapLibre and GRDB both ship their own privacy manifests (inspected 2026-11-02).
