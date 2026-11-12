// Pure parts of the map surface (no MapLibre runtime import, so Jest can test them).
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import baseStyle from '../../../assets/base-style.json';
import type { LayerSpec } from '../../domain/map/layerSpec';
import { NIGHT_RASTER } from '../../domain/map/layers';

/** base-style.json with the FAA sectional shown, dimmed and desaturated at night (MapService.applyDisplayMode). */
export function styleFor(night: boolean, sectional: boolean): StyleSpecification {
  const style = baseStyle as unknown as StyleSpecification;
  return {
    ...style,
    layers: style.layers.map((l) =>
      l.id === 'base-vfr-sectional' && l.type === 'raster'
        ? {
            ...l,
            layout: { ...l.layout, visibility: sectional ? 'visible' : 'none' },
            paint: night ? { ...l.paint, ...NIGHT_RASTER } : l.paint,
          }
        : l,
    ),
  };
}

export interface Group {
  source: string;
  specs: LayerSpec[];
}

/** Specs grouped by source in draw order. Specs of one source must be contiguous (checked by validateRegistry). */
export function groupBySource(specs: readonly LayerSpec[]): Group[] {
  const groups: Group[] = [];
  for (const spec of specs) {
    const last = groups[groups.length - 1];
    if (last && last.source === spec.source) last.specs.push(spec);
    else groups.push({ source: spec.source, specs: [spec] });
  }
  return groups;
}
