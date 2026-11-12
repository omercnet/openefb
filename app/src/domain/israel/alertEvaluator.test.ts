// Port of efb-212Tests/ServiceTests/IsraelAlertTests.swift, suites IsraelAlertEvaluatorTests and
// IsraelSquawkReminderTests. IsraelAlertServiceTests (region gate, throttle, hold, haptics) belong to the service
// port (S1); see docs/port-notes/L3b.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IsraelAerodrome,
  IsraelAerodromeFrequency,
  IsraelAirspace,
  IsraelAirspaceAuthority,
  IsraelAirspaceKind,
} from '../../data/aviation/israelTypes';
import type { Coordinate } from '../core/geometry';
import { makeActiveRoute, makeLeg, type ActiveRoute } from '../route/activeRoute';
import {
  GAZA_AREA_CODE,
  formatOneDecimal,
  airspaceAlerts,
  borderAlerts,
  closureAlerts,
  initialSquawkReminder,
  parseBorderBuffers,
  projectedPosition,
  shortAerodromeName,
  sortAlerts,
  squawkReminderAlert,
  towerContact,
  updateSquawkReminder,
  type CtrContact,
  type IsraelAlert,
  type IsraelBorderBuffers,
  type SquawkReminderState,
} from './alertEvaluator';
import type { IsraelChartClosureMark } from './l3bStandIns';

const center: Coordinate = { lat: 32.0, lon: 34.9 };

/** A square of half-side `halfDegrees` degrees around `c`. */
function square(c: Coordinate = center, halfDegrees = 0.05): Coordinate[][][] {
  return [
    [
      [
        { lat: c.lat - halfDegrees, lon: c.lon - halfDegrees },
        { lat: c.lat - halfDegrees, lon: c.lon + halfDegrees },
        { lat: c.lat + halfDegrees, lon: c.lon + halfDegrees },
        { lat: c.lat + halfDegrees, lon: c.lon - halfDegrees },
      ],
    ],
  ];
}

function area(
  id: number,
  kind: IsraelAirspaceKind,
  o: { code?: string; name?: string; authority?: IsraelAirspaceAuthority | null; ceiling?: number } = {},
): IsraelAirspace {
  return {
    id,
    kind,
    code: o.code ?? `LL${id}`,
    nameEnglish: o.name ?? null,
    nameHebrew: null,
    label: null,
    authority: o.authority === undefined ? 'civil' : o.authority,
    floor: { feet: 0, reference: 'SFC', publishedText: null },
    ceiling: { feet: o.ceiling ?? 3000, reference: 'MSL', publishedText: null },
    polygons: square(center),
  };
}

function alerts(
  position: Coordinate,
  airspaces: IsraelAirspace[],
  o: { altitude?: number | null; track?: number; groundSpeed?: number; ctr?: (code: string) => CtrContact | null } = {},
): IsraelAlert[] {
  return airspaceAlerts({
    position,
    altitudeFeet: o.altitude === undefined ? 2000 : o.altitude,
    trackTrue: o.track ?? 0,
    groundSpeedKnots: o.groundSpeed ?? 0,
    airspaces,
    ctrContact: o.ctr,
  });
}

const south5 = (): Coordinate => ({ lat: center.lat - 5.0 / 60, lon: center.lon });

describe('IsraelAlertEvaluatorTests', () => {
  // MARK: Projection

  test('projectionIsGroundSpeedTimesTwoMinutesAlongTheTrack', () => {
    const north = projectedPosition(center, 0, 120);
    expect(north).not.toBeNull();
    expect(Math.abs(((north?.lat ?? 0) - center.lat) * 60 - 4)).toBeLessThan(0.01); // 120 kt x 2 min = 4 NM
    expect(Math.abs((north?.lon ?? 0) - center.lon)).toBeLessThan(1e-9);

    const east = projectedPosition(center, 90, 120);
    expect(east).not.toBeNull();
    const eastNM = ((east?.lon ?? 0) - center.lon) * 60 * Math.cos((center.lat * Math.PI) / 180);
    expect(Math.abs(eastNM - 4)).toBeLessThan(0.01);

    expect(projectedPosition(center, 0, 10)).toBeNull();
  });

  // MARK: P / R / D and CTR

  test('insideAProhibitedAreaWithinItsVerticalLimitsIsRed', () => {
    const result = alerts(center, [area(1, 'P', { code: 'LLP04', name: 'Haifa Oil Refinery' })]);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('warning');
    expect(result[0]?.title.includes('Inside prohibited area LLP04')).toBe(true);
  });

  test('aboveAProhibitedAreaCeilingRaisesNothing', () => {
    expect(alerts(center, [area(1, 'P', { ceiling: 3000 })], { altitude: 3500 })).toEqual([]);
  });

  test('unknownAltitudeNeverRaisesARedInside', () => {
    const result = alerts(center, [area(1, 'P')], { altitude: null });
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('caution');
  });

  test('projectedEntryIntoAProhibitedAreaIsAmber', () => {
    // 5 NM south of the centre, area half-side 3 NM: 2 NM outside; 120 kt north puts the 2-min point 1 NM inside.
    const result = alerts(south5(), [area(1, 'P', { code: 'LLP09' })], { track: 0, groundSpeed: 120 });
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('caution');
    expect(result[0]?.title.includes('Entering prohibited area LLP09')).toBe(true);
  });

  test('noProjectionWhenMovingAwayOrSlow', () => {
    expect(alerts(south5(), [area(1, 'P')], { track: 180, groundSpeed: 120 })).toEqual([]);
    expect(alerts(south5(), [area(1, 'P')], { track: 0, groundSpeed: 10 })).toEqual([]);
  });

  test('restrictedAndDangerAreasAreAmberNeverRed', () => {
    const restricted = alerts(center, [area(1, 'R', { code: 'LLR1' })]);
    const danger = alerts(center, [area(2, 'D', { code: 'LLD1' })]);
    expect(restricted[0]?.severity).toBe('caution');
    expect(danger[0]?.severity).toBe('caution');
    expect(restricted[0]?.kind).toBe('restricted');
  });

  test('ctrEntryIsAnAmberReminderWithTheTowerFrequency', () => {
    const ctr = area(1, 'CTR', { code: 'LLHZ' });
    const result = alerts(south5(), [ctr], {
      track: 0,
      groundSpeed: 120,
      ctr: () => ({ name: 'Herzliya', twr: 'TWR 122.2' }),
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('caution');
    expect(result[0]?.title).toBe('Entering Herzliya CTR: contact TWR 122.2');
  });

  test('ctrWithNoKnownContactSaysGetClearance', () => {
    const result = alerts(center, [area(1, 'CTR', { code: 'LLXX' })]);
    expect(result[0]?.title.endsWith('get clearance')).toBe(true);
  });

  test('militaryAreasAreFlagged', () => {
    const result = alerts(center, [area(1, 'R', { authority: 'military' })]);
    expect(result[0]?.detail?.includes('MIL')).toBe(true);
    const civil = alerts(center, [area(2, 'R', { authority: 'civil' })]);
    expect(civil[0]?.detail?.includes('MIL')).toBe(false);
  });

  test('gazaAreaIsLeftToTheBorderEvaluatorAndOtherKindsAreIgnored', () => {
    const gaza = area(1, 'P', { code: GAZA_AREA_CODE });
    const tma = area(2, 'TMA');
    expect(alerts(center, [gaza, tma])).toEqual([]);
  });

  test('ctrNamesDropTheRegisterDecoration', () => {
    expect(shortAerodromeName('Herzliya (Modi Alon) Airport')).toBe('Herzliya');
    expect(shortAerodromeName('Haifa Airport')).toBe('Haifa');
    expect(shortAerodromeName('Rosh Pina')).toBe('Rosh Pina');
    expect(shortAerodromeName('Airport')).toBe('Airport');
  });

  test('towerContactTrimsTrailingZeros', () => {
    const aerodrome = (frequencies: IsraelAerodromeFrequency[]): IsraelAerodrome => ({
      id: 1,
      code: 'LLHZ',
      nameHebrew: '',
      nameEnglish: 'Herzliya',
      type: 'airport',
      use: 'civil',
      latitude: 32.18,
      longitude: 34.83,
      elevationFeet: null,
      circuitAltitudeFeet: null,
      circuitDirection: null,
      hours: null,
      ppr: 'unknown',
      pprText: null,
      remarks: null,
      sources: { identity: 'test', runways: null, frequencies: null, circuit: null, hours: null, remarks: null },
      uncertainGroups: [],
      notes: null,
      reviewStatus: 'reviewed',
      runways: [],
      frequencies,
    });
    const tower = { id: 1, mhz: '122.200', service: 'TWR primary', callsignHebrew: null };
    const ground = { id: 2, mhz: '121.900', service: 'GND', callsignHebrew: null };
    expect(towerContact(aerodrome([ground, tower]))).toBe('TWR 122.2');
    expect(towerContact(aerodrome([ground]))).toBeNull();
  });

  // MARK: Closed legs

  const route = (current = 0): ActiveRoute =>
    makeActiveRoute(
      [
        makeLeg({
          segmentID: 10,
          fromCode: 'AAAAA',
          toCode: 'BBBBB',
          toLatitude: 32.3,
          toLongitude: 34.8,
          altitudeText: '2500',
          distanceNM: 18,
        }),
        makeLeg({
          segmentID: 11,
          fromCode: 'BBBBB',
          toCode: 'CCCCC',
          toLatitude: 32.3,
          toLongitude: 35.1,
          altitudeText: '3500',
          distanceNM: 15,
        }),
      ],
      { currentLeg: current },
    );

  const mark = (
    notamID: string,
    text: string,
    severity: IsraelChartClosureMark['severity'],
  ): IsraelChartClosureMark => ({
    notamID,
    text,
    schedule: null,
    severity,
    notes: [],
  });

  test('fullClosureOnALegAheadIsRedAndPartialIsAmber', () => {
    const full = mark('C1/26', 'CLSD to 13:30Z', 'full');
    const partial = mark('C2/26', 'CLSD 2500 \u00B7 AVBL 3000', 'partial');

    const red = closureAlerts(route(), new Map([[11, full]]));
    expect(red).toHaveLength(1);
    expect(red[0]?.severity).toBe('warning');
    expect(red[0]?.title).toBe('Route closed ahead: BBBBB \u2192 CCCCC');

    const amber = closureAlerts(route(), new Map([[10, partial]]));
    expect(amber[0]?.severity).toBe('caution');
    expect(amber[0]?.detail?.includes('AVBL 3000')).toBe(true);
  });

  test('aClosureBehindTheCurrentLegIsNotRaised', () => {
    const full = mark('C1/26', 'CLSD', 'full');
    expect(closureAlerts(route(1), new Map([[10, full]]))).toEqual([]);
    expect(closureAlerts(route(0), new Map([[10, full]]))).toHaveLength(1);
  });

  test('noMarksOrNoRouteRaisesNothing', () => {
    const full = mark('C1/26', 'CLSD', 'full');
    expect(closureAlerts(route(), new Map())).toEqual([]);
    expect(closureAlerts(null, new Map([[10, full]]))).toEqual([]);
  });

  test('anUnreadClosureSaysCheckNotamInAmber', () => {
    const check = mark('C3/26', 'CHECK NOTAM', 'check');
    const result = closureAlerts(route(), new Map([[10, check]]));
    expect(result[0]?.severity).toBe('caution');
    expect(result[0]?.title.startsWith('Check NOTAM')).toBe(true);
  });

  // MARK: Border buffers

  /** A north-south "Syria" line at 35.80E from 32.7N to 33.4N, 6 km (3.24 NM) buffer. */
  const buffers: IsraelBorderBuffers = {
    source: 'test',
    borders: [
      {
        name: 'Syria',
        bufferKm: 6,
        lines: [
          [
            [32.7, 35.8],
            [33.4, 35.8],
          ],
        ],
      },
    ],
  };

  function border(o: { lat?: number; westNM: number; track?: number; groundSpeed?: number }): IsraelAlert[] {
    const lat = o.lat ?? 32.8;
    const lon = 35.8 - o.westNM / (60 * Math.cos((lat * Math.PI) / 180));
    return borderAlerts({
      position: { lat, lon },
      trackTrue: o.track ?? 0,
      groundSpeedKnots: o.groundSpeed ?? 0,
      buffers,
      gazaRings: [],
    });
  }

  test('insideABorderBufferIsRed', () => {
    const result = border({ westNM: 2 });
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe('warning');
    expect(result[0]?.title.includes('Syria')).toBe(true);
  });

  test('withinOneMileOutsideABufferIsAmberAndFurtherIsQuiet', () => {
    // Buffer edge at 3.24 NM: 4.0 NM is 0.76 NM outside (amber); 6.0 NM is 2.76 NM outside (nothing).
    expect(border({ westNM: 4.0 })[0]?.severity).toBe('caution');
    expect(border({ westNM: 6.0 })).toEqual([]);
  });

  test('projectedEntryIntoABufferIsAmber', () => {
    // 6 NM from the line heading east at 150 kt: 5 NM in 2 min leaves 1 NM to the line, inside the buffer.
    const result = border({ westNM: 6.0, track: 90, groundSpeed: 150 });
    expect(result[0]?.severity).toBe('caution');
    expect(result[0]?.title.includes('enters Syria')).toBe(true);
    // The same fix flying away raises nothing.
    expect(border({ westNM: 6.0, track: 270, groundSpeed: 150 })).toEqual([]);
  });

  test('gazaUsesThePAreaPolygon', () => {
    const ring = [
      [31.2, 34.2],
      [31.2, 34.6],
      [31.6, 34.6],
      [31.6, 34.2],
    ];
    const result = (lat: number, lon: number) =>
      borderAlerts({ position: { lat, lon }, trackTrue: 0, groundSpeedKnots: 0, buffers: null, gazaRings: [ring] });
    expect(result(31.4, 34.4)[0]?.severity).toBe('warning');
    expect(result(31.4, 34.4)[0]?.title.includes('Gaza')).toBe(true);
    // 0.5 NM east of the polygon: amber.
    expect(result(31.4, 34.6 + 0.5 / (60 * Math.cos((31.4 * Math.PI) / 180)))[0]?.severity).toBe('caution');
    // 10 NM away: nothing.
    expect(result(31.4, 34.9)).toEqual([]);
  });

  test('northOf33IsAnAmberEquipmentReminderNeverRed', () => {
    const north = borderAlerts({
      position: { lat: 33.1, lon: 35.4 },
      trackTrue: 0,
      groundSpeedKnots: 0,
      buffers: null,
      gazaRings: [],
    });
    expect(north[0]?.id).toBe('north-33');
    expect(north[0]?.severity).toBe('caution');

    // 3 NM south of the line, 120 kt north: the 2-minute point is 1 NM north of it.
    const crossing = borderAlerts({
      position: { lat: 33.0 - 3.0 / 60, lon: 35.4 },
      trackTrue: 0,
      groundSpeedKnots: 120,
      buffers: null,
      gazaRings: [],
    });
    expect(crossing[0]?.title.includes('crosses')).toBe(true);

    const south = borderAlerts({
      position: { lat: 32.5, lon: 35.4 },
      trackTrue: 0,
      groundSpeedKnots: 0,
      buffers: null,
      gazaRings: [],
    });
    expect(south).toEqual([]);
  });

  test('theBundledBorderFileDecodesWithTheThreeBuffers', () => {
    // The Swift app bundles this file; the RN asset wiring is a later ticket, so the test reads it in place.
    const json = readFileSync(join(__dirname, '../../../../efb-212/Resources/israel-border-lines.json'), 'utf8');
    const parsed = parseBorderBuffers(json);
    expect(Object.fromEntries(parsed.borders.map((b) => [b.name, b.bufferKm]))).toEqual({
      Egypt: 3,
      Syria: 6,
      Lebanon: 3,
    });
    expect(parsed.borders.every((b) => b.lines.length > 0)).toBe(true);
    // A point on the Egypt line is inside its own buffer.
    const egypt = parsed.borders.find((b) => b.name === 'Egypt');
    expect(egypt).toBeDefined();
    const vertex = egypt?.lines[0][0] ?? [0, 0];
    const result = borderAlerts({
      position: { lat: vertex[0], lon: vertex[1] },
      trackTrue: 0,
      groundSpeedKnots: 0,
      buffers: parsed,
      gazaRings: [],
    });
    expect(result.some((a) => a.id === 'border-Egypt' && a.severity === 'warning')).toBe(true);
  });

  // MARK: Ordering

  test('redSortsBeforeAmberAndTheOrderIsStable', () => {
    const amber: IsraelAlert = { id: 'a', severity: 'caution', kind: 'ctr', title: 'a', detail: null };
    const red: IsraelAlert = { id: 'z', severity: 'warning', kind: 'closure', title: 'z', detail: null };
    const redBorder: IsraelAlert = { id: 'b', severity: 'warning', kind: 'border', title: 'b', detail: null };
    expect(sortAlerts([amber, red, redBorder]).map((a) => a.id)).toEqual(['b', 'z', 'a']);
  });
});

describe('IsraelSquawkReminderTests', () => {
  const t0 = 1_800_000_000 * 1000;
  const at = (seconds: number) => t0 + seconds * 1000;

  /** Feeds ground speeds in order and returns whether each one fired, plus the final state. */
  function feed(steps: [number, number][], start: SquawkReminderState = initialSquawkReminder()) {
    let state = start;
    const fired = steps.map(([speed, seconds]) => {
      const next = updateSquawkReminder(state, speed, at(seconds));
      state = next.state;
      return next.fired;
    });
    return { fired, state };
  }

  test('firesOnceWhenSpeedPasses40AfterBeingOnTheGround', () => {
    const { fired } = feed([
      [0, 0],
      [30, 0],
      [55, 20],
      [90, 30],
      [100, 300],
    ]);
    expect(fired).toEqual([false, false, true, false, false]);
  });

  test('neverFiresForAFlightJoinedInTheAir', () => {
    const { fired } = feed([
      [100, 0],
      [110, 10],
    ]);
    expect(fired).toEqual([false, false]);
  });

  test('rearmsAfterTheNextStop', () => {
    const first = feed([
      [0, 0],
      [60, 10],
    ]);
    expect(first.fired[1]).toBe(true);
    const again = feed(
      [
        [5, 3600],
        [60, 3700],
      ],
      first.state,
    );
    expect(again.fired[1]).toBe(true);
  });

  test('theReminderNamesCode5100AndExpiresAfterAMinute', () => {
    const { state } = feed([
      [0, 0],
      [60, 0],
    ]);
    const shown = squawkReminderAlert(state, at(30));
    expect(shown).not.toBeNull();
    expect(shown?.title.includes('5100')).toBe(true);
    expect(shown?.severity).toBe('caution');
    expect(squawkReminderAlert(state, at(61))).toBeNull();
  });
});

describe('JS-only guards', () => {
  test('a current leg past the end raises nothing instead of trapping', () => {
    const r = makeActiveRoute(
      [
        makeLeg({
          segmentID: 1,
          fromCode: 'A',
          toCode: 'B',
          toLatitude: 0,
          toLongitude: 0,
          altitudeText: '',
          distanceNM: 1,
        }),
      ],
      {
        currentLeg: 5,
      },
    );
    const m: IsraelChartClosureMark = { notamID: 'C', text: 'CLSD', schedule: null, severity: 'full', notes: [] };
    expect(closureAlerts(r, new Map([[1, m]]))).toEqual([]);
  });

  test('a malformed border file throws instead of yielding a partial buffer set', () => {
    expect(() => parseBorderBuffers('{"source":"x","borders":[{"name":"E","bufferKm":"3","lines":[]}]}')).toThrow();
    expect(() => parseBorderBuffers('not json')).toThrow();
    expect(() => parseBorderBuffers('{"borders":[]}')).toThrow();
  });

  test('the near-buffer title formats the gap to one decimal like printf %.1f', () => {
    // 4.0 NM west of the line, 6 km (3.2397 NM) buffer: 0.76 NM outside.
    const result = borderAlerts({
      position: { lat: 32.8, lon: 35.8 - 4.0 / (60 * Math.cos((32.8 * Math.PI) / 180)) },
      trackTrue: 0,
      groundSpeedKnots: 0,
      buffers: {
        source: 't',
        borders: [
          {
            name: 'Syria',
            bufferKm: 6,
            lines: [
              [
                [32.7, 35.8],
                [33.4, 35.8],
              ],
            ],
          },
        ],
      },
      gazaRings: [],
    });
    expect(result[0]?.title).toBe('0.8 NM from Syria border buffer');
    // Exact binary ties round half to even as printf does (JS toFixed rounds them up).
    expect(formatOneDecimal(0.25)).toBe('0.2');
    expect(formatOneDecimal(0.75)).toBe('0.8');
    expect(formatOneDecimal(0.35)).toBe('0.3');
    expect(formatOneDecimal(0.96)).toBe('1.0');
  });
});

describe('review fixes (JS-only guards)', () => {
  test('border lines with fewer than two vertices or bad coordinates are rejected', () => {
    const file = (lines: unknown) => JSON.stringify({ source: 's', borders: [{ name: 'B', bufferKm: 3, lines }] });
    expect(() => parseBorderBuffers(file([[[32.7, 35.8]]]))).toThrow('malformed');
    expect(() => parseBorderBuffers(file([[]]))).toThrow('malformed');
    expect(() => parseBorderBuffers(file([[[32.7], [32.8, 35.8]]]))).toThrow('malformed');
    expect(
      parseBorderBuffers(
        file([
          [
            [32.7, 35.8],
            [32.8, 35.9],
          ],
        ]),
      ).borders,
    ).toHaveLength(1);
  });
});
