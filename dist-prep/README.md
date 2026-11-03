# Kanaf: TestFlight submission prep

Refreshed 2026-10-31 (T13, beads efb-zfm.6); test count, screenshots and claims re-checked against the code 2026-11-01 (T15,
efb-zfm.7); Israel mode, network list and test count re-checked 2026-11-02 (T29, efb-v6i). Everything here is a draft for the
owner to review. Nothing has been uploaded and nothing was changed in App Store Connect.

## State at refresh time
| Item | Value |
|---|---|
| Bundle ID | `io.omer.efb` |
| Team | `6F8N897928` (Automatic signing) |
| Version / build | `MARKETING_VERSION 1.0`, `CURRENT_PROJECT_VERSION 1` |
| Devices | iPad and iPhone (`TARGETED_DEVICE_FAMILY = 1,2`, confirmed in the archived app 2026-11-02), iOS 26.0 minimum, no Mac or visionOS |
| Export compliance | `ITSAppUsesNonExemptEncryption = NO` (HTTPS only) |
| Unit tests | **1065 tests, 0 failed** (`tools/sim-test.sh test -only-testing:efb-212Tests`, iPad Pro 13-inch simulator, 2026-11-02; 555 on 2026-11-01, 504 when this prep was first written on 2026-10-31) |
| Release archive | `xcodebuild archive -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO` -> **ARCHIVE SUCCEEDED** (details in `ARCHIVE_CONFIG.md`) |
| Screenshots | 9 iPad 13-inch captures at 2064x2752 in `screenshots/`, recaptured 2026-11-01; every image that shows the tab bar shows the current 3 tabs (Map / Flights / Settings) |

## What the app does today (what the listing may claim)
- Moving map with the FAA VFR sectional (live tiles, zoom 8 to 12) over the Street base map. Satellite and Terrain were removed (2026-11-02).
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
- **Default region is Israel (IL-DEFAULT, before the first TestFlight build).** A fresh install starts in the Israel region; an existing install keeps the region it chose. The store screenshots in `dist-prep/` were taken in the US region and are not recaptured; switch Settings > Region to United States to reproduce them. The official CAAI chart and aerodrome diagrams are downloaded from Settings > Region (a one-time hint on the map points there).

## Do-this-first checklist
1. Release: merge the release-please pull request; CI archives, signs and uploads (`TESTFLIGHT.md`, `docs/CI.md`).
   By hand: `bundle exec fastlane ios beta`.
2. TestFlight: the build reaches the internal group on its own; external groups in `TESTFLIGHT_GROUPS` get it after Beta App Review.
3. Paste metadata from `APP_STORE_METADATA.md`. Answer privacy questions from `PRIVACY_NUTRITION_LABELS.md`.
4. Upload `screenshots/` (13-inch iPad slot). The build also runs on iPhone, so the public listing also needs iPhone screenshots (none captured yet). Internal and external TestFlight do not need them.
5. **Build numbers** are the commit count, so every release from `main` beats the last. App Store Connect rejects an
   upload whose build number isn't higher than every earlier upload of the same version.

## Before the public release (not blocking TestFlight)
- Satellite and Terrain base maps are already removed (2026-11-02); see `docs/TILE-SOURCES.md`.
- Home-screen name: set to `Kanaf` (`INFOPLIST_KEY_CFBundleDisplayName`, T30). `PRODUCT_NAME` stays `efb-212`
  (file name only). Re-capture screenshots if the status bar still shows the old name.
- TestFlight text, reviewer notes and tester plan: `TESTFLIGHT.md`.
- Confirm the public repository URL (Settings links `https://github.com/omercnet/openefb`).
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
