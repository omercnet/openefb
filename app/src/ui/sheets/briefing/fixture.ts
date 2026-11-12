// FAKE briefing data for the capture route (kanaf-dev://briefing) and the web preview: what the SwiftUI sheet shows in the
// capture seed's briefing shot (docs/capture-seed.md on ci/swift-capture-refs: scenario il-cvfr-llhz-llib-nominal from
// 600 s, -OpenEFBBriefing YES). There the activated Herzliya to Rosh Pina CVFR route sets the distance filter to Route
// 25 NM, and the relay feed it downloaded (117 NOTAMs) is past the NOTAM expiry, so the list is hidden behind "Show last
// known list anyway" and Mark all read is disabled. The NOTAMs below are made up; only their count and age match.
import { makeBriefingRoute, type BriefingRoute } from '../../../domain/israel/briefingFilter';
import type { IsraelLatLon } from '../../../domain/israel/notamTypes';
import {
  makeRouteClosure,
  type IsraelNotam,
  type IsraelNotamReport,
  type IsraelRouteClosure,
} from '../../../services/israelNotam';
import { readKey } from '../../../services/notamReadStateStore';
import { DEFAULT_FILTERS } from './logic';
import type { BriefingData, BriefingReadStore } from './store';

/** Scenario start 2026-11-04T08:00+02:00 plus the 600 s capture offset (epoch ms). */
export const FIXTURE_NOW = Date.parse('2026-11-04T06:10:00Z');
const HOUR = 3600 * 1000;
/** The relay last scraped the IAA 30 h before: past the NOTAM expiry (6 h), so the feed reads EXPIRED. */
export const FIXTURE_FEED_AGE_HOURS = 30;
export const FIXTURE_NOTAM_COUNT = 117;

/** The scenario's route: LLHZ (Herzliya) to LLIB (Rosh Pina) on the CVFR network, departure first. */
const ROUTE_POINTS: [string, number, number][] = [
  ['LLHZ', 32.179444, 34.834444],
  ['BAZRA', 32.218611, 34.8825],
  ['DEROR', 32.257222, 34.891111],
  ['SHARO', 32.323056, 34.903889],
  ['ZYAAR', 32.409722, 34.903611],
  ['HADRA', 32.464722, 34.912222],
  ['EIRON', 32.480833, 35.024444],
  ['ZMGID', 32.572778, 35.191111],
  ['AFULA', 32.603611, 35.281944],
  ['TAVOR', 32.690278, 35.42],
  ['DESHE', 32.87, 35.5325],
  ['AMNON', 32.905556, 35.566667],
  ['LLIB', 32.980556, 35.570833],
];

/** The activated route as IsraelBriefingView.activeRoute() builds it: no departure time or ETE, network CVFR. */
export const FIXTURE_ROUTE: BriefingRoute = makeBriefingRoute({
  codes: ROUTE_POINTS.map(([code]) => code),
  points: ROUTE_POINTS.map(([, lat, lon]) => ({ lat, lon })),
});

/** Ownship 600 s into the scenario, on the SHARO to ZYAAR leg at 1500 ft. */
export const FIXTURE_OWNSHIP: IsraelLatLon = { lat: 32.402456, lon: 34.902482 };

const point = (code: string): IsraelLatLon => {
  const found = ROUTE_POINTS.find(([c]) => c === code);
  return found ? { lat: found[1], lon: found[2] } : { lat: 32.0, lon: 34.9 };
};

interface NotamFields {
  location?: string;
  type?: string;
  fromHours?: number;
  toHours?: number | null;
  permanent?: boolean;
  e: string;
  circle?: [IsraelLatLon, number];
  closures?: IsraelRouteClosure[];
}

function notam(id: string, f: NotamFields): IsraelNotam {
  const location = f.location ?? 'LLLL';
  const validFrom = FIXTURE_NOW + (f.fromHours ?? -24) * HOUR;
  const validTo = f.permanent ? null : f.toHours === null ? null : FIXTURE_NOW + (f.toHours ?? 48) * HOUR;
  return {
    rowId: `row-${id}`,
    id,
    type: f.type ?? 'NOTAMN',
    references: null,
    location,
    locationDescription: null,
    created: validFrom - 2 * HOUR,
    q: null,
    a: location,
    validFrom,
    validTo,
    permanent: f.permanent ?? false,
    estimated: false,
    d: null,
    e: f.e,
    f: null,
    g: null,
    geometry: { polygon: null, circle: f.circle ? { centre: f.circle[0], radiusNM: f.circle[1] } : null },
    closures: f.closures ?? [],
    parsed: true,
    cancelledBy: null,
    replacedBy: null,
    raw: `${id} ${f.type ?? 'NOTAMN'}\nA) ${location}\nE) ${f.e}`,
  };
}

const closure = (id: string, kind: string, chain: string[], partial: boolean | null = null): IsraelRouteClosure =>
  makeRouteClosure({
    notamId: id,
    routeKind: kind,
    routeName: null,
    chain,
    validFrom: null,
    validTo: null,
    schedule: null,
    partial,
  });

/** A few NOTAMs of each kind the sheet draws differently, then routine ones up to the feed's count. */
function fixtureNotams(): IsraelNotam[] {
  const items = [
    notam('C2311/26', {
      e: 'CVFR RTE CLSD HADRA-EIRON-ZMGID DUE TO MIL ACT.',
      closures: [closure('C2311/26', 'CVFR', ['HADRA', 'EIRON', 'ZMGID'])],
      fromHours: -3,
      toHours: 9,
    }),
    notam('C2298/26', {
      e: 'CVFR RTE AFULA-TAVOR CLSD BLW 1500FT AMSL. AVBL ABV 2000FT AMSL.',
      closures: [closure('C2298/26', 'CVFR', ['AFULA', 'TAVOR'], true)],
    }),
    notam('C2305/26', {
      e: 'HEL RTE CLSD BAZRA-DEROR.',
      closures: [closure('C2305/26', 'HEL', ['BAZRA', 'DEROR'])],
    }),
    notam('C2290/26', { location: 'LLHZ', e: 'RWY 11/29 TWY B CLSD FOR MAINT.', fromHours: -12, toHours: 36 }),
    notam('C2301/26', { location: 'LLIB', type: 'NOTAMR', e: 'AD HR OF OPS 0500-1500 UTC.', permanent: true }),
    notam('C2276/26', {
      e: 'UAS ACT WI 2NM RADIUS OF 322400N 0345420E. SFC-1000FT AMSL.',
      circle: [point('SHARO'), 2],
    }),
  ];
  const locations = ['LLLL', 'LLBG', 'LLHA', 'LLER', 'LLET', 'LLMG', 'LLOV', 'LLKS', 'LLRM', 'LLSD'];
  for (let i = items.length; i < FIXTURE_NOTAM_COUNT; i += 1) {
    const location = locations[i % locations.length];
    items.push(
      notam(`C${2100 + i}/26`, {
        location,
        e:
          i % 3 === 0
            ? `CRANE ERECTED ${10 + (i % 7)}NM ${['N', 'E', 'S', 'W'][i % 4]} OF ${location}. HGT ${150 + i}FT AMSL.`
            : `${location} NAV AID OUT OF SER.`,
        fromHours: -(i % 72),
        toHours: (i % 5) * 24 + 12,
      }),
    );
  }
  return items;
}

/** The downloaded feed: 117 NOTAMs scraped 30 h before the capture time. */
export function fixtureReport(): IsraelNotamReport {
  const items = fixtureNotams();
  return {
    feed: {
      generatedAt: FIXTURE_NOW - FIXTURE_FEED_AGE_HOURS * HOUR,
      items,
      closures: items.flatMap((n) => (n.cancelledBy === null && n.replacedBy === null ? n.closures : [])),
    },
    fetchedAt: FIXTURE_NOW - 5 * 60 * 1000,
    refreshFailed: false,
  };
}

/** The slice as the capture shows it: the feed loaded, the route activated (Route 25 NM), nothing read. */
export function captureBriefingData(): BriefingData {
  return {
    ...DEFAULT_FILTERS,
    distanceChoice: 'route',
    route: FIXTURE_ROUTE,
    ownship: FIXTURE_OWNSHIP,
    report: fixtureReport(),
    isLoading: false,
    errorMessage: null,
    readVersion: 0,
  };
}

type NotamKey = Pick<IsraelNotam, 'id' | 'created'>;

/** NotamReadStateStore in memory: nothing read on a fresh install. */
export class MemoryNotamReadStore implements BriefingReadStore {
  readonly keys = new Set<string>();
  isRead(n: NotamKey): boolean {
    return this.keys.has(readKey(n));
  }
  markRead(n: NotamKey): void {
    this.keys.add(readKey(n));
  }
  markUnread(n: NotamKey): void {
    this.keys.delete(readKey(n));
  }
  markAllRead(notams: readonly NotamKey[]): void {
    for (const n of notams) this.keys.add(readKey(n));
  }
}
