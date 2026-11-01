# IL-4: Israeli airports and airstrips (beads efb-aac.5; dashboard ticket T08)

The owner reads Hebrew and will review the data you produce. Your job is to produce correct data with its sources, plus a
review sheet the owner can check quickly. Background: docs/research/israel-cvfr.md §4 (sources) and §8 (J3 divert).

## Sources, in priority order
1. **eAIP AD 2** (English) for LLBG, LLHA, LLER: runways, frequencies, CTR, hours. Samples are in
   docs/research/israel-cvfr-samples/eaip-AD-2.*.txt; re-fetch the current AIRAC from https://e-aip.azurefd.net/.
2. **Domestic AIP** (Hebrew PDF, about 95 MB, `https://www.gov.il/BlobFolder/guide/aip/he/פמת מלא 1-26.pdf`, or the
   current one linked from https://www.gov.il/he/pages/aip):
   - chapter ד (airports: Herzliya, Haifa, Rosh Pina, Ein Yahav, Bar Yehuda/Masada and others);
   - chapter ה (airstrips/מנחתים): runway designators, length, surface, elevation, frequencies, circuit
     altitude/direction, hours, PPR and remarks.
   Download it with the browser into tools/caai-importer/input/ (gitignored). PyMuPDF text extraction is lossy (final
   letters dropped), so keep page numbers for every field.
3. **CAAI GIS runways and ARP points** (already in israel-aviation.sqlite, from IL-1) for coordinates and runway
   geometry.
4. **OurAirports** (public domain) only as a fallback for names and coordinates, and flagged as such.

## Build
1. **Curated data file:** `tools/caai-importer/curated/aerodromes-il.csv` (UTF-8, Hebrew allowed), one row per
   aerodrome. Columns: ICAO or local code, Hebrew name, English name, type (airport/airstrip/heliport), lat, lon,
   elevation (ft MSL), runways (designator/length/surface), frequencies, circuit altitude and direction, hours, PPR,
   remarks, a `source` per field group (AIP chapter and page), and a `review_status` column (`unreviewed` by default).
2. The importer merges it into `israel-aviation.sqlite` as an `aerodromes` table (plus `aerodrome_runways` and
   `aerodrome_frequencies`, with an R-tree), keeping the IL-1 count validation. Cross-check: every CAAI ARP point and
   runway resolves to an aerodrome row. Fail loudly otherwise.
3. **App:**
   - In Israel, NRST lists the nearest aerodromes (airports and airstrips, flagging PPR/closed-by-NOTAM if a cached
     IL-6 closure names the field).
   - Search finds aerodromes by ICAO, English and Hebrew name.
   - The airport sheet shows the data with the source and an "unreviewed" note until the owner marks it reviewed.
   - Replace IL-2's "no airport data yet" state.
4. **Review sheet:** `docs/research/israel-aerodromes-review.md`, a table the owner can check against the AIP. Group it
   by aerodrome, with the Hebrew and English name, every value, and its page reference. Put the uncertain values first,
   marked ⚠️. Keep it short enough to review in one sitting.

## Coordination
The map symbols for aerodromes belong to the IL-3 agent (85898d84-ac84-46f6-839c-8d730b88eebc), which is drawing the
CVFR chart now and already draws ARP points from the CVFR layer. Expose aerodromes through
`IsraelAviationDatabaseProtocol` (add the methods; update the mock), and message IL-3 once that API exists so it can
draw airstrips that aren't ARP points.
- You own: tools/caai-importer/curated/**, the importer merge step, Data/IsraelAviation* (aerodrome additions), the
  NRST and search Israel paths, and the airport sheet Israel path.
- Don't edit the IL-3 map layer files or the layer panel.
- If you must touch Region.swift, re-read it first, because IL-3 edits its layer availability.

Tests:
- importer cross-checks;
- DB queries (nearest, search by Hebrew name, runways);
- NRST in Israel;
- the unreviewed note.

Screenshots in docs/design/screenshots/IL-4/: NRST in Israel, a Hebrew-name search, and the Herzliya (LLHZ) and an
airstrip sheet.

Full unit suite green. Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim IL4)`
and release it). Close nothing; report, including how many aerodromes you have and how many values are ⚠️. Never end your
turn on an intention.
