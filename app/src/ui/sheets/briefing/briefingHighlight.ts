// IsraelBriefingMapHighlight.show / clear: the NOTAM's area or route drawn on the map in its tint, and the box to frame.
import type { Coordinate } from '../../../domain/core';
import type { IsraelNotam } from '../../../domain/israel/notamTypes';
import type { FeatureCollection } from '../../../domain/map/geojson';
import { israelBriefingBounds, israelBriefingHighlightSource } from '../../../domain/map/israel/briefing';
import type { HighlightTint } from './logic';

/** MapColor.notamClosure / notamCaution / notamInfo (systemRed, systemOrange, systemBlue). */
export const TINT_COLORS: Record<HighlightTint, string> = {
  closure: '#FF3B30',
  caution: '#FF9500',
  info: '#007AFF',
};

export interface Highlight {
  source: FeatureCollection;
  bounds: { south: number; west: number; north: number; east: number };
}

/** Null when the NOTAM has nothing drawable (Swift `show` returned false). */
export function highlightFor(
  notam: IsraelNotam,
  tint: HighlightTint,
  lookup: (code: string) => Coordinate | null,
): Highlight | null {
  const source = israelBriefingHighlightSource(notam, lookup, TINT_COLORS[tint]);
  const bounds = israelBriefingBounds(notam, lookup);
  return source && bounds ? { source, bounds } : null;
}
