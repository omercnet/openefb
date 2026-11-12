import { isRecord } from './typeGuards';

describe('isRecord', () => {
  test.each([
    ['an empty object', {}],
    ['an object with fields', { a: 1, b: [2] }],
    ['an object with a null prototype', Object.assign(Object.create(null), { a: 1 })],
  ])('is true for %s', (_name, value) => {
    expect(isRecord(value)).toBe(true);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['an array of objects', [{}]],
    ['a string', 'text'],
    ['a number', 5],
    ['a boolean', true],
    ['a function', () => ({})],
  ])('is false for %s', (_name, value) => {
    expect(isRecord(value)).toBe(false);
  });
});
