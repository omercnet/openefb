// What efb-212/Views/Flights/CVFRDebriefProfileView.swift works out before it draws: the stops on the distance axis, the aerodrome
// zones, the altitude range, the label rows, the amber stretches, and the spoken summary of each band. Swift has no test of the view;
// the cases follow its source. Every number comes from the L5 builder.
import { sampleCvfrDebrief } from './cvfrFixture';
import {
  LABEL_SPACING,
  PROFILE_INSET,
  altitudeRange,
  altitudeSummary,
  axisX,
  excursionShape,
  labelRows,
  longestLabel,
  profileModel,
  radioSummary,
  routeSummary,
  spokenDuration,
  thousandFootRules,
  timeToText,
} from './cvfrProfile';
import type { CVFRDebrief, CVFRProfileSample } from './cvfrDebrief';

const utc = 'UTC';

const sample = (
  distanceNM: number,
  altitudeFeet: number,
  extra: Partial<CVFRProfileSample> = {},
): CVFRProfileSample => ({
  distanceNM,
  altitudeFeet,
  legIndex: 0,
  excluded: false,
  time: 1_790_000_000_000 + distanceNM * 36_000,
  ...extra,
});

/** The sample debrief with its profile replaced. */
const withProfile = (profile: CVFRProfileSample[]): CVFRDebrief => ({ ...sampleCvfrDebrief(), profile });

describe('profileModel', () => {
  const debrief = sampleCvfrDebrief();
  const model = profileModel(debrief);

  it('lays the route out over the distance of its last leg', () => {
    expect(model.totalNM).toBe(25);
  });

  it('lists the reporting points along the route, each with the passage recorded there', () => {
    expect(model.stops.map((s) => [s.code, s.distanceNM, s.passage?.reported])).toEqual([
      ['LLHA', 0, true],
      ['KISON', 8, true],
      ['AFULA', 17, false],
      ['LLMG', 25, true],
    ]);
  });

  it('has no passage for a stop that is not in the database (the point is then drawn on the route, but not in the radio band)', () => {
    const missing = { ...debrief, points: debrief.points.filter((p) => p.code !== 'KISON') };
    expect(profileModel(missing).stops[1]!.passage).toBeNull();
  });

  it('matches a passage by its place on the axis, so a point passed twice gets one passage per visit', () => {
    const kison = debrief.points.find((p) => p.code === 'KISON')!;
    const twice: CVFRDebrief = {
      ...debrief,
      points: [
        { ...kison, distanceAlongRouteNM: 3, reported: false },
        { ...kison, distanceAlongRouteNM: 8, reported: true },
      ],
    };
    expect(profileModel(twice).stops[1]!.passage?.reported).toBe(true);
  });

  it('takes the published altitudes of each leg: one, two, or none', () => {
    expect(model.published).toEqual([[1500], [2500], [1500]]);
    const legs = debrief.legs.map((leg, i) => ({ ...leg, publishedAltitude: [null, '2500/3500', '1500'][i] ?? null }));
    expect(profileModel({ ...debrief, legs }).published).toEqual([[], [2500, 3500], [1500]]);
  });

  it('finds the aerodrome zones: the unscored runs of the profile, in nautical miles', () => {
    expect(model.zones).toHaveLength(2);
    expect(model.zones[0]!.from).toBe(0);
    expect(model.zones[0]!.to).toBeCloseTo(2.8333, 3); // the last sample inside 3 NM
    expect(model.zones[1]!.from).toBeCloseTo(22.1667, 3);
    expect(model.zones[1]!.to).toBeCloseTo(25, 3);
  });

  it('a zone runs to its last unscored sample, not to the first scored one after it', () => {
    const profile = [
      sample(0, 100, { excluded: true }),
      sample(1, 100, { excluded: true }),
      sample(2, 100),
      sample(3, 100),
    ];
    expect(profileModel(withProfile(profile)).zones).toEqual([{ from: 0, to: 1 }]);
  });

  it('keeps a zone that is still open at the end, and a zone of one sample', () => {
    const profile = [
      sample(0, 100),
      sample(1, 100, { excluded: true }),
      sample(2, 100),
      sample(3, 100, { excluded: true }),
      sample(4, 100, { excluded: true }),
    ];
    expect(profileModel(withProfile(profile)).zones).toEqual([
      { from: 1, to: 1 },
      { from: 3, to: 4 },
    ]);
  });

  it('has no zones when every sample is scored', () => {
    expect(profileModel(withProfile([sample(0, 100), sample(1, 100)])).zones).toEqual([]);
  });

  it('carries the verdict of the builder: the stretches outside the band, the longest of them, and the findings', () => {
    expect(model.excursions.length).toBeGreaterThan(0);
    expect(model.longest).toBe(
      model.excursions.reduce((a, b) => (b.endTime - b.startTime > a.endTime - a.startTime ? b : a)),
    );
    expect(model.findings).toEqual(['KISON to AFULA: 355 ft low, 2 min', 'AFULA report not heard']);
  });
});

describe('altitudeRange', () => {
  it('runs from a rule of 500 ft below the lowest altitude and its band to one above the highest', () => {
    const profile = [sample(0, 1400), sample(1, 1600)];
    const range = altitudeRange(profile, [[1500], [1500], [1500]]);
    // altitudes 1400, 1600 and the 1500 +- 200 band: 1300..1700; another 200 each way, to the next 500: 1000..2000
    expect(range).toEqual({ low: 1000, high: 2000 });
  });

  it('is at least 1000 ft tall', () => {
    expect(altitudeRange([sample(0, 1500)], [[1500]])).toEqual({ low: 1000, high: 2000 });
    expect(altitudeRange([sample(0, 1500)], [[]])).toEqual({ low: 1000, high: 2000 });
  });

  it('is made 1000 ft tall when the altitudes are close together', () => {
    expect(altitudeRange([sample(0, 1700)], [[]])).toEqual({ low: 1500, high: 2500 });
  });

  it('with nothing to measure runs from 500 ft below the ground to 1500 ft, as Swift does', () => {
    expect(altitudeRange([], [])).toEqual({ low: -500, high: 1500 });
  });

  it('is rounded outwards to 500 ft', () => {
    expect(altitudeRange([sample(0, 2210), sample(1, 2490)], [[]])).toEqual({ low: 2000, high: 3000 });
  });
});

describe('thousandFootRules', () => {
  it('are the multiples of 1000 ft inside the range', () => {
    expect(thousandFootRules({ low: -500, high: 3000 })).toEqual([0, 1000, 2000, 3000]);
    expect(thousandFootRules({ low: 1000, high: 2000 })).toEqual([1000, 2000]);
    expect(thousandFootRules({ low: 1500, high: 2500 })).toEqual([2000]);
  });
});

describe('axisX', () => {
  it('puts a distance on the axis, with 44 points of room at each end', () => {
    expect(PROFILE_INSET).toBe(44);
    expect(axisX(0, 25, 400)).toBe(44);
    expect(axisX(25, 25, 400)).toBe(356);
    expect(axisX(12.5, 25, 400)).toBe(200);
  });
});

describe('labelRows', () => {
  const stops = profileModel(sampleCvfrDebrief()).stops;
  const stopsAt = (...distances: number[]) =>
    distances.map((distanceNM, i) => ({ code: `P${i}`, distanceNM, passage: null }));

  it('puts every label on the top row when there is room for them', () => {
    expect(LABEL_SPACING).toBe(84);
    expect(labelRows(stops, 25, 400)).toEqual([0, 0, 0, 0]); // 100 points or more between neighbours
  });

  it('puts a label on the lower row when it is less than 84 points after the last label on the top row', () => {
    expect(labelRows(stopsAt(0, 8, 17, 21), 25, 400)).toEqual([0, 0, 0, 1]); // 21 NM is 50 points after 17 NM
  });

  it('staggers more labels on a narrower axis', () => {
    expect(labelRows(stops, 25, 300)).toEqual([0, 1, 0, 1]);
  });

  it('only compares with the top row, as Swift does: a label near the lower row still goes there', () => {
    const near = [
      { code: 'A', distanceNM: 0, passage: null },
      { code: 'B', distanceNM: 1, passage: null },
      { code: 'C', distanceNM: 2, passage: null },
    ];
    expect(labelRows(near, 25, 400)).toEqual([0, 1, 1]);
  });
});

describe('excursionShape (the amber stretch between the band edge and the trace)', () => {
  const debrief = sampleCvfrDebrief();
  const model = profileModel(debrief);
  const low = model.longest!;

  it('is bounded by the edge of the band the flight left, on the side it left it', () => {
    const shape = excursionShape(model, debrief, low)!;
    expect(shape.edgeFeet).toBe(2300); // 2500 - 200: below the band
    expect(shape.samples.length).toBe(low.sampleRange.upper - low.sampleRange.lower + 1);
    expect(shape.samples[0]).toBe(debrief.profile[low.sampleRange.lower]);
  });

  it('is above the band for a stretch that is high', () => {
    const high = { ...low, deviationFeet: 400 };
    const shape = excursionShape(model, debrief, high)!;
    expect(shape.edgeFeet).toBe(2700); // the published 2500 the stretch was measured against, plus 200
  });

  it('is nothing for a leg with no published altitude', () => {
    const legs = debrief.legs.map((leg) => ({ ...leg, publishedAltitude: null }));
    const bare = { ...debrief, legs };
    expect(excursionShape(profileModel(bare), bare, low)).toBeNull();
  });

  it('is nothing for a stretch on a leg that is not there', () => {
    expect(excursionShape(model, debrief, { ...low, legIndex: 9 })).toBeNull();
  });
});

describe('timeToText (FlightLogStrip.timeToText)', () => {
  it.each([
    [0, '0:00'],
    [59.4, '0:59'],
    [59.6, '1:00'],
    [168, '2:48'],
    [3599, '59:59'],
    [3600, '1:00'], // from an hour it is hours and minutes
    [5400, '1:30'],
    [-5, '0:00'],
  ])('%d s is %s', (seconds, text) => {
    expect(timeToText(seconds)).toBe(text);
  });
});

describe('spokenDuration (FlightLogStrip.spokenDuration)', () => {
  it.each([
    [168, '2 minutes 48 seconds'],
    [110, '1 minute 50 seconds'],
    [61, '1 minute 1 second'],
    [0, '0 minutes 0 seconds'],
    [3900, '1 hour 5 minutes'],
    [7200, '2 hours 0 minutes'],
  ])('%d s is "%s"', (seconds, text) => {
    expect(spokenDuration(seconds)).toBe(text);
  });
});

describe('longestLabel', () => {
  it('is the deviation and the time of the longest stretch', () => {
    const model = profileModel(sampleCvfrDebrief());
    expect(longestLabel(model.longest!)).toBe('355 ft low \u00B7 2:12');
  });
});

describe('the summaries, one per band, for screen readers', () => {
  const debrief = sampleCvfrDebrief();
  const model = profileModel(debrief);

  it('route: the length and each point with its distance', () => {
    expect(routeSummary(model)).toBe(
      'Route, 25 nautical miles: LLHA at 0 nautical miles, KISON at 8 nautical miles, AFULA at 17 nautical miles, LLMG at 25 nautical miles.',
    );
  });

  it('route: rounds the distances to whole nautical miles', () => {
    const rounded = {
      ...model,
      totalNM: 24.6,
      stops: [
        { ...model.stops[0]!, distanceNM: 8.4 },
        { ...model.stops[1]!, distanceNM: 12.5 },
      ],
    };
    expect(routeSummary(rounded)).toBe(
      'Route, 25 nautical miles: LLHA at 8 nautical miles, KISON at 13 nautical miles.',
    );
  });

  it('altitude: each leg with its published altitude and share, caution when low, then the longest stretch and the zones', () => {
    expect(altitudeSummary(debrief, model)).toBe(
      'Altitude. LLHA to KISON, published 1500 feet, 100% within 200 feet. ' +
        'KISON to AFULA, published 2500 feet, 58% within 200 feet, caution. ' +
        'AFULA to LLMG, published 1500 feet, 90% within 200 feet. ' +
        'Longest stretch outside the band: 355 ft low for 2 minutes 12 seconds on KISON to AFULA. ' +
        'Aerodrome zones are not scored.',
    );
  });

  it('altitude: says so for a leg with no published altitude and for one that was not measured', () => {
    const legs = debrief.legs.map((leg, i) =>
      i === 0 ? { ...leg, publishedAltitude: null } : i === 2 ? { ...leg, adherence: null } : leg,
    );
    const changed = { ...debrief, legs };
    const text = altitudeSummary(changed, profileModel(changed));
    expect(text).toContain('LLHA to KISON, no published altitude.');
    expect(text).toContain('AFULA to LLMG, published 1500 feet, not measured.');
  });

  it('altitude: has no longest stretch or zone sentence when there are none', () => {
    const flat = withProfile([sample(0, 1500, { legIndex: 0 }), sample(8, 1500, { legIndex: 0 })]);
    const text = altitudeSummary(flat, profileModel(flat));
    expect(text).not.toContain('Longest stretch');
    expect(text).not.toContain('Aerodrome zones');
  });

  it('radio: each point that was heard with the time, and each reporting point that was not', () => {
    expect(radioSummary(debrief, model, utc)).toBe(
      'Radio. LLHA heard at 14:13, KISON heard at 14:18, AFULA not heard, LLMG heard at 14:28.',
    );
  });

  /** The summary for a debrief changed after the model was made: the stops carry their passages, so the model is made again. */
  const radio = (changed: CVFRDebrief) => radioSummary(changed, profileModel(changed), utc);

  it('radio: an aerodrome that was not heard is left out (it is not a reporting point)', () => {
    const points = debrief.points.map((p) => (p.code === 'LLMG' ? { ...p, reported: false, reportTime: null } : p));
    expect(radio({ ...debrief, points })).not.toContain('LLMG');
  });

  it('radio: says heard without a time when the report time is not known', () => {
    const points = debrief.points.map((p) => (p.code === 'KISON' ? { ...p, reportTime: null } : p));
    expect(radio({ ...debrief, points })).toContain('KISON heard,');
  });

  it('radio: says the reports were not checked when there is no transcript', () => {
    expect(radio({ ...debrief, transcriptAvailable: false })).toBe(
      'Radio. Position reports not checked: no transcript.',
    );
  });

  it('radio: says there are no reporting points when there is nothing to say', () => {
    expect(radio({ ...debrief, points: [] })).toBe('Radio. No reporting points.');
  });
});
