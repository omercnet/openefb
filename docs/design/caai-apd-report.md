# Israeli aerodrome diagrams: georeferencing coverage (IL-13)

Edition AIRAC AMDT 001/2026 (06 AUG 2026), tool `tools/caai-apd`, gate: every matched runway within 50 ft and 5%
of the CAAI GIS runway length, at least two independent runways.

**Result: 0 of 13 charts georeferenced under the 50 ft gate.** All 13 ship as sheet-only PDFs.

| Aerodrome | Chart (source) | Scale | Runways in GIS | Result | Why |
|---|---|---|---|---|---|
| LLBG | eAIP AD 2 LLBG ADC-1 | 1:19,048 | 3 | sheet only | all 3 matched; worst 72 ft (08/26 28 ft, 03/21 52 ft, 12/30 72 ft); gate 50 ft |
| LLHA | eAIP AD 2 LLHA ADC | bar | 1 | sheet only | single runway: no independent position check |
| LLER | eAIP AD 2 LLER ADCU-1 (apron U only) | bar | 1 | sheet only | single runway; chart is an apron sheet with no runway polygon |
| LLHZ | domestic AIP p.227 | bar | 1 | sheet only | single runway |
| LLIB | domestic AIP p.281 | bar | 1 | sheet only | single runway |
| LLBS | domestic AIP p.303 | bar | 1 | sheet only | single runway |
| LLMG | domestic AIP p.327 | bar | 1 | sheet only | single runway |
| LLMZ | domestic AIP p.339 | bar | 1 | sheet only | single runway |
| LLEY | domestic AIP p.346 | bar | 1 | sheet only | single runway |
| LLFK | domestic AIP p.360 | bar | 1 | sheet only | single runway |
| LLKZ | domestic AIP p.368 | 1:15,250 | 1 | sheet only | single runway |
| LLKS | domestic AIP p.375 | bar | 1 | sheet only | single runway |
| LLRS | domestic AIP p.395 | bar | 1 | sheet only | single runway |

Not inventoried: LLAR, LLBO, LLES, LLEV and other airstrips (no aerodrome chart page found in chapters ד/ה).
No chart is "not to scale": all carry a bar or ratio scale and are north-up vector PDFs. None has a lat/lon graticule.

## Why LLBG fails

The chart agrees with the GIS runway ends to 22 m or better, but the three runways do not share one translation: after
a least-squares fit over all three the midpoint errors are 28, 60 and 72 ft in different directions. The printed
AD 2.12 threshold table is no better as control: against the GIS ends it differs by 24 to 69 m cross-track on the six
thresholds (along-track differences of 34 to 488 m are displaced thresholds), so the two control sources disagree with
each other by more than the gate. Which one is wrong (a datum offset in the printed table, or GIS ends digitised from
a different source than the chart) is open; CAAI would have to say.

## Decision needed from the owner

The single-runway aerodromes are the ones a GA pilot would use, and they cannot pass a runway-only gate by
construction. Options: (a) ship sheet-only for all (current, safe); (b) add an independent control for them, for
example the ARP symbol on the chart against the AIP ARP (AIP coordinates are to 1", about 100 ft, so this cannot meet
50 ft); (c) get surveyed thresholds from CAAI and re-run; (d) accept a looser Israeli gate. This work keeps the 50 ft
gate, as the brief says. `--dev-runway-tolerance 80` produces a dev-only LLBG pack for wiring and screenshots.
