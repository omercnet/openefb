import { isTileFailureLog } from './tileLog';

describe('isTileFailureLog', () => {
  it('flags error and warning lines about failed requests', () => {
    expect(
      isTileFailureLog('error', 'Failed to load tile 10/163/395 for source vfr-sectional: HTTP status code 503'),
    ).toBe(true);
    expect(
      isTileFailureLog('warn', 'The Internet connection appears to be offline: Could not connect to the server'),
    ).toBe(true);
    expect(isTileFailureLog('error', 'Unable to resolve host "tiles.example.com"')).toBe(true);
  });
  it('ignores other levels and unrelated errors', () => {
    expect(isTileFailureLog('info', 'Failed to load tile')).toBe(false);
    expect(isTileFailureLog('error', 'Image "ownship-chevron" missing')).toBe(false);
    expect(isTileFailureLog('warn', '')).toBe(false);
  });
});
