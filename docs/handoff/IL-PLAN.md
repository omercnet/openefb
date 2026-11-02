# IL-PLAN: Israel flight planning with automatic CVFR routing and the FPL message (dashboard ticket T15; beads efb-aac.8 + efb-aac.11)

Owner asked whether planning in Israel auto-completes CVFR routes, pointing at https://fpl.co.il. Today it doesn't:
the planning flow (Views/Planning, ViewModels/FlightPlanViewModel.swift) is US-only.

## What fpl.co.il does
I read its client bundle; reuse the behaviour, not the code (no license).
- The pilot picks departure, destination and optional via points on the map. The app finds the **shortest path over the
  open route network with Dijkstra**. If none exists it says "לא נמצא נתיב פתוח בין X ל-Y" ("no open route between X
  and Y").
- **Two networks:** CVFR (נתיבי התובלה הנמוכים) and LSA (sport-aviation routes), chosen per flight.
- **Validation:**
  - one-way segments flown the wrong way ("נתיב X - Y הוא חד כיווני");
  - segments that need controller approval, drawn dashed: "can't file a flight plan on a route by ATC approval";
  - closed points and segments with a reason and times, including weekend and Friday-from-12:00/14:00 rules for LSA, from
    their `getTrafficRules` API, which isn't public;
  - a disclaimer that the pilot is responsible for the AIP, NOTAMs and weather.
- **Output:**
  - an ICAO FPL message `(FPL-4X<REG>-V<type> … -DOF/<date> RMK/PIC <NAME> LICENSE <n> CELL <phone> DEP/<code>
    DEST/<code> -E/<endurance> P/<pob>)`, with ZZZZ plus DEP/ and DEST/ for non-ICAO strips and "4X" prefixed to
    short registrations;
  - a Hebrew summary ("תכנית טיסה בנתיבי התובלה הנמוכים, המראה מ… ב… זמן מקומי, נתיב: …, נחיתה ב… ב…");
  - share via WhatsApp or email, a "return flight plan" (reverse), and a Windy route-weather link;
  - departure date and time first, then PIC details (name, license, phone, email), saved for reuse.

## Our data
`efb-212/Resources/israel-aviation.sqlite`, `route_segments`, 275 rows:
- `alt_forward_ft` / `alt_reverse_ft` with the text: 34 segments publish only one direction, so treat them as one-way;
- `by_request` (96): dashed, needs controller approval, so not fileable;
- `military` (85);
- `length_nm`, `bearing_true`, the polyline.
Reporting points and aerodromes come from `IsraelAviationDatabaseProtocol`. Closures come from IL-6/NOTAM-2
`IsraelNotamService`: full and partial closures, altitude-conditional, with exceptions.

## Build
1. **Router:** `IsraelRoutePlanner` (pure, nonisolated, unit-tested).
   - Dijkstra on distance over the CVFR graph.
   - Edges respect direction: exclude a direction with no published altitude.
   - Exclude `by_request` and military segments by default; they're selectable only as an explicit override, and flagged
     "not fileable".
   - Exclude segments fully closed by a current NOTAM for the planned departure-time window. Allow partially closed
     segments with a caution and the available altitude.
   - Via points force the path through them.
   - Aerodromes connect through their ARP points or the segments that end at them.
   - Return the legs with the published altitude per leg in the direction flown, the distance and the ETE at the
     aircraft profile's cruise speed.
   - Clear errors: "no open route between X and Y", with the reason (closure, one-way).
2. **Planning UI in the Israel region:**
   - Choose departure and destination (search by ICAO, Hebrew or English, or tap the map); add or remove via points.
   - The auto-routed path is drawn on the map with each leg's altitude.
   - A legs table: from → to, altitude, distance, ETE, and caution and closure badges.
   - "Return flight" reverses it and re-routes it, because one-way segments differ.
   - The departure date and time drive the closure check.
   - Keep the US flow unchanged.
3. **FPL message:** generate the ICAO FPL text plus the Hebrew summary as above.
   - Aircraft registration, type, speed, endurance and POB come from the aircraft profile; PIC name, license, phone and
     email from the pilot profile (add the missing fields to the profiles if needed, as a SwiftData migration-safe
     change).
   - Offer share (system share sheet) and email.
   - **Never send anything automatically.** IAA AIS filing uses the address the AIP states; verify it in the AIP text.
   - Validation blocks "File" when the route includes a by-request or military segment, a wrong-way leg, or a closed
     segment. The disclaimer is shown.
4. **Activate:** the plan feeds the existing navigation: active leg, next point, DTG/ETE and the Direct-To/route bar from
   T21.
5. **LSA network:** the sport-aviation layer (`Sportiv 2026.zip` from the CAAI GIS page, 215 points and 229 routes per
   docs/research/israel-cvfr.md) isn't imported. Add it to tools/caai-importer as a second network, if it fits in this
   ticket, and let the planner choose CVFR or LSA. Otherwise file it as a follow-up bead and say so.

Tests:
- the router: shortest path, one-way respected, by-request excluded, closure detour, no-route error, via points, return
  route differing;
- FPL text golden tests, including ZZZZ with DEP/ and DEST/, and the 4X prefix;
- validation errors.

Screenshots in docs/design/screenshots/IL-PLAN/:
- LLHZ → LLIB routed;
- a closure detour;
- the FPL preview;
- a "no open route" case.

Files you own: Views/Planning/**, ViewModels/FlightPlanViewModel.swift (Israel paths only), new
Services/IsraelRoutePlanner.swift / IsraelFlightPlanMessage.swift, profile model fields, and the importer only for the
LSA addition.
Other agents:
- IL-13: diagrams;
- HE-APPLY-2: the curated aerodromes CSV.
Re-read shared files before editing.

Full unit suite green. Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim PLAN)`
and release it). Close nothing; report. Never end your turn on an intention.
