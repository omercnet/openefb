import { COMPACT_BELOW, sizeClass, usesCompactLayout, type DeviceInfo } from './layout';

const phone = (os: string, width: number, height: number): DeviceInfo => ({
  os,
  isPad: false,
  window: { width, height },
  screen: { width, height },
});
const pad = (width: number, height: number): DeviceInfo => ({ ...phone('ios', width, height), isPad: true });

describe('sizeClass', () => {
  it.each([
    ['iPhone 17e', 375, 812],
    ['iPhone 17 Pro', 402, 874],
    ['iPhone 17 Pro Max', 440, 956],
  ] as const)('%s portrait is compact', (_n, w, h) => {
    expect(sizeClass(phone('ios', w, h))).toBe('compact');
  });

  it.each([
    ['iPhone 17e', 812, 375],
    ['iPhone 17 Pro', 874, 402],
    ['iPhone 16 Pro', 874, 402],
  ] as const)('%s landscape stays compact', (_n, w, h) => {
    expect(sizeClass(phone('ios', w, h))).toBe('compact');
  });

  it.each([
    ['iPhone 11 / XR', 896, 414],
    ['iPhone 14 Plus', 926, 428],
    ['iPhone 17 Pro Max', 956, 440],
  ] as const)('%s landscape is regular (Plus and Max models, as UIKit reports)', (_n, w, h) => {
    expect(sizeClass(phone('ios', w, h))).toBe('regular');
  });

  it('an Android phone is compact in both orientations, by smallest screen width', () => {
    expect(sizeClass(phone('android', 412, 915))).toBe('compact');
    expect(sizeClass(phone('android', 915, 412))).toBe('compact');
    expect(sizeClass(phone('android', 599, 1000))).toBe('compact');
  });

  it('an Android tablet (smallest width 600 dp or more) follows the window width', () => {
    expect(sizeClass(phone('android', 800, 1280))).toBe('regular');
    expect(sizeClass({ ...phone('android', 800, 1280), window: { width: 590, height: 1280 } })).toBe('compact');
  });

  it.each([
    ['half of an 11" iPad in landscape (Split View)', 590, 'compact'],
    ['half of a 13" iPad in landscape (Split View)', 678, 'regular'],
    ['iPad mini portrait', 744, 'regular'],
    ['13" iPad Pro portrait', 1032, 'regular'],
  ] as const)('%s (%d pt) is %s on an iPad', (_name, width, expected) => {
    expect(sizeClass(pad(width, 1376))).toBe(expected);
  });

  it('an iPad rotated to landscape stays regular', () => {
    expect(sizeClass(pad(1376, 1032))).toBe('regular');
  });

  it('switches at 600 pt on a tablet', () => {
    expect(sizeClass(pad(COMPACT_BELOW - 0.5, 1000))).toBe('compact');
    expect(sizeClass(pad(COMPACT_BELOW, 1000))).toBe('regular');
  });
});

describe('usesCompactLayout', () => {
  it('a compact window always, a regular one only with the flight log hidden', () => {
    expect(usesCompactLayout('compact', true)).toBe(true);
    expect(usesCompactLayout('compact', false)).toBe(true);
    expect(usesCompactLayout('regular', true)).toBe(false);
    expect(usesCompactLayout('regular', false)).toBe(true);
  });
});
