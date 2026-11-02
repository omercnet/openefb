# OpenEFB: TestFlight submission prep

Refreshed 2026-10-31 (T13, beads efb-zfm.6); test count, screenshots and claims re-checked against the code 2026-11-01 (T15,
efb-zfm.7); Israel mode, network list and test count re-checked 2026-11-02 (T29, efb-v6i). Everything here is a draft for the
owner to review. Nothing has been uploaded and nothing was changed in App Store Connect.

## State at refresh time
| Item | Value |
|---|---|
| Bundle ID | `io.omer.efb` |
| Team | `6F8N897928` (Automatic signing) |
| Version / build | `MARKETING_VERSION 1.0`, `CURRENT_PROJECT_VERSION 1` |
| Devices | iPad only (`TARGETED_DEVICE_FAMILY = 2`), iOS 26.0 minimum, no Mac or visionOS |
| Export compliance | `ITSAppUsesNonExemptEncryption = NO` (HTTPS only) |
| Unit tests | **1065 tests, 0 failed** (`tools/sim-test.sh test -only-testing:efb-212Tests`, iPad Pro 13-inch simulator, 2026-11-02; 555 on 2026-11-01, 504 when this prep was first written on 2026-10-31) |
| Release archive | `xcodebuild archive -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO` -> **ARCHIVE SUCCEEDED** (details in `ARCHIVE_CONFIG.md`) |
| Screenshots | 9 iPad 13-inch captures at 2064x2752 in `screenshots/`, recaptured 2026-11-01; every image that shows the tab bar shows the current 3 tabs (Map / Flights / Settings) |

## What the app does today (what the listing may claim)
- Moving map with the FAA VFR sectional (live tiles, zoom 8 to 12), plus Street, Satellite and Terrain base maps.
- Airport database (FAA NASR data), nearest-airport list, airport sheet with METAR/TAF, frequencies, runways.
- FAA terminal charts per airport (instrument approach procedures, airport diagram) as PDFs from FAA d-TPP.
- Georeferenced airport diagram overlay on the map. Advisory: verify against the FAA diagram.
- Live TFRs and AIRMET/SIGMET layers with data-age badges. Advisory.
- PIREPs, winds aloft and NOTAMs in the airport sheet. NOTAMs need the pilot's own free FAA API key (Settings).
- Offline maps: Street and sectional regions can be downloaded; everything else needs the internet.
- Night mode (Auto / Day / Night).
- Flight recording (GPS track, cockpit audio, on-device transcription), replay, logbook, and an on-device debrief
  using Apple Foundation Models when the device supports it.
- Flight planning, instrument strip, aircraft and pilot profiles with currency tracking.
- Israel region (Settings > Region): CVFR routes, points and airspace, 49 curated aerodromes, NOTAM route closures from the project's relay, CVFR and sport-aviation route planning with FPL text, downloadable official CVFR chart and aerodrome diagrams, CVFR debrief. **Not in the current listing text: see the pending decision below.** It is unreviewed by an Israeli pilot.

## Do-this-first checklist
1. Open `efb-212.xcodeproj`, scheme `efb-212`, Any iOS Device (arm64), Product > Archive. Team `6F8N897928`.
2. Distribute > App Store Connect > Upload, then TestFlight.
3. Paste metadata from `APP_STORE_METADATA.md`. Answer privacy questions from `PRIVACY_NUTRITION_LABELS.md`.
4. Upload `screenshots/` (13-inch iPad slot). Internal TestFlight does not need them; the public listing does.
5. **Build numbers:** Version proposal for the first TestFlight upload: **1.0 (build 1)**. App Store Connect rejects an
   upload whose build number isn't higher than every earlier upload of the same version. Increase
   `CURRENT_PROJECT_VERSION` by one for every further upload of the same version (set it for the app target in both
   Debug and Release); move `MARKETING_VERSION` only for a new release train, and then the build may restart at 1.

## Before the public release (not blocking TestFlight)
- Remove Satellite and Terrain base maps unless licensed hosting replaces them (beads efb-zfm.8). See
  `docs/TILE-SOURCES.md`. Decision Q1 = A: all four base maps stay for TestFlight.
- Home-screen name: set to `OpenEFB` (`INFOPLIST_KEY_CFBundleDisplayName`, T30). `PRODUCT_NAME` stays `efb-212`
  (file name only). Re-capture screenshots if the status bar still shows the old name.
- TestFlight text, reviewer notes and tester plan: `TESTFLIGHT.md`.
- Confirm the public repository URL (Settings links `https://github.com/quartermint/openefb`).
- Re-check the privacy answers if any analytics SDK, CloudKit sync or an AI service is added.
- **Pending owner decision: Israel in the listing.** The App Store description, subtitle, keywords and screenshots describe
  the US app only, and Israel is not named in them. The Israel mode ships in the same build (Settings > Region, epic
  efb-aac), and this repo doesn't record the owner's release plan for it. If Israel goes into the public release:
  add it to the description and keywords, take screenshots in the Israel region (screenshots that show CAAI chart or
  diagram artwork stay out of git until CAAI/Mapa permission to publish them is recorded), and add an Israel line to the
  review notes. If it doesn't: keep the listing as is. Until decided, `APP_STORE_METADATA.md` carries only the
  corrections that keep its data-source and privacy lines true for a build that contains Israel mode.
- **CAAI chart and diagram artwork on R2:** the CVFR chart and the aerodrome diagrams are hosted on the project's R2
  bucket and downloaded by the app. CAAI approved in-app use of the chart and diagrams (chart base map © Mapa Ltd, used
  under that approval for in-app display); see `NOTICE`. Copyright stays with CAAI and Mapa Ltd.

## Files
- `ARCHIVE_CONFIG.md`: verified build settings, usage strings, archive result, versions.
- `APP_STORE_METADATA.md`: name, subtitle, description, keywords, disclaimers, review notes.
- `PRIVACY_NUTRITION_LABELS.md`: audit of what leaves the device and the App Store privacy answers.
- `screenshots/`: App Store screenshots and a manifest.
