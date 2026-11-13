import { fixed1 } from '../numberFormat';
import {
  cvfrLegId,
  cvfrPassageId,
  lowLegFraction,
  percent,
  type CVFRDebrief,
  type CVFRLegDebrief,
  type CVFRPointPassage,
} from './cvfrDebrief';

// The tables of efb-212/Views/Flights/CVFRDebriefContent.swift as text: the legs and the reporting points. Every number comes from
// the L5 builder; this only words it.

export const CVFR_LEG_HEADERS = ['Leg', 'Pub. alt', '\u00B1200 / \u00B1300 ft', 'Max dev.'] as const;
export const CVFR_POINT_HEADERS = ['Point', 'Time', 'Closest', 'Reported'] as const;

/** DateFormatter "HH:mm:ss" or "HH:mm" in the device's zone (the zone option is for the tests). */
export function clockText(epochMs: number, withSeconds: boolean, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(epochMs));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hoursAndMinutes = `${part('hour')}:${part('minute')}`;
  return withSeconds ? `${hoursAndMinutes}:${part('second')}` : hoursAndMinutes;
}

/**
 * `String(format: "%+.0f", x)`: a sign and a whole number. printf rounds an exact tie to the even digit, where Math.round rounds it
 * up; a value that rounds to zero keeps its sign ("-0").
 */
export function signedWhole(x: number): string {
  const magnitude = Math.abs(x);
  const floor = Math.floor(magnitude);
  const tie = magnitude - floor === 0.5;
  const whole = tie ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(magnitude);
  return `${x < 0 ? '-' : '+'}${whole}`;
}

export const cvfrNote = (debrief: Pick<CVFRDebrief, 'fromPlan'>): string =>
  debrief.fromPlan ? 'Compared with the activated plan.' : 'Matched from the track to the route network.';

export interface CvfrLegRow {
  id: string;
  /** "LLHA–KISON" (an en dash). */
  route: string;
  times: string;
  /** "2500 ft", or --- when CAAI publishes none. */
  published: string;
  /** The share within ±200 and ±300 ft; null for a leg that was not measured. `low` is amber with a triangle, never red. */
  adherence: { text: string; low: boolean } | null;
  maxDeviation: string | null;
}

export function cvfrLegRows(debrief: Pick<CVFRDebrief, 'legs'>, timeZone?: string): CvfrLegRow[] {
  return debrief.legs.map((leg: CVFRLegDebrief) => ({
    id: cvfrLegId(leg),
    route: `${leg.fromCode}\u2013${leg.toCode}`,
    times: `${clockText(leg.startTime, true, timeZone)}\u2013${clockText(leg.endTime, true, timeZone)}`,
    published: leg.publishedAltitude === null ? '---' : `${leg.publishedAltitude} ft`,
    adherence: leg.adherence && {
      text: `${percent(leg.adherence.fractionWithin200)} / ${percent(leg.adherence.fractionWithin300)}`,
      low: leg.adherence.fractionWithin300 < lowLegFraction,
    },
    maxDeviation: leg.adherence ? `${signedWhole(leg.adherence.maxDeviationFeet)} ft` : null,
  }));
}

/** The leg row read as one phrase, each value after its column's name (a screen reader meets the cells without the header). */
export function cvfrLegLabel(row: CvfrLegRow): string {
  const [leg, published, adherence, deviation] = CVFR_LEG_HEADERS;
  const measured = row.adherence
    ? `${adherence} ${row.adherence.text}${row.adherence.low ? ', below 80 percent' : ''}. ${deviation} ${row.maxDeviation}`
    : 'not measured';
  return `${leg} ${row.route}, ${row.times}. ${published} ${row.published}. ${measured}`;
}

export interface CvfrPointRow {
  id: string;
  code: string;
  /** The English name, unless it is only the code in other letters. */
  name: string | null;
  time: string;
  closest: string;
  reported: { text: 'Yes' | 'No' | 'Not checked'; spoken?: string };
}

/** The point row read as one phrase, each value after its column's name. */
export function cvfrPointLabel(row: CvfrPointRow): string {
  const [point, time, closest, reported] = CVFR_POINT_HEADERS;
  const name = row.name ? `, ${row.name}` : '';
  return `${point} ${row.code}${name}. ${time} ${row.time}. ${closest} ${row.closest}. ${reported} ${row.reported.spoken ?? row.reported.text}`;
}

export function cvfrPointRows(
  debrief: Pick<CVFRDebrief, 'points' | 'transcriptAvailable'>,
  timeZone?: string,
): CvfrPointRow[] {
  return debrief.points.map((point: CVFRPointPassage) => ({
    id: cvfrPassageId(point),
    code: point.code,
    name:
      point.nameEnglish !== null && point.nameEnglish.toLowerCase() !== point.code.toLowerCase()
        ? point.nameEnglish
        : null,
    time: clockText(point.time, true, timeZone),
    closest: `${fixed1(point.distanceNM)} NM`,
    reported: !debrief.transcriptAvailable
      ? { text: 'Not checked', spoken: 'Not checked: no transcript' }
      : { text: point.reported ? 'Yes' : 'No' },
  }));
}
