# NOTAM-2: Israeli route-closure parsing: altitude conditions, exceptions, missed sentences (dashboard ticket T14)

## Evidence
I ran our relay parser (`web/notam-relay/src/parse-notam.ts`, `parseClosures`) over an independent archive of 3,146
real IAA NOTAMs. The archive is from github.com/rommguy/israeli-notam-parser, `daily-notams/notams.json`, which has **no
license**: download it locally to /tmp for testing, and never commit it or copy its code.
- Validity and ICAO match that project's independent parser on all 120 currently parsed NOTAMs. Good.
- **646 route-closure NOTAMs:** 583 yielded closures and 63 yielded none. Misses include:
  - `CVFR AND HEL RTE CLSD AT 1,200FT AMSL, AVBL BIDIRECTIONAL AT 800FT AMSL ZASHD-YAVNE-NAGID-BOVED-NTAIM-SUPER-TYONA.`
  - `CVFR RTE CLSD, EXC PPR FLT FM IAF NMASD-SHORELINE-TYONA.` (exception clause, and a non-5-letter token)
  - `HEL RTE CLSD EXC PPR FLT FM IAF SELZR-ZKOCH-GOMME-LLKS.`
- **Wrong semantics where it does parse:** C2981/25
  `ULTRALIGHT AND HEL RTE CLSD BTN ARRAA-ZMGID. CVFR RTE CLSD AT 2,500FT AMSL, AVBL BIDIRECTIONAL AT 3,000FT AMSL EIRON-ZMGID.`
  yields only the HEL closure. **The CVFR closure in the second sentence is missed**, so the app would show that route
  open. That's the safety bug.
- Among the parsed closures: 83 have BTN/BLW/ABV wording, 30 have EXC, and 2 have AVBL. None of these conditions is
  modelled today; every closure is treated as a full closure.

## Change
1. **Parser** (web/notam-relay):
   - Split E) into sentences or clauses, and parse every closure clause.
   - Model per closure:
     - `routeKinds` (CVFR, HEL, ULTRALIGHT, ATS, …), a set, because "CVFR AND HEL" is both;
     - the chain, accepting known non-code tokens such as SHORELINE and ICAO aerodromes (LLxx);
     - `closedAltitudes` (AT/BLW/ABV/BTN, in feet AMSL);
     - `availableAltitudes` (AVBL … AT …, plus BIDIRECTIONAL or a direction);
     - `exceptions` (raw text, e.g. "PPR FLT FM IAF");
     - `partial: boolean`.
   - **Never drop a closure clause.** If a clause looks like a closure and you can't fully parse it, emit it with
     `parsed: false` and the raw clause, so the app can show "possible closure, read NOTAM".
   - **Tests:** fixtures you write yourself from IAA text patterns (paraphrase the structure; don't copy the archive),
     covering every pattern above. Add a local-only harness `npm run corpus -- /tmp/notams.json` that reports the
     coverage numbers. Target: 0 silent misses on the archive, with every closure-looking clause either parsed or
     flagged.
   - **Our own corpus:** the Worker appends every NOTAM it sees (id plus raw text) to a history store in KV or R2, so we
     build our own regression corpus over time. Mind the free limit of 1000 KV writes a day: batch writes per run.
2. **Deploy:** `npx wrangler deploy` from web/notam-relay. The owner is logged in on this Mac, and the Worker is
   `openefb-notam-relay`. Check `/health` and `/notams.json` afterwards. Keep the JSON backward compatible, so add fields
   rather than renaming them, because shipped app builds decode it.
3. **App** (Swift; `IsraelNotamService` decoding, the closure mapper, and the CVFR overlay in
   `Services/IsraelChartFeatures.swift` / `IsraelChartOverlay.swift`):
   - Decode the new fields.
   - Draw partial closures distinctly from full ones: amber for "closed at 2,500, open at 3,000", red for fully closed.
     Show unparsed possible closures as amber "check NOTAM".
   - Label with the altitudes ("CLSD 2500 · AVBL 3000"), and put the exception text in the tap sheet.
   - Only CVFR (and ultralight/helicopter if the overlay draws those layers) affect CVFR segments.
   - Tests for decode, styling inputs and the mapping.
   - Simulator screenshot of a partial and a full closure in docs/design/screenshots/NOTAM-2/.

Files you own: web/notam-relay/**, efb-212/Services/IsraelNotam*, efb-212/Services/IsraelChartFeatures.swift,
efb-212/Services/IsraelChartOverlay.swift and their tests.
Other agents:
- IL-13: Israeli airport diagrams;
- WEB-2: web/interviews;
- HE-REVIEW: docs/research only.
Don't touch their files.

Full unit suite green, plus relay tests green. Follow docs/handoff/COMMON.md (claim a simulator with
`export SIM_TAG=$(tools/sim-test.sh claim N2)` and release it). Report the corpus numbers before and after. Never end
your turn on an intention.
