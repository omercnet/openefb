import { israelAirspaceSelection, israelSelectionFromFeature } from '../../domain/map/israel';
import {
  CHART_TAP_REACH,
  DOT_LAYERS,
  DOT_TAP_REACH,
  ISRAEL_AREA_LAYERS,
  ISRAEL_SYMBOL_LAYERS,
  resolveMapTap,
  type MapTap,
  type TapFeature,
} from './mapTap';

jest.mock('../../domain/map/israel', () => ({
  israelSelectionFromFeature: jest.fn(),
  israelAirspaceSelection: jest.fn(),
}));
const fromFeature = jest.mocked(israelSelectionFromFeature);
const airspaces = jest.mocked(israelAirspaceSelection);

const point = (lon: number, lat: number, properties: TapFeature['properties']): TapFeature => ({
  properties,
  geometry: { type: 'Point', coordinates: [lon, lat] },
});

function tapWith(results: { symbols?: TapFeature[]; areas?: TapFeature[]; dots?: TapFeature[] }) {
  const query = jest.fn(async (reach: number, layers: readonly string[]) => {
    if (layers === ISRAEL_SYMBOL_LAYERS) return results.symbols ?? [];
    if (layers === ISRAEL_AREA_LAYERS) return results.areas ?? [];
    return results.dots ?? [];
  });
  const tap: MapTap = { lngLat: { lng: 34.8, lat: 32 }, query };
  return { tap, query };
}
const israel = { data: { points: [], segments: [], airspaces: [{ id: 5 }], aerodromes: [] }, closures: new Map() } as never;

beforeEach(() => {
  fromFeature.mockReset();
  airspaces.mockReset();
});

describe('what a tap on the map opens', () => {
  it('an airport dot opens the airport column (its icao), a weather dot its station', async () => {
    const { tap, query } = tapWith({ dots: [point(34.8, 32, { icao: 'KSQL' })] });
    expect(await resolveMapTap(tap, null)).toEqual({ kind: 'airport', icao: 'KSQL' });
    expect(query).toHaveBeenCalledWith(DOT_TAP_REACH, DOT_LAYERS);
    const station = tapWith({ dots: [point(34.8, 32, { stationID: 'KOAK' })] });
    expect(await resolveMapTap(station.tap, null)).toEqual({ kind: 'airport', icao: 'KOAK' });
  });

  it('nothing under the finger opens nothing', async () => {
    expect(await resolveMapTap(tapWith({}).tap, null)).toBeNull();
    expect(await resolveMapTap(tapWith({ dots: [point(1, 1, {})] }).tap, null)).toBeNull();
  });

  it('outside Israel (no chart data) the chart layers are never asked', async () => {
    const { tap, query } = tapWith({ dots: [point(1, 1, { icao: 'KSQL' })] });
    await resolveMapTap(tap, null);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('the nearest chart symbol within 26 pt wins; a reporting point opens the chart sheet', async () => {
    const selection = { kind: 'point', detail: { code: 'DEROR' } };
    fromFeature.mockReturnValue(selection as never);
    const near = point(34.8, 32.0001, { id: 1 });
    const far = point(34.9, 32.1, { id: 2 });
    const { tap, query } = tapWith({ symbols: [far, near] });
    expect(await resolveMapTap(tap, israel)).toEqual({ kind: 'israelChart', selection });
    expect(query).toHaveBeenCalledWith(CHART_TAP_REACH, ISRAEL_SYMBOL_LAYERS);
    expect(fromFeature).toHaveBeenCalledWith({ id: 1 }, expect.anything(), expect.anything());
  });

  it('an aerodrome symbol (or an ARP the database knows) opens the airport column, not a sheet', async () => {
    fromFeature.mockReturnValue({ kind: 'aerodrome', code: 'LLHZ' });
    const { tap } = tapWith({ symbols: [point(34.8, 32, { id: 3 })] });
    expect(await resolveMapTap(tap, israel)).toEqual({ kind: 'airport', icao: 'LLHZ' });
  });

  it('a symbol the data does not know but that carries a code is that aerodrome', async () => {
    fromFeature.mockReturnValue(null);
    const { tap } = tapWith({ symbols: [point(34.8, 32, { code: 'LLSD' })] });
    expect(await resolveMapTap(tap, israel)).toEqual({ kind: 'airport', icao: 'LLSD' });
  });

  it('no symbol: the airspaces under the finger open the chart sheet', async () => {
    const selection = { kind: 'airspaces', details: [] };
    airspaces.mockReturnValue(selection as never);
    const { tap, query } = tapWith({ areas: [{ properties: { id: 5 } }, { properties: { id: 'x' } }] });
    expect(await resolveMapTap(tap, israel)).toEqual({ kind: 'israelChart', selection });
    expect(query).toHaveBeenCalledWith(0, ISRAEL_AREA_LAYERS);
    expect(airspaces).toHaveBeenCalledWith([5], expect.anything());
  });

  it('with no chart feature under the finger it falls through to the airport dots', async () => {
    airspaces.mockReturnValue(null);
    const { tap } = tapWith({ dots: [point(34.8, 32, { icao: 'LLHZ' })] });
    expect(await resolveMapTap(tap, israel)).toEqual({ kind: 'airport', icao: 'LLHZ' });
  });
});
