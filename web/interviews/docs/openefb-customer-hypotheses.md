# Customer

Primary user: weekend VFR pilot, Private or Sport certificate, 50-150 h/yr, single-engine piston
(owned, club or rental), iPad mini mounted in the cockpit (PRD.md §3). Secondary: student pilot.
Tertiary: CFI reviewing student flights.

> Evidence status (2026-10-31): **assumption-based.** No pilot has used a build yet (no TestFlight
> testers). Everything below comes from PRD.md and from audits of the code and simulator. Validate
> with interviews before acting on it (beads `efb-77r.7`).

## Job Statement

**Primary job (anchors the improve-app pass): J1, in-flight awareness**

> When I'm flying VFR in a single-engine plane, I want to see at a glance where I am relative to
> airspace, airports, TFRs and weather, so I can stay legal and safe with minimal heads-down time.

Secondary jobs (kept in view; must not regress):

| Job | When… | I want to… | so I can… |
|---|---|---|---|
| J2 preflight | planning a local or weekend flight | check weather, TFRs and the destination in a few minutes | make a confident go/no-go call |
| J3 emergency | something goes wrong in flight | get the nearest suitable airport, with bearing and distance, instantly | divert without thinking |
| J4 learn | I've just landed | review my track and radio calls, and log the flight | improve and stay current |

## Job Dimensions

| Dimension | What the pilot wants | Where we fall short today (J1) |
|---|---|---|
| Functional | Current position on a current chart, airports and hazards nearby, readable in sunlight and at night | Sectionals are online-only; offline, the map is a plain background. Map doesn't follow ownship. Airports load only within ~6 NM of the map centre. No night mode. Altitude and VS depend on GPS quality and aren't flagged when missing. |
| **Emotional (trust): worst gap** | To feel calm and certain that what the screen shows is true *now*, especially offline | The pilot can't tell what works offline. Data age is shown in some places but not everywhere, with inconsistent styles (the yellow badge is hard to read; winds use "Current / Not current"). The beta banner stays up. Until recently TFRs were samples and frequency types were wrong; both are fixed, but trust has to be earned visibly. |
| Social | To look prepared to a CFI, passengers and at a ramp check ("my data is current") | No visible chart / database cycle. No way to share a flight with a CFI yet. |

**Big Hire vs Little Hire:** the failure is a **Little Hire** problem. The pilot mounts the iPad
for each flight, and one in-flight gap (blank offline map, ownship off-screen, unclear staleness) is
enough to switch back to ForeFlight mid-flight and not return.

## Forces of Progress

| Force | Content |
|---|---|
| Push | ForeFlight cost ($120-360/yr, 20% rise in 2025); feature bloat for simple VFR |
| Pull | Free and open source; VFR-only simplicity; recording and debrief |
| Habit | ForeFlight muscle memory and pre-downloaded charts; panel GPS in rentals |
| **Anxiety (dominant)** | "Will it fail me in flight?": offline behaviour, data currency, a new unproven app in a safety role |

Implication for later phases: reducing anxiety (visible system status, honest staleness, offline
certainty) is worth more than adding pull (features).

## Competing Alternatives

| Alternative | Why hired | Weakness |
|---|---|---|
| ForeFlight | Complete, trusted, habit | Price, complexity |
| Garmin Pilot | Avionics integration | Price, IFR-first UI |
| FltPlan Go | Free | Ads, closed source, no recording |
| Panel GPS (G1000 / GTN) | Already in the aircraft, certified | No sectional or weather context on many units; renter's unit differs every time |
| Paper sectional + phone weather app | Cheap, no batteries | Heads-down, no ownship, stale weather |
| Non-consumption: look outside / flight following | Zero effort | No airspace or TFR awareness; depends on ATC workload |
| Avare | Free, open source | Android only |
