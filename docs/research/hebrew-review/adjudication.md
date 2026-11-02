# Hebrew review: adjudication of fable.csv vs astra.csv (integrator, 2026-11-01)

Two independent reviews of 49 aerodromes × 9 field groups (441 rows). Raw outputs: `fable.csv` and `astra.csv`.

| Outcome | Rows |
|---|---|
| Both confirm | 238 |
| Both not-in-aip | 123 |
| Both corrected, same fact in different wording | 25 |
| One confirmed or not-in-aip, the other corrected **with a page or source** (additive) | 50 |
| Real conflicts for the owner | 5 rows (4 aerodromes) |

## Rules applied
1. **Both confirm, or both not-in-aip:** keep the value.
2. **Both corrected, same fact:** apply it. Use Fable's wording, and Astra's where it's more complete.
3. **One corrected with a cited source, the other confirmed or found no source:** apply the cited correction. These add
   precision or a missed fact, and don't contradict. Examples:
   - helipad CAAI location indicators (LLAA, LLBL, LLHD, LLHY, LLIC, LLPO, LLRB, LLSR, LLSM, LLYS);
   - LLBG and LLER circuit altitudes and slot coordination (PPR = yes) from the current online eAIP AD 2.22 (Fable had
     only the truncated sample);
   - military airbases: "operation requires CAAI authorization", not "emergency only";
   - dead-side leg wording at LLHZ and LLIB;
   - LLIB RWY 33 1008 m;
   - LLBO takeoff 36 at 1650 m;
   - Ichilov circular 28 m pad with 42 lights;
   - Herzliya title "Modi Alon" (not "Moshe");
   - LLAR drawn on the p341 chart with ATZ ARAD GND–3000 ft;
   - LLEV active אז"ם strip per p230;
   - Hadassah: merge Fable's obstacle buildings with Astra's coordinate fix.
4. **Both say LLRS (מז"ם) is ultralight only:** exclude LLRS from NRST for conventional GA aircraft.
5. **Frequencies at LLBG and LLER:** Astra confirmed them against the full eAIP AD 2.18 online, and Fable couldn't check
   (truncated sample), so they're confirmed.

## For the owner (real conflicts; these aerodromes stay "unreviewed" until decided)
1. **LLKS (Kiryat Shmona) frequencies:** is 118.40 "Pluto Mizrah", as the CSV says?
   - Fable: no. The 1/26 A-07 military table (p29) gives Pluto **Mizrah** 123.85 / 134.65, and 118.40 is Pluto
     **Maarav**. Safety-relevant.
   - Astra: the current value is confirmed.
2. **Assuta Ashdod helipad frequencies,** from the same A-07 table:
   - Fable: 128.35 is Hagav Tzfoni primary and 129.25 secondary.
   - Astra: the current listing (129.25 Hagav Tzfoni, 128.35 unlabelled) is confirmed.
3. **LLRS circuit on Fri/Sat/holidays:**
   - Astra: circuits are prohibited on weekends (p383).
   - Fable: no prohibition; only an early-turn restriction.
4. **LLKZ (Kzioth) runway length:** both reviewers flag that the AIP contradicts itself (1600 m in the p365 table, 1500 m
   on the p368 chart). Only CAAI can settle it; meanwhile show both values.

## Resolved by owner (Q7 = B)
The owner took Fable's reading on all four (2026-11-01). Applied to `tools/caai-importer/curated/aerodromes-il.csv`,
each row now `review_status=reviewed`, `reviewed_by="fable+astra, owner decision 2026-11-01"`; 49/49 reviewed.
1. **LLKS:** Pluto Mizrah is 123.85 primary / 134.65 secondary (A-07 table p29, 1/26). The wrong "118.400 Pluto Mizrah"
   entry is removed; 118.40 is Pluto Maarav and Fable's row does not tie it to the strip, so it is not listed.
2. **Assuta Ashdod:** 128.35 Hagav Tzfoni primary, 129.25 Hagav Tzfoni secondary; Hatzor tower 123.55 unchanged.
3. **LLRS:** no Fri/Sat/holiday circuit prohibition. Recorded as Fable states it: on Fri/Sat/holidays turn west
   (crosswind) as early as possible after takeoff from RWY 36 and never later than the north hangar line (p386).
4. **LLKZ:** both published lengths stay in remarks (p365 table 1600 m, p368 chart 1500 m) with a note that the AIP is
   internally inconsistent; the shorter 1500 m is the runway length used for calculations.
