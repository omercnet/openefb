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

GPS position is never put in a request. Tile requests reveal the map area on screen (and the device IP) to the tile
host, as every map app does. There is no advertising or tracking SDK in the project; anonymous analytics and crash
summaries go to TelemetryDeck (below).

Added 2026-11-02 (T29): Israel mode (Settings > Region, default Israel on a new install: `Region.defaultRegion`) makes two more kinds of request, both to infrastructure
the developer runs on Cloudflare. Neither carries a position, an account, or credentials. Cloudflare sees the device IP
and the file requested, like any host, under its own terms. The relay's code reads no client header except the owner's
`/run` authorization and stores no client data; the R2 bucket is plain file hosting. Whether the Cloudflare dashboard's
own analytics count as the developer "collecting" an IP address is the owner's call when answering App Store Connect; the
conservative choice is the same as for the tile hosts (see "Answers to enter").

| Destination | What it carries | Personal data? |
|---|---|---|
| `openefb-notam-relay.omerc.workers.dev` (Cloudflare Worker) | `GET /notams.json`: the whole-country NOTAM feed, no query parameters, `Accept: application/json` | IP address only |
| `pub-cdfb51548498487fa9fdb9794192c8ef.r2.dev` (Cloudflare R2) | `GET` of `<product>/manifest.json` for update checks; pack and diagram files when the user taps Download (with `Range` to resume) | IP address only |

The NOTAM relay itself scrapes the Israel Airports Authority site; the app never contacts the IAA. The interviews site
(`openefb-interviews.vercel.app`) is not part of the app and the app never calls it. Source of this list: a grep of every
`https://` string in `efb-212/Services`, `Core`, `Data` and `Resources` on 2026-11-02.

Added 2026-11-07: anonymous usage analytics and MetricKit crash / hang summaries through the TelemetryDeck Swift SDK
(`efb-212/Services/TelemetryService.swift`). Off until `TELEMETRYDECK_APP_ID` is set, off under tests, and off when the
pilot turns off Settings > Privacy > Share anonymous usage data (default on; stops sending at once).

| Destination | What it carries | Personal data? |
|---|---|---|
| `nom.telemetrydeck.com` (TelemetryDeck) | signal names and their parameters: `Navigation.tab` (`tab`: map / flights / settings), `Recording.started`, `Recording.stopped` (`durationMinutes`: 0-15 / 15-60 / 60+), `Debrief.generated`, `FlightPlan.activated`, `Israel.briefingOpened`, `Israel.fplShared` (`method`: share / email; counts taps on the control, not completed shares), `ChartPack.installed` (`product`, `edition`), `Diagnostics.crash`, `Diagnostics.hang` (below); the region (`appRegion`: us / israel), the SDK's defaults (app and OS version, device model, locale) and a SHA-256 hash of the iOS vendor identifier (`identifierForVendor`), hashed on the device | no; IP address seen by the host. No coordinates, airport identifiers, tail numbers, names or free text |

Crash and hang signals carry `exceptionType`, `exceptionCode`, `signal`, `appBuildVersion`, `osVersion`, `hangDuration`
and `topFrames` (the attributed thread's top 8 frames as `binary+offset`). The free-text termination reason and memory
contents (`virtualMemoryRegionInfo`) are dropped.

## On-device only
- Location: moving map, nearest airports, track recording. Stored in the local database.
- Audio and transcripts: `AVAudioEngine` recording; transcription uses `SpeechAnalyzer`, with `SFSpeechRecognizer`
  fallback forced to `requiresOnDeviceRecognition = true`. Nothing is sent to Apple or anyone else.
- Debrief: `DebriefEngine` uses Apple Foundation Models (`SystemLanguageModel`), which runs on the device. **No
  request goes to any AI service.**
- Flights, logbook, aircraft and pilot profiles: SwiftData and GRDB on the device. CloudKit sync is not enabled.

## `PrivacyInfo.xcprivacy` (re-audited 2026-11-02, T30)
- `NSPrivacyTracking = false`, no tracking domains.
- `NSPrivacyCollectedDataTypes` declares `CoarseLocation` (owner decision Q13 = B), plus `CrashData` and
  `PerformanceData` (added 2026-11-07: the app's own MetricKit code sends crash and hang summaries), all not linked,
  not used for tracking, purpose App Functionality. `PreciseLocation` and `AudioData` are not declared: GPS and audio
  stay on the device and no request carries them. `PrivacyManifestTests` pins this.
- Required-reason APIs:
  - `UserDefaults` with `CA92.1` (the app's own defaults).
  - `FileTimestamp` with `C617.1` (added by T30): `FlightRecoveryService.swift:128` reads `.creationDate` of the app's own
    recorded audio files in its container. Other `attributesOfItem` calls (`AviationDatabase`, `IsraelChartService`) read
    only file **size**.
  - No boot-time, disk-space or active-keyboard calls in app code (grep of `systemUptime`, `mach_absolute_time`,
    `volumeAvailableCapacity`, `systemFreeSize`).
- SDK manifests: MapLibre ships its own (FileTimestamp C617.1, SystemBootTime 35F9.1, UserDefaults CA92.1, nothing
  collected, no tracking); GRDB ships one declaring nothing; TelemetryDeck ships one declaring `ProductInteraction` and
  `DeviceID` (not linked, not tracking, purpose Analytics) and UserDefaults CA92.1. All are bundled by Xcode, so the app
  manifest needs only the app's own use.
- Export compliance: the only cryptography is CryptoKit `SHA256` (file integrity), Keychain storage and HTTPS, all
  exempt; `ITSAppUsesNonExemptEncryption = NO` is set in `Info.plist`.
- `PrivacyManifestTests` asserts both required-reason entries.

## Answers to enter in App Store Connect (owner decision Q13 = B)
Apple counts data as "collected" when it leaves the device. Requests reveal the map area on screen (tile hosts), the
selected airport or a coarse region (weather APIs) and the IP address to third parties; the NOTAM relay and R2 see the IP
address and the file requested.
- **Do you or your third-party partners collect data from this app?** -> **Yes**.
- **Data types:**
  - **Location > Coarse Location.** Linked: **No**. Tracking: **No**. Purpose: **App Functionality**.
  - **Diagnostics > Crash Data** and **Diagnostics > Performance Data** (MetricKit crash and hang summaries via
    TelemetryDeck). Linked: **No**. Tracking: **No**. Purpose: **App Functionality**.
  - **Usage Data > Product Interaction** (TelemetryDeck signals). Linked: **No**. Tracking: **No**. Purpose: **Analytics**.
  - **Identifiers > Device ID** (TelemetryDeck's hashed `identifierForVendor`; its SDK manifest declares it). Linked:
    **No**. Tracking: **No**. Purpose: **Analytics**.
- Re-declare if another diagnostics or analytics path is added.

## Re-check when any of these change
1. CloudKit sync is turned on.
2. Another analytics or crash SDK is added, or a TelemetryDeck signal gains a parameter.
3. A remote AI service replaces or supplements Foundation Models.
4. Tile hosts change (Satellite and Terrain, `server.arcgisonline.com` and `tile.opentopomap.org`, were removed 2026-11-02).
5. The Israel relay or the R2 bucket moves, or either starts to receive anything beyond a plain file request.
