# Hebrew AIP review — astra

## Coverage and counts

49 aerodromes × 9 field groups = **441 decisions**.

| Verdict | Count |
|---|---:|
| confirm | 255 |
| correct | 56 |
| unsure | 5 |
| not-in-aip | 125 |
| **Total** | **441** |

Reviewed independently against domestic AIP amendment 1/26. Rendered domestic source pages at 150 dpi into a temporary directory outside the repository; used page images for numeric and operational evidence. PDF references in the CSV are **one-based PDF page numbers**, not printed chapter pagination. Used the local English eAIP samples and the complete official 2026-08-06 English eAIP for LLBG/LLER operational regulations omitted from those samples. No other reviewer’s output was read.

`confirm` concerns the listed values, not completeness of all possible airport information. `not-in-aip` means this field has no establishing source in the reviewed AIP; it does not mean the aerodrome is closed. GIS/OurAirports coordinates, elevations and runway data without AIP support remain unverified. A blank circuit/frequency is not permission to operate without restrictions. English-source corrections have a literal English excerpt in `note` where applicable rather than a fabricated Hebrew quotation; their section references resolve through the links below. Proposed values are review recommendations, not importer-ready patches.

## Ten most safety-relevant corrections

1. **LLRS aircraft category:** מז״מ is an **ultralight category, not UAS**. The airstrip is restricted to that operational category (PDF383); ordinary fixed-wing GA should not be presented with it as a suitable NRST destination. Do not exclude ultralights or silently apply that restriction to the separate helicopter landing area (PDF390–399). Retain prior coordination/Palmachim requirements.
2. **LLBG prior coordination:** replace `ppr=no` with prior-coordination-required semantics. All arrivals/departures need a coordinated slot, requested 48 h ahead Mon–Thu or 72 h Fri–Sun; GA parking beyond 36 h needs a request and non-home-base parking beyond 72 h is restricted. AD2.20 §1. H24 service hours do not override operating restrictions.
3. **LLER prior coordination:** replace `ppr=no`; private domestic/international traffic requires a coordinated slot requested 48 h ahead. Arriving CVFR flights should telephone TWR before departure for a CTR-entry slot. AD2.20 §1.
4. **LLKZ hours:** the rendered page clearly reads **Sunday–Thursday 08:00–22:00** (PDF364), not “hours illegible”. Circuit **1900 ft QNH / 1000 ft AGL**, east, right33/left15 is confirmed. Hagav Dromi **121.150 MHz** is independently confirmed in current A-07, PDF29, not merely the older local chart.
5. **LLHZ/LLIB circuit geometry:** צלע מתה means **dead-side leg**, not downwind. Herzliya dead-side is south of the runway (PDF219); Rosh Pina dead-side is west while its standard circuit is east (PDF274). Preserve the published circuit altitude and tower qualifications.
6. **LLBG/LLER missing circuits:** LLBG CAT A/B1200 ft, C/D2000 ft; left30/26/21, right12/08. LLER CAT A/B1500 day/2000 night, C2500, D3000; west circuit, left01/right19; CAT E not applicable. AD2.22. A single scalar must not erase aircraft-category/night qualifications.
7. **LLMZ parachute ceiling:** **9000 ft MSL**, not AGL (PDF337). Above8000 ft requires advance Southern Control coordination. Negative field elevation makes the datum error consequential.
8. **Ultralight mistranslations elsewhere:** LLHZ’s prohibited category and its **123.700 MHz** monitored traffic are ultralights, not UAS (PDF213/223). Assuta Ashdod’s weekend Road4 traffic at400 ft is also ultralight traffic (PDF408).
9. **Landing geometry:** Ichilov is **28 m diameter**, not a28×28 m square (PDF404); Hadassah rooftop is **30 m diameter**, not a30×30 m square (PDF415). Preserve published non-reciprocal helicopter approach directions. Rosh Pina has direction-dependent dimensions/landing distances (PDF270); Bar Yehuda takeoff36 is1650 m versus1487 m for the other listed operations (PDF308).
10. **Military access and radio data:** “Emergency only” is not established by the cited AIP. A-01 requires **CAAI authorization and approved procedures** for operation to/from a military aerodrome (PDF16). Do not imply routine civil access. A-07 publishes military unit frequencies (PDF29); the nine blank military frequency groups and blanket “not in domestic AIP” remarks need correction.

## Priority findings and unresolved evidence

- **LLHA:** keep `ppr=yes`. Non-home-based aircraft must coordinate arrival and parking by email (PDF245); international requests require at least24 h (PDF251–252). This is not an unrestricted GA field.
- **LLAR:** Arad **does appear**: B-08 explicitly mentions intermediate landing at Arad (PDF152), and charts label the strip (e.g.PDF136). No dedicated chapter ד/ה was found. That does not verify the GIS ARP/runway dimensions or establish present availability.
- **LLEV:** the Herzliya training chart explicitly identifies an active ultralight strip at Ein Vered in area9 (PDF230 note1). Missing dedicated chapter does not establish closure; GIS dimensions remain unverified.
- **LLKZ runway remains unsure:** PDF365 text table says1600×30 m; PDF368 chart says1500×30 m, both from the same2025 amendment. Do not select one silently.
- Other `unsure` rows: mixed-source remarks for LLAR/LLEV and broad foreign-airport/GIS assertions for HETB/OJAQ. These are evidentiary gaps, not proposed numerical fixes.

## Official English sources

- [LLBG, AIRAC2026-08-06](https://e-aip.azurefd.net/2026-08-06-AIRAC/html/eAIP/LL-AD-2.LLBG-en-GB.html)
- [LLER, AIRAC2026-08-06](https://e-aip.azurefd.net/2026-08-06-AIRAC/html/eAIP/LL-AD-2.LLER-en-GB.html)

Review of a published edition, not operational clearance or a NOTAM/current-availability check. No curated data, importer or app files changed.
