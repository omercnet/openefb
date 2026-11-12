// JS-only: MapLibre RN v11 has no per-tile error event (Swift got `mapViewDidFailLoadingMap` / tile callbacks from the
// delegate), so basemap tile failures are inferred from native log lines. Heuristic and UNVERIFIED on device: the
// patterns cover MapLibre Native's HTTP and connectivity messages; tune them from a real offline run (M3 device check).
export type NativeLogLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

const TILE_FAILURE =
  /(failed to load tile|tile .*(error|fail|timed out)|http (request )?(failed|error)|could not connect|network (is )?(unreachable|unavailable)|connection (refused|lost|failed)|timed out|not connected to the internet|unable to resolve host)/i;

/** True for an error or warning line that looks like a failed tile, glyph or sprite request. */
export function isTileFailureLog(level: string, message: string): boolean {
  if (level !== 'error' && level !== 'warn') return false;
  return TILE_FAILURE.test(message);
}
