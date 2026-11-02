# Israeli aerodrome diagrams: georeferencing coverage (IL-13)

Edition AIRAC AMDT 001/2026 (06 AUG 2026), tool `tools/caai-apd`. The shared core is unchanged for the US: the new scanner
modes (stroked runways, graphics-state restore) are off unless the CAAI tool turns them on.

**Result (edition `2026-08b`, IL-DIAG2): 5 of 13 charts placed (LLBG, LLHA, LLIB, LLBS, LLEY). 8 stay sheet-only.**
The pack is built with `published: false`. The previous edition `2026-08` placed 2 (LLBG, LLHA).

## Gate (owner decision Q6, option B)

- **Runway gate: 100 ft** (US stays 50 ft) on every matched runway: cross-track, along-track and midpoint, plus 5% on length.
- **Two or more runways** (LLBG): scale and translation fitted by least squares over all drawn runways; the runways check each other.
- **One runway**: the runway fixes scale, rotation and position, so it cannot check itself. The independent check is the printed
  ARP symbol (a small circle with a cross, nearest an "ARP" label) against the AIP ARP in `israel-aviation.sqlite`, after the fit.
  Tolerance per axis = 100 ft + the AIP rounding of 1 arc-second: north-south 30.5 m + 31 m = 61.5 m, east-west 30.5 m + 26 m = 56.5 m
  (1" is about 31 m N-S and 26 m E-W at 31-33 N). A field with no printed ARP symbol, or one outside that box, is never placed.
- One-runway fields: rotation is taken from the GIS runway bearing and accepted only within 10 degrees of north-up (charts are
  north-up or drawn to magnetic north, variation about 5 E). Rotation and scale are therefore not independently checked; only position is.
- Badge: edition plus "±100 ft" (`index.json` `accuracyFeet`).

## IL-DIAG2 findings

- **LLIB was never rotated.** The IL-13 note "drawn rotated 82 degrees" was a misread. The chart is north-up. The scanner
  did not restore the fill colour after `q ... Q`, so the black active runway was read as white and the closed grey
  "RUNWAY NOT IN USE" strip (crossing at 82 degrees) was picked as the runway. With the graphics state restored the
  active runway is found, and LLIB places north-up: ARP 42 m N, 21 m W of the AIP ARP (allowed 61.5 / 56.5 m).
  No rotation fit was added: no chart in the set is actually drawn rotated, so there is nothing real to validate one against,
  and a hand-fitted rotation would have an unverifiable 180 degree sense. The app overlay already draws rotated georeferences
  correctly: it builds the map quad from `clipCorners`, which go through the full affine transform (test:
  `rotatedGeoreferenceGivesRotatedCorners`).
- **Stroked runways.** LLBS and LLEY draw the runway as one thick black stroked line, not a filled polygon.
  `PDFVectorScanner.strokedRunwayShapes()` accepts a dark open path of 2 to 4 collinear points, painted at least 3 pt wide and
  at least 5 times longer than wide. It is only a fallback when no filled runway polygon exists, and is not used for the US.
  LLBS: ARP 10 m N, 6 m W. LLEY: ARP 5 m N, 14 m E (an earlier run misread LLEY as 128 m N, 138 m E for the same stale-colour reason).
- **LLER.** Every AD 2.24 chart for LLER is an apron or parking chart (ADCU, ADCRST, ADCV) or the VFR terminal chart (VFRTA);
  none draws a runway, so there is nothing to fit. Sheet only.
- **LLKZ.** The runway is drawn as a 15-point filled outline with a wide threshold blob (area about 38% of its bounding box, the
  core requires 55%) and the chart prints no ARP symbol. A one-runway field with no ARP symbol has no independent check, so
  loosening the extractor could not place it. Sheet only. The AIP also gives the length as 1500 m on this chart and 1600 m on p. 365.

## Per aerodrome

| Aerodrome | Chart | Runways in GIS | Result | Evidence |
|---|---|---|---|---|
| LLBG | eAIP AD 2 LLBG ADC-1, 1:19,048 | 3 | **placed** | 3 of 3 matched, worst runway error 72 ft (28, 52, 72). No ARP cross symbol found, so no ARP check (not required with 3 runways). |
| LLHA | eAIP AD 2 LLHA ADC | 1 | **placed** | ARP check: printed ARP 12 m N, 0 m E of the AIP ARP (allowed 61.5 / 56.5 m). Page rotation 3 degrees. |
| LLIB | domestic AIP p.281 | 1 | **placed** | North-up. ARP check: 42 m N, 21 m W (allowed 61.5 / 56.5 m). Chart length 1102 m vs GIS 1106 m. |
| LLBS | domestic AIP p.303 | 1 | **placed** | Runway drawn as a stroked line. ARP check: 10 m N, 6 m W. Chart length 1400 m vs GIS 1403 m. |
| LLEY | domestic AIP p.346 | 1 | **placed** | Runway drawn as a stroked line. ARP check: 5 m N, 14 m E. |
| LLER | eAIP AD 2 LLER (ADCU, ADCRST, ADCV apron charts) | 1 | sheet only | apron charts only: no runway on any AD 2.24 chart |
| LLHZ | domestic AIP p.227 | 1 | sheet only | ARP check failed: printed ARP 98 m N, 6 m E of the AIP ARP (allowed 61.5 m N-S) |
| LLMG | domestic AIP p.327 | 1 | sheet only | ARP check failed: 6 m N, 107 m E (allowed 56.5 m E-W) |
| LLMZ | domestic AIP p.339 | 1 | sheet only | ARP check failed: 97 m N, 23 m E (allowed 61.5 m N-S) |
| LLFK | domestic AIP p.360 | 1 | sheet only | ARP check failed: 255 m N, 192 m E |
| LLKZ | domestic AIP p.368 | 1 | sheet only | no runway polygon matched and no printed ARP symbol |
| LLKS | domestic AIP p.375 | 1 | sheet only | ARP check failed: 295 m N, 233 m E |
| LLRS | domestic AIP p.395 | 1 | sheet only | no printed ARP symbol found: no independent check |

Not inventoried: LLAR, LLBO, LLES, LLEV and other airstrips (no aerodrome chart page found in chapters ד/ה).

## What this does and does not show

- LLBG's runways agree with each other to 72 ft, but the printed AD 2.12 threshold table differs from the CAAI GIS runway ends by
  24 to 69 m cross-track, so the two control sources disagree with each other. The GIS ends were used (the chart agrees with them).
- The five ARP failures are 100 to 300 m, far more than rounding. The charts are internally consistent (runway and ARP symbol drawn
  together), so the disagreement is between the GIS runway ends and the GIS/AIP ARP, or between the chart and both. It cannot be told
  which from the data we have; CAAI would have to say. LLHZ, the busiest GA field, misses by 36 m.
- LLHA, LLIB, LLBS and LLEY pass with 5 to 42 m, but the check covers position only. Treat the "±100 ft" badge as the gate, not a measured accuracy.
- Data-fix questions for CAAI (surveyed thresholds and ARP for the five ARP failures, LLKZ length, LLBG threshold table): `docs/research/israel-caai-data-fixes.md`.
