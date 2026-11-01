# IL-2: Region switch, US / Israel (beads efb-aac.3; dashboard ticket T02)

Background: docs/research/israel-cvfr.md. Today every data source assumes the US. Add a `Region` (`.us`, `.israel`)
that the app reads instead of hard-coding US sources.

## Build
1. **Model:**
   - `Region` in Core with the per-region configuration:
     - display name;
     - default map center and zoom (Israel: about 32.0N 34.9E, showing the whole country);
     - altimeter unit (US inHg, Israel hPa);
     - weather station list for the area (Israel: LLBG, LLHA, LLER, LLIB for METAR; plus LLHZ for TAF);
     - which data layers exist.
   - Persist it in UserSettings; the default is US.
   - Expose it on AppState as one property; that's the only AppState change.
2. **Settings:**
   - a Region picker;
   - switching recenters the map and reloads the region's sources;
   - Settings > About shows the region's data attributions (for Israel, the CAAI attribution string from the IL-1
     `metadata`, falling back to "Aeronautical data: Civil Aviation Authority of Israel (CAAI)").
3. **Honest availability:**
   - In Israel, the US-only layers can't produce data: FAA sectional, NASR airports/NRST, FAA TFRs, NOAA AIRMET/SIGMET,
     FAA NOTAMs, airport diagrams.
   - Hide or disable them, with a short plain reason ("Not available in Israel yet"). Never show empty US layers as if
     they were current.
   - Base map in Israel: the existing street/OSM style.
   - NRST in Israel must say there's no airport data yet, rather than showing nothing. IL-4 adds airports later.
4. **Weather:** in Israel, METAR/TAF use the Israel station list from aviationweather.gov (the research verified that it
   serves them). Altimeter is shown in hPa, and staleness badges work the same way. Test the station list and hPa
   formatting with the existing stub pattern; the network isn't used in tests.
5. **Wiring for IL-1:**
   - when the region is Israel, create `IsraelAviationDatabase.bundled()` (built by the IL-1 agent in Data/);
   - if the file or type isn't there yet when you finish, gate on it with a clear `EFBError` and coordinate with the
     IL-1 agent via the brief contract, rather than stubbing;
   - you don't draw CVFR layers; that's IL-3.

Tests:
- the region persists and round-trips;
- the per-region configuration (stations, units, layer availability);
- weather uses the region stations;
- NRST in Israel gives the honest empty state.

Screenshots in docs/design/screenshots/IL-2/:
- the Settings picker;
- the map in Israel (street base, honest "not available" layer states);
- METAR for LLBG with hPa;
- US unchanged.

Files you own: Core/ (Region, the AppState property, UserSettings), Views/Settings/**, WeatherService station
configuration, MapContainerView and the layer-panel availability, NRST empty state.
Another agent (IL-1) owns tools/caai-importer, Data/IsraelAviation*, Resources/israel-aviation.sqlite and NOTICE; don't
edit those.

Full unit suite green; the US behaviour is unchanged. Follow docs/handoff/COMMON.md (claim a simulator with
`export SIM_TAG=$(tools/sim-test.sh claim IL2)` and release it). Close nothing; report. Read screenshots as small JPEGs.
