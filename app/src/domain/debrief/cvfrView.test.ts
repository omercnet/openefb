// The tables of efb-212/Views/Flights/CVFRDebriefContent.swift as text: the legs and the reporting points. Swift has no test of the
// view; the cases follow its source. Times are shown in the device's time zone; the tests fix UTC.
import { sampleCvfrDebrief } from './cvfrFixture';
import {
  CVFR_LEG_HEADERS,
  CVFR_POINT_HEADERS,
  clockText,
  cvfrLegRows,
  cvfrNote,
  cvfrPointRows,
  signedWhole,
} from './cvfrView';

const utc = 'UTC';

describe('clockText', () => {
  it('is HH:mm:ss or HH:mm, 24-hour, in the given zone', () => {
    const t = Date.UTC(2026, 8, 21, 14, 13, 20);
    expect(clockText(t, true, utc)).toBe('14:13:20');
    expect(clockText(t, false, utc)).toBe('14:13');
    expect(clockText(t, true, 'Asia/Jerusalem')).toBe('17:13:20'); // UTC+3 in September
  });

  it('writes midnight as 00, not 24', () => {
    expect(clockText(Date.UTC(2026, 8, 21, 0, 5, 9), true, utc)).toBe('00:05:09');
  });
});

describe('signedWhole (String(format: "%+.0f"))', () => {
  it.each([
    [330, '+330'],
    [-330.4, '-330'],
    [0, '+0'],
    [0.4, '+0'],
    [-0.4, '-0'],
    [2.5, '+2'], // a tie rounds to the even digit
    [3.5, '+4'],
    [-2.5, '-2'],
    [-3.5, '-4'],
    [2.6, '+3'],
  ])('%d is %s', (value, text) => {
    expect(signedWhole(value)).toBe(text);
  });
});

describe('cvfrNote', () => {
  it('says where the legs came from', () => {
    expect(cvfrNote({ fromPlan: true })).toBe('Compared with the activated plan.');
    expect(cvfrNote({ fromPlan: false })).toBe('Matched from the track to the route network.');
  });
});

describe('the table headers', () => {
  it('are the ones of the legs and the points tables', () => {
    expect(CVFR_LEG_HEADERS).toEqual(['Leg', 'Pub. alt', '\u00B1200 / \u00B1300 ft', 'Max dev.']);
    expect(CVFR_POINT_HEADERS).toEqual(['Point', 'Time', 'Closest', 'Reported']);
  });
});

describe('cvfrLegRows', () => {
  const rows = cvfrLegRows(sampleCvfrDebrief(), utc);

  it('is one row per leg: the two codes with an en dash, the times, the published altitude, the share within 200 and 300 ft', () => {
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      route: 'LLHA\u2013KISON',
      times: '14:13:20\u201314:18:08',
      published: '1500 ft',
      adherence: { text: '100% / 100%', low: false },
      maxDeviation: '+45 ft',
    });
  });

  it('marks a leg amber when less than 80% of it was within 300 ft', () => {
    expect(rows[1]).toMatchObject({
      route: 'KISON\u2013AFULA',
      adherence: { text: '58% / 66%', low: true },
      maxDeviation: '-330 ft',
    });
    expect(rows[2]!.adherence).toEqual({ text: '90% / 95%', low: false });
  });

  it('exactly 80% within 300 ft is not low (the rule is "less than")', () => {
    const debrief = sampleCvfrDebrief();
    debrief.legs[0]!.adherence = {
      fractionWithin200: 0.8,
      fractionWithin300: 0.8,
      maxDeviationFeet: 10,
      sampledSeconds: 60,
    };
    expect(cvfrLegRows(debrief, utc)[0]!.adherence).toEqual({ text: '80% / 80%', low: false });
  });

  it('says --- for a leg with no published altitude, and not measured for one with no adherence', () => {
    const debrief = sampleCvfrDebrief();
    debrief.legs[2] = { ...debrief.legs[2]!, publishedAltitude: null, adherence: null };
    const row = cvfrLegRows(debrief, utc)[2]!;
    expect(row.published).toBe('---');
    expect(row.adherence).toBeNull();
    expect(row.maxDeviation).toBeNull();
  });

  it('gives each leg an id that is unique on a route that goes out and back', () => {
    const debrief = sampleCvfrDebrief();
    debrief.legs = [debrief.legs[0]!, { ...debrief.legs[0]!, startTime: debrief.legs[0]!.startTime + 60_000 }];
    const ids = cvfrLegRows(debrief, utc).map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('cvfrPointRows', () => {
  it('is one row per passage: the code, the name, the time of closest approach, the distance, and whether it was reported', () => {
    const rows = cvfrPointRows(sampleCvfrDebrief(), utc);
    expect(rows.map((r) => [r.code, r.name, r.time, r.closest, r.reported.text])).toEqual([
      ['LLHA', 'Haifa', '14:13:20', '0.3 NM', 'Yes'],
      ['KISON', 'Kishon', '14:18:08', '0.3 NM', 'Yes'],
      ['AFULA', null, '14:24:44', '0.3 NM', 'No'],
      ['LLMG', 'Megiddo', '14:28:20', '0.3 NM', 'Yes'],
    ]);
  });

  it('leaves the name out when it is the code in other letters (a case-insensitive match)', () => {
    const debrief = sampleCvfrDebrief();
    debrief.points[1] = { ...debrief.points[1]!, nameEnglish: 'kison' };
    expect(cvfrPointRows(debrief, utc)[1]!.name).toBeNull();
  });

  it('leaves the name out when there is none', () => {
    const debrief = sampleCvfrDebrief();
    debrief.points[0] = { ...debrief.points[0]!, nameEnglish: null };
    expect(cvfrPointRows(debrief, utc)[0]!.name).toBeNull();
  });

  it('says Not checked, not No, for every point when the flight has no transcript', () => {
    const debrief = sampleCvfrDebrief();
    debrief.transcriptAvailable = false;
    const rows = cvfrPointRows(debrief, utc);
    expect(rows.map((r) => r.reported.text)).toEqual(['Not checked', 'Not checked', 'Not checked', 'Not checked']);
    expect(rows[0]!.reported.spoken).toBe('Not checked: no transcript');
  });

  it('shows the distance with one decimal, a tie rounding to even as printf does', () => {
    const debrief = sampleCvfrDebrief();
    debrief.points[0] = { ...debrief.points[0]!, distanceNM: 0.25 };
    debrief.points[1] = { ...debrief.points[1]!, distanceNM: 12.04 };
    const rows = cvfrPointRows(debrief, utc);
    expect(rows[0]!.closest).toBe('0.2 NM');
    expect(rows[1]!.closest).toBe('12.0 NM');
  });

  it('gives a point passed twice (out and back) two distinct ids', () => {
    const debrief = sampleCvfrDebrief();
    debrief.points = [debrief.points[1]!, { ...debrief.points[1]!, time: debrief.points[1]!.time + 600_000 }];
    const ids = cvfrPointRows(debrief, utc).map((r) => r.id);
    expect(new Set(ids).size).toBe(2);
  });
});
