# Israel CVFR support — research (R01)

Date: 2026-11-01. Research only; no app code. Samples (API responses, AIP excerpts, GIS extracts) are in
`docs/research/israel-cvfr-samples/`. Every claim cites its source; anything not verified against a primary source is
marked **UNCONFIRMED**.

Sources used most: the international eAIP (`https://e-aip.azurefd.net/`, AIRAC 2026-08-06, in English), the domestic
AIP ("פמ"ת", Hebrew, amendment 1/26 effective 2026-08-06, single PDF of 440 pages at
`https://www.gov.il/BlobFolder/guide/aip/he/פמת מלא 1-26.pdf`), the CAAI domestic-AIP web page
`https://www.gov.il/he/pages/aip` (chapter "מידע תעופתי נוסף", `?chapterIndex=11`), the IAA NOTAM page, and live calls
to aviationweather.gov. Hebrew quotes below are translated by me; the PDF text extraction is lossy (final letters
dropped), so page numbers are given so a Hebrew reader can check.

---

## 1. One-page summary

**Feasibility: good, better than the brief assumed.** The two things that looked like blockers (chart licensing and
machine-readable route data) resolve in opposite directions:

- **Data is solved.** CAAI publishes, next to the domestic AIP, Esri *File Geodatabase* layer packages for the
  CVFR routes (275 segments with the published altitude per direction, civil/military and by-request flags, bearing),
  the 198 CVFR reporting points (compulsory / on-request / ARP, 5-letter codes), 39 CTR/ATZ polygons with floors and
  ceilings, 113 P/R/D polygons, the 9 TMAs, the FIR and 42 runways. They open with GDAL's OpenFileGDB driver
  (verified; GeoJSON extracts in the samples folder). Updated per AIP amendment (file names carry the year; "2026").
  Source page: `https://www.gov.il/he/pages/aip?chapterIndex=11`. This replaces the "parse the eAIP HTML / georeference
  a PDF chart" plan that the only open-source precedent (Brook46/israel-airspace-map) had to use.
- **The raster chart is NOT redistributable.** The CVFR chart (domestic AIP B-03 appendix A, 1:250,000, north and
  south sheets, vector PDF) carries "© all rights reserved to CAAI; rights to the geographic information belong to
  'Mapa' Ltd" and the gov.il page states contents are for personal non-commercial use and may not be copied or
  distributed without written consent of Mapa – Mapping and Publishing Ltd. So: no FAA-style tile pipeline from the
  official chart. We render our own chart from the CAAI vectors + OSM/terrain base.
- **Weather is already there.** aviationweather.gov serves METAR for LLBG/LLHA/LLER/LLIB and TAF for those plus LLHZ
  (verified live, 2026-11-01). No LLLL SIGMETs in the AWC international feed at the time of the call; the FIR is
  covered by the Israel Meteorological Service (IMS) aviation page instead. Our WeatherService works unchanged.
- **NOTAMs need a scraper.** The IAA page (`brin.iaa.gov.il/aeroinfo`) is an ASP.NET WebForms page with no API; a
  mobile detail page returns full ICAO-format NOTAM text per row id (verified). Route closures appear as free-text
  "CVFR RTE CLSD GALIM-DAROM-HOTRM-BOREN-FRDIS" using the same 5-letter codes as the reporting-point layer, so
  closures can be mapped onto route segments by name. Terms of use for scraping: not published → **UNCONFIRMED**.

**Biggest blockers / risks, in order**
1. Licensing of the CAAI GIS layers for redistribution in an open-source app: the page says they are "for the users'
   convenience only; the binding publications are the official ones" and carries no explicit license. Need a written
   OK from CAAI (`aip@mot.gov.il`) before shipping them in the app. Risk: medium; the data is factual aeronautical
   information CAAI itself hands out, but the surrounding gov.il/Mapa copyright notice is broad.
   **Resolved 2026-11-01: the owner reports that CAAI approved redistribution of the GIS layers** (efb-aac.1 closed).
   Keep the approval email with the project records. Add CAAI's requested attribution wording to the app's About
   screen and to `NOTICE` if they specified one; otherwise use "Aeronautical data: Civil Aviation Authority of Israel
   (CAAI), AIP amendment <n>". The official chart is still not licensed (Mapa Ltd).
   **Not public domain (checked 2026-11-01).** Israeli works made by the State are State-owned (Copyright Act 2007 §36);
   §6 frees only statutes, regulations, Knesset protocols and court decisions. §5 leaves facts and data unprotected,
   but a compilation of data, including a database, is a protected work, so the selection and arrangement can carry
   copyright (https://www.wipo.int/wipolex/en/text/202010). data.gov.il has an explicit open license (copy,
   redistribute, derivative works, commercial use, attribution required; https://data.gov.il/he/terms-of-use). Its
   Ministry of Transport aviation sets are planning buffers, not navigation data:
   - "נתיבי טיסה": 1 merged polygon, fields OID/Shape_Length/Shape_Area/YEARMONTH=202512, no altitudes, no point codes;
   - airports: 8 rows;
   - navaids: 8 rows;
   - hospital helipads: 21 rows.
   These were checked through `datastore_search`. No reporting points, CTR/TMA or P/R/D layer is on data.gov.il, so the
   layers we need remain unlicensed.
2. NOTAM feed stability (scraping a government WebForms page) and the absence of structured route-closure data.
3. Hebrew-only domestic AIP (per-aerodrome visual charts, airstrip chapters) — needs a Hebrew-reading owner for data
   curation; the eAIP only covers LLBG, LLHA, LLER.
4. Military ("blue") routes and by-request legs, firing-area schedules (weekday vs weekend), and border buffers are
   rule-heavy; getting them wrong is a safety issue. Needs an Israeli CFI reviewer.

**Recommended MVP scope ("Israel pack v1")**
- Region switch (US / Israel) controlling data sources, units and chart style.
- Own-rendered Israel VFR chart: CAAI vectors (routes with altitude labels per direction, reporting points, CTR/ATZ,
  TMA, P/R/D, runways) over an OSM-based base map with terrain shading; offline.
- Airports/airstrips from the CAAI runway layer + domestic AIP tables + OurAirports (37 LL airports), frequencies
  from eAIP AD 2 and domestic AIP chapter A-07.
- Weather: same NOAA service, Israeli ICAO ids; QNH in hPa.
- NOTAMs: scraper → closed-route overlay + "route closed" alert on the active route; raw text list.
- Route-following: next reporting point, ETA, published altitude for the current leg and direction; border and P/R
  proximity alerts.
- Recording/debrief unchanged (J4).
Not in v1: flight-plan filing (email/phone only, no API), sport-aviation ("LSA") map, helicopter routes, Hebrew UI.

---

## 2. Rules (Q1)

Vocabulary: Israel's low-level VFR routes are "נתיבי תובלה נמוכים" (low transport routes), flown under "כטר"מ" =
CVFR. The international eAIP ENR 1.2 is the generic ICAO VFR text and does not describe CVFR; the real rules are in
the domestic AIP chapters A-02 (CVFR rules), A-11 (flight plans), A-17 (P/R/D and border limits) and B-03 (routes).
eAIP AD 2 LLBG §5.1 says explicitly: "CVFR flights are conducted according to controlled visual routes chart (see
Domestic AIP, chapter A-07 & chapter B-03)" (`https://e-aip.azurefd.net/2026-08-06-AIRAC/html/eAIP/LL-AD-2.LLBG-en-GB.html`).

### Route structure (domestic AIP B-03, PDF pp. 106–112; sample `domestic-aip-B03-text.txt`)
- Routes link aerodromes and airstrips; usable by piston aeroplanes, touring motor gliders and helicopters; not by
  ultralights (except per B-08), gliders, jets or paragliders (B-03 §1a).
- Route colours on the chart: **green** = shared civil/military; **green dashed** = "by request" (real-time ATC
  approval; civil use needs IAF coordination via a "space flight plan"); **blue** = military routes, civil use only
  with IAF approval (B-03 §1b). The GIS layer encodes this as `Military` ∈ {CIVIL, MIL} and `byReques` ∈ {OPEN, BR}
  (190 civil / 85 military; 179 open / 96 by request).
- Route width 2 km (1 km each side of centreline) unless stated (B-03 §2b). Most routes follow ground features
  (roads, railways, wadis); fly *to the right of* the feature (§2c). Coastal route Bat Galim → Tel Ashkelon: fly west
  of the coastline (§2c(1)). In the Negev south of Beer Sheva and along the Jordan valley, stay on the road: firing
  areas start >1 km from centreline (§2c(2)).
- Max speed 180 kt IAS on routes; higher needs ATC approval, never inside CTRs or on Ashkelon–Netanya and
  Hadera–Bazra legs (§2e).
- Deviation from the route only with ATC approval, except emergency/collision avoidance (§6c). In-flight plan changes
  are generally not possible; ATC may approve: up to 5 NM off the planned route in daylight VMC, a touch-and-go, a
  by-request leg instead of the planned one, or a lower altitude in daylight VMC at pilot's responsibility (§5g).

### Reporting points
- Domestic AIP table (PDF p. 115, "5 Letter Code"): 198 points — 90 **compulsory** ("חובה"), 83 **on request**
  ("דרישה"), 25 aerodrome reference points. Sample CSV: `domestic-aip-reporting-points.csv`; same 198 in the CAAI GIS
  layer `F_CVFR_POINTS2026` with Hebrew and English names.
- Altitude changes between legs are made *at* the reporting point between them unless ATC says otherwise (§3h).

### Altitudes (B-03 §3)
- Most routes are set at least 1,000 ft above the highest terrain on the leg; opposite directions separated by
  500 ft. In the dense centre of the country: minimum ~700 ft AGL and 400 ft separation. The published altitude is per
  direction, shown on the chart, flown on the **QNH** given by the controlling unit; same altitude day and night.
  The GIS layer carries `N_A`/`S_A` or `W_Alt`/`E_Alt` per segment plus `LowerALT`.
- General minimums (eAIP ENR 1.2 §1.5): 1,000 ft above the highest obstacle within 600 m over congested areas /
  assemblies; 500 ft above ground or water elsewhere
  (`https://e-aip.azurefd.net/2026-08-06-AIRAC/html/eAIP/LL-ENR-1.2-en-GB.html`). Domestic A-02 (PDF pp. 18–23) repeats
  these and adds VMC minima (5 km visibility below 10,000 ft, 8 km above; 1.5 km horizontal / 1,000 ft vertical from
  cloud).
- VFR in a CTR/ATZ needs ceiling ≥ 1,500 ft and ground visibility ≥ 5 km (ENR 1.2 §1.2). Night VFR only as prescribed
  by CAA operations (§1.3).

### Radio and transponder
- "Do not depart without serviceable two-way radio contact with the ATS unit" (B-03 §5c). Routes outside the LLBG
  TMA and civil CTRs are controlled by **military controllers** (§5b): northern-sector land traffic is "PLUTO"
  control on 118.400, Hebrew, operated by the IDFAF (eAIP ENR 2.1,
  `https://e-aip.azurefd.net/2026-08-06-AIRAC/html/eAIP/LL-ENR-2.1-en-GB.html`).
- If a transponder is installed it must be on for the whole flight, **squawk 5100** unless told otherwise (B-03 §2f;
  A-13 governs details).
- North of 33°00'N (Rosh Pina line) only with two-way radio and a working transponder (A-17 §4a, PDF p. 63).

### Flight plan (domestic AIP A-11, PDF pp. 32–38; eAIP ENR 1.10)
- A flight plan is required for any VFR/CVFR flight in the FIR (ENR 1.10 §1;
  `https://e-aip.azurefd.net/2026-08-06-AIRAC/html/eAIP/LL-ENR-1.10-en-GB.html`). CVFR plans are **not** handled by
  Eurocontrol IFPS; they go to the IAA ARO ("מודיעין טיס").
- How: route flight plans by **phone or e-mail to `ais@iaa.gov.il`** (A-11 §3b(1)); "space" (area) flight plans by
  e-mail only to `fpl@iaa.gov.il` (§3b(2)). Timing: not later than 60 min before ETD; for departures up to 17:00 may be
  filed from 18:00 the day before (§3d). Validity: −30/+60 min for domestic VFR (§5). ICAO FPL format examples are in
  the appendix (`FPL-4XHLH-VG …`). No API. A third-party web app `https://fpl.co.il/` ("Israeli Flight Plan Application
  for LSA and CVFR flights") exists; its backend/relationship to IAA is **UNCONFIRMED**.

### Restricted/danger areas, TMAs, coast, borders
- eAIP ENR 5.1 lists LLP/LLR/LLD areas with coordinates (parseable table; 37 designators in the HTML sample). The CAAI
  GIS layer `F_Limited` has 113 polygons (47 P, 28 R, 30 D, 4 "LLD") with AltMin/AltMax.
- Domestic A-17 (PDF pp. 52–65) adds the Hebrew descriptions and closures: e.g. LLP11 Temple Mount up to 8,000 ft,
  LLP04 Haifa refineries to 3,000 ft, LLP171/172/173 along the West Bank separation fence (~2 km buffer), nature
  reserve (RTG) aerial closures with 100 m vertical / 600 m horizontal from cliffs.
- **Border buffers (A-17 §4b, PDF p. 63):** no flight at any altitude within 6 km of the Gaza Strip border (LLP19),
  3 km of Egypt, 6 km of Syria, 3 km of Lebanon; flight up to the Jordan border is allowed. North of 33°00'N as above.
- Firing areas ("שטחי אש") are inactive on weekends (Friday 14:00 to end of Shabbat); midweek ATC has no real-time
  picture and may only warn (B-03 §2g).
- TMAs: Ben-Gurion TMA (civil, 120.50 APP / 119.50), plus military TMAs; the GIS TMA layer has 9 polygons. Haifa has
  no TMA in the eAIP, only a **Haifa CTR, class D, SFC–3,000 ft MSL (3,500 ft at weekends), CVFR flights only** (eAIP
  AD 2 LLHA §2.17 and §2.22, `https://e-aip.azurefd.net/2026-08-06-AIRAC/html/eAIP/LL-AD-2.LLHA-en-GB.html`).
- Coast: Tel-Aviv FIR extends 27 NM parallel to the coast / 46 NM arc around BGN (ENR 2.1). Over-water CVFR is on the
  coastal route only; no specific sea-minimum beyond the 500 ft rule found → **UNCONFIRMED** whether extra rules exist.

### Units
- eAIP: feet (altitude), FL, NM, knots, QNH in **hPa** (METAR `Q1017`), degrees magnetic (VAR 5°E 2025 on the chart).
  Domestic AIP uses **km and metres** for lateral distances (route width 2 km, border buffers in km, nature-reserve
  600 m) and feet for altitude. Transition altitude: NIL at LLHA (AD 2 LLHA §2.17); national value not extracted →
  **UNCONFIRMED**.

## 3. Charts (Q2)

- **GEN 3.2** (`https://e-aip.azurefd.net/2026-08-06-AIRAC/html/eAIP/LL-GEN-3.2-en-GB.html`): CAAI charts are free on
  the eAIP; paper ENR 6.1 (1:400,000 en-route) sold by Gideon Dan Cartography. The eAIP chart list contains **no
  VFR/CVFR chart** — only ENR 6.x index charts, SID/STAR/IAC, Visual Approach Charts (LLHA circuit chart, LLBG NAMIM/
  GAVRI/ROMIE visual approaches) and aerodrome charts, all PDF, part of the AIP, not georeferenced.
- **The CVFR chart** lives in the domestic AIP as B-03 appendix A, "מפת נתיבי תובלה נמוכים", north and south sheets,
  **1:250,000**, WGS-84, vector PDF (150k drawing paths/page, 1984×2835 pt). Direct links (gov.il chapter B):
  north `…/aip_ב'-03 CVFR צפוני-.pdf`, south `…/aip_ב'-03 CVFR דרומי.pdf`, legend/back side `…/aip_ב'-03CVFR אחורי.pdf`.
  Sister charts: B-08 appendix A low-altitude sport-aviation map (north/south), B-06 gliding map, IAF helicopter map,
  and a general "navigation aviation map" (`Navigation-North 2026.pdf` / `Navigation-south 2026.pdf`, 100×70 cm print).
- **Update cycle:** domestic AIP amendments roughly 2–3 per year (chart imprint "עדכון 2/25 … אוקטובר 2025", current
  amendment 1/26 effective 6 Aug 2026; eAIP on the AIRAC cycle, next 26 Nov 2026 already published on the root page).
- **License:** chart imprint (PDF p. 113): "© כל הזכויות שמורות לרת"א. הזכויות על המידע הגאוגרפי שייכות לחברת 'מפה'" =
  all rights reserved to CAAI; geographic (base-map) rights belong to Mapa Ltd. The gov.il AIP page: contents are for
  personal, non-commercial use; no copying/distribution/storage without prior written consent from Mapa – Mapping and
  Publishing Ltd (`https://www.gov.il/he/pages/aip`, snapshot in browser 2026-11-01). **Conclusion: we cannot tile and
  ship the official chart.** Note the PDFs are vector, so tiling is technically trivial — the problem is purely legal.
- **Alternatives:**
  1. Render our own chart from the CAAI GIS layers (routes, points, airspace) over OSM + terrain (recommended; this is
     what every Israeli app that isn't paying Mapa does — see §7).
  2. User-imported PDF/mbtiles (pilot downloads the chart themselves; app georeferences a known sheet by its lat/lon
     grid). Legal for the pilot's personal use; keeps us out of redistribution. Good "escape hatch" and a way to show
     the authoritative symbology for cross-checking.
  3. Ask CAAI/Mapa for a license (open question for the owner).

## 4. Data (Q3)

| Source | What | Coverage for Israel | License / terms | Verdict |
|---|---|---|---|---|
| **CAAI GIS layer packages** (`gov.il/he/pages/aip?chapterIndex=11`): `CVFR2026.zip`, `Sportiv 2026.zip`, `IFR2026.zip`, `שכבות FIR, TMA, ACC, CTR.zip`, `אסורים לטיסה וCTRים.zip`, `RATAG_kmz.zip` | Esri File Geodatabase (OpenFileGDB readable; EPSG:32636 / 4326). CVFR: 275 route segments (first/second waypoint codes, English+Hebrew names, length, Military, byRequest, altitude per direction, bearing, map sheet), 198 points. CTR/ATZ 39 (Min/Max alt, civ/mil), P/R/D 113, TMA 9, FIR, 42 runways. IFR: 93 points, 140 ATS segments. Sport: 215 points, 229 routes. RTG: nature-reserve closures KMZ. | Complete for what the chart shows (points layer = AIP table 1:1, 198/198). Airstrip list is implicit via ARP points and runways. | No explicit license; page says "for users' convenience only; binding information is the official publications". gov.il/Mapa general notice applies to the *page*. Download is blocked for non-browser clients (403 WAF); works from a browser. | **Primary source for the epic.** Get written permission; cache by amendment. |
| **eAIP HTML** (`e-aip.azurefd.net/<AIRAC>/html/eAIP/LL-*.html`) | Plain HTML tables: ENR 4.4 significant points (186 rows, DMS coords), ENR 5.1 P/R/D with coordinate strings, ENR 2.1 FIR/TMA with frequencies, ENR 3.6 holdings, AD 2 for **LLBG, LLHA, LLER only** (runways, frequencies, CTR). AD 1.3 index lists only those three. | IFR/international side. No CVFR routes, no airstrips (LLHZ, LLIB, LLBS, LLMZ, LLEY, LLKS, LLES… are domestic-AIP chapters ד/ה, Hebrew). | AIP data; no terms page found on the site → **UNCONFIRMED**, treat as public aeronautical information. Static, fetchable with curl (no WAF). | Parse for frequencies, holdings, P/R/D cross-check, AD 2 of the three internationals. |
| **Domestic AIP PDF** (95 MB, 440 pp.) | Hebrew text; tables extractable with PyMuPDF (reporting points p. 115; A-17 appendix B coordinates p. 64+; LLU no-fly circles; obstacles). Chapters ד (airports: Herzliya, Haifa, Rosh Pina…) and ה (airstrips) have runway/frequency/circuit data per field. | Everything domestic, but Hebrew and PDF. | Same gov.il/Mapa notice; text facts are not copyrightable but the charts are. | Secondary: airstrip details, rules. Needs a Hebrew curator. |
| **OpenAIP** | API needs key; `/api/airports?country=IL` returned 403 without one. | Israel coverage **UNCONFIRMED** (not checked with a key). | CC BY-NC 4.0 — **non-commercial only** (`https://www.openaip.net/legal`). | Not usable as a base for an MPL app with a premium tier. |
| **OurAirports** (`davidmegginson.github.io/ourairports-data/airports.csv`) | 59 IL rows, 37 with LL ICAO codes incl. all nine in the brief; basic runway/frequency CSVs exist. | Names, coords, type; frequencies/runways partial. | Public domain. | Fallback/seed, not authoritative. |
| **Eurocontrol EAD** | EAD Basic (free registration) gives SDO reports/PIB; data redistribution needs an EAD Agreement (`https://www.eurocontrol.int/service/european-ais-database`). Israel is an EAD data provider (eAIP is EAD-style). | Would duplicate eAIP. | Agreement required for integration. | Skip. |
| **flight-maps.com** (community) | mbtiles of the CVFR/LSA/ATS charts, airstrip/frequency KMZ, "SkyDemon Israel Airspace" and "ForeFlight Israel Airspace" user files. | Shows what pilots already load into other EFBs. | Unlicensed re-publication of CAAI charts; don't reuse. | Reference only. |
| **Brook46/israel-airspace-map** (GitHub, Python) | Pipeline: IAA NOTAM list + detail pages, eAIP ENR 2.1/5.1/AD 2.17, domestic PDF tables, chart vector georeferencing. No LICENSE file. | Proof that scraping works; its NOTAM parser (Q-line, coordinates, schedules) is worth reading. | No license → can't copy code; can copy approach. | Reference. |

The GeoJSON evaluation extracts that lived in the samples folder were removed once CAAI approved redistribution:
the full layers are now imported by `tools/caai-importer` into `efb-212/Resources/israel-aviation.sqlite` (IL-1).

Reporting-point / route key: route segments reference points by their 5-letter code (`firstWayPo`/`secondWayp`, e.g.
`HADRA`→`DALIA`), aerodromes by ICAO (`LLEK`). NOTAM closures use the same codes ("CVFR RTE CLSD TAVOR-DESHE"), so a
closure can be resolved to a chain of segments.

## 5. Weather (Q4)

- **aviationweather.gov** (`/api/data/metar?ids=LLBG,LLHA,LLER,LLHZ,…&format=json`, called 2026-11-01 09:22Z, sample
  `awc-metar.json`): METAR returned for **LLBG, LLER, LLHA, LLIB** (e.g. `METAR LLBG 010920Z 29005KT 250V330 9999
  FEW025 26/15 Q1017 NOSIG`, `fltCat: VFR`, `altim: 1017` = hPa). TAF (`awc-taf.json`) for **LLBG, LLER, LLHA, LLHZ,
  LLIB**. Not served: LLHZ METAR, LLES, LLEY, LLMZ, LLBS, LLKS (no METAR station). Same JSON shape as US stations, so
  `WeatherService` needs only the station list and hPa display.
- **ISIGMET** (`/api/data/isigmet?format=json`): 109 international SIGMETs, FIRs listed did not include LLLL (sample
  `awc-isigmet-llll.json` is empty). Whether LLLL SIGMETs reach AWC at all is **UNCONFIRMED** (none were active).
- **IMS** (`https://ims.gov.il/en/aviation`): aviation page with wind/temperature maps by FL, significant weather
  charts, upper-air soundings, per-airport METAR/TAF bulletins, a **SIGMET/AIRMET** list and AD/WS warnings, behind a
  terms-of-use click-through (Drupal/Angular; data loaded by XHR — endpoint not reverse-engineered, **UNCONFIRMED**
  whether it is usable programmatically or licensed for apps). This is the authoritative LLLL SIGMET source.
- Weather briefing before filing is mandatory (A-11 §3a) — a nice hook for J2.

## 6. NOTAMs and closures (Q5)

- **Page:** `https://brin.iaa.gov.il/aeroinfo/AeroInfo.aspx?msgType=Notam` (mirror `ext.iaa.gov.il`). ASP.NET WebForms
  (ViewState, postback filters for region/series/hours/location), 1.4 MB HTML, 126 NOTAM rows, each with only the E)
  line truncated (sample `iaa-notam.txt`). Row ids are in `id="divMainInfo_<n>"`.
- **Detail:** `https://brin.iaa.gov.il/MobileAeroinfo/maiDetails.aspx?rowID=<n>&scrpos=0&mode=notam` returns the full
  ICAO NOTAM (Q-line, A/B/C/E/F/G) — verified, sample `iaa-notam-detail.txt` (C0005/26, Q) LLLL/QWULW/…, F) GND
  G) 500FT AMSL). So: list page → ids → detail per id, cache by id. ~126 requests per refresh; Brook46 polls every
  10 min with a 0.35 s delay.
- **Format of closures:** series C, location LLLL, text like `CVFR RTE CLSD GALIM-DAROM-HOTRM-BOREN-FRDIS`,
  `HEL RTE CLSD GALIM-SUVAS`, `ULTRALIGHT RTE CLSD …`, `ATS RTE CLSD P68 BTN GALIM-MERVA`, plus area closures with
  coordinate lists and heights (`AN AREA BTN FLW PSN CLSD TO ALL FLT, FM GND UP TO 12,000FT AMSL 323334N0345409E …`),
  UAS activity, balloons, airstrip closures (`LLBO AIRSTRIP CLSD TO ALL FLT`). Schedules are in D) lines.
- **Feed/API:** none found. No RSS, no JSON. robots.txt is blocked by the WAF (returns a block page). Terms of use for
  automated access: not published → **UNCONFIRMED**; a mobile-oriented endpoint exists, and at least two Israeli apps
  (Air Map Israel changelog "Fix Notam for Israel", v57.0.4 of 18 Jul 2026; Brook46) consume it, which suggests
  tolerance, not permission.
- **How pilots learn today:** NOTAM page before every flight (A-11 §3a makes it mandatory), the ARO phone, and the
  apps' NOTAM pages (Air Map Israel has a "Notam page with service and airspace filtering"). Military activity: ATC
  warns in real time; firing areas are shown on the IAF helicopter map; no public schedule of daily military
  activity exists beyond NOTAMs (B-03 §2g says ATC itself lacks real-time info midweek).

## 7. Competitors (Q6)

| App | Israel coverage | Price | Gaps / reviews |
|---|---|---|---|
| **Air Map Israel** (iOS id6452393844, Android; dev. Ofer Raanan) | Purpose-built: CVFR, LSA ("AZAM"), HEL and ATS maps; airfields with patterns; waypoints; NOTAM layer and page; training/restricted areas with voice alerts; flight plans (GPX/FPL/KML), recorder/replay, W&B, logbook, METAR/TAF, ADS-B traffic, PFD/EHSI, LiveATC. English UI. Expo/React Native, v58 (Oct 2026). | Free with in-app "Support the APP" ₪49.90 one-off or ₪17.90 subscription (App Store IL listing). | 36 ratings, 4.6★ (IL store). Recent 1★ reviews: "crashes all the time", "shuts down all the time" (27 Jul), purchase-restore issue. One-person project; feature-dense, UI dense. Does not render terrain/own chart; shows the official chart rasters (origin of those rasters not stated). |
| **PilotNav** (Android `com.amit.pilotnavigation`, iOS "PilotNavigation" id6446889549; Amit Yazdan) | "Free CVFR/SPORT map", quick access to AIP docs, visual circuit charts, TAF/METAR, frequencies chart, other users as traffic, flight recording. | 30-day trial then subscription (price not shown). | 100+ downloads on Play. Small. |
| **SkyDemon** | **Israel is not in the chart coverage list** (`https://www.skydemon.aero/start/coverage`, 2026). Pilots load the community "SkyDemon Israel Airspace" file from flight-maps.com (2021). | ~£/€ subscription (not re-checked) | No official Israeli data, no CVFR routes, no IAA NOTAMs. |
| **ForeFlight** | Global aeronautical map; Jeppesen "Middle East" add-on coverage exists for IFR charts (`foreflight.com/buy` lists `jepp_middle_east_21`). No CVFR routes or domestic VFR chart. Community "ForeFlight Israel Airspace" user layer (2019). | From $130/yr + Jeppesen add-on (price **UNCONFIRMED**) | Expensive; no route structure, no Israeli NOTAM closures by route, no Hebrew airstrips. |
| **Garmin Pilot** | Worldwide navigation DB; VFR plan filing "globally" via AIS claimed by Garmin (press release 2016) — whether it reaches IAA ARO is **UNCONFIRMED**. | Subscription | Same gaps as ForeFlight. |
| **Air Navigation Pro / Air Navigation** (Xample), **AviateHub** | Listed as "also bought" next to Air Map Israel; Israel-specific content **UNCONFIRMED**. | | |
| **Brook46 israel-airspace-map** (web PWA) | Live NOTAM shapes, CTR/TMA/PRD, CVFR routes, sport bubbles, traffic relay. Informational, paraglider-first. | Free, self-hosted | Not an EFB (no moving-map nav/record). |

**Where a free open-source app wins:** (1) Air Map Israel is the only real incumbent and is a one-person, crash-prone
app with no terrain, no debrief and a cluttered UI; (2) nobody ties **NOTAM closures to the route you are flying** or
gives border/P-area proximity alerts with the EFB polish of OpenEFB; (3) our J4 recording + AI debrief doesn't exist in
any Israeli app; (4) open data pipeline + reviewable rules = trust ("my data is current", with the AIP amendment shown).

## 8. Language and locale (Q7)

- Charts: the CVFR chart is bilingual-ish — Hebrew place names with Latin 5-letter codes; the GIS layer has both
  `LocalName`/`Name` (English) and `HebrewName`. The domestic AIP is Hebrew only; the eAIP is English.
- Radio: military "PLUTO" control is **Hebrew** (ENR 2.1); civil units (Tel-Aviv Control, Ben-Gurion APP) English.
  Haifa Tower: "English (Hebrew at ATC discretion) & Hebrew" (AD 2 LLHA §2.17); other towers **UNCONFIRMED**. Pilots of
  Israeli GA are Hebrew speakers; ICAO phraseology in Hebrew is standard.
- UI: English UI is acceptable (Air Map Israel is English-only and leads the market), but **Hebrew names of points and
  places are needed on the map** (pilots read "בית חנן", ATC says it in Hebrew). RTL: only needed if we localize the
  UI; v1 can stay LTR with Hebrew labels (SwiftUI handles mixed-direction strings). Hebrew labels in MapLibre need a
  font stack with Hebrew glyphs and RTL text plugin (MapLibre Native supports Arabic/Hebrew shaping).
- Units: feet/knots/NM for flying, **hPa QNH**, km/m for the lateral rules. Dates: UTC in NOTAMs, local in the AIP.

## 9. Product fit (Q8)

| Job | US today | Israel CVFR difference |
|---|---|---|
| **J1 in-flight awareness** | Sectional, airspace rings, ownship, TFRs, weather dots | The *route* is the primary object: show the active route leg with its **published altitude for my direction**, the **next reporting point** (compulsory vs on-request) with distance/ETA, and 2 km corridor. Airspace = CTR/ATZ floors/ceilings, TMA, P/R/D with altitudes, firing areas (active midweek). **Route-closure overlay** from NOTAMs. **Border and P-area proximity alerts** (6/3 km buffers, 33°N line). Squawk 5100 reminder. Hebrew labels. |
| **J2 preflight** | Weather, TFRs, destination | Weather + NOTAMs (mandatory), route builder from the published network (only legal legs; by-request and military legs flagged), altitude profile, auto-generated ICAO FPL text to paste into the e-mail to `ais@iaa.gov.il`. |
| **J3 emergency divert** | Nearest airport, bearing/distance | Same, but the candidate set includes airstrips (ה chapter) with "closed by NOTAM" status, and the nearest point must respect P-areas and borders (don't vector a pilot into Gaza's 6 km strip). Lost-comms: land at nearest suitable aerodrome per domestic ג-01. |
| **J4 recording/debrief** | Track, audio, transcript, AI debrief | Unchanged technically; debrief can score **altitude adherence per leg** and **reporting-point calls** (transcript in Hebrew — Apple speech models support he-IL; aviation vocabulary processor needs Hebrew/English mixed terms). |

New concepts in the data model: `Route` (segment graph keyed by point codes), `ReportingPoint` (kind: compulsory /
onRequest / arp), per-segment directional altitude, segment flags (military, byRequest), `Closure` (NOTAM-derived,
with validity schedule), region-specific airspace classes (CTR/ATZ/TMA/P/R/D/LLD/LLU), border buffers.

## 10. Proposed epic breakdown

Sizes: S ≤ 2 days, M ≤ 1 week, L > 1 week. "Owner" = product owner decision.

| # | Ticket (plain language) | Size | Depends on |
|---|---|---|---|
| IL-0 | **Ask CAAI for permission** to redistribute the GIS layers in the app (e-mail `aip@mot.gov.il`), and ask whether the chart itself can be licensed. Record the answer in the repo. | S (calendar time unknown) | — |
| IL-1 | **Data pipeline: CAAI GIS → app bundle.** Script that downloads the six zips (browser-like client; the WAF blocks curl), reads the File GDB (GDAL), normalizes to WGS-84 GeoJSON/SQLite: routes, points, CTR/ATZ, TMA, P/R/D, runways, FIR. Records the amendment date. Unit-tested on the saved samples. | M | IL-0 (to ship), not to build |
| IL-2 | **Region model.** `Region` = US / Israel selecting data sources, chart style, units (hPa), weather station list, NOTAM provider. Settings switch; persisted. | S | — |
| IL-3 | **Israel chart rendering.** MapLibre style: OSM base + hillshade (offline tiles), route lines coloured by type (civil / by-request dashed / military blue), altitude labels per direction, reporting-point triangles (filled = compulsory), CTR/ATZ/TMA/P/R/D polygons with floor/ceiling labels, runways, Hebrew + Latin labels. Visual check against the official sheet (user-imported, see IL-9). | L | IL-1, IL-2 |
| IL-4 | **Airports & airstrips for Israel.** Seed the aviation DB from CAAI runways/ARP + eAIP AD 2 (LLBG/LLHA/LLER frequencies, CTR) + domestic AIP chapters ד/ה (Hebrew curation: frequencies, circuit altitude, hours) + OurAirports fallback. Search by ICAO, Hebrew and English names. | M (+ Hebrew curator) | IL-1 |
| IL-5 | **Weather for Israel.** Station list (LLBG, LLHA, LLER, LLIB METAR; +LLHZ TAF), hPa altimeter display, IMS link-out for SIGMET until a feed exists. | S | IL-2 |
| IL-6 | **IAA NOTAM provider.** List → detail scraper with per-id cache and polite rate limit; parser for Q-line, A/B/C/D/E/F/G, coordinates/radius polygons, route-closure sentences → point-code chains → route segments. Staleness badge. Tests on saved samples. | M | IL-1 (point codes) |
| IL-7 | **Route-following view (J1).** Plan a route over the published network (only legal legs by default; by-request/military flagged), active leg with published altitude for direction, next reporting point + ETA, corridor, off-route distance, altitude deviation caution. | L | IL-1, IL-3 |
| IL-8 | **Alerts.** Route closed by NOTAM (on the planned route; before and in flight), approaching P/R area or CTR floor, border buffers (Gaza 6 km, Egypt 3 km, Syria 6 km, Lebanon 3 km, 33°N line), squawk 5100 reminder on departure. Red/amber rules per COMMON.md. | M | IL-6, IL-7 |
| IL-9 | **User-imported official chart.** Pilot adds the CAAI PDF sheets; app georeferences by the known sheet graticule and shows them as an overlay for cross-check. Keeps us clear of redistribution. | M | IL-3 |
| IL-10 | **Flight plan text (J2).** Generate the ICAO FPL block (A-11 appendix format) from the planned route, with a one-tap e-mail to `ais@iaa.gov.il`. No filing API. | S | IL-7 |
| IL-11 | **Debrief for CVFR (J4).** Per-leg altitude adherence, reporting-point passage times, Hebrew transcription vocabulary (point names, "דיווח", squawk). | M | IL-7, existing SFR work |
| IL-12 | **Review with an Israeli CFI.** Walk through rules in §2 against the app; fix symbology/wording. | S | IL-3, IL-7, IL-8 |

Critical path: IL-0/IL-1 → IL-3 → IL-7 → IL-8; IL-6 in parallel after IL-1.

## 11. Open questions for the owner

1. Do we ship the CAAI GIS layers without written permission (risk tolerance), or block v1 on IL-0?
2. Is a Hebrew-reading curator/CFI available for airstrip data and rule review (IL-4, IL-12)?
3. Do we scrape the IAA NOTAM page from the device (each iPad hits brin.iaa.gov.il) or run a small server that scrapes
   once and serves JSON (also lets us publish closures as open data)? The latter changes the "no backend" posture.
4. Military/by-request legs: show and allow planning (flagged) or hide by default?
5. Hebrew UI/RTL in v1 or English UI + Hebrew map labels (recommended)?
6. Should Israel be the test of a general "non-US region" abstraction (likely next: Cyprus for Israeli pilots flying
   LCLK/LCPH — note flight-maps.com ships Larnaca/Paphos charts), or a one-off?
7. Pricing: Air Map Israel is ₪0–50. A free OpenEFB with optional sync is competitive; confirm no premium feature is
   Israel-gated.

## 11. CVFR chart rendering notes for the CFI review (IL-3, IL-12)

The app draws the chart from the CAAI layers (`Services/IsraelChart*.swift`). Points for the reviewer:

- **Altitude references are inferred.** The CAAI layers carry none. IL-1 stores MSL for every non-zero airspace limit and
  SFC for 0, UNL for 99000. The airspace tap sheet says so on every limit that rests on that inference. Please confirm
  against the AIP (A-17, ENR 5.1) that no CTR/TMA/P/R/D limit is AGL or a flight level.
- **Route altitudes** are per direction, feet, flown on the controlling unit's QNH. The map label reads along the line:
  an arrow points the way the text runs, so "2500 -> / <- 3000" means 2500 flying with the text and 3000 against it. Text
  that CAAI publishes as two numbers ("2500/3500") is shown as published, never reduced to one number.
- **Colours:** civil routes solid green, by-request dashed green, military blue and tagged "MIL". Ordinary airspace is
  indigo; P/R/D are amber (caution). Red is used only for NOTAM route closures ("CLSD to HH:MMZ", dashed red hatch).
- **Closures** draw only from a NOTAM feed whose scrape time is under 6 h old. Between 1 h and 6 h they still draw, and
  every label adds "(data Nh MMm old)". Past 6 h, or with no feed, nothing is drawn and the layer panel says why. D)
  schedules are not evaluated on the map: a scheduled closure is drawn for its whole validity window and the schedule text
  is in the NOTAM list. Please say whether that is too aggressive.
- **Not drawn:** the FIR boundary, heliport/ultralight/ATS closure chains, border buffers (IL-8).
- **Offline:** the chart layers, labels and symbols are local sprites and need no network. The street base map under them is
  online only.

## 12. Aerodrome diagrams inventory (IL-13, 2026-11-01)

Sources fetched with plain curl (no WAF): eAIP `https://e-aip.azurefd.net/2026-08-06-AIRAC/html/eAIP/LL-AD-2.<ICAO>-en-GB.html`
(PDFs under `.../graphics/eAIP/`, cycle AIRAC AMDT 001/2026, 06 AUG 2026) and the full domestic AIP
`https://www.gov.il/BlobFolder/guide/aip/he/פמת מלא 1-26.pdf` (95 MB, downloaded; chapters ד/ה not yet inventoried).
Everything is stored in `tools/caai-apd/input/` (gitignored). Charts are (c) CAAI; permission is with the owner, so nothing is published.

| Aerodrome | Chart | Scale | Vector | Lang | Edition | Georef status |
|---|---|---|---|---|---|---|
| LLBG | `LL_AD_2_LLBG_ADC_V2_en.pdf` (AD 2 LLBG ADC-1) | 1:19,048 | yes (11.7k paths) | en | AMDT 001/2026, 06 AUG 2026 | runway-only fit, 3 runways, worst residual 65 ft (gate 50): rejected by the unmodified core |
| LLHA | `LL_AD_2_LLHA_ADC_V1_en.pdf` | bar scale only | yes | en | AMDT 001/2026 | one runway: "orientation ambiguous" |
| LLER | only apron charts (ADCRST, ADCU, ADCV), no aerodrome chart | 100 m bar | yes | en | AMDT 001/2026 | apron sheets, no runway: sheet only |
| LLHZ, LLIB, LLEY, LLMZ, LLKS, others | domestic AIP chapter ד/ה | not yet inventoried | | he | AIP 1/26 | pending |

Key finding: unlike FAA APDs, the Israeli charts have **no lat/lon graticule labels** (the only "N/S" matches are
bearing and threshold tables). The core's grid method does not apply; only the runway method (thresholds from
`israel-aviation.sqlite` `runways`, plus AD 2.12 coordinates printed on the chart) can fit them. A single runway
cannot fix orientation (LLHA), and LLBG's three-runway fit lands 36/52/65 ft off with translation chosen from one runway.
Next step: a wrapper-side least-squares fit over all drawn runways (scale + translation, rotation 0), keeping the 50 ft gate.
