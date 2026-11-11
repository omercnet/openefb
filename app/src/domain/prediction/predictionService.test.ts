import type { IsraelAirspace, IsraelAirspaceKind, IsraelAirspaceLimit } from '../../data/aviation/israelTypes';
import type { Airspace } from '../core/models';
import {
  israelShortName,
  PredictionService,
  volumeFromAirspace,
  volumesFromIsraelAirspace,
  type PredictionFix,
  type PredictionState,
} from './predictionService';
import type { PredictedEvent } from './predictedEvent';

const airspace = (classification: Airspace['classification'], floor = 0, ceiling = 4000): Airspace => ({
  id: 'AS-1',
  classification,
  name: 'Test',
  floor,
  ceiling,
  geometry: { kind: 'circle', center: [37, -122], radiusNM: 5 },
});

describe('PredictionUSMapperTests', () => {
  it('classesMapToShortNamesAndSeverity', () => {
    const expected = [
      ['bravo', 'B', 'caution'],
      ['charlie', 'C', 'caution'],
      ['delta', 'D', 'caution'],
      ['restricted', 'R', 'warning'],
      ['prohibited', 'P', 'warning'],
      ['moa', 'MOA', 'caution'],
      ['alert', 'A', 'caution'],
      ['warning', 'W', 'caution'],
      ['tfr', 'TFR', 'warning'],
    ] as const;
    for (const [c, name, severity] of expected) {
      const v = volumeFromAirspace(airspace(c));
      expect(v?.shortName).toBe(name);
      expect(v?.severity).toBe(severity);
    }
  });
  it('classEAndGAreSkipped', () => {
    expect(volumeFromAirspace(airspace('echo'))).toBeNull();
    expect(volumeFromAirspace(airspace('golf'))).toBeNull();
  });
  it('unlimitedCeilingIsNilAndSurfaceFloorIsZero', () => {
    const v = volumeFromAirspace(airspace('bravo', 0, 99999));
    expect(v?.floorFeetMSL).toBe(0);
    expect(v?.ceilingFeetMSL).toBeNull();
    expect(v?.shape).toEqual({ kind: 'circle', center: [37, -122], radiusNM: 5 });
  });
  it('polygonBecomesOuterRing', () => {
    const ring = [
      [37, -122],
      [37.1, -122],
      [37.1, -121.9],
      [37, -122],
    ];
    const v = volumeFromAirspace({ ...airspace('delta', 0, 2500), geometry: { kind: 'polygon', coordinates: ring } });
    expect(v?.shape).toEqual({ kind: 'polygon', rings: [ring] });
    expect(v?.ceilingFeetMSL).toBe(2500);
    expect(v?.id).toBe('us-AS-1');
  });
});

const SFC: IsraelAirspaceLimit = { feet: 0, reference: 'SFC', publishedText: null };
const il = (
  kind: IsraelAirspaceKind,
  code: string | null,
  floor = SFC,
  ceiling: IsraelAirspaceLimit = { feet: 3000, reference: 'MSL', publishedText: null },
): IsraelAirspace => ({
  id: 7,
  kind,
  code,
  nameEnglish: null,
  nameHebrew: null,
  label: null,
  authority: null,
  floor,
  ceiling,
  polygons: [
    [
      [
        { lat: 32.0, lon: 34.8 },
        { lat: 32.1, lon: 34.8 },
        { lat: 32.1, lon: 34.9 },
        { lat: 32.0, lon: 34.8 },
      ],
    ],
  ],
});

describe('PredictionIsraelMapperTests', () => {
  it('aglFloorReadsAsSurface', () => {
    const v = volumesFromIsraelAirspace(il('CTR', 'LLHA', { feet: 500, reference: 'AGL', publishedText: null }))[0];
    expect(v.floorFeetMSL).toBeNull();
    expect(v.ceilingFeetMSL).toBe(3000);
    expect(v.shortName).toBe('CTR LLHA');
    expect(v.severity).toBe('caution');
    expect(v.shape).toEqual({
      kind: 'polygon',
      rings: [
        [
          [32.0, 34.8],
          [32.1, 34.8],
          [32.1, 34.9],
          [32.0, 34.8],
        ],
      ],
    });
  });
  it('mslFloorKeptAndNonMSLCeilingUnlimited', () => {
    const v = volumesFromIsraelAirspace(
      il(
        'TMA',
        'LLBG',
        { feet: 2500, reference: 'MSL', publishedText: null },
        { feet: 95, reference: 'FL', publishedText: null },
      ),
    )[0];
    expect(v.floorFeetMSL).toBe(2500);
    expect(v.ceilingFeetMSL).toBeNull();
  });
  it('surfaceFloorIsZero', () => {
    expect(volumesFromIsraelAirspace(il('ATZ', 'LLHZ'))[0].floorFeetMSL).toBe(0);
  });
  it('firIsSkipped', () => {
    expect(volumesFromIsraelAirspace(il('FIR', 'LLLL'))).toEqual([]);
  });
  it('prohibitedAndRestrictedAreWarnings', () => {
    const p = volumesFromIsraelAirspace(il('P', 'LLP04'))[0];
    expect([p.shortName, p.severity]).toEqual(['P 4', 'warning']);
    const r = volumesFromIsraelAirspace(il('R', 'LLR12'))[0];
    expect([r.shortName, r.severity]).toEqual(['R 12', 'warning']);
    const d = volumesFromIsraelAirspace(il('D', 'LLD5'))[0];
    expect([d.shortName, d.severity]).toEqual(['D 5', 'caution']);
  });
  it('multi-polygon ids and short-name fallbacks', () => {
    const a = il('CTR', 'X');
    const two = volumesFromIsraelAirspace({ ...a, polygons: [a.polygons[0], a.polygons[0]] });
    expect(two.map((v) => v.id)).toEqual(['il-7-0', 'il-7-1']);
    expect(volumesFromIsraelAirspace(a)[0].id).toBe('il-7');
    expect(israelShortName('CTR', null)).toBe('CTR');
    expect(israelShortName('P', 'LLPX')).toBe('P LLPX');
  });
});

describe('PredictionServiceUpdateTests', () => {
  const classC: Airspace = {
    id: 'C-1',
    classification: 'charlie',
    name: 'Test C',
    floor: 0,
    ceiling: 4000,
    geometry: { kind: 'circle', center: [37 + 5 / 60, -122], radiusNM: 2 },
  };
  const placeholder: PredictedEvent = {
    volumeID: 'x',
    kind: 'lateral',
    severity: 'caution',
    secondsAhead: 60,
    coordinate: { lat: 37, lon: -122 },
    limitFeetMSL: null,
    title: 'C',
    assumption: 'at 000\u00B0, level',
  };
  const makeState = (): PredictionState => ({ region: 'us', track: 0, groundSpeed: 120, predictedEvents: [] });
  const makeService = () =>
    new PredictionService({ usAirspaces: () => [classC], israelAirspaces: () => [] }, { update: () => 0 });
  const fix = (secondsAfterStart: number, course = 0): PredictionFix => ({
    coordinate: { lat: 37, lon: -122 },
    altitudeMeters: 609.6,
    verticalAccuracyMeters: 5,
    course,
    timestampMs: (1_800_000_000 + secondsAfterStart) * 1000,
  });

  it('publishesAStableEventAfterTwoConsistentFixes', () => {
    const state = makeState();
    const service = makeService();
    service.update(fix(0), state, false, true);
    expect(state.predictedEvents).toEqual([]);
    service.update(fix(1), state, false, true);
    expect(state.predictedEvents).toHaveLength(1);
    const e = state.predictedEvents[0];
    expect(e.volumeID).toBe('us-C-1');
    expect(e.severity).toBe('caution');
    expect(e.secondsAhead).toBeGreaterThan(0);
    expect(e.secondsAhead).toBeLessThan(180);
  });
  it('disabledClearsEvents', () => {
    const state = { ...makeState(), predictedEvents: [placeholder] };
    makeService().update(fix(0), state, false, false);
    expect(state.predictedEvents).toEqual([]);
  });
  it('staleFixClearsEventsAndRestartsDebounce', () => {
    const state = makeState();
    const service = makeService();
    service.update(fix(0), state, false, true);
    service.update(fix(1), state, false, true);
    expect(state.predictedEvents.length).toBeGreaterThan(0);
    service.update(fix(2), state, true, true);
    expect(state.predictedEvents).toEqual([]);
    service.update(fix(3), state, false, true);
    expect(state.predictedEvents).toEqual([]);
  });
  it('clearDropsEventsAndRestartsDebounce', () => {
    const state = makeState();
    const service = makeService();
    service.update(fix(0), state, false, true);
    service.update(fix(1), state, false, true);
    expect(state.predictedEvents.length).toBeGreaterThan(0);
    service.clear(state);
    expect(state.predictedEvents).toEqual([]);
    service.update(fix(2), state, false, true);
    expect(state.predictedEvents).toEqual([]);
  });
  it('unknownCoursePredictsNothing', () => {
    const state = makeState();
    const service = makeService();
    service.update(fix(0, -1), state, false, true);
    service.update(fix(1, -1), state, false, true);
    expect(state.predictedEvents).toEqual([]);
  });
  it('reuses cached volumes inside the query interval and distance', () => {
    const usAirspaces = jest.fn(() => [classC]);
    const service = new PredictionService({ usAirspaces, israelAirspaces: () => [] }, { update: () => 0 });
    const state = makeState();
    service.update(fix(0), state, false, true);
    service.update(fix(1), state, false, true);
    expect(usAirspaces).toHaveBeenCalledTimes(1);
    service.update(fix(11), state, false, true);
    expect(usAirspaces).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed query', () => {
    let fail = true;
    const usAirspaces = jest.fn(() => {
      if (fail) throw new Error('db');
      return [classC];
    });
    const service = new PredictionService({ usAirspaces, israelAirspaces: () => [] }, { update: () => 0 });
    const state = makeState();
    service.update(fix(0), state, false, true);
    fail = false;
    service.update(fix(1), state, false, true);
    expect(usAirspaces).toHaveBeenCalledTimes(2);
  });
});
