# NASR data import (beads efb-chx; dashboard ticket T17)

The bundled efb-212/Resources/aviation.sqlite comes from OurAirports via tools/nasr-importer (despite its name). It has
these problems (docs/DESIGN.md audit and the review):
- runway end coordinates off by 50-300 ft (efb-chx);
- magnetic variation 0 everywhere;
- every airport marked "public";
- no data cycle or version metadata;
- airspace is 45 hand-made circles.

## Change
1. **Importer.** Extend tools/nasr-importer to read the FAA NASR 28-day subscription CSVs (e.g. APT_BASE.csv,
   APT_RWY.csv, APT_RWY_END.csv, FRQ.csv, NAV_BASE.csv; download from the FAA NASR subscription page for the current cycle and
   verify the file names). Import:
   - runway end and displaced-threshold coordinates from NASR;
   - real ownership (public / private / military), magnetic variation, pattern altitude, fuel, and runway surface and lighting.
   Keep OurAirports only as a fallback for fields NASR lacks. Keep the schema compatible with AviationDatabase. Add a
   `metadata` table with the NASR cycle and effective/expiry dates, and expose that in the app where the chart cycle is shown.
2. **App.**
   - Rebuild aviation.sqlite and bump `AviationDatabase.bundledDataVersion` so installed apps recopy it.
   - Remove the `apd-runway-ends.json` stopgap (efb-212/Resources) and its substitution in AirportDiagramOverlay once the DB has
     NASR ends. Re-run the georef batch tool (tools/apd-georef) and update docs/design/apd-georef-report.md.
   - LandableAirportFilter's private-field flag starts working once ownership is real. Check that the Nearest list flags private fields.
3. **Airspace** (stretch, but do it if the NASR shapefiles or the FAA AIS ArcGIS "Class_Airspace" feature service are usable):
   replace the 45 circles with real Class B/C/D polygons. The airspace layer and the proximity alerts already consume polygons.
4. **Tests.**
   - Re-run BundledAviationDataTests (enum vocabularies).
   - Add tests for ownership/magvar presence, KPAO 13/31 runway-end accuracy vs NASR, and the metadata cycle.

## Acceptance
- Full unit suite green (use your own simulator: SIM_TAG=T17).
- Georef report re-run with the new DB.
- `bd update efb-chx --notes` with what was imported and from which cycle.
- No regressions in nearest airports or search: spot-check KPAO, KSQL, KSFO in a throwaway UI test or unit test.
