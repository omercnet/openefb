// Port of ServiceTests/IsraelChartServiceTests.swift (18 tests): manifest decoding, checksum verification, the
// published/validated rule, resume, edition-update detection and the fallback state. Network and disk are fakes.
import { AppFailure } from '../../domain/errors';
import { fakeFetch, type FakeFetch, type StubReply } from '../testSupport';
import { ChartPackService, isSafeName, NO_RETRY, retryDelayMs, type RetryPolicy } from './chartPackService';
import {
  chartBadgeText,
  compareNumeric,
  decodeChartIndex,
  decodeChartManifest,
  isServable,
  manifestLabel,
  manifestPack,
  manifestTotalBytes,
  resolveChartStatus,
  statusIsPresent,
  type ChartPackInstalled,
} from './manifest';
import { CancelledError } from './ports';
import { Sha256, sha256Hex } from './sha256';
import { bytesOf, MemoryFileSystem, nodeSha256, ScriptedDownloader, type ScriptedReply } from './testSupport';

const packBytes = Uint8Array.from({ length: 4000 }, (_, i) => (i * 31 + 7) & 0xff);
const BASE = 'https://charts.example.test';
const ROOT = '/root';

function manifestJSON(
  opts: { edition?: string; published?: boolean; validated?: boolean; sha256?: string; bytes?: number } = {},
): string {
  const { edition = '2025-02', published = true, validated = true } = opts;
  const bytes = opts.bytes ?? packBytes.length;
  return `{"product":"israel-cvfr","edition":"${edition}","edition_label":"Update 2/25 (October 2025)",
 "published":${published},"publishedAt":"2026-11-02T08:00:00Z","validated_at":"2026-11-01T12:00:00Z",
 "validation":{"passed":${validated},"median_m":56.0,"p95_m":187.0,"max_m":329.0,"failures":[]},
 "bounds":[34.2,29.4,36.0,33.4],"min_zoom":7,"max_zoom":12,"size_bytes":${bytes},
 "files":[{"name":"israel-cvfr-${edition}.mbtiles","bytes":${bytes},
           "sha256":"${opts.sha256 ?? nodeSha256(packBytes)}","path":"israel-cvfr/${edition}/israel-cvfr-${edition}.mbtiles"}]}`;
}

function indexJSON(latest: string | null, editions: [string, boolean][]): string {
  const list = editions.map(
    ([e, p]) => `{"edition":"${e}","published":${p},"publishedAt":null,"validatedAt":"2026-11-01T12:00:00Z"}`,
  );
  return `{"product":"israel-cvfr","updatedAt":"2026-11-02T08:00:00Z","latest":${latest ? `"${latest}"` : 'null'},"editions":[${list.join(',')}]}`;
}

const decode = decodeChartManifest;

interface Rig {
  fs: MemoryFileSystem;
  downloader: ScriptedDownloader;
  service: ChartPackService;
}

function rig(
  handler: (url: string, rangeStart: number, call: number) => ScriptedReply | Promise<ScriptedReply>,
  opts: { retry?: RetryPolicy; fetch?: FakeFetch; fs?: MemoryFileSystem; sleeps?: number[] } = {},
): Rig {
  const fs = opts.fs ?? new MemoryFileSystem();
  const downloader = new ScriptedDownloader(fs, (req, call) => handler(req.url, req.rangeStart, call));
  const service = new ChartPackService({
    product: 'israel-cvfr',
    baseUrl: BASE,
    root: ROOT,
    fs,
    fetch: opts.fetch ?? fakeFetch(() => ({ status: 404 })),
    downloader,
    retry: opts.retry ?? NO_RETRY,
    sleep: async (ms) => void opts.sleeps?.push(ms),
    now: () => 1_000,
  });
  return { fs, downloader, service };
}

const PACK_FILE = 'israel-cvfr-2025-02.mbtiles';

// MARK: Manifest decode

test('decodesTheEditionManifestWrittenByThePipelineAndHost', () => {
  const manifest = decode(manifestJSON());
  expect(manifest.edition).toBe('2025-02');
  expect(manifestLabel(manifest)).toBe('Update 2/25 (October 2025)');
  expect(manifest.published).toBe(true);
  expect(manifest.validation?.passed).toBe(true);
  expect(manifest.validation?.p95M).toBe(187.0);
  expect(manifest.bounds).toEqual([34.2, 29.4, 36.0, 33.4]);
  expect([manifest.minZoom, manifest.maxZoom]).toEqual([7, 12]);
  expect(manifestPack(manifest)?.name).toBe(PACK_FILE);
  expect(manifestTotalBytes(manifest)).toBe(packBytes.length);
});

test('decodesTheProductIndexAndAManifestWithoutChartFields', () => {
  const index = decodeChartIndex(indexJSON('2025-02', [['2025-02', true]]));
  expect(index.latest).toBe('2025-02');
  expect(index.editions[0].published).toBe(true);
  // Another product (diagrams) has no bounds, zooms or label.
  const bare =
    '{"product":"il-diagrams","edition":"2026-11","published":true,"validation":{"passed":true},"files":[{"name":"a.png","bytes":1,"sha256":"00"}]}';
  const manifest = decode(bare);
  expect(manifest.bounds).toBeNull();
  expect(manifest.minZoom).toBeNull();
  expect(manifestLabel(manifest)).toBe('2026-11');
  expect(isServable(manifest, false)).toBe(true);
});

// MARK: Published / validated rule

test('unpublishedOrUnvalidatedEditionsAreNeverServedToPilots', () => {
  expect(isServable(decode(manifestJSON({ published: false })), false)).toBe(false);
  expect(isServable(decode(manifestJSON({ validated: false })), false)).toBe(false);
  expect(isServable(decode(manifestJSON({ published: false, validated: false })), true)).toBe(true);
});

test('latestServableIgnoresAnUnpublishedEdition', async () => {
  const index = indexJSON(null, [['2025-02', false]]);
  const manifest = manifestJSON({ published: false });
  const fetch = fakeFetch((url) => {
    if (url.endsWith('/israel-cvfr/manifest.json')) return { body: index };
    if (url.endsWith('/israel-cvfr/2025-02/manifest.json')) return { body: manifest };
    return { status: 404 };
  });
  const { service } = rig(() => ({ status: 404 }), { fetch });
  expect(await service.latestServable(false)).toBeNull();
  expect((await service.latestServable(true))?.edition).toBe('2025-02');
});

test('publishedButFailedValidationIsIgnored', async () => {
  const index = indexJSON('2025-02', [['2025-02', true]]);
  const manifest = manifestJSON({ published: true, validated: false });
  const fetch = fakeFetch((url) => ({ body: url.endsWith('/israel-cvfr/manifest.json') ? index : manifest }));
  const { service } = rig(() => ({ status: 404 }), { fetch });
  expect(await service.latestServable(false)).toBeNull();
});

// MARK: Download, checksum, resume

test('downloadInstallsAVerifiedPack', async () => {
  const manifest = decode(manifestJSON());
  const { service, fs, downloader } = rig((url) => {
    expect(url).toBe(`${BASE}/israel-cvfr/2025-02/${PACK_FILE}`);
    return { status: 200, body: packBytes };
  });
  const record = await service.download(manifest);
  expect(record.edition).toBe('2025-02');
  const path = await service.filePath(PACK_FILE);
  expect(path).not.toBeNull();
  expect(fs.files.get(path ?? '')).toEqual(packBytes);
  expect((await service.installed())?.editionLabel).toBe('Update 2/25 (October 2025)');
  expect(downloader.requests).toHaveLength(1);
});

test('checksumMismatchIsRejectedAndNothingIsInstalled', async () => {
  const manifest = decode(manifestJSON({ sha256: '0'.repeat(64) }));
  const { service } = rig(() => ({ status: 200, body: packBytes }));
  await expect(service.download(manifest)).rejects.toMatchObject({ error: { kind: 'chartCorrupted' } });
  expect(await service.installed()).toBeNull();
  expect(await service.filePath(PACK_FILE)).toBeNull();
});

test('aShortDownloadIsNotInstalled', async () => {
  const manifest = decode(manifestJSON());
  const { service } = rig(() => ({ status: 200, body: packBytes.slice(0, 1000) }));
  await expect(service.download(manifest)).rejects.toBeInstanceOf(AppFailure);
  expect(await service.installed()).toBeNull();
});

test('downloadResumesFromAPartialFileWithARangeRequest', async () => {
  const fs = new MemoryFileSystem();
  fs.put(`${ROOT}/israel-cvfr/.partial-2025-02/${PACK_FILE}`, packBytes.slice(0, 1500));
  const manifest = decode(manifestJSON());
  const { service, downloader } = rig(() => ({ status: 206, body: packBytes.slice(1500) }), { fs });
  await service.download(manifest);
  expect(downloader.requests[0].rangeStart).toBe(1500); // "bytes=1500-"
  const path = await service.filePath(PACK_FILE);
  expect(fs.files.get(path ?? '')).toEqual(packBytes);
});

test('aSameSizeCorruptedInstalledPackFailsReverificationAndIsRemoved', async () => {
  const manifest = decode(manifestJSON());
  const { service, fs } = rig(() => ({ status: 200, body: packBytes }));
  await service.download(manifest);
  expect(await service.verifyInstalled()).toBe(true); // intact

  // Flip a byte without changing the size: the size check at load still passes.
  const path = (await service.filePath(PACK_FILE)) ?? '';
  const flipped = Uint8Array.from(fs.files.get(path) ?? []);
  flipped[10] ^= 0xff;
  fs.put(path, flipped);
  expect(await service.installed()).not.toBeNull();

  expect(await service.verifyInstalled()).toBe(false);
  expect(await service.installed()).toBeNull();
});

test('reverificationWithNothingInstalledPasses', async () => {
  expect(await rig(() => ({ status: 404 })).service.verifyInstalled()).toBe(true);
});

test('aDroppedConnectionIsRetriedUntilItSucceeds', async () => {
  const manifest = decode(manifestJSON());
  const sleeps: number[] = [];
  const { service, downloader } = rig(
    (_url, range, call) => {
      if (call < 3) throw new Error('connection lost');
      expect(range).toBe(0);
      return { status: 200, body: packBytes };
    },
    { retry: { maxAttempts: 3, baseDelayMs: 1 }, sleeps },
  );
  await service.download(manifest);
  expect(downloader.requests).toHaveLength(3);
  expect(await service.installed()).not.toBeNull();
  expect(sleeps).toHaveLength(2);
});

test('retriesAreBoundedAndTheFailureIsReported', async () => {
  const manifest = decode(manifestJSON());
  const { service, downloader } = rig(
    () => {
      throw new Error('timed out');
    },
    { retry: { maxAttempts: 3, baseDelayMs: 1 } },
  );
  await expect(service.download(manifest)).rejects.toBeInstanceOf(AppFailure);
  expect(downloader.requests).toHaveLength(3);
  expect(await service.installed()).toBeNull();
});

test('anHTTPErrorIsNotRetried', async () => {
  const manifest = decode(manifestJSON());
  const { service, downloader } = rig(() => ({ status: 404 }), { retry: { maxAttempts: 3, baseDelayMs: 1 } });
  await expect(service.download(manifest)).rejects.toBeInstanceOf(AppFailure);
  expect(downloader.requests).toHaveLength(1);
});

test('installingANewEditionRemovesTheOldOne', async () => {
  const fs = new MemoryFileSystem();
  for (const edition of ['2025-02', '2026-01']) {
    const { service } = rig(() => ({ status: 200, body: packBytes }), { fs });
    await service.download(decode(manifestJSON({ edition })));
  }
  expect(await fs.list(`${ROOT}/israel-cvfr`)).toEqual(['2026-01', 'installed.json']);
});

// MARK: Edition status and fallback

const installedRecord = (edition: string): ChartPackInstalled => ({
  product: 'israel-cvfr',
  edition,
  editionLabel: `Update ${edition}`,
  files: [{ name: 'x.mbtiles', bytes: 1, sha256: '00' }],
  installedAtMs: 0,
});

test('nothingInstalledFallsBackToTheStreetBaseWithAnHonestBadge', () => {
  const status = resolveChartStatus(null, decode(manifestJSON()));
  expect(status).toEqual({ kind: 'notDownloaded' });
  expect(statusIsPresent(status)).toBe(false);
  expect(chartBadgeText(status)).toBe('Official chart not downloaded');
});

test('aNewerServableEditionIsReportedAsAnUpdate', () => {
  const status = resolveChartStatus(installedRecord('2025-02'), decode(manifestJSON({ edition: '2025-10' })));
  expect(status).toMatchObject({ kind: 'updateAvailable', installedEdition: '2025-02', latestEdition: '2025-10' }); // numeric: 10 > 02
  expect(statusIsPresent(status)).toBe(true);
  expect(chartBadgeText(status)).toBe('CAAI CVFR (official) Update 2025-02, newer edition available');
});

test('theSameOrAnOlderEditionIsNotAnUpdate', () => {
  const installed = { kind: 'installed', edition: '2025-02', label: 'Update 2025-02' };
  expect(resolveChartStatus(installedRecord('2025-02'), decode(manifestJSON({ edition: '2025-02' })))).toEqual(
    installed,
  );
  expect(resolveChartStatus(installedRecord('2025-02'), decode(manifestJSON({ edition: '2025-01' })))).toEqual(
    installed,
  );
  expect(resolveChartStatus(installedRecord('2025-02'), null)).toEqual(installed);
});

// JS-only guards (port notes S1c)

test('sha256 matches the published vectors and node crypto, across chunk boundaries', () => {
  expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(sha256Hex(bytesOf('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(sha256Hex(bytesOf('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
  const big = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 7 + 3) & 0xff);
  const hasher = new Sha256();
  for (let i = 0; i < big.length; i += 777) hasher.update(big.subarray(i, i + 777));
  expect(hasher.digestHex()).toBe(nodeSha256(big));
  for (const n of [55, 56, 57, 63, 64, 65, 119, 120]) {
    const data = big.subarray(0, n);
    expect(sha256Hex(data)).toBe(nodeSha256(data));
  }
});

test('manifest names that could leave the product folder are refused before anything is written', async () => {
  const evilEdition = decode(manifestJSON({ edition: '2025-02' }));
  evilEdition.files[0].name = '../../evil.mbtiles';
  const { service, fs, downloader } = rig(() => ({ status: 200, body: packBytes }));
  await expect(service.download(evilEdition)).rejects.toMatchObject({ error: { kind: 'chartDownloadFailed' } });
  const evilName = { ...decode(manifestJSON()), edition: '../x' };
  await expect(service.download(evilName)).rejects.toBeInstanceOf(AppFailure);
  await expect(service.fetchManifest('../x')).rejects.toBeInstanceOf(AppFailure);
  expect(downloader.requests).toHaveLength(0);
  expect(fs.files.size).toBe(0);
  expect(['a.mbtiles', '2025-02', 'IL_1.png'].every(isSafeName)).toBe(true);
  expect(['', '.', '..', 'a/b', 'a\\b', '.hidden', '/abs'].some(isSafeName)).toBe(false);
});

test('a manifest url off https is ignored, a path with dot segments is ignored', async () => {
  const manifest = decode(manifestJSON());
  manifest.files[0].url = 'file:///etc/passwd';
  const a = rig(() => ({ status: 200, body: packBytes }));
  await a.service.download(manifest);
  expect(a.downloader.requests[0].url).toBe(`${BASE}/israel-cvfr/2025-02/${PACK_FILE}`);

  const viaUrl = decode(manifestJSON());
  viaUrl.files[0].url = 'https://cdn.example.test/x.mbtiles';
  const b = rig(() => ({ status: 200, body: packBytes }));
  await b.service.download(viaUrl);
  expect(b.downloader.requests[0].url).toBe('https://cdn.example.test/x.mbtiles');

  const traversal = decode(manifestJSON());
  traversal.files[0].path = 'israel-cvfr/../../secret';
  const c = rig(() => ({ status: 200, body: packBytes }));
  await c.service.download(traversal);
  expect(c.downloader.requests[0].url).toBe(`${BASE}/israel-cvfr/2025-02/${PACK_FILE}`);
});

test('a cancelled download keeps the partial file and installs nothing; a later download resumes', async () => {
  const manifest = decode(manifestJSON());
  const fs = new MemoryFileSystem();
  const controller = new AbortController();
  const first = rig(
    async () => {
      fs.put(`${ROOT}/israel-cvfr/.partial-2025-02/${PACK_FILE}`, packBytes.slice(0, 900));
      controller.abort();
      return { status: 206, body: new Uint8Array() };
    },
    { fs },
  );
  await expect(first.service.download(manifest, { signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
  expect(await first.service.installed()).toBeNull();
  expect(fs.size(`${ROOT}/israel-cvfr/.partial-2025-02/${PACK_FILE}`)).toBe(900);

  const second = rig(() => ({ status: 206, body: packBytes.slice(900) }), { fs });
  await second.service.download(manifest);
  expect(second.downloader.requests[0].rangeStart).toBe(900);
});

test('a second download of the same edition joins the first; another edition is refused', async () => {
  let release: (r: ScriptedReply) => void = () => undefined;
  const { service, downloader } = rig(() => new Promise<ScriptedReply>((resolve) => (release = resolve)));
  const a = service.download(decode(manifestJSON()));
  const b = service.download(decode(manifestJSON()));
  await expect(service.download(decode(manifestJSON({ edition: '2026-01' })))).rejects.toBeInstanceOf(AppFailure);
  await Promise.resolve();
  release({ status: 200, body: packBytes });
  const [ra, rb] = await Promise.all([a, b]);
  expect(rb).toBe(ra);
  expect(downloader.requests).toHaveLength(1);
});

test('remove() stops a running download, waits for it, then deletes; no download starts meanwhile', async () => {
  let release: (r: ScriptedReply) => void = () => undefined;
  const { service, fs } = rig(() => new Promise<ScriptedReply>((resolve) => (release = resolve)));
  const download = service.download(decode(manifestJSON()));
  const caught = download.catch((e: unknown) => e);
  await Promise.resolve();
  const removal = service.remove();
  await expect(service.download(decode(manifestJSON()))).rejects.toBeInstanceOf(AppFailure);
  release({ status: 200, body: packBytes });
  await removal;
  expect(await caught).toBeInstanceOf(CancelledError);
  expect(fs.files.size).toBe(0);
  expect(await service.installed()).toBeNull();
});

test('a file that already has every byte is not requested again; an oversized partial is discarded', async () => {
  const fs = new MemoryFileSystem();
  fs.put(`${ROOT}/israel-cvfr/.partial-2025-02/${PACK_FILE}`, packBytes);
  const manifest = decode(manifestJSON());
  const a = rig(() => ({ status: 500 }), { fs });
  await a.service.download(manifest);
  expect(a.downloader.requests).toHaveLength(0);

  const fs2 = new MemoryFileSystem();
  fs2.put(`${ROOT}/israel-cvfr/.partial-2025-02/${PACK_FILE}`, new Uint8Array(9000));
  const b = rig(() => ({ status: 200, body: packBytes }), { fs: fs2 });
  await b.service.download(manifest);
  expect(b.downloader.requests[0].rangeStart).toBe(0);
});

test('a throwing disk write is a failed download, not a half installed pack', async () => {
  const manifest = decode(manifestJSON());
  const { service, fs } = rig(() => ({ status: 200, body: packBytes }));
  fs.failWrites = true;
  await expect(service.download(manifest)).rejects.toThrow('disk full');
  expect(await service.installed()).toBeNull();
});

test('progress is reported as a fraction and ends at 1', async () => {
  const seen: number[] = [];
  const { service } = rig(() => ({ status: 200, body: packBytes }));
  await service.download(decode(manifestJSON()), { progress: (f) => seen.push(f) });
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true);
  expect(seen[seen.length - 1]).toBe(1);
});

test('an installed record is ignored when its files changed size or its names are unsafe', async () => {
  const manifest = decode(manifestJSON());
  const { service, fs } = rig(() => ({ status: 200, body: packBytes }));
  await service.download(manifest);
  const path = `${ROOT}/israel-cvfr/2025-02/${PACK_FILE}`;
  fs.put(path, packBytes.slice(0, 10));
  expect(await service.installed()).toBeNull();
  fs.put(path, packBytes);
  expect(await service.installed()).not.toBeNull();
  fs.put(
    `${ROOT}/israel-cvfr/installed.json`,
    bytesOf(JSON.stringify({ ...JSON.parse(fs.text(`${ROOT}/israel-cvfr/installed.json`) ?? '{}'), edition: '../x' })),
  );
  expect(await service.installed()).toBeNull();
});

test('retry delay doubles, caps at 2^6 and adds at most 25% jitter', () => {
  const policy = { maxAttempts: 4, baseDelayMs: 2000 };
  expect(retryDelayMs(policy, 0)).toBe(0);
  expect(retryDelayMs(policy, 1, () => 0)).toBe(2000);
  expect(retryDelayMs(policy, 3, () => 1)).toBe(10_000);
  expect(retryDelayMs(policy, 30, () => 0)).toBe(2000 * 64);
  expect(retryDelayMs(NO_RETRY, 1)).toBe(0);
});

test('numeric compare orders edition ids the way Foundation does', () => {
  expect(compareNumeric('2025-10', '2025-02')).toBeGreaterThan(0);
  expect(compareNumeric('2025-02', '2026-01')).toBeLessThan(0);
  expect(compareNumeric('a', 'a')).toBe(0);
  expect(compareNumeric('a2', 'a10')).toBeLessThan(0);
});

test('a non-200 index or a malformed manifest is chartDownloadFailed; a transport error is networkUnavailable', async () => {
  const bad = fakeFetch(() => ({ status: 500 }));
  await expect(rig(() => ({ status: 404 }), { fetch: bad }).service.fetchIndex()).rejects.toMatchObject({
    error: { kind: 'chartDownloadFailed' },
  });
  const junk = fakeFetch((): StubReply => ({ body: '{"edition":1}' }));
  await expect(rig(() => ({ status: 404 }), { fetch: junk }).service.fetchManifest('2025-02')).rejects.toMatchObject({
    error: { kind: 'chartDownloadFailed' },
  });
  const down = fakeFetch(() => {
    throw new TypeError('Network request failed');
  });
  await expect(rig(() => ({ status: 404 }), { fetch: down }).service.fetchIndex()).rejects.toMatchObject({
    error: { kind: 'networkUnavailable' },
  });
});

// Review follow-ups (PR #51)

test('an abort during the final move rolls the stage back: nothing is installed and the partial is kept for resume', async () => {
  const manifest = decode(manifestJSON());
  const controller = new AbortController();
  const { service, fs } = rig(() => ({ status: 200, body: packBytes }));
  const move = fs.move.bind(fs);
  fs.move = async (from: string, to: string) => {
    await move(from, to);
    if (to.endsWith('/2025-02')) controller.abort(); // the pilot pauses while the stage is being moved into place
  };
  await expect(service.download(manifest, { signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
  expect(await service.installed()).toBeNull();
  expect(fs.exists(`${ROOT}/israel-cvfr/installed.json`)).toBe(false);
  expect(fs.size(`${ROOT}/israel-cvfr/.partial-2025-02/${PACK_FILE}`)).toBe(packBytes.length); // put back
});

test('an abort right before the final move or the record write never installs', async () => {
  const manifest = decode(manifestJSON());
  const controller = new AbortController();
  const { service, fs } = rig(() => ({ status: 200, body: packBytes }));
  const remove = fs.remove.bind(fs);
  fs.remove = async (path: string) => {
    await remove(path);
    if (path.endsWith('/2025-02')) controller.abort(); // the old-edition removal is the first final-commit step
  };
  let moves = 0;
  const move = fs.move.bind(fs);
  fs.move = async (from: string, to: string) => {
    moves += 1;
    await move(from, to);
  };
  await expect(service.download(manifest, { signal: controller.signal })).rejects.toBeInstanceOf(CancelledError);
  expect(await service.installed()).toBeNull();
  expect(moves).toBe(0); // the abort is seen before the stage is moved
});

test('a body larger than the manifest says is rejected, removed, sent with a byte limit, and not retried', async () => {
  const manifest = decode(manifestJSON());
  const { service, fs, downloader } = rig(() => ({ status: 200, body: new Uint8Array(packBytes.length + 500) }), {
    retry: { maxAttempts: 3, baseDelayMs: 1 },
  });
  await expect(service.download(manifest)).rejects.toMatchObject({ error: { kind: 'chartDownloadFailed' } });
  expect(downloader.requests).toHaveLength(1);
  expect(downloader.requests[0].maxBytes).toBe(packBytes.length);
  expect(fs.exists(`${ROOT}/israel-cvfr/.partial-2025-02/${PACK_FILE}`)).toBe(false);
});
