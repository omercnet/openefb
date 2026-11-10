// Port of efb-212Tests/ServiceTests/VerticalSpeedEstimatorTests.swift (6 cases).
import { VerticalSpeedEstimator } from './verticalSpeedEstimator';

const t0 = 1_000_000_000_000;
const at = (seconds: number): number => t0 + seconds * 1000;

describe('VerticalSpeedEstimator Tests', () => {
  test('steadyClimbReadsFiveHundredFPM', () => {
    const e = new VerticalSpeedEstimator();
    let last = 0;
    for (let i = 0; i <= 30; i++) last = e.update(100 + (i * 500) / 60, at(i), 3);
    expect(Math.abs(last - 500)).toBeLessThan(10);
  });

  test('rateDependsOnFixTimestampsNotFixCount', () => {
    const oneHz = new VerticalSpeedEstimator();
    const halfHz = new VerticalSpeedEstimator();
    let a = 0;
    let b = 0;
    for (let i = 0; i <= 30; i++) {
      const altitude = 100 + i * 10;
      a = oneHz.update(altitude, at(i), 3);
      b = halfHz.update(altitude, at(i * 2), 3);
    }
    expect(Math.abs(a - 600)).toBeLessThan(10);
    expect(Math.abs(b - 300)).toBeLessThan(10);
  });

  test('descentIsNegative', () => {
    const e = new VerticalSpeedEstimator();
    let last = 0;
    for (let i = 0; i <= 20; i++) last = e.update(3000 - i * 10, at(i), 3);
    expect(Math.abs(last + 600)).toBeLessThan(10);
  });

  test('invalidVerticalAccuracyIsIgnored', () => {
    const e = new VerticalSpeedEstimator();
    for (let i = 0; i <= 10; i++) e.update(100 + i * 10, at(i), 3);
    const before = e.verticalSpeedFPM;
    const held = e.update(50_000, at(11), -1);
    expect(held).toBe(before);
    expect(e.verticalSpeedFPM).toBe(before);
  });

  test('smoothingDampsSingleFixJitter', () => {
    const e = new VerticalSpeedEstimator();
    for (let i = 0; i <= 10; i++) e.update(1000, at(i), 3);
    const spike = e.update(1010, at(11), 3);
    expect(spike).toBeGreaterThan(0);
    expect(spike).toBeLessThan(200);
  });

  test('duplicateTimestampDoesNotDivideByZero', () => {
    const e = new VerticalSpeedEstimator();
    e.update(100, at(0), 3);
    const result = e.update(200, at(0), 3);
    expect(result).toBe(0);
    expect(Number.isFinite(result)).toBe(true);
  });
});
