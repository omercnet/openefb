import { appVersionDimension, updateDimension } from './dimensions';
import { validateRow } from './schema';

describe('appVersionDimension', () => {
  test.each([
    ['1.2.0', '1.2.0'],
    ['0.1.0', '0.1.0'],
    ['10.20.300', '10.20.300'],
    ['1.2.0-beta.3', '1.2.0'], // a pre-release suffix is the same app version for counting
    ['1.2.0+45', '1.2.0'], // so is build metadata
  ])('%s is counted as %s', (version, dimension) => {
    expect(appVersionDimension(version)).toBe(dimension);
  });

  test.each([
    ['two numbers', '1.2'],
    ['four numbers', '1.2.3.4'],
    ['a leading v', 'v1.2.0'],
    ['spaces around it', ' 1.2.0 '],
    ['four digits in a part', '1.2.0000'],
    ['text', 'beta'],
    ['an empty string', ''],
    ['text after the numbers with no separator', '1.2.0beta'],
    ['not text (undefined)', undefined],
    ['not text (null)', null],
    ['not text (a number)', 1.2],
  ])('%s is not an app version', (_name, version) => {
    expect(appVersionDimension(version)).toBeNull();
  });

  test('what it gives the schema accepts', () => {
    const row = {
      event: 'App.launched',
      app: appVersionDimension('3.14.159'),
      platform: 'ios',
      update: 'embedded',
      region: 'us',
      count: 1,
    };
    expect(validateRow(row)).not.toBeNull();
  });
});

describe('updateDimension', () => {
  const UUID = '0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

  test('the app as it was built is "embedded", whatever id the embedded update has', () => {
    expect(updateDimension(true, UUID)).toBe('embedded');
    expect(updateDimension(true, null)).toBe('embedded');
  });

  test('a downloaded update is counted under its id', () => {
    expect(updateDimension(false, UUID)).toBe(UUID);
  });

  test('the id is lower-cased, as the schema asks', () => {
    expect(updateDimension(false, UUID.toUpperCase())).toBe(UUID);
  });

  test.each([
    ['no id', null],
    ['an id that is not there', undefined],
    ['an empty id', ''],
  ])('%s is "embedded" (updates are off, as in development)', (_name, id) => {
    expect(updateDimension(false, id)).toBe('embedded');
  });

  test('is "embedded" when the launch is not known to be an update', () => {
    expect(updateDimension(undefined, null)).toBe('embedded');
    expect(updateDimension(undefined, UUID)).toBe(UUID);
  });

  test('what it gives the schema accepts', () => {
    for (const update of [updateDimension(true, UUID), updateDimension(false, UUID.toUpperCase())]) {
      expect(
        validateRow({ event: 'App.launched', app: '1.0.0', platform: 'ios', update, region: 'us', count: 1 }),
      ).not.toBeNull();
    }
  });
});
