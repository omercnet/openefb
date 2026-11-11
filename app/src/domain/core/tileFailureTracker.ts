// Port of Core/TileFailureTracker.swift. Immutable: every call returns the next state.

export const TILE_FAILURE_THRESHOLD = 6;

export interface TileFailureTracker {
  readonly consecutiveErrors: number;
}

export const newTileFailureTracker = (): TileFailureTracker => ({ consecutiveErrors: 0 });
export const isTileFailing = (t: TileFailureTracker): boolean => t.consecutiveErrors >= TILE_FAILURE_THRESHOLD;
export const recordTileError = (t: TileFailureTracker): TileFailureTracker => ({
  consecutiveErrors: t.consecutiveErrors + 1,
});
export const recordTileNetworkLoad = (): TileFailureTracker => ({ consecutiveErrors: 0 });
