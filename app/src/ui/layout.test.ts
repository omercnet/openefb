import { COMPACT_BELOW, usesCompactLayout, widthClass } from './layout';

describe('widthClass', () => {
  it.each([
    ['iPhone 17e portrait', 375, 'compact'],
    ['iPhone 17 Pro portrait', 402, 'compact'],
    ['iPhone 17 Pro Max portrait', 440, 'compact'],
    ['half of an 11" iPad in landscape (Split View)', 590, 'compact'],
    ['half of a 13" iPad in landscape (Split View)', 678, 'regular'],
    ['iPad mini portrait', 744, 'regular'],
    ['13" iPad Pro portrait', 1032, 'regular'],
  ] as const)('%s (%d pt) is %s', (_name, width, expected) => {
    expect(widthClass(width)).toBe(expected);
  });

  it('switches at 600 pt', () => {
    expect(widthClass(COMPACT_BELOW - 0.5)).toBe('compact');
    expect(widthClass(COMPACT_BELOW)).toBe('regular');
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
