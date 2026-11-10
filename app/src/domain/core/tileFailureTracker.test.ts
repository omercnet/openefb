import {
  isTileFailing,
  newTileFailureTracker,
  recordTileError,
  recordTileNetworkLoad,
  TILE_FAILURE_THRESHOLD,
  type TileFailureTracker,
} from './tileFailureTracker';

const errors = (n: number, t = newTileFailureTracker()): TileFailureTracker => {
  for (let i = 0; i < n; i++) t = recordTileError(t);
  return t;
};

describe('Tile failure tracker', () => {
  it('aFewErrorsAreNotAnOutage', () => {
    expect(isTileFailing(errors(TILE_FAILURE_THRESHOLD - 1))).toBe(false);
  });
  it('aRunOfErrorsRaisesTheIndicator', () => {
    expect(isTileFailing(errors(TILE_FAILURE_THRESHOLD))).toBe(true);
  });
  it('aTileFromTheNetworkClearsItAndTheRunStartsOver', () => {
    let t = errors(TILE_FAILURE_THRESHOLD + 3);
    expect(isTileFailing(t)).toBe(true);
    t = recordTileNetworkLoad();
    expect(isTileFailing(t)).toBe(false);
    t = errors(TILE_FAILURE_THRESHOLD - 1, t);
    expect(isTileFailing(t)).toBe(false);
  });
});
