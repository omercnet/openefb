// Tests for IsraelChartStore and IsraelDiagramStore (the Swift stores have no tests; behaviour follows the Swift code).
// Focus: download ownership (pause, remove, replace), refresh failure, once-per-launch verification, served-edition gate.
import { fakeFetch, MemoryTextStorage, type StubReply } from '../testSupport';
import { ChartPackService, NO_RETRY } from './chartPackService';
import { DIAGRAM_SERVED_EDITION_KEY, IsraelChartStore, IsraelDiagramStore } from './chartStores';
import { DownloadSlot } from './downloadSlot';
import { bytesOf, MemoryFileSystem, nodeSha256, ScriptedDownloader, type ScriptedReply } from './testSupport';

const pack = Uint8Array.from({ length: 3000 }, (_, i) => (i * 13 + 5) & 0xff);
const ROOT = '/root';
const BASE = 'https://charts.example.test';

const manifest = (
  product: string,
  edition: string,
  opts: { validated?: boolean; file?: string; bytes?: Uint8Array } = {},
) => {
  const bytes = opts.bytes ?? pack;
  const file = opts.file ?? (product === 'israel-cvfr' ? `israel-cvfr-${edition}.mbtiles` : 'index.json');
  return JSON.stringify({
    product,
    edition,
    published: true,
    validation: { passed: opts.validated ?? true },
    files: [{ name: file, bytes: bytes.length, sha256: nodeSha256(bytes) }],
  });
};

function host(
  product: string,
  state: { latest: string | null; validated?: boolean; bytes?: Uint8Array; offline?: boolean },
) {
  return fakeFetch((url): StubReply => {
    if (state.offline) throw new TypeError('Network request failed');
    if (url.endsWith(`/${product}/manifest.json`)) {
      return {
        body: JSON.stringify({
          product,
          latest: state.latest,
          editions: state.latest ? [{ edition: state.latest, published: true }] : [],
        }),
      };
    }
    const edition = /\/([^/]+)\/manifest\.json$/.exec(url)?.[1] ?? '';
    return { body: manifest(product, edition, { validated: state.validated, bytes: state.bytes }) };
  });
}

function make(
  product: string,
  fs: MemoryFileSystem,
  fetch: ReturnType<typeof host>,
  handler?: (n: number) => Promise<ScriptedReply> | ScriptedReply,
) {
  const downloader = new ScriptedDownloader(fs, (_req, call) =>
    handler ? handler(call) : { status: 200, body: pack },
  );
  const service = new ChartPackService({
    product,
    baseUrl: BASE,
    root: ROOT,
    fs,
    fetch,
    downloader,
    retry: NO_RETRY,
    now: () => 5,
  });
  return { service, downloader };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

async function settle(store: { isDownloading: boolean }) {
  for (let i = 0; i < 200 && store.isDownloading; i++) await flush();
}

// MARK: IsraelChartStore

test('chart store: refresh finds the latest edition, download installs it, status follows', async () => {
  const fs = new MemoryFileSystem();
  const { service } = make('israel-cvfr', fs, host('israel-cvfr', { latest: '2025-02' }));
  const store = await IsraelChartStore.open({ service });
  expect(store.status.kind).toBe('notDownloaded');
  expect(store.packPath).toBeNull();

  await store.refresh();
  expect(store.latest?.edition).toBe('2025-02');
  expect(store.checkFailed).toBe(false);
  expect(store.offeredBytes).toBe(pack.length);

  const seen: (number | null)[] = [];
  store.subscribe(() => seen.push(store.downloadProgress));
  store.startDownload();
  expect(store.isDownloading).toBe(true);
  await settle(store);
  expect(store.installed?.edition).toBe('2025-02');
  expect(store.status).toEqual({ kind: 'installed', edition: '2025-02', label: '2025-02' });
  expect(store.packPath).toBe(`${ROOT}/israel-cvfr/2025-02/israel-cvfr-2025-02.mbtiles`);
  expect(store.errorMessage).toBeNull();
  expect(seen[seen.length - 1]).toBeNull();
});

test('chart store: an unreachable host keeps the installed pack and flags the failed check', async () => {
  const fs = new MemoryFileSystem();
  const online = host('israel-cvfr', { latest: '2025-02' });
  const first = await IsraelChartStore.open({ service: make('israel-cvfr', fs, online).service });
  await first.refresh();
  first.startDownload();
  await settle(first);

  const offline = await IsraelChartStore.open({
    service: make('israel-cvfr', fs, host('israel-cvfr', { latest: null, offline: true })).service,
  });
  expect(offline.installed?.edition).toBe('2025-02');
  await offline.refresh();
  expect(offline.checkFailed).toBe(true);
  expect(offline.latest).toBeNull();
  expect(offline.status.kind).toBe('installed');
  expect(offline.isChecking).toBe(false);
});

test('chart store: a corrupt installed pack is removed once per launch and the pilot is told', async () => {
  const fs = new MemoryFileSystem();
  const f = host('israel-cvfr', { latest: '2025-02' });
  const a = await IsraelChartStore.open({ service: make('israel-cvfr', fs, f).service });
  await a.refresh();
  a.startDownload();
  await settle(a);
  const path = `${ROOT}/israel-cvfr/2025-02/israel-cvfr-2025-02.mbtiles`;
  const flipped = Uint8Array.from(fs.files.get(path) ?? []);
  flipped[3] ^= 0xff;
  fs.put(path, flipped);

  const b = await IsraelChartStore.open({ service: make('israel-cvfr', fs, f).service });
  expect(b.installed).not.toBeNull(); // the size check alone passes
  await b.refresh();
  expect(b.installed).toBeNull();
  expect(b.errorMessage).toMatch(/corrupt|damaged|verify|chart/i);
  const hashedBefore = fs.hashed.length;
  await b.refresh();
  expect(fs.hashed.length).toBe(hashedBefore); // verified once per launch
});

test('chart store: pause keeps the partial file and records the fraction; start resumes', async () => {
  const fs = new MemoryFileSystem();
  let release: (r: ScriptedReply) => void = () => undefined;
  const { service, downloader } = make('israel-cvfr', fs, host('israel-cvfr', { latest: '2025-02' }), (call) =>
    call === 1 ? new Promise<ScriptedReply>((resolve) => (release = resolve)) : { status: 206, body: pack.slice(1000) },
  );
  const store = await IsraelChartStore.open({ service });
  await store.refresh();
  store.startDownload();
  await flush();
  fs.put(`${ROOT}/israel-cvfr/.partial-2025-02/israel-cvfr-2025-02.mbtiles`, pack.slice(0, 1000));
  await Promise.all([
    store.pauseDownload(),
    Promise.resolve().then(() => release({ status: 206, body: new Uint8Array() })),
  ]);
  expect(store.isDownloading).toBe(false);
  expect(store.pausedProgress).toBe(0);
  expect(store.installed).toBeNull();
  expect(store.errorMessage).toBeNull();

  store.startDownload();
  await settle(store);
  expect(store.pausedProgress).toBeNull();
  expect(downloader.requests[1].rangeStart).toBe(1000);
  expect(store.installed?.edition).toBe('2025-02');
});

test('chart store: remove during a download leaves nothing behind and the late finish cannot reinstall', async () => {
  const fs = new MemoryFileSystem();
  let release: (r: ScriptedReply) => void = () => undefined;
  const { service } = make(
    'israel-cvfr',
    fs,
    host('israel-cvfr', { latest: '2025-02' }),
    () => new Promise<ScriptedReply>((resolve) => (release = resolve)),
  );
  const store = await IsraelChartStore.open({ service });
  await store.refresh();
  store.startDownload();
  await flush();
  const removal = store.remove();
  release({ status: 200, body: pack });
  await removal;
  await flush();
  expect(store.installed).toBeNull();
  expect(store.isDownloading).toBe(false);
  expect(store.errorMessage).toBeNull();
  expect(fs.files.size).toBe(0);
});

test('chart store: a failed download reports the error and can be retried; a second start while running is ignored', async () => {
  const fs = new MemoryFileSystem();
  let fail = true;
  const { service, downloader } = make('israel-cvfr', fs, host('israel-cvfr', { latest: '2025-02' }), () =>
    fail ? { status: 404 } : { status: 200, body: pack },
  );
  const store = await IsraelChartStore.open({ service });
  await store.refresh();
  store.startDownload();
  store.startDownload();
  await settle(store);
  expect(downloader.requests).toHaveLength(1);
  expect(store.errorMessage).not.toBeNull();
  expect(store.installed).toBeNull();
  fail = false;
  store.startDownload();
  expect(store.errorMessage).toBeNull();
  await settle(store);
  expect(store.installed?.edition).toBe('2025-02');
});

test('chart store: startDownload does nothing without a latest edition, and an overtaken refresh is dropped', async () => {
  const fs = new MemoryFileSystem();
  const { service } = make('israel-cvfr', fs, host('israel-cvfr', { latest: null }));
  const store = await IsraelChartStore.open({ service });
  store.startDownload();
  expect(store.isDownloading).toBe(false);

  let indexCalls = 0;
  const slow = fakeFetch(async (url): Promise<StubReply> => {
    if (url.endsWith('/israel-cvfr/manifest.json')) {
      indexCalls += 1;
      const first = indexCalls === 1;
      if (first) await new Promise((r) => setTimeout(r, 20));
      return { body: JSON.stringify({ product: 'israel-cvfr', latest: first ? '2025-01' : '2025-02', editions: [] }) };
    }
    return { body: manifest('israel-cvfr', url.includes('2025-01') ? '2025-01' : '2025-02') };
  });
  const s2 = await IsraelChartStore.open({ service: make('israel-cvfr', fs, slow as ReturnType<typeof host>).service });
  const older = s2.refresh();
  await flush();
  const newer = s2.refresh();
  await Promise.all([older, newer]);
  expect(s2.latest?.edition).toBe('2025-02');
  expect(s2.isChecking).toBe(false);
});

// MARK: IsraelDiagramStore

const indexBytes = bytesOf(
  JSON.stringify({
    product: 'il-diagrams',
    edition: '2026-08',
    editionLabel: 'L',
    aipDate: '2026-08-06',
    accuracyFeet: 100,
    aerodromes: {
      LLHA: { chart: 'c', language: 'en', scale: 's', georeferenced: false, reason: 'r', sheet: 'LLHA.pdf' },
    },
  }),
);

test('diagram store: download of a servable edition records it as served and loads the pack', async () => {
  const fs = new MemoryFileSystem();
  const storage = new MemoryTextStorage();
  const f = host('il-diagrams', { latest: '2026-08', bytes: indexBytes });
  const { service } = make('il-diagrams', fs, f, () => ({ status: 200, body: indexBytes }));
  const store = await IsraelDiagramStore.open({ service, fs, storage });
  expect(store.pack).toBeNull();
  await store.refresh();
  expect(store.canDownload).toBe(true);
  store.startDownload();
  await settle(store);
  expect(storage.files.get(DIAGRAM_SERVED_EDITION_KEY)).toBe('2026-08');
  expect(store.pack?.edition).toBe('2026-08');
  expect(store.canDownload).toBe(false);
  expect(store.availability('LLHA').kind).toBe('none'); // its sheet file is not in this pack

  // A new launch reads the served edition back.
  const again = await IsraelDiagramStore.open({ service: make('il-diagrams', fs, f).service, fs, storage });
  expect(again.pack?.edition).toBe('2026-08');
});

test('diagram store: an edition not served at download stays hidden unless the developer setting lifts the gate', async () => {
  const fs = new MemoryFileSystem();
  const f = host('il-diagrams', { latest: '2026-08', validated: false, bytes: indexBytes });
  const { service } = make('il-diagrams', fs, f, () => ({ status: 200, body: indexBytes }));
  const store = await IsraelDiagramStore.open({ service, fs, allowUnpublished: () => false });
  // An unvalidated edition is never offered to pilots.
  await store.refresh();
  expect(store.latest).toBeNull();

  const dev = await IsraelDiagramStore.open({
    service: make('il-diagrams', fs, f, () => ({ status: 200, body: indexBytes })).service,
    fs,
    allowUnpublished: () => true,
  });
  await dev.refresh();
  dev.startDownload();
  await settle(dev);
  expect(dev.pack?.edition).toBe('2026-08'); // developer setting
  const release = await IsraelDiagramStore.open({
    service: make('il-diagrams', fs, f).service,
    fs,
    allowUnpublished: () => false,
  });
  expect(release.pack).toBeNull(); // never served to a pilot
});

test('diagram store: a failed host check keeps latest null; a failed download shows the error', async () => {
  const fs = new MemoryFileSystem();
  const store = await IsraelDiagramStore.open({
    service: make('il-diagrams', fs, host('il-diagrams', { latest: null, offline: true })).service,
    fs,
  });
  await store.refresh();
  expect(store.latest).toBeNull();
  expect(store.isChecking).toBe(false);

  const f = host('il-diagrams', { latest: '2026-08', bytes: indexBytes });
  const bad = await IsraelDiagramStore.open({
    service: make('il-diagrams', fs, f, () => ({ status: 500 })).service,
    fs,
  });
  await bad.refresh();
  bad.startDownload();
  await settle(bad);
  expect(bad.errorMessage).not.toBeNull();
  expect(bad.pack).toBeNull();
});

// MARK: DownloadSlot

test('DownloadSlot: one run at a time; an invalidated run sees isCurrent false; abort waits for the run to stop', async () => {
  const slot = new DownloadSlot();
  const events: string[] = [];
  let finish: () => void = () => undefined;
  expect(
    slot.start(async (signal, isCurrent) => {
      await new Promise<void>((resolve) => (finish = resolve));
      events.push(`aborted=${signal.aborted} current=${isCurrent()}`);
    }),
  ).toBe(true);
  expect(slot.start(async () => undefined)).toBe(false);
  const aborting = slot.abort({ invalidate: true });
  finish();
  await aborting;
  expect(events).toEqual(['aborted=true current=false']);
  expect(slot.active).toBe(false);
  expect(slot.start(async () => undefined)).toBe(true);
});

test('DownloadSlot: a throwing run frees the slot and does not leak a rejection', async () => {
  const slot = new DownloadSlot();
  slot.start(async () => {
    throw new Error('boom');
  });
  await slot.abort();
  await flush();
  expect(slot.active).toBe(false);
});
