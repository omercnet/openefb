// BriefingFixtures of efb-212Tests/ServiceTests/IsraelBriefingFilterTests.swift, shared by the briefing sheet's tests.
import type { IsraelLatLon } from '../../../../domain/israel/notamTypes';
import { makeRouteClosure, type IsraelNotam, type IsraelRouteClosure } from '../../../../services/israelNotam';

/** Date(timeIntervalSince1970: 1_800_000_000): 2027-01-15 08:00Z (epoch ms). */
export const t0 = 1_800_000_000 * 1000;
export const hours = (h: number): number => t0 + h * 3600 * 1000;

export function closure(
  id: string,
  o: { chain?: string[]; partial?: boolean; parsed?: boolean; kind?: string; kinds?: string[] } = {},
): IsraelRouteClosure {
  return makeRouteClosure({
    notamId: id,
    routeKind: o.kind ?? 'CVFR',
    routeName: null,
    chain: o.chain ?? ['GALIM', 'DAROM'],
    validFrom: null,
    validTo: null,
    schedule: null,
    partial: o.partial ?? null,
    parsed: o.parsed ?? null,
    routeKinds: o.kinds ?? null,
  });
}

export interface NotamOptions {
  location?: string;
  type?: string;
  created?: number | null;
  from?: number | null;
  to?: number | null;
  permanent?: boolean;
  e?: string;
  circle?: [IsraelLatLon, number];
  polygon?: IsraelLatLon[];
  closures?: IsraelRouteClosure[];
  cancelledBy?: string;
}

export function notam(id: string, o: NotamOptions = {}): IsraelNotam {
  const location = o.location ?? 'LLLL';
  return {
    rowId: `row-${id}`,
    id,
    type: o.type ?? 'NOTAMN',
    references: null,
    location,
    locationDescription: null,
    created: o.created === undefined ? hours(-48) : o.created,
    q: null,
    a: location,
    validFrom: o.from === undefined ? hours(-1) : o.from,
    validTo: o.to === undefined ? hours(2) : o.to,
    permanent: o.permanent ?? false,
    estimated: false,
    d: null,
    e: o.e ?? 'TEXT',
    f: null,
    g: null,
    geometry: {
      polygon: o.polygon ?? null,
      circle: o.circle ? { centre: o.circle[0], radiusNM: o.circle[1] } : null,
    },
    closures: o.closures ?? [],
    parsed: true,
    cancelledBy: o.cancelledBy ?? null,
    replacedBy: null,
    raw: `RAW ${id}`,
  };
}
