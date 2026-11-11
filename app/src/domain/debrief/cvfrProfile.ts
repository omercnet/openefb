import { clockText } from './cvfrView';
import {
  deviationFeet,
  deviationText,
  excursionSeconds,
  excursions,
  isAerodromeCode,
  longest,
  lowLegFraction,
  percent,
  publishedAltitudes,
  routeStops,
  tightBandFeet,
  verdictFindings,
  type CVFRAltitudeExcursion,
  type CVFRDebrief,
  type CVFRPointPassage,
  type CVFRProfileSample,
} from './cvfrDebrief';

// What efb-212/Views/Flights/CVFRDebriefProfileView.swift works out before it draws the flight on one distance axis: the stops, the
// aerodrome zones, the altitude range, the label rows, the amber stretches and the spoken summary of each band. Every number
// comes from the L5 builder. Distances are nautical miles, altitudes feet MSL, positions points.

/** Room at each end of the axis for edge labels and the altitude scale -- points. */
export const PROFILE_INSET = 44;
/** Labels closer than this share a row only if staggered -- points. */
export const LABEL_SPACING = 84;
/** The heights of the three bands -- points. */
export const BAND_HEIGHTS = { route: 132, altitude: 220, radio: 104 } as const;
/** The altitude band reserves this much at the bottom for the waypoint times -- points. */
export const TIME_ROW_HEIGHT = 24;

/** A reporting point on the axis; `passage` is null when the point is missing from the database. */
export interface ProfileStop {
  code: string;
  distanceNM: number;
  passage: CVFRPointPassage | null;
}

export interface ProfileModel {
  totalNM: number;
  stops: ProfileStop[];
  /** The not-scored aerodrome zones on the axis. */
  zones: { from: number; to: number }[];
  excursions: CVFRAltitudeExcursion[];
  longest: CVFRAltitudeExcursion | null;
  findings: string[];
  /** The published altitudes of each leg: one or two numbers, none when the leg has no published altitude. */
  published: number[][];
  altitudeRange: { low: number; high: number };
}

/** The unscored runs of the profile: a zone ends at its last unscored sample, not at the scored one that follows. */
function unscoredZones(profile: readonly CVFRProfileSample[]): { from: number; to: number }[] {
  const zones: { from: number; to: number }[] = [];
  let start: number | null = null;
  let end = 0;
  for (const sample of profile) {
    if (sample.excluded) {
      if (start === null) start = sample.distanceNM;
      end = sample.distanceNM;
    } else if (start !== null) {
      zones.push({ from: start, to: end });
      start = null;
    }
  }
  if (start !== null) zones.push({ from: start, to: end });
  return zones;
}

/**
 * The altitude band's vertical range: from a rule of 500 ft below the lowest altitude (and the published band) to one above the
 * highest, at least 1000 ft tall. The band is taken off the lowest and added to the highest a second time, as in Swift, so the
 * range reaches below the ground for a flight that starts there.
 */
export function altitudeRange(
  profile: readonly CVFRProfileSample[],
  published: readonly (readonly number[])[],
): { low: number; high: number } {
  const band = tightBandFeet;
  const altitudes = [
    ...profile.map((s) => s.altitudeFeet),
    ...published.flat().flatMap((value) => [value - band, value + band]),
  ];
  let min = Infinity;
  let max = -Infinity;
  for (const altitude of altitudes) {
    min = Math.min(min, altitude);
    max = Math.max(max, altitude);
  }
  const low = Math.floor(((altitudes.length === 0 ? 0 : min) - band) / 500) * 500;
  const high = Math.ceil(((altitudes.length === 0 ? 1000 : max) + band) / 500) * 500;
  return { low, high: Math.max(low + 1000, high) };
}

export function profileModel(debrief: CVFRDebrief): ProfileModel {
  const stops = routeStops(debrief.legs).map((stop) => ({
    code: stop.code,
    distanceNM: stop.distanceNM,
    passage: debrief.points.find((p) => p.code === stop.code && p.distanceAlongRouteNM === stop.distanceNM) ?? null,
  }));
  const published = debrief.legs.map((leg) =>
    leg.publishedAltitude === null ? [] : publishedAltitudes(leg.publishedAltitude),
  );
  const found = excursions(debrief);
  return {
    totalNM: debrief.legs.at(-1)?.endDistanceNM ?? 0,
    stops,
    zones: unscoredZones(debrief.profile),
    excursions: found,
    longest: longest(found),
    findings: verdictFindings(debrief),
    published,
    altitudeRange: altitudeRange(debrief.profile, published),
  };
}

/** The feet of each thousand-foot rule inside the range. */
export function thousandFootRules(range: { low: number; high: number }): number[] {
  const rules: number[] = [];
  for (let feet = (Math.ceil(range.low / 1000) || 0) * 1000; feet <= range.high; feet += 1000) rules.push(feet);
  return rules;
}

/** x for a distance along the route -- points. */
export const axisX = (distanceNM: number, totalNM: number, width: number): number =>
  PROFILE_INSET + (distanceNM / totalNM) * (width - 2 * PROFILE_INSET);

/** Row 0 unless the previous label on row 0 is too close, then row 1. Only row 0 is compared, as in Swift. */
export function labelRows(stops: readonly ProfileStop[], totalNM: number, width: number): (0 | 1)[] {
  const lastX = [-Infinity, -Infinity];
  return stops.map((stop) => {
    const x = axisX(stop.distanceNM, totalNM, width);
    const row = x - lastX[0]! >= LABEL_SPACING ? 0 : 1;
    lastX[row] = x;
    return row;
  });
}

/** The amber stretch between the edge of the ±200 ft band and the trace; null for a leg with no published altitude. */
export function excursionShape(
  model: ProfileModel,
  debrief: CVFRDebrief,
  excursion: CVFRAltitudeExcursion,
): { edgeFeet: number; samples: CVFRProfileSample[] } | null {
  const samples = debrief.profile.slice(excursion.sampleRange.lower, excursion.sampleRange.upper + 1);
  const first = samples[0];
  const published = model.published[excursion.legIndex];
  if (first === undefined || published === undefined || published.length === 0) return null;
  const reference = first.altitudeFeet - deviationFeet(first.altitudeFeet, published);
  return { edgeFeet: reference + (excursion.deviationFeet > 0 ? tightBandFeet : -tightBandFeet), samples };
}

/** FlightLogStrip.timeToText: "M:SS", or "H:MM" from an hour. */
export function timeToText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (total < 3600) return `${Math.floor(total / 60)}:${pad(total % 60)}`;
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}`;
}

/** FlightLogStrip.spokenDuration: "11 minutes 16 seconds", "1 minute 50 seconds", "1 hour 5 minutes". */
export function spokenDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const count = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'}`;
  if (total < 3600) return `${count(Math.floor(total / 60), 'minute')} ${count(total % 60, 'second')}`;
  return `${count(Math.floor(total / 3600), 'hour')} ${count(Math.floor((total % 3600) / 60), 'minute')}`;
}

/** The label on the longest stretch: "330 ft low \u00B7 4:02". */
export const longestLabel = (excursion: CVFRAltitudeExcursion): string =>
  `${deviationText(excursion.deviationFeet)} \u00B7 ${timeToText(excursionSeconds(excursion))}`;

export const routeSummary = (model: ProfileModel): string =>
  `Route, ${Math.round(model.totalNM)} nautical miles: ${model.stops
    .map((stop) => `${stop.code} at ${Math.round(stop.distanceNM)} nautical miles`)
    .join(', ')}.`;

export function altitudeSummary(debrief: CVFRDebrief, model: ProfileModel): string {
  const parts = debrief.legs.map((leg) => {
    const name = `${leg.fromCode} to ${leg.toCode}`;
    if (leg.publishedAltitude === null) return `${name}, no published altitude`;
    if (leg.adherence === null) return `${name}, published ${leg.publishedAltitude} feet, not measured`;
    const low = leg.adherence.fractionWithin300 < lowLegFraction ? ', caution' : '';
    return `${name}, published ${leg.publishedAltitude} feet, ${percent(leg.adherence.fractionWithin200)} within 200 feet${low}`;
  });
  const worst = model.longest;
  const leg = worst === null ? undefined : debrief.legs[worst.legIndex];
  if (worst !== null && leg !== undefined) {
    parts.push(
      `Longest stretch outside the band: ${deviationText(worst.deviationFeet)} for ${spokenDuration(excursionSeconds(worst))} on ${leg.fromCode} to ${leg.toCode}`,
    );
  }
  if (model.zones.length > 0) parts.push('Aerodrome zones are not scored');
  return `Altitude. ${parts.join('. ')}.`;
}

export function radioSummary(debrief: CVFRDebrief, model: ProfileModel, timeZone?: string): string {
  if (!debrief.transcriptAvailable) return 'Radio. Position reports not checked: no transcript.';
  const parts = model.stops.flatMap((stop) => {
    const passage = stop.passage;
    if (passage === null) return [];
    if (passage.reported) {
      return [
        passage.reportTime === null
          ? `${stop.code} heard`
          : `${stop.code} heard at ${clockText(passage.reportTime, false, timeZone)}`,
      ];
    }
    return isAerodromeCode(stop.code) ? [] : [`${stop.code} not heard`];
  });
  return `Radio. ${parts.length === 0 ? 'No reporting points.' : `${parts.join(', ')}.`}`;
}
