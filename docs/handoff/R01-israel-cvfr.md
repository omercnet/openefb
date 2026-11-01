# R01: Research: supporting Israel CVFR (next epic) (research only, no app code)

The next epic adds Israel to OpenEFB. Today the app is US-only: FAA sectionals, NASR airports, NOAA weather, FAA TFRs and
NOTAMs. Israeli VFR flying is "CVFR" (controlled VFR): pilots fly published CVFR routes and reporting points at assigned
altitudes, under ATC, with frequent military and route closures by NOTAM.

Produce **docs/research/israel-cvfr.md**: a decision-ready research document. Cite a primary source (URL) for every claim.
Mark anything you couldn't confirm as UNCONFIRMED.

## Questions to answer
1. **Rules:** what CVFR is in Israel (AIP ENR 1.2 and related sections):
   - the route structure, reporting points, altitude rules, mandatory radio and transponder use;
   - the flight plan requirement (CVFR plans are filed via ... ?);
   - the restricted and danger areas, the Tel Aviv and Haifa TMAs, the coastline rules, the border buffer zones;
   - the rules for minimum altitude over cities and the sea;
   - the units used (feet / NM / knots? QNH?).
2. **Charts:**
   - what CAAI publishes (GEN 3.2): the Israel VFR/CVFR charts (north and south, scale), and the per-aerodrome visual
     charts;
   - the format (PDF? georeferenced?), the update cycle, the license and copyright terms for redistribution in a free
     open-source app, and whether tiles could be generated from it the way we do with FAA sectionals;
   - if redistribution isn't allowed, what the alternatives are (render our own chart from data, user-imported PDF).
3. **Data:** where to get machine-readable:
   - aerodromes: LLBG, LLHZ Herzliya, LLHA Haifa, LLER Ramon, LLEY Ein Yahav, LLMZ, LLBS, LLKS, LLIB and the others;
   - runways, frequencies, CVFR routes and reporting points (with coordinates), and airspace (CTR/TMA/restricted/danger).
   Candidates:
   - the eAIP at https://e-aip.azurefd.net/ (HTML per AIRAC; check whether the ENR 4.4 / ENR 6 / AD 2 tables can be
     parsed);
   - OpenAIP (license? Israel coverage?);
   - OurAirports;
   - Eurocontrol EAD (access terms).
   Report coverage and licensing for each.
4. **Weather:**
   - METAR/TAF for Israeli airports: does aviationweather.gov already serve LLBG, LLHA, LLER, etc.? (Test the API:
     `https://aviationweather.gov/api/data/metar?ids=LLBG,LLHA,LLER,LLHZ&format=json`.)
   - the Israel Meteorological Service aviation products;
   - SIGMET/AIRMET for the LLLL FIR.
5. **NOTAMs and closures:**
   - the IAA NOTAM page (https://brin.iaa.gov.il/aeroinfo/AeroInfo.aspx?msgType=Notam) shows items like "CVFR RTE CLSD
     TAVOR-DESHE";
   - is there a feed or API, what's its format, and are its terms OK to use?
   - how pilots learn about daily closures and military activity today.
6. **Competitors:**
   - what Israeli pilots use now: Air Map Israel (App Store id6452393844, sites.google.com/view/airmap-israel), SkyDemon,
     ForeFlight, Garmin Pilot, any others;
   - what each covers (CVFR routes? closures?), its price, its gaps, and its reviews;
   - where a free open-source app could win.
7. **Language and locale:** whether we need Hebrew UI or RTL; whether pilots use English on charts and the radio; units.
8. **Product fit:** map our jobs (docs/CUSTOMER.md J1 in-flight awareness, J3 emergency divert, J4 recording/debrief) to
   Israeli CVFR. What's different, e.g.:
   - the route-following view, "next reporting point" ETA, the altitude per route segment;
   - route closure alerts;
   - border and restricted-area proximity alerts.

## Deliverable shape
- A one-page summary on top: feasibility, the biggest blockers (licensing, data), and a recommended MVP scope.
- Then a section per question. End with a proposed epic breakdown: tickets with rough size and dependencies, written in
  plain product language, plus open questions for the owner.

Rules:
- Research only. No Swift edits and no simulators. Don't edit the other docs except your own file.
- Other agents (T15 docs, T23 UI polish) are working in this worktree, so leave their files alone.
- Use web search and fetch, curl the APIs, and save small samples under docs/research/israel-cvfr-samples/ when useful.
- Report a short summary when done.
