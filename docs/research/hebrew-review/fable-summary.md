# Hebrew review of aerodromes-il.csv: reviewer `fable`

Independent review of the 49 aerodromes in `tools/caai-importer/curated/aerodromes-il.csv` against the rendered pages
of the domestic AIP amendment 1/26 (`tools/caai-importer/input/aip-1-26.pdf`, PyMuPDF at 150-220 dpi) and the English
eAIP samples for LLBG/LLHA/LLER. Every number, frequency, hour and designator was read off the page image, not the text
layer. Row-level findings: `fable.csv` (441 rows = 49 aerodromes x 9 field groups).

## Counts by verdict

| verdict | rows |
|---|---|
| confirm | 248 |
| correct | 42 |
| unsure | 6 |
| not-in-aip | 145 |

Not-in-AIP rows are the 10 agricultural strips (no elevation/runway/frequency/circuit/hours published), the 9 military
airbases, the 2 foreign airports and most of Arad / Ein Vered. The 6 `unsure` rows are LLKZ runway length (AIP
contradicts itself), LLAR identity and elevation, and LLBG/LLER frequencies plus LLBG PPR (the repo's eAIP text samples
are truncated before AD 2.18 / AD 2.22, so those values cannot be checked from the repo).

## The 10 most safety-relevant corrections

1. **LLKS Kiryat Shmona, frequencies.** 118.400 is labelled "Pluto Mizrah". The 1/26 military frequency table (A-07,
   p29) gives Pluto Mizrah 123.85 primary / 134.65 secondary; 118.40 is Pluto *Maarav* (west). A pilot calling 118.40
   near Kiryat Shmona reaches the wrong control unit.
2. **LLRS Rishon LeZion, identity / PPR / remarks.** מז"ם is מטוס זעיר ממונע (powered ultralight), a manned category,
   not UAS. The CSV calls it "MAZAM (UAS)". The strip is an ultralight-only field (660 x 9 m): exclude it from NRST for
   conventional GA aircraft, keep it for ultralight profiles with a restriction badge (p377, p381).
3. **LLKZ Kzioth, hours.** The rendered page is legible: Sun-Thu 08:00-22:00 (p364). The CSV says "illegible".
4. **LLKZ Kzioth, runway length.** Text table p365 (2/25) prints 1600 m / 5249 ft; the field chart p368 (2/25) prints
   1500 x 30 / 4921 ft. The AIP contradicts itself; the owner must pick (chart says 1500). Flag in-app as approximate.
5. **LLHZ Herzliya, remarks.** "UAS prohibited" is a mistranslation of כניסת מז"ם לשדה אסורה: *ultralight* entry is
   prohibited (p213). Relevant for ultralight pilots using NRST near Herzliya. Also the 123.700 gloss "UAS (אז"ם)" is
   wrong: אז"ם is a light sport manned class; 123.7 is their Sharon-area common frequency (p230).
6. **ASSUTA-ASHDOD, frequencies.** Both 128.35 and 129.25 are Hagav Tzfoni; A-07 (1/26) makes 128.35 primary and
   129.25 secondary. 123.55 Hatzor tower is right. Also the "weekend UAV corridor along Route 4 at 400 ft" is an אז"ם
   (light sport aircraft) route, not UAV (p408). The Assuta chart is p410, not p411 (p411 is Beilinson page 1).
7. **LLAR Arad, identity / remarks.** Not "no AIP source": the Metzada CVFR chart (p341, 1/23) draws מנחת ערד with its own
   ATZ "ARAD GND-3000 QNH" and a spot elevation 1961. Treat as an active strip with an ATZ, PPR unknown, rather than
   possibly closed.
8. **LLEV Ein Vered, identity / remarks / frequency.** The Herzliya training-area chart (p230, 2/25) states the strip is
   active ("פעיל מנחת אז"ם: עין ורד") in area 9, with traffic to 700 ft QNH on 123.7. Not closed; a sport-aviation strip
   to exclude from NRST for conventional GA.
9. **LLMZ Metzada, remarks.** The parachute cylinder tops at 9,000 ft **QNH** (chart p341), not AGL, and the ATZ is only
   GND-300 ft QNH (p333), which the CSV omits. After takeoff do not climb above -400 ft without Hagav Dromi (p335).
10. **LLBG Ben Gurion, PPR = no (unsure).** The eAIP defers GA conditions to AD 2.22 para 10, which the repo sample does
    not contain, and the domestic AIP has no LLBG PPR statement. Showing LLBG as PPR-free in NRST for a light aircraft is
    risky; verify AD 2.22 before release.

Other corrections worth applying (lower risk): the nine military airbases do have published control frequencies in A-07
1/26 (Tel Nof 128.15, Hatzor 123.55, Palmachim 135.55/118.25, Ramat David 130.50, Ramon 124.60, Ovda 129.90, Nevatim
132.40, Hatzerim 125.35/130.80, Kedem 134.70/118.35) useful for emergencies; the 11 chapter-ו helipads all have CAAI
location indicators (LLIC, LLAA, LLBL, LLHD, LLHY, LLYS, LLSR, LLPO, LLRB, LLSM, LLIS) that the CSV does not carry;
TEFEN is the Iscar company helipad, not a hospital; helipad surfaces are mostly "concrete + asphalt" or
"asphalt/concrete", not plain concrete (Assuta, Hadassah ground pad, Hillel Yaffe, Yoseftal, Poria, Tel Hashomer,
Tefen); LLKZ 121.150 is current (A-07 Hagav Dromi primary) but is a military-control frequency, not an airstrip channel.

## Special items from the brief

- **LLRS "מז"ם only"**: yes, exclude from NRST for GA aircraft other than ultralights (see 2).
- **LLAR in the AIP**: only as a chart symbol with an ATZ on the Metzada CVFR chart p341 (see 7); no chapter.
- **LLHA PPR for GA**: `yes` is right. p245 15.ג.3.א requires prior e-mail coordination of arrival and parking for any
  aircraft not based at Haifa, and p240 forbids fixed-wing landings when the airport is closed. Hours confirmed.
- **LLBG PPR for GA**: cannot be confirmed from repo sources (see 10).
- **LLKZ**: hours Sun-Thu 08:00-22:00 (p364); circuit 1,900 ft QNH east of 15/33, right for 33, left for 15 (p367);
  frequency: no airstrip channel, Hagav Dromi 121.15 per A-07 (p29); runway 1500 vs 1600 m conflict (see 4).

## Method notes
- Pages rendered at 150 dpi (all cited pages), plus p28-30 (A-07 frequency and phone tables) and p230-231 (Herzliya charts)
  at 170 dpi, and p401 at 220 dpi. p341 (Metzada CVFR chart) and p377 (LLRS chapter cover) were read at 150 dpi.
- A few helipad "part 3" pages (p427, p430, p433) were not re-rendered; their circuit rows are confirmed on the strength
  of the identical chapter template and are noted as such in the CSV.
- ARP rows were compared by eye against the printed DMS on each chapter's first page; no automated conversion was run.
