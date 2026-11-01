# App Store screenshots (iPad 13-inch)

Recaptured 2026-11-01 (T15) on the iPad Pro 13-inch (M5) simulator, iOS 26, portrait, **2064x2752** px (Apple's
13-inch iPad size; 2048x2732 is also accepted). The first set (2026-10-31) showed the old 5-tab bar (Map / Flights /
Logbook / Aircraft / Settings); every image now shows the current 3-tab bar (Map / Flights / Settings) with Day display
mode. Simulated position: a climb out of KPAO (Palo Alto) at ~97 kt on course 300, fed through `XCUIDevice.location`
with altitude, so GPS shows OK with real ground speed, altitude and vertical speed. Because the simulated aircraft is
above 15 kt, recording auto-started, so the REC pill is visible on the map images. The airport sheet is KOAK. Data is
live from NOAA and the FAA at capture time.

| File | Shows |
|---|---|
| `01-moving-map.png` | Moving map, FAA sectional, ownship, instrument strip, nearest airport |
| `02-map-layers-tfr-airmet.png` | Layer panel with Airspace, TFRs and AIRMET/SIGMET on; TFRs and AIRMET/SIGMET each show a "<1 min" data-age badge |
| `03-nearest-airports.png` | Nearest airports with distance, bearing, runway data and Direct-to |
| `04-airport-sheet.png` | KOAK sheet: weather (METAR with an age badge, raw METAR collapsed), frequencies |
| `05-airport-sheet-charts.png` | Same sheet expanded: runways, NOTAMs (needs the pilot's own FAA key), FAA charts |
| `06-airport-diagram-pdf.png` | FAA airport diagram PDF |
| `07-night-mode.png` | Night mode |
| `08-recording.png` | Recording in progress (auto-started above 15 kt) |
| `09-replay.png` | Flight replay of a recorded flight (2026-11-01): map, track, readouts, scrub bar; transcript panel collapsed because the flight has no transcript |

## Not captured
- **TFR polygons.** No TFR polygon is drawn in the Bay Area view even though the TFR layer is on (it shows a "<1 min" age
  badge). Re-shoot `02-map-layers-tfr-airmet.png` or add an overlay shot when a TFR is active near the chosen position.

## Known cosmetic items in the images
- Status bar shows the app name `efb-212` (home-screen name is still the product name; see `../README.md`).
- The METAR age badge reads "5 min" in `04-airport-sheet.png` (fresh data at capture time). Stale data shows an amber OLD badge instead.

Before the public release, retake the Satellite/Terrain-free set if those base maps are removed (efb-zfm.8); none of
these images shows Satellite or Terrain.

Internal TestFlight does not need store screenshots.
