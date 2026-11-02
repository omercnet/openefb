# IL-BRIEF: Israel pre-flight briefing: NOTAM list and metric weather (dashboard T20; beads efb-aac.16, efb-aac.6)

## 1. NOTAM briefing list (efb-aac.16)
Israeli pilots brief all LLLL NOTAMs before flying. The app draws route closures on the map, but has no NOTAM list for
Israel, and closures with no drawable chain (e.g. "ATS RTE J14 CLSD", relay `parsed: false`) appear nowhere.
- **Where:** a "NOTAMs" briefing view for the Israel region, reachable from the map (a ≥60pt control, or the layer
  panel) and from the Israel flight plan screen (Views/Planning, IsraelFlightPlanView; add only an entry button there,
  because another agent is editing the FPL preview in that file, so re-read it first).
- **Source:** `IsraelNotamService` (efb-212/Services/IsraelNotamService.swift) and the relay feed. Show the feed age and
  staleness badge, and never show a stale list as current.
- **Filters:**
  - **Flight window:** default to the planned departure time plus ETE, otherwise now to +3 h. Only NOTAMs valid in the
    window are shown, and PERM ones always.
  - **Distance:** from the planned route (corridor in NM) or from ownship, using the Q-line centre/radius and E)
    geometry.
  - **Aerodrome:** A) location, e.g. LLHZ, LLBG.
- **Order:** closures first: route closures, red full / amber partial, then any closure that couldn't be parsed or
  drawn, marked "check NOTAM". Then aerodromes on the route, then the rest.
- **Each row:** id, location, validity in local time and Z, plain E) text (raw available), and "Show on map" when it has
  geometry or a chain.
- **Read/unread tracking:** keyed by NOTAM id plus its created stamp, persisted locally, with a "mark all read". A
  NOTAMR that replaces a read NOTAM shows as unread.
- Inspired by github.com/rommguy/israeli-notam-parser's viewer (date, ICAO and centre filters, read/unread). That repo
  has no license, so take ideas only, not code.

## 2. Weather for Israel (efb-aac.6)
- **Visibility:** in the Israel region METARs report metres (9999 = 10 km or more). Show "≥10 km" or "4000 m", not
  ">10 SM". Keep the US unchanged.
- **Weather row units:** wind kt, temperature °C, QNH hPa (the IL-2 work already does hPa; verify).
- **LLLL SIGMET/AIRMET:** aviationweather.gov's international SIGMET feed may carry LLLL; check it live (there's a sample
  in docs/research/israel-cvfr-samples/awc-isigmet-llll.json).
  - If present, show the active LLLL SIGMETs in the briefing view.
  - Always add a link-out to the Israel Meteorological Service aviation page for the authoritative products. Use the
    URL from docs/research/israel-cvfr.md §5.
- Tests: METAR metric visibility formatting, region switch, SIGMET decode if built.

## Rules
Files you own: new Views/Briefing/IsraelBriefing*.swift (or similar), a NOTAM read-state store, WeatherService
formatting for Israel, and the airport-sheet weather row.
Other agents in parallel:
- FIX-1 owns MapService route colour, IsraelFlightPlanMessage and the FPL preview;
- IL-ALERTS owns alerts, the active-navigation bar and ProximityAlertService;
- IL-DEBRIEF owns Services/Debrief and Recording;
- IL-DIAG2 owns tools/caai-apd, AirportDiagram* and the map badge stack.
Re-read any shared file before editing.

Full unit suite green. Screenshots in docs/design/screenshots/IL-BRIEF/:
- the briefing list, with its filters and a "check NOTAM" row;
- an LLBG METAR in metric.
Follow docs/handoff/COMMON.md (claim a simulator with `export SIM_TAG=$(tools/sim-test.sh claim BRIEF)` and release it).
Close nothing; don't commit.

Record progress on the Paseo dashboard as you work:
- at each new stage: cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticket update T20 --stage <stage>
- between stages:    cd /Users/omer/.paseo/worktrees/2njag5y3/glorious-narwhal && paseo-progress ticker set "<what you are doing now>"
Use the stages Build, Review, Fixes and Verify. Never end your turn on an intention.
