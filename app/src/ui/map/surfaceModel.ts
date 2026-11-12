// Pure parts of the map surface (no MapLibre runtime import, so Jest can test them).
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import baseStyle from '../../../assets/base-style.json';
import type { LayerSpec, StyleValue } from '../../domain/map/layerSpec';
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

/** Per-layer overrides: forced visibility and paint merged over the spec's (Israel official chart base). */
export interface LayerOverrides {
  visibility: Readonly<Record<string, boolean>>;
  paint: Readonly<Record<string, Record<string, StyleValue>>>;
}

/** The native paint, layout and range props of one layer: night paint over day, then the override, then visibility. */
export function resolveLayerProps(
  spec: LayerSpec,
  o: { visible: boolean; night: boolean; visibilityOverride?: boolean | undefined; paintOverride?: Record<string, StyleValue> | undefined },
) {
  const visible = o.visibilityOverride ?? o.visible;
  return {
    ...(spec.minzoom === undefined ? {} : { minzoom: spec.minzoom }),
    ...(spec.maxzoom === undefined ? {} : { maxzoom: spec.maxzoom }),
    ...(spec.filter ? { filter: spec.filter } : {}),
    paint: { ...spec.paint, ...(o.night ? spec.nightPaint : undefined), ...o.paintOverride },
    layout: { ...spec.layout, visibility: visible ? 'visible' : 'none' },
  };
}
