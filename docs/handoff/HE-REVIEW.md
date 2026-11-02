# HE-REVIEW: Independent Hebrew review of the Israeli aerodrome data

Two reviewers (different models) check the same data independently. The integrator compares their findings and asks
the owner only where they disagree. **Don't read the other reviewer's file**: independence is the point.

## What to check
- The data: `tools/caai-importer/curated/aerodromes-il.csv` (49 aerodromes). The readable version, uncertain values
  first, is docs/research/israel-aerodromes-review.md. Every value cites its source page.
- The source of truth is the domestic AIP, Hebrew, amendment 1/26: `tools/caai-importer/input/aip-1-26.pdf`. The
  extracted text in `tools/caai-importer/input/pages/p*.txt` is **lossy**: final letters drop and digits get scrambled
  (e.g. "099" for 900). Wherever a value matters (numbers, frequencies, hours, PPR, runway designators and lengths,
  elevation), read the **rendered page image**, not just the text layer. Render pages with PyMuPDF at 150–200 dpi into
  a temp folder outside the repo and look at them.
- For LLBG, LLHA and LLER, the English eAIP (docs/research/israel-cvfr-samples/eaip-AD-2.*.txt) is also authoritative.

## For every aerodrome and every field group
Field groups: identity (Hebrew/English name, type, use), ARP, elevation, runways, frequencies, circuit, hours, PPR,
remarks.

Record one verdict per field group:
- `confirm`: the value matches the source;
- `correct`: give the corrected value exactly as published, the page, and the Hebrew quote;
- `unsure`: say why;
- `not-in-aip`: no AIP source exists, e.g. values that came from GIS or OurAirports.

Pay special attention to:
- every ⚠️ value;
- whether Rishon LeZion (LLRS) "מז"ם only" means it should be excluded from NRST for GA;
- whether Arad (LLAR) appears anywhere in the AIP;
- the PPR flags on Haifa (LLHA) and Ben Gurion (LLBG) for GA;
- Kzioth (LLKZ) hours, circuit and frequency.

## Output (your file only)
`docs/research/hebrew-review/<reviewer>.csv` with the columns
`code,field_group,verdict,current_value,proposed_value,page,quote_he,note`, one row per aerodrome × field group (49 × 9
rows). Also write a short `docs/research/hebrew-review/<reviewer>-summary.md` with the counts by verdict and the 10
most safety-relevant corrections.

Don't edit the CSV, the importer, the app or any other file. No simulator. Report your counts when done. Never end your
turn on an intention.
