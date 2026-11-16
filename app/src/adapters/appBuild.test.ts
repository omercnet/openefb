import { parseBuildNumber } from './appBuild';

describe('the running build number', () => {
  it('reads CFBundleVersion / versionCode text as a number', () => {
    expect(parseBuildNumber('161')).toBe(161);
  });
  it('is null, not 0, when the build is missing or not a number, so no banner can be raised for it', () => {
    for (const raw of [undefined, null, '', '  ', 'abc', '0', '-3']) expect(parseBuildNumber(raw)).toBeNull();
  });
});
