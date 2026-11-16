// The Israel half of the live map: the CVFR chart sources from the Israel database (IsraelChartData.load +
// IsraelChartFeatureBuilder), their NOTAM closure marks (IsraelChartOverlay.applyClosures), and the closure lookup the
// Nearest column flags aerodromes with (IsraelAerodromeAdapter.closingNotams).
import type { IsraelAviationDatabase } from '../../data/aviation/israelDatabase';
import { evaluateFreshness } from '../../domain/core/freshness';
import { closingNotams } from '../../domain/israel/aerodromeAdapter';
import { notamIsSuperseded } from '../../domain/israel/notamTypes';
import { IsraelNetworkLookup } from '../../domain/israel/closureMarks';
import { mapClosures } from '../../domain/israel/closureMapper';
import type { FeatureCollection } from '../../domain/map/geojson';
import {
  buildIsraelSources,
  israelClosureSet,
  israelClosureSources,
  israelClosureStatus,
  segmentFeatures,
  type IsraelChartClosureMark,
  type IsraelClosureStatus,
} from '../../domain/map/israel';
import { loadIsraelChartInput, type IsraelChartInput } from '../../domain/map/israel/layers';
import type { IsraelNotamServiceLike } from '../../services/israelNotamService';
import type { IsraelNotamReport } from '../../services/israelNotam';
import type { NotamClosureLookup } from '../columns/nearest/sources';

export type IsraelChartDb = Pick<
  IsraelAviationDatabase,
  'reportingPoints' | 'routeSegments' | 'airspacesOfKind' | 'runwaysIn' | 'aerodromesIn'
>;

/** Every source the Israel chart draws, with the NOTAM closures of `report` (none when null). */
export async function israelChartSources(
  input: IsraelChartInput,
  report: IsraelNotamReport | null,
  nowMs: number,
): Promise<{
  sources: Record<string, FeatureCollection>;
  status: IsraelClosureStatus;
  /** The closures drawn, for the point sheet. */
  marks: ReadonlyMap<number, IsraelChartClosureMark>;
}> {
  const base = buildIsraelSources(input);
  if (report === null) return { sources: base, status: { kind: 'noFeed' }, marks: new Map() };
  // IsraelChartFeatureBuilder.closures(from:network:now:): the feed's closures placed on the CVFR network.
  const known = new IsraelNetworkLookup(input.points, input.segments);
  const network = {
    knowsPoint: (code: string) => known.knowsPoint(code),
    // A closure names its chain in either direction; the chart has each segment once.
    segment: (from: string, to: string) => known.segment(from, to) ?? known.segment(to, from),
  };
  const mapping = await mapClosures(report.feed.closures, network, nowMs, (s) => s.id);
  const set = israelClosureSet(
    report.feed,
    mapping.matches.map((m) => ({ closure: m.closure, segments: m.segments })),
    nowMs,
  );
  return {
    sources: { ...base, ...israelClosureSources(segmentFeatures(input.segments), set.marks) },
    status: israelClosureStatus(set),
    marks: set.marks,
  };
}

export const loadIsraelChart = (db: IsraelChartDb): Promise<IsraelChartInput> =>
  loadIsraelChartInput(db as IsraelAviationDatabase);

/** The feed read for the chart: a failed fetch with nothing cached is "no feed", never an error on the map. */
export async function currentReport(
  service: IsraelNotamServiceLike | null,
  forceRefresh = false,
): Promise<IsraelNotamReport | null> {
  if (!service) return null;
  try {
    return await service.fetchFeed(forceRefresh);
  } catch {
    return null;
  }
}

/** AirportQueries.fetchNotamClosures: which NOTAMs close a field now, from the feed (an unusable feed names none). */
export function closureLookupFrom(service: IsraelNotamServiceLike | null): (() => Promise<NotamClosureLookup>) | null {
  if (!service) return null;
  return async () => {
    const report = await service.fetchFeed();
    return (code, nowMs) => {
      const freshnessLevel = evaluateFreshness('notam', { observed: report.feed.generatedAt, now: nowMs }).level;
      const items = report.feed.items.map((n) => ({
        id: n.id,
        isSuperseded: notamIsSuperseded(n),
        closures: n.closures,
        validFrom: n.validFrom,
        validTo: n.validTo,
        e: n.e,
      }));
      return closingNotams(code, { freshnessLevel, items }, nowMs).map((n) => n.id);
    };
  };
}
