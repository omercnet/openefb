// What a tap on the map opens (MapView.handleMapTap): the Israel CVFR chart first (an aerodrome opens the airport column, a
// reporting point or the airspaces under the finger open the chart sheet), then the airport and weather-station dots (the
// airport column). The surface only queries the rendered features; the decisions are here.
import type { Coordinate } from '../../domain/core';
import type { IsraelChartClosureMark } from '../../domain/map/israel';
import {
  israelAirspaceSelection,
  israelSelectionFromFeature,
  type IsraelChartSelection,
  type IsraelSelectionData,
} from '../../domain/map/israel';

/** Half of the 52 pt target around the tap in which the nearest chart symbol wins (IsraelChartOverlay.hitTest). */
export const CHART_TAP_REACH = 26;
/** Half of the finger target around the tap for the airport and weather dots. */
export const DOT_TAP_REACH = 22;

export const ISRAEL_SYMBOL_LAYERS = ['il-point-icons', 'il-point-icons-request', 'il-aerodrome-icons'] as const;
export const ISRAEL_AREA_LAYERS = ['il-as-fill-civil', 'il-as-fill-restricted'] as const;
export const DOT_LAYERS = ['airport-circles', 'weather-circles'] as const;

export interface TapFeature {
  properties?: Record<string, string | number | boolean | null> | null;
  geometry?: { type: string; coordinates?: unknown } | null;
}

export interface MapTap {
  lngLat: { lng: number; lat: number };
  /** The rendered features of `layers` within `reach` pixels of the tap (0: exactly at it). */
  query: (reach: number, layers: readonly string[]) => Promise<readonly TapFeature[]>;
}

export interface IsraelTapData {
  data: IsraelSelectionData;
  closures: ReadonlyMap<number, IsraelChartClosureMark>;
}

export type TapResult =
  | { kind: 'airport'; icao: string }
  | { kind: 'israelChart'; selection: Exclude<IsraelChartSelection, { kind: 'aerodrome' }> };

const pointOf = (f: TapFeature): Coordinate | null => {
  const c = f.geometry?.type === 'Point' ? (f.geometry.coordinates as number[] | undefined) : undefined;
  return c && c.length >= 2 ? { lat: c[1]!, lon: c[0]! } : null;
};

/** Ground distance stands in for screen distance: at one zoom the two order symbols the same way. */
const nearness = (tap: Coordinate, p: Coordinate): number => {
  const dLat = p.lat - tap.lat;
  const dLon = (p.lon - tap.lon) * Math.cos((tap.lat * Math.PI) / 180);
  return dLat * dLat + dLon * dLon;
};

export async function resolveMapTap(tap: MapTap, israel: IsraelTapData | null): Promise<TapResult | null> {
  const at: Coordinate = { lat: tap.lngLat.lat, lon: tap.lngLat.lng };
  if (israel) {
    const symbols = (await tap.query(CHART_TAP_REACH, ISRAEL_SYMBOL_LAYERS))
      .map((f) => ({ f, p: pointOf(f) }))
      .filter((x): x is { f: TapFeature; p: Coordinate } => x.p !== null)
      .sort((a, b) => nearness(at, a.p) - nearness(at, b.p));
    const nearest = symbols[0]?.f;
    if (nearest) {
      const props = nearest.properties ?? {};
      const selection = israelSelectionFromFeature(props, israel.data, israel.closures);
      if (selection?.kind === 'aerodrome') return { kind: 'airport', icao: selection.code };
      if (selection) return { kind: 'israelChart', selection };
      // A symbol the data does not know but that carries an aerodrome code (Swift: `if let code`).
      if (typeof props.code === 'string') return { kind: 'airport', icao: props.code };
    }
    const ids = (await tap.query(0, ISRAEL_AREA_LAYERS))
      .map((f) => f.properties?.id)
      .filter((id): id is number => typeof id === 'number');
    const area = ids.length > 0 ? israelAirspaceSelection(ids, israel.data.airspaces) : null;
    if (area && area.kind !== 'aerodrome') return { kind: 'israelChart', selection: area };
  }
  const dots = await tap.query(DOT_TAP_REACH, DOT_LAYERS);
  const first = dots[0]?.properties ?? null;
  const icao = typeof first?.icao === 'string' ? first.icao : typeof first?.stationID === 'string' ? first.stationID : null;
  return icao ? { kind: 'airport', icao } : null;
}
