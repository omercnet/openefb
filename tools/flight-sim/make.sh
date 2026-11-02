#!/bin/bash
# Regenerate the committed scenarios in tools/flight-sim/scenarios/ from efb-212/Resources/israel-aviation.sqlite.
# Leg numbers refer to the LLHZ -> LLIB CVFR route (12 legs): 0 LLHZ-BAZRA ... 6 EIRON-ZMGID, 9 TAVOR-DESHE, 11 AMNON-LLIB.
set -euo pipefail
cd "$(dirname "$0")"
G="python3 gen.py"
START="2026-11-04T08:00:00+02:00"   # a Wednesday: weekday for the LSA weekend rule; inside the fixture NOTAM window

$G --name il-cvfr-llhz-llib-nominal --network cvfr --from LLHZ --to LLIB --start "$START" \
  --description "Herzliya to Rosh Pina on the CVFR network, on route and on the published altitude of every leg." \
  --expect offRoute=false --expect altitudeCaution=false

$G --name il-cvfr-llhz-llib-deviations --network cvfr --from LLHZ --to LLIB --start "$START" \
  --alt-dev 6:400 --offset 9:1.5:R:180 \
  --description "Same route: 400 ft high on leg 6 (EIRON-ZMGID), then 1.5 NM right of route for 3 minutes on leg 9 (TAVOR-DESHE)." \
  --expect altitudeCautionLeg=6 --expect offRouteLeg=9 --expect offRouteSide=R

$G --name il-ctr-entry --from LLES --to LLHA --via 32.658,35.013 --cruise-alt 1500 --speed 100 --start "$START" \
  --description "Eyn Shemer to Haifa direct, over the Fire Zone 100 restricted area and into the Haifa CTR." \
  --expect ctr=LLHA

$G --name il-border-approach --from LLIB --to LLKS --via 33.30,35.57 --cruise-alt 2500 --speed 100 --start "$START" \
  --description "Rosh Pina to Kiryat Shmona direct, past Kiryat Shmona to 33.30N: up to and into the Lebanon border buffer, and north of 33N." \
  --expect border=Lebanon

$G --name il-closed-leg --network cvfr --from LLHZ --to LLIB --start "$START" \
  --description "The nominal route with fixtures/notams-closed-leg.json: DEROR-SHARO fully closed (leg 2), ZMGID-AFULA partly (leg 7)." \
  --expect closureFull=C9001/26 --expect closurePartial=C9002/26

$G --name il-lsa-llbs-llrs --network lsa --from LLBS --to LLRS --weekday-only --speed 80 --start "$START" \
  --description "Sport network, Beer Sheva to Rishon LeZion, planned on a weekday (weekend-only routes left out)." \
  --expect network=lsa

$G --name il-gps-loss --network cvfr --from LLHZ --to LLIB --start "$START" --gps-loss 1156:1200 \
  --description "Nominal route with a 44 s GPS loss at 1156 s (no fixes at all, over the Judea and Samaria prohibited area), then recovery." \
  --expect gpsLossFrom=1156 --expect gpsLossTo=1200

$G --name us-kpao-ksql --region US --from 37.4611,-122.1150 --to 37.5124,-122.2495 --cruise-alt 1500 --speed 97 --start "2026-11-04T10:00:00-08:00" \
  --description "Old US route (KPAO to KSQL) with altitude, for parity with tools/fly.sh." \
  --expect region=us
