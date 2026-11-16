import { fakeFetch, MemoryTextStorage, type StubReply } from '../../services/testSupport';
import { ChartPackService, NO_RETRY } from '../../services/charts/chartPackService';
import { IsraelChartStore, IsraelDiagramStore } from '../../services/charts/chartStores';
import { bytesOf, MemoryFileSystem, nodeSha256, ScriptedDownloader } from '../../services/charts/testSupport';
import { israelChartStoreLike, israelDiagramStoreLike, openChartPacks } from './chartPacks';

const pack = Uint8Array.from({ length: 2000 }, (_, i) => (i * 7 + 3) & 0xff);
const INDEX = bytesOf(
  JSON.stringify({
    product: 'il-diagrams',
    edition: '2025-02',
    editionLabel: 'Update 2/25',
    aipDate: '2025-02-01',
    accuracyFeet: 60,
    aerodromes: {},
  }),
);

const host = (product: string, bytes: Uint8Array, file: string) =>
  fakeFetch((url): StubReply => {
    if (url.endsWith(`/${product}/manifest.json`)) {
      return {
        body: JSON.stringify({ product, latest: '2025-02', editions: [{ edition: '2025-02', published: true }] }),
      };
    }
    return {
      body: JSON.stringify({
        product,
        edition: '2025-02',
        edition_label: 'Update 2/25',
        published: true,
        validation: { passed: true },
        files: [{ name: file, bytes: bytes.length, sha256: nodeSha256(bytes) }],
      }),
    };
  });

const service = (product: string, fs: MemoryFileSystem, bytes: Uint8Array, file: string) =>
  new ChartPackService({
    product,
    baseUrl: 'https://charts.example.test',
    root: '/root',
    fs,
    fetch: host(product, bytes, file),
    downloader: new ScriptedDownloader(fs, () => ({ status: 200, body: bytes })),
    retry: NO_RETRY,
    now: () => 5,
  });

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

describe('the chart pack stores as Settings reads them', () => {
  it('the CVFR chart: not downloaded, then an offered edition, then installed; the snapshot is stable between changes', async () => {
    const fs = new MemoryFileSystem();
    const store = await IsraelChartStore.open({
      service: service('israel-cvfr', fs, pack, 'israel-cvfr-2025-02.mbtiles'),
    });
    const like = israelChartStoreLike(store);
    expect(like.getSnapshot().status).toEqual({ kind: 'notDownloaded' });
    expect(like.getSnapshot()).toBe(like.getSnapshot());
    const seen = jest.fn();
    like.subscribe(seen);
    await like.refresh();
    expect(seen).toHaveBeenCalled();
    expect(like.getSnapshot()).toMatchObject({
      latestLabel: 'Update 2/25',
      offeredBytes: pack.length,
      installedBytes: null,
    });
    like.startDownload();
    for (let i = 0; i < 200 && store.isDownloading; i++) await flush();
    expect(like.getSnapshot().status).toEqual({ kind: 'installed', label: 'Update 2/25' });
    expect(like.getSnapshot().installedBytes).toBe(pack.length);
    like.remove();
    await flush();
    expect(like.getSnapshot().status).toEqual({ kind: 'notDownloaded' });
  });

  it('the aerodrome diagrams: can download the offered edition, then show the installed pack', async () => {
    const fs = new MemoryFileSystem();
    const store = await IsraelDiagramStore.open({
      service: service('il-diagrams', fs, INDEX, 'index.json'),
      fs,
      storage: new MemoryTextStorage(),
    });
    const like = israelDiagramStoreLike(store);
    expect(like.getSnapshot()).toMatchObject({ pack: null, canDownload: false });
    await like.refresh();
    expect(like.getSnapshot()).toMatchObject({ latestLabel: 'Update 2/25', canDownload: true });
    like.startDownload();
    for (let i = 0; i < 200 && store.downloadProgress !== null; i++) await flush();
    const state = like.getSnapshot();
    expect(state.pack).toMatchObject({ editionLabel: 'Update 2/25', accuracyFeet: 60, georeferencedICAOs: [] });
    expect(state.canDownload).toBe(false);
  });
});

describe('openChartPacks', () => {
  it('opens the three products and a source that answers per region without a pack', async () => {
    const fs = new MemoryFileSystem();
    const packs = await openChartPacks({
      fetch: fakeFetch(() => ({ status: 404, body: '' })),
      fs,
      downloader: new ScriptedDownloader(fs, () => ({ status: 404, body: new Uint8Array() })),
      storage: new MemoryTextStorage(),
      root: '/root',
      aviation: null,
      israel: null,
    });
    expect(packs.israelChart.status.kind).toBe('notDownloaded');
    expect(packs.israelDiagrams.pack).toBeNull();
    expect(packs.usDiagrams.pack).toBeNull();
    expect(await packs.diagramSource.candidates('israel', { lat: 32, lon: 34.8 }, 5)).toEqual([]);
    expect(await packs.diagramSource.candidates('us', { lat: 37, lon: -122 }, 5)).toEqual([]);
  });
});
