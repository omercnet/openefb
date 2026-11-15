// M5b: US diagrams on demand (Swift AirportDiagramOverlay.load: each airport's diagram is fetched when the map shows it,
// cached per chart cycle, and a load error is retried later, never final). Here the cycle's `us-diagrams` edition is
// published as the S1c layout `<base>/us-diagrams/<cycle>/<file>`; the source reads the edition manifest and index.json
// once, then downloads only the PNG and georeference JSON of airports in view. An installed full pack is preferred.
import type { AviationDatabase } from '../data/aviation';
import { AppFailure } from '../domain/errors';
import { ChartPackService, NO_RETRY } from '../services/charts/chartPackService';
import type { AirportDiagramGeoreference } from '../services/charts/diagramGeoreference';
import { IsraelDiagramPack, type DiagramIndexRecord } from '../services/charts/diagramPack';
import { bytesOf, MemoryFileSystem, nodeSha256, ScriptedDownloader } from '../services/charts/testSupport';
import { fakeFetch } from '../services/testSupport';
import { createOnDemandUsDiagramSource } from './usDiagramOnDemand';

const BASE = 'https://charts.example.test';
const CACHE = '/cache/us-diagrams-ondemand';
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
const AIRPORTS: Record<string, { icao: string; type: string; latitude: number; longitude: number }> = {
  KPAO: { icao: 'KPAO', type: 'airport', latitude: 37.4611, longitude: -122.115 },
  KBOS: { icao: 'KBOS', type: 'airport', latitude: 42.3643, longitude: -71.0052 },
  KXXX: { icao: 'KXXX', type: 'airport', latitude: 37.47, longitude: -122.12 }, // in the index, not placed
};
const rec = (icao: string, georeferenced: boolean): DiagramIndexRecord => ({
  chart: `${icao}.PDF`,
  language: 'en',
  scale: 'as charted',
  georeferenced,
  reason: georeferenced ? 'accepted' : 'rejected',
  sheet: '',
  image: georeferenced ? `${icao}.png` : null,
  georeference: georeferenced ? `${icao}.json` : null,
});

interface Edition {
  edition: string;
  files: Record<string, Uint8Array>;
  manifest: string;
}

function makeEdition(
  edition = '2611',
  opts: { badSha?: string; brokenGeoreference?: string; published?: boolean; declared?: Record<string, number> } = {},
): Edition {
  const files: Record<string, Uint8Array> = {};
  for (const icao of ['KPAO', 'KBOS']) {
    files[`${icao}.png`] = new Uint8Array([0x89, 0x50, icao === 'KPAO' ? 1 : 2]);
    const a = AIRPORTS[icao]!;
    files[`${icao}.json`] = bytesOf(
      icao === opts.brokenGeoreference ? '{"a":1}' : JSON.stringify(geo(a.latitude, a.longitude)),
    );
  }
  files['index.json'] = bytesOf(
    JSON.stringify({
      product: 'us-diagrams',
      edition,
      editionLabel: `d-TPP cycle ${edition} (29 OCT 2026)`,
      aipDate: '2026-10-29',
      accuracyFeet: 50,
      aerodromes: { KPAO: rec('KPAO', true), KBOS: rec('KBOS', true), KXXX: rec('KXXX', false) },
    }),
  );
  const list = Object.entries(files).map(([name, data]) => ({
    name,
    bytes: opts.declared?.[name] ?? data.length,
    sha256: name === opts.badSha ? '0'.repeat(64) : nodeSha256(data),
  }));
  const manifest = JSON.stringify({
    product: 'us-diagrams',
    edition,
    edition_label: `d-TPP cycle ${edition} (29 OCT 2026)`,
    published: opts.published ?? true,
    publishedAt: '2026-11-02T08:00:00Z',
    validated_at: '2026-11-01T12:00:00Z',
    validation: { passed: true, max_m: 9 },
    files: list,
  });
  return { edition, files, manifest };
}

interface Host {
  latest: Edition | null;
  online: boolean;
}

function setup(
  host: Host,
  opts: {
    fs?: MemoryFileSystem;
    pack?: IsraelDiagramPack | null;
    loadPack?: () => Promise<IsraelDiagramPack | null>;
    allowUnpublished?: boolean;
    now?: () => number;
  } = {},
) {
  const fs = opts.fs ?? new MemoryFileSystem();
  const fetchedDocs: string[] = [];
  const fetch = fakeFetch((url) => {
    if (!host.online) throw new Error('offline');
    fetchedDocs.push(url.replace(BASE, ''));
    if (url === `${BASE}/us-diagrams/manifest.json`) {
      const e = host.latest;
      return {
        body: JSON.stringify({
          product: 'us-diagrams',
          updatedAt: '2026-11-02T08:00:00Z',
          latest: e ? e.edition : null,
          editions: e
            ? [{ edition: e.edition, published: true, publishedAt: null, validatedAt: '2026-11-01T12:00:00Z' }]
            : [],
        }),
      };
    }
    if (host.latest && url === `${BASE}/us-diagrams/${host.latest.edition}/manifest.json`)
      return { body: host.latest.manifest };
    return { status: 404 };
  });
  const downloaded: string[] = [];
  const downloader = new ScriptedDownloader(fs, (req) => {
    if (!host.online) throw new Error('offline');
    downloaded.push(req.url.replace(BASE, ''));
    const name = req.url.split('/').pop() ?? '';
    const data = host.latest?.files[name];
    return data ? { status: 200, body: data } : { status: 404 };
  });
  const service = new ChartPackService({
    product: 'us-diagrams',
    baseUrl: BASE,
    root: '/root',
    fs,
    fetch,
    downloader,
    retry: NO_RETRY,
    now: () => 1_000,
  });
  const aviation: Pick<AviationDatabase, 'airportsNear'> = {
    airportsNear: async () => Object.values(AIRPORTS) as never,
  };
  let clock = 1_000_000;
  const source = createOnDemandUsDiagramSource({
    service,
    fs,
    cacheDir: CACHE,
    loadPack: opts.loadPack ?? (async () => opts.pack ?? null),
    allowUnpublished: () => opts.allowUnpublished ?? false,
    aviation,
    now: opts.now ?? (() => clock),
    retryAfterMs: 300_000,
  });
  return { source, fs, fetchedDocs, downloaded, advance: (ms: number) => (clock += ms) };
}

describe('US diagrams on demand', () => {
  it('reads the manifest and index once, then fetches only the files of airports in view', async () => {
    const host: Host = { latest: makeEdition(), online: true };
    const { source, downloaded, fetchedDocs } = setup(host);
    const r = await source.diagramFor('us', 'KPAO');
    if (r.kind !== 'ready') throw new Error(`expected ready, got ${r.reason}`);
    expect(r.image.imageUri).toBe(`file://${CACHE}/2611/KPAO.png`);
    expect(r.image.coordinates).toHaveLength(4);
    expect(fetchedDocs).toEqual(['/us-diagrams/manifest.json', '/us-diagrams/2611/manifest.json']);
    expect(downloaded).toEqual([
      '/us-diagrams/2611/index.json',
      '/us-diagrams/2611/KPAO.json', // the georeference first: a bad one costs no image download
      '/us-diagrams/2611/KPAO.png',
    ]);

    await source.diagramFor('us', 'KPAO'); // cached: nothing more
    expect(downloaded).toHaveLength(3);
    expect((await source.diagramFor('us', 'KBOS')).kind).toBe('ready');
    expect(downloaded.slice(3)).toEqual(['/us-diagrams/2611/KBOS.json', '/us-diagrams/2611/KBOS.png']);
    expect(fetchedDocs).toHaveLength(2); // the edition was resolved once
  });

  it('draws from the cache with no network on the next launch, and rejects for an airport it never fetched', async () => {
    const host: Host = { latest: makeEdition(), online: true };
    const first = setup(host);
    await first.source.diagramFor('us', 'KPAO');
    host.online = false;
    const second = setup(host, { fs: first.fs });
    expect((await second.source.diagramFor('us', 'KPAO')).kind).toBe('ready');
    await expect(second.source.diagramFor('us', 'KBOS')).rejects.toBeInstanceOf(AppFailure); // retried later, not final
  });

  it('says unavailable, without downloading, for an airport the pack did not place or does not have', async () => {
    const host: Host = { latest: makeEdition(), online: true };
    const { source, downloaded } = setup(host);
    expect(await source.diagramFor('us', 'KXXX')).toMatchObject({ kind: 'unavailable', reason: 'not georeferenced' });
    expect((await source.diagramFor('us', 'KZZZ')).kind).toBe('unavailable');
    expect((await source.diagramFor('israel', 'LLBG')).kind).toBe('unavailable');
    expect(downloaded).toEqual(['/us-diagrams/2611/index.json']);
  });

  it('with no signal and no cache rejects, waits before trying again, then recovers', async () => {
    const host: Host = { latest: makeEdition(), online: false };
    const { source, fetchedDocs, advance } = setup(host);
    await expect(source.diagramFor('us', 'KPAO')).rejects.toBeInstanceOf(AppFailure);
    host.online = true;
    await expect(source.diagramFor('us', 'KPAO')).rejects.toBeInstanceOf(AppFailure); // inside the retry window: no request
    expect(fetchedDocs).toEqual([]);
    advance(300_001);
    expect((await source.diagramFor('us', 'KPAO')).kind).toBe('ready');
  });

  it('prefers an installed full pack and then needs no network at all', async () => {
    const host: Host = { latest: makeEdition(), online: false };
    const pack = new IsraelDiagramPack(
      {
        product: 'us-diagrams',
        edition: '2611',
        editionLabel: 'd-TPP cycle 2611 (29 OCT 2026)',
        aipDate: '2026-10-29',
        accuracyFeet: 50,
        aerodromes: { KPAO: rec('KPAO', true) },
      },
      (name) => `/pack/${name}`,
    );
    const { source, fs, downloaded, fetchedDocs } = setup(host, { pack });
    fs.put('/pack/KPAO.json', bytesOf(JSON.stringify(geo(37.4611, -122.115))));
    fs.put('/pack/KPAO.png', new Uint8Array([1]));
    const r = await source.diagramFor('us', 'KPAO');
    expect(r).toMatchObject({ kind: 'ready', image: { imageUri: 'file:///pack/KPAO.png' } });
    expect((await source.candidates('us', { lat: 37.5, lon: -122.2 }, 30)).map((c) => c.icao)).toEqual(['KPAO']);
    expect(downloaded).toEqual([]);
    expect(fetchedDocs).toEqual([]);
  });

  it('keeps one cycle: a new edition replaces the cached one', async () => {
    const host: Host = { latest: makeEdition('2611'), online: true };
    const first = setup(host);
    await first.source.diagramFor('us', 'KPAO');
    expect(first.fs.exists(`${CACHE}/2611/KPAO.png`)).toBe(true);
    host.latest = makeEdition('2612');
    const next = setup(host, { fs: first.fs });
    expect((await next.source.diagramFor('us', 'KPAO')).kind).toBe('ready');
    expect(first.fs.exists(`${CACHE}/2611/KPAO.png`)).toBe(false);
    expect(first.fs.exists(`${CACHE}/2612/KPAO.png`)).toBe(true);
  });

  it('never keeps or draws a file whose checksum is wrong', async () => {
    const host: Host = { latest: makeEdition('2611', { badSha: 'KPAO.png' }), online: true };
    const { source, fs } = setup(host);
    await expect(source.diagramFor('us', 'KPAO')).rejects.toMatchObject({ error: { kind: 'chartCorrupted' } });
    expect(fs.exists(`${CACHE}/2611/KPAO.png`)).toBe(false);
  });

  it('is unavailable when nothing is published or the georeference is unreadable', async () => {
    const none = setup({ latest: null, online: true });
    expect(await none.source.diagramFor('us', 'KPAO')).toMatchObject({ kind: 'unavailable' });
    expect(await none.source.candidates('us', { lat: 37.5, lon: -122.2 }, 30)).toEqual([]);
    const broken = setup({ latest: makeEdition('2611', { brokenGeoreference: 'KPAO' }), online: true });
    expect(await broken.source.diagramFor('us', 'KPAO')).toMatchObject({
      kind: 'unavailable',
      reason: 'georeference unreadable',
    });
    expect(broken.downloaded.some((u) => u.endsWith('KPAO.png'))).toBe(false); // no image for a diagram that cannot be placed
  });

  it('offers the airports in view that the edition placed, nothing without the index', async () => {
    const host: Host = { latest: makeEdition(), online: true };
    const { source } = setup(host);
    const near = await source.candidates('us', { lat: 37.5, lon: -122.2 }, 30);
    expect(near.map((c) => c.icao)).toEqual(['KPAO']); // KBOS is far, KXXX was not placed
    expect(await source.candidates('israel', { lat: 37.5, lon: -122.2 }, 30)).toEqual([]);
    const offline = setup({ latest: makeEdition(), online: false });
    expect(await offline.source.candidates('us', { lat: 37.5, lon: -122.2 }, 30)).toEqual([]);
  });

  it('serves a cached cycle with no signal only if it passes the published-edition gate', async () => {
    const host: Host = { latest: makeEdition(), online: true };
    const first = setup(host);
    await first.source.diagramFor('us', 'KPAO');
    // The cached manifest is now one that was never published (as after a developer build with the gate lifted).
    const path = `${CACHE}/current.json`;
    const stored = JSON.parse(new TextDecoder().decode(first.fs.files.get(path)!));
    first.fs.put(path, bytesOf(JSON.stringify({ ...stored, published: false })));
    host.online = false;
    const strict = setup(host, { fs: first.fs });
    await expect(strict.source.diagramFor('us', 'KPAO')).rejects.toBeInstanceOf(AppFailure);
    const lifted = setup(host, { fs: first.fs, allowUnpublished: true });
    expect((await lifted.source.diagramFor('us', 'KPAO')).kind).toBe('ready');
  });

  it('refuses files that declare an absurd size, before downloading or reading them', async () => {
    const GiB = 1024 ** 3;
    const bigIndex = setup({ latest: makeEdition('2611', { declared: { 'index.json': GiB } }), online: true });
    await expect(bigIndex.source.diagramFor('us', 'KPAO')).rejects.toMatchObject({
      error: { kind: 'chartDownloadFailed' },
    });
    expect(bigIndex.downloaded).toEqual([]);
    const bigGeo = setup({ latest: makeEdition('2611', { declared: { 'KPAO.json': GiB } }), online: true });
    expect(await bigGeo.source.diagramFor('us', 'KPAO')).toMatchObject({ kind: 'unavailable' });
    expect(bigGeo.downloaded.some((u) => u.endsWith('KPAO.json') || u.endsWith('KPAO.png'))).toBe(false);
  });

  it('reads the installed pack once per call, so a pack removed in between does not hide the diagram', async () => {
    const pack = new IsraelDiagramPack(
      {
        product: 'us-diagrams',
        edition: '2611',
        editionLabel: 'd-TPP cycle 2611 (29 OCT 2026)',
        aipDate: '2026-10-29',
        accuracyFeet: 50,
        aerodromes: { KPAO: rec('KPAO', true) },
      },
      (name) => `/pack/${name}`,
    );
    let reads = 0;
    const { source, fs } = setup(
      { latest: makeEdition(), online: false },
      { loadPack: async () => (++reads === 1 ? pack : null) },
    );
    fs.put('/pack/KPAO.json', bytesOf(JSON.stringify(geo(37.4611, -122.115))));
    fs.put('/pack/KPAO.png', new Uint8Array([1]));
    expect((await source.diagramFor('us', 'KPAO')).kind).toBe('ready');
    reads = 0;
    expect((await source.candidates('us', { lat: 37.5, lon: -122.2 }, 30)).map((c) => c.icao)).toEqual(['KPAO']);
    expect(reads).toBe(1);
  });

  it('never reuses a cached file whose contents changed, even at the same size', async () => {
    const host: Host = { latest: makeEdition(), online: true };
    const first = setup(host);
    await first.source.diagramFor('us', 'KPAO');
    const path = `${CACHE}/2611/KPAO.json`;
    const good = first.fs.files.get(path)!;
    const altered = good.slice();
    altered[altered.length - 3] = altered[altered.length - 3]! ^ 1; // same length, different bytes
    first.fs.files.set(path, altered);
    const next = setup(host, { fs: first.fs });
    expect((await next.source.diagramFor('us', 'KPAO')).kind).toBe('ready');
    expect(first.fs.files.get(path)).toEqual(good); // fetched again and verified
    expect(next.downloaded.some((u) => u.endsWith('KPAO.json'))).toBe(true);
  });

  it('rejects, to be retried, when a cached georeference cannot be read right now', async () => {
    const host: Host = { latest: makeEdition(), online: true };
    const first = setup(host);
    await first.source.diagramFor('us', 'KPAO');
    const next = setup(host, { fs: first.fs });
    const read = first.fs.readText.bind(first.fs);
    let fail = true;
    first.fs.readText = async (p: string) => {
      if (fail && p.endsWith('KPAO.json')) throw new Error('disk busy');
      return read(p);
    };
    await expect(next.source.diagramFor('us', 'KPAO')).rejects.toThrow('disk busy');
    fail = false;
    expect((await next.source.diagramFor('us', 'KPAO')).kind).toBe('ready');
  });

  it('keeps a cached file when it cannot be hashed right now, and rejects instead of deleting it', async () => {
    const host: Host = { latest: makeEdition(), online: true };
    const first = setup(host);
    await first.source.diagramFor('us', 'KPAO');
    const next = setup(host, { fs: first.fs });
    const hash = first.fs.hashFile.bind(first.fs);
    let fail = true;
    first.fs.hashFile = async (p, h) => {
      if (fail && p.endsWith('KPAO.json')) throw new Error('disk busy');
      return hash(p, h);
    };
    await expect(next.source.diagramFor('us', 'KPAO')).rejects.toThrow('disk busy');
    expect(first.fs.exists(`${CACHE}/2611/KPAO.json`)).toBe(true); // not deleted for a read error
    fail = false;
    expect((await next.source.diagramFor('us', 'KPAO')).kind).toBe('ready');
  });

  it('fails a missing cached georeference read with a machine-readable error', async () => {
    const host: Host = { latest: makeEdition(), online: true };
    const first = setup(host);
    await first.source.diagramFor('us', 'KPAO');
    const next = setup(host, { fs: first.fs });
    first.fs.readText = async (p: string) =>
      p.endsWith('KPAO.json') ? null : new TextDecoder().decode(first.fs.files.get(p));
    await expect(next.source.diagramFor('us', 'KPAO')).rejects.toMatchObject({
      error: { kind: 'chartDownloadFailed' },
    });
  });
});
