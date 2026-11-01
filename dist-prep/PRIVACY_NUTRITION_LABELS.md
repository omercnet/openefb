# Privacy: what leaves the device, and the App Store answers

Audited from the code 2026-10-31 (grep of every `https://` endpoint, `URLSession` use, Speech, FoundationModels).

## Off-device network traffic (complete list)
| Destination | What it carries | Personal data? |
|---|---|---|
| `aviationweather.gov` METAR/TAF | station IDs (`ids=KOAK`) | no |
| `aviationweather.gov` PIREPs | bounding box around the **selected airport** (not the aircraft position) and an age | no position of the user |
| `aviationweather.gov` AIRMET/SIGMET, winds aloft | whole-product requests; winds aloft sends only a coarse region (`all`, alaska, pacific, hawaii) | no |
| `tfr.faa.gov` | whole-country TFR list plus per-TFR detail XML | no |
| `external-api.faa.gov` NOTAMs | airport identifier plus the pilot's **own** FAA `client_id`/`client_secret` (kept in Keychain, only if the pilot adds a key) | the pilot's own API credentials, sent to the FAA only |
| `external-api.faa.gov/apra/dtpp`, `aeronav.faa.gov/d-tpp` | chart cycle and terminal chart PDFs | no |
| `tiles.openfreemap.org` | vector map tiles and fonts | tile coordinates and IP address |
| `tiles.arcgis.com` (FAA VFR sectional) | raster tiles | tile coordinates and IP address |
| `server.arcgisonline.com` (Esri World Imagery) | satellite tiles, only if the Satellite base map is chosen | tile coordinates and IP address |
| `tile.opentopomap.org` | terrain tiles, only if the Terrain base map is chosen | tile coordinates and IP address |

GPS position is never put in a request. Tile requests reveal the map area on screen (and the device IP) to the tile
host, as every map app does. There is no analytics, crash, advertising or tracking SDK in the project.

## On-device only
- Location: moving map, nearest airports, track recording. Stored in the local database.
- Audio and transcripts: `AVAudioEngine` recording; transcription uses `SpeechAnalyzer`, with `SFSpeechRecognizer`
  fallback forced to `requiresOnDeviceRecognition = true`. Nothing is sent to Apple or anyone else.
- Debrief: `DebriefEngine` uses Apple Foundation Models (`SystemLanguageModel`), which runs on the device. **No
  request goes to any AI service.**
- Flights, logbook, aircraft and pilot profiles: SwiftData and GRDB on the device. CloudKit sync is not enabled.

## `PrivacyInfo.xcprivacy` (checked, unchanged)
- `NSPrivacyTracking = false`, no tracking domains.
- Declares `PreciseLocation` and `AudioData` as not linked, not used for tracking, purpose App Functionality.
  This is conservative: both are processed on the device only, so over-declaring is harmless. `PrivacyManifestTests`
  pins these entries, so they stay.
- Required-reason API: `UserDefaults` with `CA92.1`. The audit found no other required-reason API use in app code
  (no file timestamp, boot time or disk-space calls; the only `attributesOfItem` call reads a file **size**).
- `PrivacyManifestTests` passes (included in the 555-case run of 2026-11-01).

## Answers to enter in App Store Connect
Apple counts data as "collected" when it is transmitted off the device and kept by the developer or partners in a
way that can be read. The developer receives nothing.
- **Do you or your third-party partners collect data from this app?** -> **No**. Card shows "Data Not Collected".
- Be ready for a reviewer question about the tile hosts: they see an IP address and the tile being fetched, like any
  map client, and the developer does not receive that data. If you prefer to be conservative, you may instead declare
  **Coarse Location**, not linked to identity, not used for tracking, purpose App Functionality. That is a choice, not a
  requirement.

## Re-check when any of these change
1. CloudKit sync is turned on.
2. An analytics or crash SDK is added.
3. A remote AI service replaces or supplements Foundation Models.
4. Tile hosts change (for example the public-release removal of Satellite and Terrain, efb-zfm.8).
