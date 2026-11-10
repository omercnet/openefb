import { assumptionText, PredictionStabilizer, predictEvents } from './airspacePredictor';
import {
  predictedEventId,
  type PredictableVolume,
  type PredictedEvent,
  type PredictedSeverity,
  type PredictionInput,
} from './predictedEvent';

const origin = { lat: 32, lon: 35 };
const box = (lat: [number, number], lon: [number, number]): number[][] => [
  [lat[0], lon[0]],
  [lat[0], lon[1]],
  [lat[1], lon[1]],
  [lat[1], lon[0]],
];
const input = (o: Partial<PredictionInput> = {}): PredictionInput => ({
  position: origin,
  altitudeFeetMSL: 2450,
  trackTrue: 90,
  groundSpeedKnots: 120,
  verticalSpeedFPM: 0,
  isStale: false,
  ...o,
});
const volume = (
  id: string,
  rings: number[][][],
  floor: number | null,
  ceiling: number | null,
  name = 'B',
  severity: PredictedSeverity = 'caution',
): PredictableVolume => ({
  id,
  shortName: name,
  shape: { kind: 'polygon', rings },
  floorFeetMSL: floor,
  ceilingFeetMSL: ceiling,
  severity,
});

const shelfOverhead = volume('B1', [box([31.5, 32.5], [34.5, 35.5])], 3000, 10000);

describe('AirspacePredictor Tests', () => {
  it('climbingUnderShelfPredictsFloorAtTheRightTime', () => {
    const events = predictEvents(input({ verticalSpeedFPM: 300 }), [shelfOverhead]);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('floor');
    expect(e.secondsAhead).toBe(110);
    expect(e.limitFeetMSL).toBe(3000);
    expect(e.title).toBe('B floor 3,000');
    expect(e.assumption).toBe('at 090\u00B0, +300 fpm');
    expect(predictedEventId(e)).toBe('B1/floor');
  });
  it('levelUnderShelfPredictsNothing', () => {
    expect(predictEvents(input(), [shelfOverhead])).toEqual([]);
  });
  it('levelTowardLowerShelfPredictsLateralEntry', () => {
    const lower = volume('B2', [box([31.5, 32.5], [35.1, 35.5])], 1500, 10000);
    const events = predictEvents(input({ altitudeFeetMSL: 2900 }), [shelfOverhead, lower]);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('lateral');
    expect(e.title).toBe('B floor 1,500');
    expect(e.limitFeetMSL).toBe(1500);
    expect(e.secondsAhead).toBeGreaterThanOrEqual(150);
    expect(e.secondsAhead).toBeLessThanOrEqual(160);
    expect(e.coordinate.lon).toBeGreaterThan(35.1);
  });
  it('descendingOntoCeilingPredictsCeiling', () => {
    const delta = volume('D1', [box([31.5, 32.5], [34.5, 35.5])], null, 2500, 'D');
    const events = predictEvents(input({ altitudeFeetMSL: 3000, verticalSpeedFPM: -500 }), [delta]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: 'ceiling',
      secondsAhead: 60,
      limitFeetMSL: 2500,
      title: 'D ceiling 2,500',
    });
  });
  it('alreadyInsidePredictsNothing', () => {
    const delta = volume('D1', [box([31.5, 32.5], [34.5, 35.5])], null, 4000, 'D');
    expect(predictEvents(input({ verticalSpeedFPM: 300 }), [delta])).toEqual([]);
  });
  it('eventsAreSoonestFirst', () => {
    const lower = volume('B2', [box([31.5, 32.5], [35.1, 35.5])], 1500, 10000);
    const events = predictEvents(input({ altitudeFeetMSL: 2900, verticalSpeedFPM: 300 }), [lower, shelfOverhead]);
    expect(events.map((e) => e.volumeID)).toEqual(['B1', 'B2']);
  });
  it('staleFixPredictsNothing', () => {
    expect(predictEvents(input({ verticalSpeedFPM: 300, isStale: true }), [shelfOverhead])).toEqual([]);
  });
  it('noAltitudePredictsNothing', () => {
    expect(predictEvents(input({ altitudeFeetMSL: null, verticalSpeedFPM: 300 }), [shelfOverhead])).toEqual([]);
  });
  it('slowGroundSpeedPredictsNothing', () => {
    expect(predictEvents(input({ groundSpeedKnots: 20, verticalSpeedFPM: 300 }), [shelfOverhead])).toEqual([]);
  });
  it('entryBeyondTenMinutesPredictsNothing', () => {
    const far = volume('B3', [box([31.5, 32.5], [35.5, 36.0])], 1500, 10000);
    expect(predictEvents(input({ altitudeFeetMSL: 2900 }), [far])).toEqual([]);
  });
  it('holeInPolygonIsNotEntered', () => {
    const ringed = volume('C1', [box([31.5, 32.5], [35.1, 35.8]), box([31.9, 32.1], [35.15, 35.75])], null, 5000, 'C');
    expect(predictEvents(input({ position: { lat: 32, lon: 35.3 } }), [ringed])).toEqual([]);
  });
  it('circleVolumeIsEntered', () => {
    const prohibited: PredictableVolume = {
      id: 'P4',
      shortName: 'P 4',
      shape: { kind: 'circle', center: [32, 35.2], radiusNM: 3 },
      floorFeetMSL: null,
      ceilingFeetMSL: 4000,
      severity: 'warning',
    };
    const events = predictEvents(input(), [prohibited]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'lateral', severity: 'warning', title: 'P 4' });
    expect(events[0].secondsAhead).toBeGreaterThanOrEqual(210);
    expect(events[0].secondsAhead).toBeLessThanOrEqual(225);
  });
});

const event = (volumeID: string, seconds: number): PredictedEvent => ({
  volumeID,
  kind: 'lateral',
  severity: 'caution',
  secondsAhead: seconds,
  coordinate: origin,
  limitFeetMSL: null,
  title: volumeID,
  assumption: 'at 090\u00B0, level',
});

describe('PredictionStabilizer', () => {
  it('stabilizerHidesOneOffEvent', () => {
    const s = new PredictionStabilizer();
    expect(s.update([event('A', 100)])).toEqual([]);
    expect(s.update([])).toEqual([]);
    expect(s.update([])).toEqual([]);
    expect(s.update([])).toEqual([]);
  });
  it('stabilizerShowsRepeatedEventWithLatestTime', () => {
    const s = new PredictionStabilizer();
    expect(s.update([event('A', 100)])).toEqual([]);
    expect(s.update([event('A', 95)]).map((e) => e.secondsAhead)).toEqual([95]);
    expect(s.update([])).toEqual([]);
    expect(s.update([event('A', 85)]).map((e) => e.secondsAhead)).toEqual([85]);
  });
  it('stabilizerResetForgetsHistory', () => {
    const s = new PredictionStabilizer();
    s.update([event('A', 100)]);
    s.reset();
    expect(s.update([event('A', 95)])).toEqual([]);
  });
});

describe('assumptionText', () => {
  it('assumptionTextFormats', () => {
    expect(assumptionText(312, 300)).toBe('at 312\u00B0, +300 fpm');
    expect(assumptionText(45, -500)).toBe('at 045\u00B0, -500 fpm');
    expect(assumptionText(7, 60)).toBe('at 007\u00B0, level');
  });
  it('normalises negative tracks and rounds rates to 10 away from zero', () => {
    expect(assumptionText(-90, 0)).toBe('at 270\u00B0, level');
    expect(assumptionText(0, 125)).toBe('at 000\u00B0, +130 fpm');
    expect(assumptionText(0, -125)).toBe('at 000\u00B0, -130 fpm');
  });
});
