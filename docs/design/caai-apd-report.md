# Israeli aerodrome diagrams: georeferencing coverage (IL-13)

Edition AIRAC AMDT 001/2026 (06 AUG 2026), tool `tools/caai-apd` (US gate and US behaviour untouched: the Israeli gate lives
in the tool, the shared core is unchanged).

**Result: 2 of 13 charts placed (LLBG, LLHA). 11 stay sheet-only.** The pack is built with `published: false`.

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

## Per aerodrome

| Aerodrome | Chart | Runways in GIS | Result | Evidence |
|---|---|---|---|---|
| LLBG | eAIP AD 2 LLBG ADC-1, 1:19,048 | 3 | **placed** | 3 of 3 matched, worst runway error 72 ft (28, 60, 72). No ARP cross symbol found, so no ARP check (not required with 3 runways). |
| LLHA | eAIP AD 2 LLHA ADC | 1 | **placed** | ARP check: printed ARP 12 m N, 0 m E of the AIP ARP (allowed 61.5 / 56.5 m). Page rotation 3 degrees. |
| LLER | eAIP AD 2 LLER ADCU-1 (apron U) | 1 | sheet only | apron sheet: no runway polygon in the vector stream |
| LLHZ | domestic AIP p.227 | 1 | sheet only | ARP check failed: printed ARP 98 m N, 6 m E of the AIP ARP (allowed 61.5 m N-S) |
| LLIB | domestic AIP p.281 | 1 | sheet only | chart is rotated 82 degrees from north-up (outside the 10 degree limit) |
| LLBS | domestic AIP p.303 | 1 | sheet only | no runway polygon found (runway not drawn as a dark filled shape) |
| LLMG | domestic AIP p.327 | 1 | sheet only | ARP check failed: 6 m N, 107 m E (allowed 56.5 m E-W) |
| LLMZ | domestic AIP p.339 | 1 | sheet only | ARP check failed: 97 m N, 23 m E (allowed 61.5 m N-S) |
| LLEY | domestic AIP p.346 | 1 | sheet only | ARP check failed: 128 m N, 138 m E |
| LLFK | domestic AIP p.360 | 1 | sheet only | ARP check failed: 255 m N, 192 m E |
| LLKZ | domestic AIP p.368 | 1 | sheet only | no runway polygon found |
| LLKS | domestic AIP p.375 | 1 | sheet only | ARP check failed: 295 m N, 233 m E |
| LLRS | domestic AIP p.395 | 1 | sheet only | no printed ARP symbol found: no independent check |

Not inventoried: LLAR, LLBO, LLES, LLEV and other airstrips (no aerodrome chart page found in chapters ד/ה).

## What this does and does not show

- LLBG's runways agree with each other to 72 ft, but the printed AD 2.12 threshold table differs from the CAAI GIS runway ends by
  24 to 69 m cross-track, so the two control sources disagree with each other. The GIS ends were used (the chart agrees with them).
- The six ARP failures are 100 to 300 m, far more than rounding. The charts are internally consistent (runway and ARP symbol drawn
  together), so the disagreement is between the GIS runway ends and the GIS/AIP ARP, or between the chart and both. It cannot be told
  which from the data we have; CAAI would have to say. LLHZ, the busiest GA field, misses by 36 m.
- LLHA passes with 12 m, but the check covers position only. Treat the "±100 ft" badge as the gate, not a measured accuracy.
- An LLIB-style chart (drawn rotated, not north-up) could be placed with a hand-read rotation; not done, because the 180 degree
  sense of the runway is then unverifiable.
