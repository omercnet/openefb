import type { CVFRDebrief, CVFRLegDebrief, CVFRPointPassage, CVFRProfileSample } from './cvfrDebrief';

// A hand-built CVFR debrief for the tests and the screenshot fixtures: three legs, Haifa to Megiddo over Kishon and Afula (25 NM,
// 100 kt). Leg 2 is flown 330 ft below its published 2500, the report at Afula is not heard, and the aerodrome zones at both ends are
// not scored. The numbers are written down here, not computed by the L5 builder, so a test can name them.

const KNOTS = 100;
const NM_PER_SECOND = KNOTS / 3600;
const SAMPLE_SECONDS = 6;
const TOTAL_NM = 25;

interface LegSpec {
  fromCode: string;
  toCode: string;
  published: string;
  startNM: number;
  endNM: number;
  adherence: CVFRLegDebrief['adherence'];
}

const LEGS: LegSpec[] = [
  {
    fromCode: 'LLHA',
    toCode: 'KISON',
    published: '1500',
    startNM: 0,
    endNM: 8,
    adherence: { fractionWithin200: 1, fractionWithin300: 1, maxDeviationFeet: 45, sampledSeconds: 180 },
  },
  {
    fromCode: 'KISON',
    toCode: 'AFULA',
    published: '2500',
    startNM: 8,
    endNM: 19,
    adherence: { fractionWithin200: 0.58, fractionWithin300: 0.66, maxDeviationFeet: -330, sampledSeconds: 396 },
  },
  {
    fromCode: 'AFULA',
    toCode: 'LLMG',
    published: '1500',
    startNM: 19,
    endNM: 25,
    adherence: { fractionWithin200: 0.9, fractionWithin300: 0.95, maxDeviationFeet: 80, sampledSeconds: 90 },
  },
];

/** The flown altitude at a distance along the route, feet MSL. */
function altitudeAt(nm: number): number {
  if (nm < 3) return 40 + (1460 * nm) / 3;
  if (nm < 8) return 1500 + 40 * Math.sin(nm * 3);
  if (nm < 8.6) return 1500 + 1000 * ((nm - 8) / 0.6); // a climb through the band, too quick to count
  if (nm < 12) return 2500 + 30 * Math.sin(nm * 5);
  if (nm < 16.5) return 2170 + 25 * Math.sin(nm * 4); // 330 ft low
  if (nm < 17.1) return 2170 + 330 * ((nm - 16.5) / 0.6);
  if (nm < 19) return 2500;
  if (nm < 19.6) return 2500 - 1000 * ((nm - 19) / 0.6);
  if (nm < 22) return 1500 + 40 * Math.sin(nm * 3);
  return 1500 - 900 * ((nm - 22) / 3);
}

export function sampleCvfrDebrief(start = 1_790_000_000_000): CVFRDebrief {
  const timeAt = (nm: number) => start + (nm / NM_PER_SECOND) * 1000;

  const legs: CVFRLegDebrief[] = LEGS.map((leg) => ({
    fromCode: leg.fromCode,
    toCode: leg.toCode,
    publishedAltitude: leg.published,
    startTime: timeAt(leg.startNM),
    endTime: timeAt(leg.endNM),
    adherence: leg.adherence,
    startDistanceNM: leg.startNM,
    endDistanceNM: leg.endNM,
  }));

  const profile: CVFRProfileSample[] = [];
  for (let seconds = 0; seconds * NM_PER_SECOND <= TOTAL_NM; seconds += SAMPLE_SECONDS) {
    const distanceNM = seconds * NM_PER_SECOND;
    const legIndex = Math.max(
      0,
      LEGS.findIndex((leg) => distanceNM >= leg.startNM && distanceNM < leg.endNM),
    );
    profile.push({
      distanceNM,
      altitudeFeet: altitudeAt(distanceNM),
      legIndex,
      excluded: distanceNM < 3 || distanceNM > 22, // the 3 NM aerodrome zones
      time: start + seconds * 1000,
    });
  }

  const passage = (
    code: string,
    nameEnglish: string,
    nameHebrew: string,
    nm: number,
    reported: boolean,
  ): CVFRPointPassage => ({
    code,
    nameEnglish,
    nameHebrew,
    time: timeAt(nm),
    distanceNM: 0.3,
    reported,
    distanceAlongRouteNM: nm,
    reportTime: reported ? timeAt(nm) + 2000 : null,
  });

  return {
    fromPlan: true,
    legs,
    points: [
      passage('LLHA', 'Haifa', '\u05D7\u05D9\u05E4\u05D4', 0, true),
      passage('KISON', 'Kishon', '\u05E7\u05D9\u05E9\u05D5\u05DF', 8, true),
      passage('AFULA', 'Afula', '\u05E2\u05E4\u05D5\u05DC\u05D4', 19, false),
      passage('LLMG', 'Megiddo', '\u05DE\u05D2\u05D9\u05D3\u05D5', 25, true),
    ],
    observations: [
      'Altitude stayed within 200 ft on two of three legs.',
      'KISON to AFULA was flown about 330 ft below the published 2500 ft for 2 minutes.',
      'The report at AFULA was not heard.',
    ],
    transcriptAvailable: true,
    profile,
  };
}
