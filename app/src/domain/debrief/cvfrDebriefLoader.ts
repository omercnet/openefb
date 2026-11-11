// Port of efb-212/Services/Debrief/CVFRDebriefLoader.swift: loads a flight's track, transcript and stored plan legs
// from the recording store, the route network from the Israel aviation database, and builds the CVFR debrief. null
// for flights outside Israel (US flights are unchanged).
// Swift's loadBundled (open the bundled Israel database, swallow any error) is not ported here: opening the database
// is an adapter concern, and the caller decides what a failure means.

import {
  buildCVFRDebrief,
  isCVFRDebriefEmpty,
  reportWindowSeconds,
  type CVFRDebrief,
  type CVFRRouteLeg,
} from './cvfrDebrief';
import type {
  CVFRTrackPoint,
  CVFRTranscriptSegment,
  IsraelReportingPoint,
  IsraelRouteSegment,
  StoredRouteLeg,
} from './types';

/** What the loader reads from the recording store (RecordingDatabase in Swift). */
export interface CVFRRecordingSource {
  trackPoints(flightID: string): Promise<CVFRTrackPoint[]>;
  transcriptSegments(flightID: string): Promise<CVFRTranscriptSegment[]>;
  /** The activated plan's legs stored with the flight, in order; empty when it had no plan. */
  routeLegs(flightID: string): Promise<StoredRouteLeg[]>;
}

/** What the loader reads from the Israel aviation database: the whole CVFR network. */
export interface CVFRNetworkSource {
  routeSegments(): Promise<IsraelRouteSegment[]>;
  reportingPoints(): Promise<IsraelReportingPoint[]>;
}

/** Region.israel's bounding box, degrees. TODO(region): use the Region port once on main. */
const israelBounds = { south: 29.0, north: 33.6, west: 33.8, east: 36.2 };

/** The CVFR debrief for `flightID`, or null when the flight was not flown on the Israel network. Rejects when a
 * source does. `reportWindow` is the position-report window, seconds. */
export async function loadCVFRDebrief(
  flightID: string,
  recording: CVFRRecordingSource,
  network: CVFRNetworkSource,
  reportWindow: number = reportWindowSeconds,
): Promise<CVFRDebrief | null> {
  const track = await recording.trackPoints(flightID);
  const first = track[0];
  if (
    !first ||
    first.latitude < israelBounds.south ||
    first.latitude > israelBounds.north ||
    first.longitude < israelBounds.west ||
    first.longitude > israelBounds.east
  ) {
    return null;
  }

  const transcript = await recording.transcriptSegments(flightID);
  const storedLegs = await recording.routeLegs(flightID);
  const segments = await network.routeSegments();
  const points = await network.reportingPoints();

  // The first point with a code wins (codes are not unique: LLNV names two ARPs).
  const pointsByCode = new Map<string, IsraelReportingPoint>();
  for (const point of points) if (!pointsByCode.has(point.code)) pointsByCode.set(point.code, point);

  const debrief = buildCVFRDebrief({
    trackPoints: track,
    transcript,
    plannedLegs: resolveStoredLegs(storedLegs, segments),
    segments,
    points: pointsByCode,
    reportWindow,
  });
  return isCVFRDebriefEmpty(debrief) ? null : debrief;
}

/** Resolve stored code pairs to segments: the published direction first, else the reverse. null when there are no
 * stored legs or none resolves; a code pair with no segment is skipped. */
export function resolveStoredLegs(
  legs: readonly StoredRouteLeg[],
  segments: readonly IsraelRouteSegment[],
): CVFRRouteLeg[] | null {
  const resolved: CVFRRouteLeg[] = [];
  for (const pair of legs) {
    const forward = segments.find((s) => s.fromCode === pair.from && s.toCode === pair.to);
    if (forward) {
      resolved.push({ segment: forward, forward: true });
      continue;
    }
    const reverse = segments.find((s) => s.fromCode === pair.to && s.toCode === pair.from);
    if (reverse) resolved.push({ segment: reverse, forward: false });
  }
  return resolved.length === 0 ? null : resolved;
}
