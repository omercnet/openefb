import { describeError } from './describeError';

describe('describeError', () => {
  it.each([
    [new Error('disk full'), 'disk full'],
    [new TypeError('bad value'), 'bad value'],
    [new Error(''), 'Error'], // an Error without a message falls back to its string form
    ['plain text', 'plain text'],
    [42, '42'],
    [null, 'null'],
    [undefined, 'undefined'],
    [{ code: 7 }, '[object Object]'],
  ])('%j -> %s', (value, text) => {
    expect(describeError(value)).toBe(text);
  });
});
