// M5: the overlay's pack source for US airports, over the installed `us-diagrams` pack (S1c format) and the aviation
// database, and the region router that picks it or the Israel source. A diagram that is not in the pack, is unreadable
// or has a malformed quad is "unavailable": a wrong overlay is worse than none.
import type { AviationDatabase } from '../data/aviation';
import type { AirportDiagramGeoreference } from '../services/charts/diagramGeoreference';
import { IsraelDiagramPack, type DiagramIndexRecord } from '../services/charts/diagramPack';
import { bytesOf, MemoryFileSystem } from '../services/charts/testSupport';
import type { DiagramPackSource } from '../domain/diagram/overlayController';
import { createDiagramSource } from './diagramSource';
import { createUsDiagramSource } from './usDiagramSource';

const rec = (icao: string): DiagramIndexRecord => ({
  chart: `${icao}.PDF`,
  language: 'en',
  scale: 'as charted',
  georeferenced: true,
  reason: 'accepted',
  sheet: '',
  image: `${icao}.png`,
  georeference: `${icao}.json`,
});
const page = { x: 0, y: 0, width: 1000, height: 700 };
const geo = (lat: number, lon: number): AirportDiagramGeoreference => ({
  a: 2,
  b: 0,
  c: 0,
  d: 2,
  tx: -1000,
  ty: -700,
  reference: page,
  referenceLatitude: lat,
  referenceLongitude: lon,
  pageBox: page,
  clipBox: page,
  masks: [],
  diagnostics: {
    method: 'gridRunwayChecked',
    labelSource: 'text',
    latitudeLabels: 2,
    longitudeLabels: 2,
    rotationDegrees: 0,
    feetPerPoint: 6.5,
    scaleRatio: 1,
    runwaysMatched: 2,
    runwayResidualFeet: 20,
    runwayMidpointFeet: 15,
    runwayEndFeet: 30,
    runwayBestMidpointFeet: 5,
    runwayMedianMidpointFeet: 12,
    maskedInsets: 0,
  },
});
const AIRPORTS: Record<string, { icao: string; type?: string; latitude: number; longitude: number }> = {
  KPAO: { icao: 'KPAO', latitude: 37.4611, longitude: -122.115 },
  KSFO: { icao: 'KSFO', latitude: 37.6213, longitude: -122.379 },
  KBOS: { icao: 'KBOS', latitude: 42.3643, longitude: -71.0052 },
  KXXX: { icao: 'KXXX', latitude: 37.47, longitude: -122.12 }, // in the database, not in the pack
  KHLI: { icao: 'KPAO', type: 'heliport', latitude: 37.46, longitude: -122.11 }, // a pack id on a non-airport row
};

function setup(
  opts: { wholeDatabase?: boolean; missingPng?: string; badJson?: string; noPack?: boolean; failNear?: boolean } = {},
) {
  const pack = new IsraelDiagramPack(
    {
      product: 'us-diagrams',
      edition: '2611',
      editionLabel: 'd-TPP cycle 2611 (12 NOV 2026)',
      aipDate: '2026-11-12',
      accuracyFeet: 50,
      aerodromes: { KPAO: rec('KPAO'), KSFO: rec('KSFO'), KBOS: rec('KBOS') },
    },
    (name) => `/us/${name}`,
  );
  const fs = new MemoryFileSystem();
  for (const icao of ['KPAO', 'KSFO', 'KBOS']) {
    const a = AIRPORTS[icao]!;
    fs.put(
      `/us/${icao}.json`,
      bytesOf(icao === opts.badJson ? '{"a":1}' : JSON.stringify(geo(a.latitude, a.longitude))),
    );
    if (icao !== opts.missingPng) fs.put(`/us/${icao}.png`, new Uint8Array([1]));
  }
  const calls: { lat: number; lon: number; radius: number }[] = [];
  const aviation: Pick<AviationDatabase, 'airportsNear'> = {
    airportsNear: async (center, radius) => {
      calls.push({ ...center, radius });
      if (opts.failNear) throw new Error('db down');
      if (opts.wholeDatabase) return Object.values(AIRPORTS).map((a) => ({ type: 'airport', ...a })) as never; // a box can return airports beyond the circle
      const dLat = radius / 60;
      return Object.values(AIRPORTS)
        .map((a) => ({ type: 'airport', ...a }))
        .filter(
          (a) => Math.abs(a.latitude - center.lat) <= dLat && Math.abs(a.longitude - center.lon) <= dLat * 1.5,
        ) as never;
    },
  };
  const source = createUsDiagramSource({ loadPack: async () => (opts.noPack ? null : pack), fs, aviation });
  return { source, calls };
}

describe('US diagram source', () => {
  it('offers only airports near the camera that the pack can draw', async () => {
    const { source, calls } = setup();
    const near = await source.candidates('us', { lat: 37.5, lon: -122.2 }, 30);
    expect(near.map((c) => c.icao).sort()).toEqual(['KPAO', 'KSFO']); // KXXX is in the database but not in the pack
    expect(near.find((c) => c.icao === 'KPAO')?.position).toEqual({ lat: 37.4611, lon: -122.115 });
    expect(calls).toEqual([{ lat: 37.5, lon: -122.2, radius: 30 }]);
  });

  it('offers only airports, not a heliport row that carries a pack id', async () => {
    const { source } = setup({ wholeDatabase: true });
    const near = await source.candidates('us', { lat: 37.46, lon: -122.11 }, 5);
    expect(near).toEqual([expect.objectContaining({ icao: 'KPAO', position: { lat: 37.4611, lon: -122.115 } })]);
  });

  it('cuts the database box to the requested radius', async () => {
    const { source } = setup({ wholeDatabase: true });
    const near = await source.candidates('us', { lat: 37.5, lon: -122.2 }, 5);
    expect(near.map((c) => c.icao)).toEqual(['KPAO']); // KSFO is about 11 NM away, KBOS across the country
  });

  it('offers nothing for another region, without the pack, or when the database fails', async () => {
    expect(await setup().source.candidates('israel', { lat: 37.5, lon: -122.2 }, 30)).toEqual([]);
    expect(await setup({ noPack: true }).source.candidates('us', { lat: 37.5, lon: -122.2 }, 30)).toEqual([]);
    await expect(setup({ failNear: true }).source.candidates('us', { lat: 37.5, lon: -122.2 }, 30)).rejects.toThrow(
      'db down',
    ); // the controller retries a rejected lookup later
  });

  it('draws a placed diagram from its four corners', async () => {
    const { source } = setup();
    const r = await source.diagramFor('us', 'KPAO');
    if (r.kind !== 'ready') throw new Error(`expected ready, got ${r.reason}`);
    expect(r.image.imageUri).toBe('file:///us/KPAO.png');
    expect(r.image.coordinates).toHaveLength(4);
    const [tl, tr, br, bl] = r.image.coordinates as [number, number][];
    expect(tl[1]).toBeGreaterThan(bl[1]); // top is north of bottom
    expect(tr[0]).toBeGreaterThan(tl[0]); // right is east of left
    expect(br[0]).toBeGreaterThan(bl[0]);
  });

  it('says why a diagram is unavailable instead of guessing', async () => {
    expect((await setup().source.diagramFor('us', 'KXXX')).kind).toBe('unavailable');
    expect(await setup().source.diagramFor('israel', 'KPAO')).toMatchObject({ kind: 'unavailable' });
    expect(await setup({ noPack: true }).source.diagramFor('us', 'KPAO')).toMatchObject({
      reason: 'diagram pack not installed',
    });
    expect(await setup({ badJson: 'KPAO' }).source.diagramFor('us', 'KPAO')).toMatchObject({
      reason: 'georeference unreadable',
    });
    expect((await setup({ missingPng: 'KPAO' }).source.diagramFor('us', 'KPAO')).kind).toBe('unavailable');
  });
});

describe('diagram source router', () => {
  const stub = (tag: string): DiagramPackSource => ({
    candidates: async () => [{ icao: tag, position: { lat: 0, lon: 0 } }],
    diagramFor: async () => ({ kind: 'unavailable', reason: tag }),
  });

  it('sends each region to its own pack and draws nothing for a region without one', async () => {
    const router = createDiagramSource({ israel: stub('IL'), us: stub('US') });
    expect((await router.candidates('us', { lat: 0, lon: 0 }, 1))[0]?.icao).toBe('US');
    expect((await router.candidates('israel', { lat: 0, lon: 0 }, 1))[0]?.icao).toBe('IL');
    expect(await router.diagramFor('us', 'KPAO')).toMatchObject({ reason: 'US' });
    expect(await router.diagramFor('israel', 'LLBG')).toMatchObject({ reason: 'IL' });
  });
});
