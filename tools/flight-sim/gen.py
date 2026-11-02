#!/usr/bin/env python3
"""Generate deterministic flight scenarios for Kanaf (SIM-IL, dashboard T35).

Reads efb-212/Resources/israel-aviation.sqlite (route segments with the published altitude per direction,
reporting points, aerodromes) and writes a scenario JSON: fixes every second with time, position, altitude
(feet MSL), ground speed (knots), course (degrees true) and accuracies (metres), plus events (GPS loss,
degraded accuracy). The app replays a scenario in DEBUG builds (`-OpenEFBScenario <name>`) and the unit suite
(efb-212Tests/Simulation) feeds the same fixes through the real pipeline.

Stdlib only (json, math, sqlite3, argparse). See README.md for the command line; `make.sh` regenerates the
committed scenarios.
"""

import argparse
import json
import math
import os
import sqlite3
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DB_PATH = os.path.join(ROOT, "efb-212", "Resources", "israel-aviation.sqlite")
SCENARIO_DIR = os.path.join(HERE, "scenarios")

EARTH_NM = 3440.065  # earth radius, nautical miles
FT_PER_M = 1 / 0.3048
MS_PER_KT = 0.514444

# Flight profile constants
TAXI_SECONDS = 60
TAXI_KT = 8.0          # knots
ROLL_SECONDS = 20
ROTATE_KT = 65.0       # knots, ground speed at lift-off
CLIMB_KT = 80.0        # knots, until cruise speed is reached
ACCEL_SECONDS = 60     # seconds from lift-off to cruise speed
CLIMB_FPM = 500.0      # feet per minute
DESCENT_FPM = 500.0    # feet per minute
LEVEL_FPM = 1000.0     # feet per minute, change of published altitude between legs
FINAL_DESCENT_NM = 2.8 # nautical miles from the destination where the descent to the field begins
PATTERN_AGL_FT = 1000  # feet AGL, descent target before the field
LANDING_SECONDS = 30
H_ACC_M = 5.0          # metres
V_ACC_M = 8.0          # metres


# MARK: geometry

def haversine_nm(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_NM * math.asin(math.sqrt(h))


def bearing_deg(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def destination(a, bearing, dist_nm):
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    br, d = math.radians(bearing), dist_nm / EARTH_NM
    lat2 = math.asin(math.sin(lat1) * math.cos(d) + math.cos(lat1) * math.sin(d) * math.cos(br))
    lon2 = lon1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(lat1),
                             math.cos(d) - math.sin(lat1) * math.sin(lat2))
    return (math.degrees(lat2), math.degrees(lon2))


# MARK: database

class Data:
    def __init__(self, path=DB_PATH):
        self.db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        self.db.row_factory = sqlite3.Row

    def aerodrome(self, code):
        row = self.db.execute("SELECT code, name_en, lat, lon, elevation_ft FROM aerodromes WHERE code = ?",
                              (code,)).fetchone()
        if row is None:
            raise SystemExit(f"unknown aerodrome {code}")
        return dict(row)

    def point(self, network, code):
        row = self.db.execute(
            "SELECT code, name_en, lat, lon, kind FROM reporting_points WHERE network = ? AND code = ? LIMIT 1",
            (network, code)).fetchone()
        return dict(row) if row else None

    def segments(self, network):
        return [dict(r) for r in self.db.execute("SELECT * FROM route_segments WHERE network = ?", (network,))]

    def airspace(self, code):
        row = self.db.execute("SELECT kind, code, name_en, floor_ft, ceiling_ft, polygons FROM airspaces WHERE code = ?",
                              (code,)).fetchone()
        return dict(row) if row else None


def published_altitude(seg, forward):
    """Feet MSL for the direction flown: the numeric value, else the first number of the text, else the lower."""
    ft = seg["alt_forward_ft"] if forward else seg["alt_reverse_ft"]
    if ft:
        return int(ft), (seg["alt_forward_text"] if forward else seg["alt_reverse_text"]) or str(ft)
    text = seg["alt_forward_text"] if forward else seg["alt_reverse_text"]
    if text:
        for token in text.replace("/", " ").split():
            if token.isdigit():
                return int(token), text
    if seg["lower_alt_ft"]:
        return int(seg["lower_alt_ft"]), str(seg["lower_alt_ft"])
    return None, None


def find_route(data, network, start, end, weekday_only=False):
    """Fewest-segments path over the network, from point code to point code. Returns legs in flying order."""
    segs = data.segments(network)
    adj = {}
    for s in segs:
        if weekday_only and s["activity"] == "weekend":
            continue
        adj.setdefault(s["from_code"], []).append((s["to_code"], s, True))
        adj.setdefault(s["to_code"], []).append((s["from_code"], s, False))
    prev = {start: None}
    queue = deque([start])
    while queue:
        node = queue.popleft()
        if node == end:
            break
        for nxt, seg, forward in adj.get(node, []):
            if nxt not in prev:
                prev[nxt] = (node, seg, forward)
                queue.append(nxt)
    if end not in prev:
        raise SystemExit(f"no {network} route from {start} to {end}")
    legs = []
    node = end
    while prev[node] is not None:
        src, seg, forward = prev[node]
        legs.append((seg, forward))
        node = src
    legs.reverse()
    out = []
    for seg, forward in legs:
        poly = json.loads(seg["polyline"])
        if not forward:
            poly = list(reversed(poly))
        alt, text = published_altitude(seg, forward)
        out.append({
            "segmentId": seg["id"],
            "from": seg["from_code"] if forward else seg["to_code"],
            "to": seg["to_code"] if forward else seg["from_code"],
            "name": seg["name_en"],
            "altitudeFt": alt,
            "altitudeText": text,
            "activity": seg["activity"],
            "forward": forward,
            "distanceNm": seg["length_nm"],
            "polyline": [[float(p[0]), float(p[1])] for p in poly],
        })
    return out


# MARK: path and profile

class Path:
    """A polyline with the leg index and target altitude at every vertex, parametrised by distance (NM)."""

    def __init__(self):
        self.vertices = []  # (lat, lon, legIndex, altitudeFt)
        self.cum = []       # cumulative NM at each vertex

    def add(self, lat, lon, leg, alt):
        if self.vertices:
            prev = self.vertices[-1]
            d = haversine_nm((prev[0], prev[1]), (lat, lon))
            if d < 1e-6:
                return
            self.cum.append(self.cum[-1] + d)
        else:
            self.cum.append(0.0)
        self.vertices.append((lat, lon, leg, alt))

    @property
    def length(self):
        return self.cum[-1] if self.cum else 0.0

    def next_change(self, s):
        """(distance NM, new altitude) of the next published-altitude change ahead of s, or None. The final vertex
        (the destination ARP) is not a change."""
        if s >= self.length:
            return None
        hi = 1
        while hi < len(self.cum) - 1 and self.cum[hi] <= s:
            hi += 1
        current = self.vertices[hi][3]
        for j in range(hi + 1, len(self.vertices) - 1):
            if self.vertices[j][3] != current:
                return self.cum[j - 1] - s, self.vertices[j][3]
        return None

    def at(self, s):
        """Position, course, leg index and target altitude at distance s (clamped)."""
        if s <= 0:
            a, b = self.vertices[0], self.vertices[min(1, len(self.vertices) - 1)]
            return (a[0], a[1]), bearing_deg(a, b), a[2], a[3]
        if s >= self.length:
            a, b = self.vertices[-2], self.vertices[-1]
            return (b[0], b[1]), bearing_deg(a, b), b[2], b[3]
        lo, hi = 0, len(self.cum) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if self.cum[mid] <= s:
                lo = mid
            else:
                hi = mid
        a, b = self.vertices[lo], self.vertices[hi]
        f = (s - self.cum[lo]) / max(self.cum[hi] - self.cum[lo], 1e-9)
        pos = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        return pos, bearing_deg(a, b), b[2], b[3]


def build_path(legs, dep, dest, cruise_alt=None):
    """Taxi starts at the departure ARP; the route legs follow; the destination ARP ends it."""
    path = Path()
    path.add(dep["lat"], dep["lon"], -1, dep["elevation_ft"] or 0)
    for i, leg in enumerate(legs):
        alt = leg["altitudeFt"] if leg["altitudeFt"] is not None else cruise_alt
        if alt is None:
            raise SystemExit(f"leg {i} {leg['from']}-{leg['to']} publishes no altitude; pass --cruise-alt")
        leg["altitudeFt"] = alt
        for lat, lon in leg["polyline"]:
            path.add(lat, lon, i, alt)
    path.add(dest["lat"], dest["lon"], len(legs), dest["elevation_ft"] or 0)
    return path


def simulate(path, dep_elev, dest_elev, cruise_kt, dt=1.0):
    """Taxi, takeoff roll, climb, cruise at each leg's altitude, descent, landing, taxi. Fixes every dt seconds."""
    fixes = []
    t = 0.0
    s = 0.0
    alt = float(dep_elev)
    gs = 0.0
    total = path.length
    # (the final descent is computed from the remaining distance, see FINAL_DESCENT_NM)
    phase = "taxi"
    phase_t = 0.0
    airborne_t = 0.0

    def emit(pos, crs, leg):
        fixes.append({"t": round(t, 1), "lat": round(pos[0], 6), "lon": round(pos[1], 6),
                      "alt": round(alt), "gs": round(gs, 1), "crs": round(crs, 1),
                      "hAcc": H_ACC_M, "vAcc": V_ACC_M, "leg": leg})

    reached_first = False
    while True:
        pos, crs, leg, target = path.at(s)
        if phase == "taxi":
            gs = TAXI_KT
            if phase_t >= TAXI_SECONDS:
                phase, phase_t = "roll", 0.0
        elif phase == "roll":
            gs = ROTATE_KT * min(1.0, phase_t / ROLL_SECONDS)
            if phase_t >= ROLL_SECONDS:
                phase, phase_t = "airborne", 0.0
        elif phase == "airborne":
            airborne_t += dt
            gs = CLIMB_KT + (cruise_kt - CLIMB_KT) * min(1.0, airborne_t / ACCEL_SECONDS)
            remaining = total - s
            # A change of published altitude between legs is flown across the junction: it starts half its
            # duration early, so the aircraft is never more than half a change off either leg's altitude.
            change = path.next_change(s)
            if change is not None and reached_first:
                dist_nm, new_alt = change
                if dist_nm <= abs(new_alt - target) / LEVEL_FPM * 60.0 / 2.0 * (gs / 3600.0):
                    target = float(new_alt)
            if abs(alt - target) < 1.0:
                reached_first = True
            # Final descent: inside 2.8 NM of the field (the app's terminal zone is 3 NM), fly down to the field
            # elevation so as to arrive on it at the end of the path.
            rate = LEVEL_FPM if reached_first else CLIMB_FPM
            if remaining <= FINAL_DESCENT_NM:
                target = float(dest_elev)
                rate = max(DESCENT_FPM, (alt - dest_elev) / max(remaining / max(gs, 1.0) * 60.0, 0.05))
            step_ft = rate / 60.0 * dt
            if abs(target - alt) <= step_ft:
                alt = float(target)
            else:
                alt += step_ft if target > alt else -step_ft
            if s >= total:
                phase, phase_t = "landing", 0.0
                alt = float(dest_elev)
        elif phase == "landing":
            gs = max(TAXI_KT, ROTATE_KT * (1 - phase_t / LANDING_SECONDS))
            alt = float(dest_elev)
            if phase_t >= LANDING_SECONDS:
                phase, phase_t = "taxi-in", 0.0
        elif phase == "taxi-in":
            gs = TAXI_KT if phase_t < TAXI_SECONDS else 0.0
            if phase_t >= TAXI_SECONDS + 10:
                emit(pos, crs, leg)
                break
        emit(pos, crs, leg)
        if phase in ("taxi", "roll", "airborne"):
            s += gs / 3600.0 * dt
        t += dt
        phase_t += dt
    return fixes


# MARK: modifiers

def ramp(i, start, end, edge):
    """0..1 weight that ramps up over `edge` fixes after start and down over `edge` before end."""
    if i < start or i > end:
        return 0.0
    return min(1.0, (i - start) / edge, (end - i) / edge)


def apply_altitude_deviation(fixes, leg, feet):
    idx = [i for i, f in enumerate(fixes) if f["leg"] == leg and f["gs"] > ROTATE_KT]
    if not idx:
        raise SystemExit(f"no cruise fixes on leg {leg}")
    # Skip the first and last quarter of the leg so the deviation is clearly on the leg, not at a turn.
    a, b = idx[len(idx) // 4], idx[3 * len(idx) // 4]
    for i in range(a, b + 1):
        fixes[i]["alt"] = round(fixes[i]["alt"] + feet * ramp(i, a, b, 30))
    return {"kind": "altitudeDeviation", "leg": leg, "feet": feet, "from": fixes[a]["t"], "to": fixes[b]["t"]}


def apply_offset(fixes, leg, nm, side, seconds):
    idx = [i for i, f in enumerate(fixes) if f["leg"] == leg and f["gs"] > ROTATE_KT]
    if not idx:
        raise SystemExit(f"no cruise fixes on leg {leg}")
    mid = idx[len(idx) // 2]
    a = max(idx[0], mid - int(seconds) // 2)
    b = min(idx[-1], a + int(seconds))
    sign = 1 if side.upper().startswith("R") else -1
    for i in range(a, b + 1):
        f = fixes[i]
        w = ramp(i, a, b, 60)
        pos = destination((f["lat"], f["lon"]), (f["crs"] + 90 * sign) % 360, nm * w)
        f["lat"], f["lon"] = round(pos[0], 6), round(pos[1], 6)
    return {"kind": "offRoute", "leg": leg, "nm": nm, "side": "right" if sign > 0 else "left",
            "from": fixes[a]["t"], "to": fixes[b]["t"]}


def apply_gps_loss(fixes, t1, t2):
    kept = [f for f in fixes if not (t1 <= f["t"] < t2)]
    fixes[:] = kept
    return {"kind": "gpsLoss", "from": t1, "to": t2}


def apply_accuracy(fixes, t1, t2, h_acc):
    for f in fixes:
        if t1 <= f["t"] < t2:
            f["hAcc"] = h_acc
    return {"kind": "accuracyDegraded", "from": t1, "to": t2, "hAcc": h_acc}


# MARK: scenario assembly

def parse_point(data, network, token):
    """An aerodrome code, a reporting point code or 'lat,lon'."""
    if "," in token:
        lat, lon = (float(x) for x in token.split(","))
        return {"code": f"{lat:.4f},{lon:.4f}", "lat": lat, "lon": lon, "elevation_ft": 0}
    try:
        return data.aerodrome(token)
    except SystemExit:
        p = data.point(network or "cvfr", token)
        if p is None:
            raise SystemExit(f"unknown point {token}")
        p["elevation_ft"] = 0
        return p


def build(args, data):
    legs = []
    if args.network:
        legs = find_route(data, args.network, args.start_code, args.end_code, weekday_only=args.weekday_only)
    dep = parse_point(data, args.network, args.start_code)
    dest = parse_point(data, args.network, args.end_code)
    if not legs:
        # Direct path through the via points, one leg per segment, at the cruise altitude.
        points = [dep] + [parse_point(data, None, v) for v in args.via] + [dest]
        for i in range(len(points) - 1):
            a, b = points[i], points[i + 1]
            legs.append({"segmentId": None, "from": a["code"], "to": b["code"], "name": f"{a['code']}-{b['code']}",
                         "altitudeFt": args.cruise_alt, "altitudeText": None, "activity": None,
                         "forward": True, "distanceNm": round(haversine_nm((a["lat"], a["lon"]), (b["lat"], b["lon"])), 3),
                         "polyline": [[a["lat"], a["lon"]], [b["lat"], b["lon"]]]})
    elif args.via:
        raise SystemExit("--via is for direct paths; drop --network")
    path = build_path(legs, dep, dest, args.cruise_alt)
    fixes = simulate(path, dep["elevation_ft"] or 0, dest["elevation_ft"] or 0, args.speed)
    events = []
    for spec in args.alt_dev:
        leg, feet = spec.split(":")
        events.append(apply_altitude_deviation(fixes, int(leg), int(feet)))
    for spec in args.offset:
        leg, nm, side, seconds = spec.split(":")
        events.append(apply_offset(fixes, int(leg), float(nm), side, float(seconds)))
    for spec in args.accuracy:
        t1, t2, h = spec.split(":")
        events.append(apply_accuracy(fixes, float(t1), float(t2), float(h)))
    for spec in args.gps_loss:
        t1, t2 = (float(x) for x in spec.split(":"))
        events.append(apply_gps_loss(fixes, t1, t2))
    expect = {}
    for kv in args.expect:
        k, v = kv.split("=", 1)
        try:
            expect[k] = json.loads(v)
        except json.JSONDecodeError:
            expect[k] = v
    return {
        "name": args.name,
        "version": 1,
        "description": args.description or "",
        "region": args.region,
        "network": args.network,
        "startTime": args.start,
        "cruiseSpeedKt": args.speed,
        "route": {
            "from": dep["code"], "to": dest["code"],
            "points": [legs[0]["from"]] + [l["to"] for l in legs] if legs else [],
            "legs": legs,
        },
        "events": events,
        "expect": expect,
        "fixes": fixes,
    }


def write(scenario, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{scenario['name']}.json")
    with open(path, "w") as fh:
        json.dump(scenario, fh, separators=(",", ":"), ensure_ascii=False)
        fh.write("\n")
    last = scenario["fixes"][-1]["t"]
    print(f"{path}: {len(scenario['fixes'])} fixes, {last:.0f} s, legs {len(scenario['route']['legs'])}, "
          f"events {[e['kind'] for e in scenario['events']]}")
    return path


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--name", required=True)
    p.add_argument("--description", default="")
    p.add_argument("--region", default="IL", choices=["IL", "US"])
    p.add_argument("--network", choices=["cvfr", "lsa"], help="route over the published network (omit for a direct path)")
    p.add_argument("--from", dest="start_code", required=True, help="aerodrome or point code, or lat,lon")
    p.add_argument("--to", dest="end_code", required=True)
    p.add_argument("--via", action="append", default=[], help="direct paths only: intermediate point or lat,lon")
    p.add_argument("--cruise-alt", type=int, help="feet MSL, for legs without a published altitude")
    p.add_argument("--speed", type=float, default=100.0, help="cruise ground speed, knots")
    p.add_argument("--start", default="2026-11-04T08:00:00+02:00", help="ISO 8601 start time (fixed for reproducibility)")
    p.add_argument("--weekday-only", action="store_true", help="LSA: leave weekend-only routes out of the routing")
    p.add_argument("--alt-dev", action="append", default=[], metavar="LEG:FEET", help="e.g. 3:+400")
    p.add_argument("--offset", action="append", default=[], metavar="LEG:NM:SIDE:SECONDS", help="e.g. 2:1.5:R:180")
    p.add_argument("--gps-loss", action="append", default=[], metavar="T1:T2", help="seconds since start")
    p.add_argument("--accuracy", action="append", default=[], metavar="T1:T2:METRES")
    p.add_argument("--expect", action="append", default=[], metavar="KEY=JSON", help="expected outcome for the tests")
    p.add_argument("--db", default=DB_PATH)
    p.add_argument("--out", default=SCENARIO_DIR)
    args = p.parse_args(argv)
    data = Data(args.db)
    write(build(args, data), args.out)


if __name__ == "__main__":
    main()
