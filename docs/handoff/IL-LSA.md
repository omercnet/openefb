# IL-LSA: Sport-aviation (LSA) routes in the Israel planner (dashboard T24; beads efb-14e)

Israeli light-sport and ultralight pilots fly the sport-aviation route network (נתיבי התעופה הספורטיבית), not the CVFR
network. fpl.co.il offers both networks per flight. The planner (Services/IsraelRoutePlanner.swift, IL-PLAN) supports
CVFR only.

## Build
1. **Importer:** add CAAI `Sportiv 2026.zip` from the CAAI GIS page (https://www.gov.il/he/pages/aip?chapterIndex=11;
   the WAF blocks curl, so use the browser) to `tools/caai-importer`:
   - a second network: about 215 points and 229 routes per docs/research/israel-cvfr.md §4;
   - the same normalization, count validation and endpoint resolution as CVFR;
   - store it with a `network` column (`cvfr` / `lsa`), or in separate tables.
   Keep the bundled DB deterministic. CAAI approved the GIS layers.
2. **Time rules:** fpl.co.il shows LSA routes with weekend-only or Friday-from-12:00/14:00 activity. Find the published
   rule for each LSA route or point in the domestic AIP (B-08 and the related chapters), and model it as data.
   - If the AIP doesn't publish it as structured data, record it as text and show it.
   - Don't invent schedules.
3. **Planner:** a network choice (CVFR / LSA) per plan.
   - The router uses the chosen network and respects its direction rules, closures (NOTAMs naming LSA, ULTRALIGHT or
     sport routes) and time rules for the planned departure.
   - The FPL Hebrew summary says "בנתיבי התעופה הספורטיבית" for LSA.
   - The aircraft profile can carry a category (LSA/ultralight vs GA) to preselect the network. Profiles were edited by
     FIX-1, so re-read them.
4. **Map:** draw the LSA network in the Israel overlay when the plan uses LSA, or when its layer is toggled, in a
   distinct style.

## Tests
Import counts, routing on LSA, time-rule exclusion, network selection in the FPL text.

## Rules
Starts after FIX-1 (T18) finishes, because both edit the planning views and the profiles.
Files you own: tools/caai-importer (the LSA addition), israel-aviation.sqlite, Data/IsraelAviation* (the LSA queries),
IsraelRoutePlanner, Views/Planning/**, the Israel overlay LSA layer.
Another agent (IL-ALERTS) uses the planner output; keep the leg API stable or update its callers.

Full unit suite green. Screenshots in docs/design/screenshots/IL-LSA/. Follow docs/handoff/COMMON.md (claim a simulator
with `export SIM_TAG=$(tools/sim-test.sh claim LSA)` and release it). Close nothing; don't commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T24 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
