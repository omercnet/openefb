# IL-3: Our own Israel CVFR chart (beads efb-aac.4; dashboard ticket T04)

When the region is Israel, draw a CVFR chart from the bundled CAAI data (`IsraelAviationDatabaseProtocol` in
efb-212/Data/, built by IL-1), over the existing street base map. The official CAAI chart is NOT licensed (Mapa Ltd), so
don't copy its artwork. Our symbology must still be familiar to Israeli pilots. Use docs/research/israel-cvfr.md §2–3
and the domestic AIP legend text in docs/research/israel-cvfr-samples/ for meaning, not for artwork.

## Layers, MapLibre, Israel region only, each toggleable in the layer panel
1. **Route segments:**
   - Colour by type: civil solid; by-request dashed; military in a distinct colour, flagged.
   - An altitude label per direction along the line, e.g. "↑2500 / ↓3000" oriented to the segment.
   - Where the published altitude is two-number text (e.g. "2500/3500"), show the text as published.
   - Labels must stay legible at the zoom levels pilots use and thin out at low zoom; reuse the low-zoom thinning pattern
     from T19.
2. **Reporting points:** a filled triangle for compulsory, an open triangle for on-request, an aerodrome symbol for
   ARP, with the 5-letter code label. Tapping one shows a small sheet with the code, the name and the connected
   segments with their altitudes.
3. **Airspace:**
   - CTR/ATZ/CTA, TMA sectors and P/R/D as outlines with a light fill;
   - a floor/ceiling label ("SFC–3000", "FL95") using the reference IL-1 stored;
   - P/R/D in a restricted colour.
   - Follow COMMON.md's colour rules: red = warning, amber = caution. Don't use red for ordinary airspace.
   - Tapping an airspace shows its name, class/type, limits and raw text.
4. **Runways:** as lines at aerodromes.
5. **NOTAM closures (from IL-6):**
   - if a cached `notams.json` is present, draw closed segments with a clear "CLSD" treatment and its validity;
   - if it's stale or absent, show nothing, plus the existing staleness badge pattern;
   - never show an old closure set as current.

## Rules
- Day and night styles: reuse the T10/T18 night palette approach. Glanceable in sunlight.
- Performance: the data is small (651 KB). Load it once per region switch, and use GeoJSON sources or vector sources
  built in memory. Panning at 60 fps on an iPad simulator.
- Offline: the chart layers must work with no network. The street base map offline is out of scope; say so in the
  report.
- Layer availability: add the CVFR layers to `Region` availability for Israel. IL-1 may be finishing a small edit to
  `Region.dataAttribution` in the same file, so re-read it before editing, and only touch the layer-availability parts.
- Treat altitude references conservatively: IL-1 inferred MSL where the source has none. Show the published text in the
  tap sheets, and add a note in docs/research/israel-cvfr.md for the CFI review (IL-12).

Tests:
- GeoJSON/feature building: direction labels, two-number text, closure styling inputs, stale closures hidden;
- layer availability by region.

Screenshots in docs/design/screenshots/IL-3/:
- day and night over central Israel (Tel Aviv, Herzliya, the coast);
- the north (Haifa/Megiddo);
- the Negev (Ramon);
- the point and airspace tap sheets;
- a closed segment drawn from a sample notams.json.
Compare the routes and points by eye against the official chart PDF the research downloaded, if it's still on disk.
Don't commit or ship it.

Files you own: efb-212/Services/Map*/ and the CVFR layer code (new files preferred, e.g. `Services/IsraelChartLayers.swift`),
Views/Map/ layer panel and tap sheets, and the Region layer-availability cases.
Don't edit tools/caai-importer, Data/IsraelAviation* or services/il-notam.

Full unit suite green. Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim IL3)`
and release it). Close nothing; report. Read screenshots as small JPEGs. Never end your turn on an intention.
