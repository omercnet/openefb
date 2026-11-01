# IL-1: CAAI GIS layers into app data (beads efb-aac.2; dashboard ticket T05)

CAAI has approved redistribution of its GIS layers (see docs/research/israel-cvfr.md §1). Everything about the source
is in that doc: §4 Data, the samples in docs/research/israel-cvfr-samples/, the field names (`firstWayPo`/`secondWayp`,
directional altitudes, civil/military/by-request flags), and the source page `https://www.gov.il/he/pages/aip?chapterIndex=11`.
The official chart is still NOT licensed, so don't touch it.

## Build
1. **Importer: `tools/caai-importer/`.**
   - Download the layer zips. The gov.il WAF blocks curl, so use a browser download, as the research did. Keep the raw
     zips out of git (gitignore a `tools/caai-importer/input/` directory).
   - Read the File GDB with GDAL. `brew install gdal` is fine; document it in the importer README.
   - Write `efb-212/Resources/israel-aviation.sqlite`, normalized to WGS-84:
     - `reporting_points`: code, name (he/en if available), kind compulsory/onRequest/arp, lat, lon;
     - `route_segments`: from/to codes, polyline, altitude per direction in feet MSL, flags civil/military/byRequest,
       bearing;
     - `airspaces`: class/type CTR/ATZ/TMA/P/R/D/FIR, name, floor and ceiling with their reference (MSL/AGL/SFC/FL),
       polygon;
     - `runways`: aerodrome, designators, ends, lat/lon;
     - `metadata`: AIP amendment, effective date, source URLs, attribution, import date.
   - Add R-tree indexes for the spatial lookups, matching the pattern `Data/AviationDatabase.swift` uses.
   - The importer must be repeatable: same input gives byte-stable output where practical.
   - Validate counts against the AIP: 198 points, 275 route segments, 39 CTR/ATZ, 113 P/R/D, 9 TMA, 42 runways. Every
     segment endpoint must resolve to a point or ARP. Fail loudly on a mismatch.
2. **App data layer:** `IsraelAviationDatabaseProtocol` plus a GRDB implementation in `efb-212/Data/`. Read-only, bundled,
   with queries for:
   - points and segments in a region;
   - airspaces containing a coordinate at an altitude, and airspaces near a coordinate;
   - segment lookup by from/to codes (later used for NOTAM closures);
   - metadata.
   Follow the protocol-first convention; add a mock for tests.
3. **Tests:** Swift Testing against the bundled DB:
   - counts;
   - a known point's coordinates;
   - a known segment's altitudes in both directions;
   - point-in-airspace at and outside its floor and ceiling;
   - the metadata amendment date.
4. **Attribution:** add the CAAI line to `NOTICE` (create it if missing). The About screen wiring belongs to IL-2; give
   them the string via `metadata`.
5. Remove the raw CAAI samples from the research folder if the importer's tests no longer need them. Otherwise keep them;
   they're licensed now.

Files you own: tools/caai-importer/**, efb-212/Resources/israel-aviation.sqlite, efb-212/Data/IsraelAviation*,
efb-212Tests/**/IsraelAviation*, NOTICE, .gitignore.
Another agent (IL-2) is building the US/Israel region switch in Core/, Settings and the services; don't edit those. The
contract between you: IL-2 will instantiate your `IsraelAviationDatabase` from the bundle when the region is Israel, so
expose `init(bundle:)` or a static `bundled()` that throws `EFBError` when the file is missing.

Full unit suite green. Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim IL1)`
for the test run, and release it). Close nothing; report the counts and the amendment date.
