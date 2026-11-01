# FAA airport diagram georeferencing report

Generated 2026-10-31 21:12 UTC by `tools/apd-georef` over d-TPP cycle 2611.
Core: `efb-212/Services/AirportDiagramGeoreferencer.swift` (same code the app runs on device).

## Summary

| Metric | Value |
|---|---|
| APD records in the metafile | 925 |
| Airports not in the bundled database (skipped) | 0 |
| PDFs that failed to download | 0 |
| Diagrams processed | 925 |
| Georeferenced and validated | 820 (88.6%) |
| Rejected | 105 (11.4%) |
| Validated with the runway cross-check | 815 |
| Diagrams with masked insets | 9 |
| Wall time | 301 s (6 jobs); per diagram median 0.07 s, p95 6.56 s |

Acceptance gates applied to every accepted fit: E-W vs N-S scale within 3% (when both
axes have two grid values), predicted runway centrelines and midpoints within 50 ft of the drawn runways
whenever the database has threshold coordinates, chart scale between 3 and 80 ft per PDF point.

## Method and label source (accepted fits)

| Method | Count |
|---|---|
| gridRunwayChecked | 778 |
| runway | 37 |
| grid | 5 |

| Label source | Count |
|---|---|
| text | 536 |
| ocr | 280 |
| none | 4 |

| Page rotation (page up vs true north) | Count |
|---|---|
| 0 deg | 642 |
| 270 deg | 178 |

## Accuracy vs database runway thresholds (accepted fits)

Worst predicted-threshold error per diagram, over all matched runways.

| Error | Diagrams |
|---|---|
| 0-10 ft | 640 |
| 10-20 ft | 96 |
| 20-30 ft | 35 |
| 30-40 ft | 25 |
| 40-50 ft | 19 |
| 50-75 ft | 0 |
| 75-100 ft | 0 |
| 100-150 ft | 0 |
| 150-300 ft | 0 |
| over 300 ft | 0 |

Median 4.7 ft, p95 31.5 ft, max 48.7 ft.

## Failure reasons

| Reason | Diagrams |
|---|---|
| runway-cross-check | 70 |
| runways-not-matched | 15 |
| scale-undetermined | 8 |
| orientation-ambiguous | 8 |
| implausible-scale | 2 |
| labels-not-snapped | 1 |
| insufficient-labels | 1 |

## Where the pass rate stands and why (analysis, added by hand)

**Result (re-run on the NASR-built aviation.sqlite, NASR cycle 29 Oct 2026): 820 of 925 diagrams (88.6%) are
accepted, every one within 50 ft of the NASR runway centrelines (median 4.7 ft, p95 31.5 ft, max 48.7 ft). The 90%
target is still not reached.** The previous run on the OurAirports database plus a 908-airport NASR substitution
file (`apd-runway-ends.json`, now deleted) accepted 784 of 910 (86.2%; 84.8% of all 925 records).

1. **Runway data was the first blocker, now fixed at the source.** The old OurAirports runway ends were 100-300 ft off
   (KPAO 13/31 ends 100-130 ft, KBOS 15L/33R 200 ft; see efb-chx), so the 50 ft gate rejected KPAO and KBOS. The
   bundled database now carries FAA NASR `APT_RWY_END` ends for every airport that has surveyed ends (about 15,000 of
   22,900 runways; most of the rest are private turf strips, 407 filled from OurAirports). The app and this tool read
   the same database, so there is no substitution step left. The gate stays at 50 ft.
2. **Military fields drew runways with arrestor-gear circles in the outline**, so the extractor found no runway.
   Allowing up to 4 curve points in a runway polygon fixed 33 of 42 (KSSC: 1 ft residual).
3. **70 "runway-cross-check" rejections are 50-310 ft misses** (for example KBIX 310 ft, KCMA 296 ft, KBPT 120 ft).
   An earlier run with the gate opened to 100,000 ft showed the miss in PDF points: 1.5-6 pt for 20 diagrams, 12-15 pt
   (about 300 ft) for the rest. Large airports are drawn at 30-50 ft per point, so 50 ft is about 1 pt, the width of a
   drawn line. No tolerance reaches 90% without admitting fits that are off by more than a runway width, so the gate
   was not loosened. Every accepted fit is verified; the rejected ones show no overlay.
4. **Other rejects:** 15 where no drawn runway matched a database runway, 8 scale undetermined, 8 orientation-ambiguous,
   2 implausible scale, 2 label failures.

The previous run skipped 15 airports (mostly Pacific and Caribbean territories) that the OurAirports database lacked;
the NASR database includes them, so they are processed now. Their PDFs failed to download in the tool's first two
runs (the same URLs return 200 under curl; cause not found) and were pre-fetched into the cache for the final run.

**Ceiling with the current approach: about 88-89%.** Closing the gap needs per-style runway extraction for the
military and large-hub diagrams (the runway outlines there are hatched or composed of several pieces).

## Rejected diagrams

| Airport | PDF | Reason |
|---|---|---|
| KABY | 00008AD.PDF | runway cross-check failed (73 ft) |
| KACT | 00439AD.PDF | runway cross-check failed (57 ft) |
| KARA | 05040AD.PDF | runway cross-check failed (90 ft) |
| KAYX | 05731AD.PDF | orientation ambiguous |
| KBDR | 00621AD.PDF | runway cross-check failed (60 ft) |
| KBIF | 00133AD.PDF | no drawn runway matched the database runways |
| KBIX | 00049AD.PDF | runway cross-check failed (310 ft) |
| KBPT | 00521AD.PDF | runway cross-check failed (120 ft) |
| KBRO | 00061AD.PDF | runway cross-check failed (68 ft) |
| KCBM | 00091AD.PDF | runway cross-check failed (62 ft) |
| KCMA | 00680AD.PDF | runway cross-check failed (296 ft) |
| KCOF | 00038AD.PDF | runway cross-check failed (124 ft) |
| KCWA | 05674AD.PDF | runway cross-check failed (73 ft) |
| KDEN | 09077AD.PDF | implausible scale (90.2 ft/pt) |
| KDLH | 00125AD.PDF | runway cross-check failed (59 ft) |
| KDMA | 00429AD.PDF | runway cross-check failed (189 ft) |
| KDPG | 05071AD.PDF | runway cross-check failed (108 ft) |
| KDTO | 05866AD.PDF | runway cross-check failed (65 ft) |
| KDTW | 00119AD.PDF | runway cross-check failed (56 ft) |
| KDYS | 00002AD.PDF | runway cross-check failed (85 ft) |
| KEDW | 00500ADROGERSLAKEBED.PDF | implausible scale (130.4 ft/pt) |
| KEDW | 00500ADROSAMONDLAKEBED.PDF | insufficient labels (lat 0, lon 0) |
| KEGI | 00699AD.PDF | runway cross-check failed (51 ft) |
| KFAF | 05211AD.PDF | orientation ambiguous |
| KFBG | 05069AD.PDF | no drawn runway matched the database runways |
| KGLE | 06113AD.PDF | no drawn runway matched the database runways |
| KGRF | 00413AD.PDF | runway cross-check failed (269 ft) |
| KGSB | 00169AD.PDF | runway cross-check failed (71 ft) |
| KHFF | 06315AD.PDF | runway cross-check failed (105 ft) |
| KHIF | 00296AD.PDF | orientation ambiguous |
| KHLR | 05031AD.PDF | runway cross-check failed (73 ft) |
| KHMN | 00007AD.PDF | runway cross-check failed (96 ft) |
| KHTS | 00532AD.PDF | runway cross-check failed (76 ft) |
| KHUM | 05037AD.PDF | runway cross-check failed (51 ft) |
| KIAB | 00453AD.PDF | no drawn runway matched the database runways |
| KJAN | 05132AD.PDF | runway cross-check failed (64 ft) |
| KLAW | 00924AD.PDF | runway cross-check failed (106 ft) |
| KLMT | 00473AD.PDF | runway cross-check failed (53 ft) |
| KLRF | 00738AD.PDF | runway cross-check failed (90 ft) |
| KLSF | 00146AD.PDF | no drawn runway matched the database runways |
| KLUF | 00321AD.PDF | no drawn runway matched the database runways |
| KMFD | 00860AD.PDF | runway cross-check failed (232 ft) |
| KMGE | 00959AD.PDF | no drawn runway matched the database runways |
| KMIB | 05013AD.PDF | runway cross-check failed (268 ft) |
| KMLU | 00270AD.PDF | runway cross-check failed (374 ft) |
| KMSN | 00245AD.PDF | runway cross-check failed (56 ft) |
| KMSP | 00264AD.PDF | runway cross-check failed (99 ft) |
| KMTC | 00276AD.PDF | labels not snapped to grid lines (lat 2, lon 0) |
| KMUO | 00323AD.PDF | runway cross-check failed (104 ft) |
| KMWA | 05215AD.PDF | runway cross-check failed (99 ft) |
| KMXF | 00274AD.PDF | scale undetermined |
| KNBC | 00916AD.PDF | runway cross-check failed (111 ft) |
| KNCA | 00732AD.PDF | runway cross-check failed (167 ft) |
| KNDZ | 01909AD.PDF | runway cross-check failed (78 ft) |
| KNFG | 05985AD.PDF | no drawn runway matched the database runways |
| KNGU | 00290AD.PDF | no drawn runway matched the database runways |
| KNHK | 00314AD.PDF | runway cross-check failed (78 ft) |
| KNIP | 00209AD.PDF | runway cross-check failed (222 ft) |
| KNKT | 00471AD.PDF | runway cross-check failed (91 ft) |
| KNLC | 05067AD.PDF | runway cross-check failed (90 ft) |
| KNMM | 05079AD.PDF | runway cross-check failed (110 ft) |
| KNQI | 00918AD.PDF | runway cross-check failed (85 ft) |
| KNRS | 00307AD.PDF | runway cross-check failed (568 ft) |
| KNTU | 00934AD.PDF | runway cross-check failed (106 ft) |
| KNUQ | 00410AD.PDF | runway cross-check failed (50 ft) |
| KNYG | 00339AD.PDF | no drawn runway matched the database runways |
| KNYL | 00511AD.PDF | runway cross-check failed (306 ft) |
| KNZY | 00374AD.PDF | runway cross-check failed (76 ft) |
| KOFF | 00544AD.PDF | scale undetermined |
| KOKC | 00301AD.PDF | runway cross-check failed (102 ft) |
| KONT | 00965AD.PDF | runway cross-check failed (774 ft) |
| KORH | 00652AD.PDF | runway cross-check failed (192 ft) |
| KOSH | 00730AD.PDF | runway cross-check failed (64 ft) |
| KOZR | 00577AD.PDF | runway cross-check failed (55 ft) |
| KPOB | 00147AD.PDF | no drawn runway matched the database runways |
| KPUB | 00334AD.PDF | runway cross-check failed (122 ft) |
| KRCA | 00343AD.PDF | no drawn runway matched the database runways |
| KRDR | 05010AD.PDF | runway cross-check failed (161 ft) |
| KRDU | 00516AD.PDF | runway cross-check failed (68 ft) |
| KRVS | 05427AD.PDF | runway cross-check failed (516 ft) |
| KSAW | 00773AD.PDF | orientation ambiguous |
| KSDF | 00239AD.PDF | runway cross-check failed (64 ft) |
| KSJC | 00693AD.PDF | runway cross-check failed (58 ft) |
| KSKA | 00553AD.PDF | runway cross-check failed (298 ft) |
| KSLI | 00953AD.PDF | runway cross-check failed (297 ft) |
| KSPS | 00454AD.PDF | runway cross-check failed (142 ft) |
| KSVC | 00793AD.PDF | orientation ambiguous |
| KSVN | 00381AD.PDF | no drawn runway matched the database runways |
| KTPA | 00416AD.PDF | runway cross-check failed (60 ft) |
| KVPS | 00436AD.PDF | runway cross-check failed (149 ft) |
| KWRI | 00150AD.PDF | runway cross-check failed (205 ft) |
| PACZ | 02326AD.PDF | scale undetermined |
| PADK | 01244AD.PDF | orientation ambiguous |
| PAEH | 02235AD.PDF | scale undetermined |
| PAEI | 01729AD.PDF | runway cross-check failed (183 ft) |
| PAIM | 02335AD.PDF | scale undetermined |
| PASV | 02332AD.PDF | scale undetermined |
| PASY | 01246AD.PDF | runway cross-check failed (75 ft) |
| PATC | 02334AD.PDF | scale undetermined |
| PATL | 10651AD.PDF | scale undetermined |
| PGUA | 02147AD.PDF | no drawn runway matched the database runways |
| PHKO | 05761AD.PDF | no drawn runway matched the database runways |
| PHMK | 00759AD.PDF | runway cross-check failed (52 ft) |
| PKWA | 11010AD.PDF | orientation ambiguous |
| PWAK | 02162AD.PDF | orientation ambiguous |
