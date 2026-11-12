// OfflineMapService over a fake engine. Swift has no service-level tests (MLNOfflineStorage is a singleton); these
// cases exercise create, resume, delete and the failure paths the brief calls out.
import { AppFailure } from '../errors';
import { bounds } from './bounds';
import {
  OfflineMapService,
  toEnginePack,
  type EngineCreateOptions,
  type EnginePack,
  type OfflineEngine,
} from './offlineMapService';

const region = bounds(37.3, -122.3, 37.6, -121.9);
const baseStyle = {
  version: 8,
  glyphs: 'g',
  sources: { 'vfr-sectional': { type: 'raster' }, openmaptiles: { type: 'vector' } },
  layers: [
    { id: 'a', type: 'raster', source: 'vfr-sectional' },
    { id: 'b', type: 'fill', source: 'openmaptiles' },
  ],
};

class FakeEngine implements OfflineEngine {
  packs: EnginePack[] = [];
  created: EngineCreateOptions[] = [];
  calls: string[] = [];
  failCreate: string | null = null;
  failDelete = false;
  failList = false;
  failPause = false;
  errorCb: ((id: string, m: string) => void)[] = [];
  progressCb: ((id: string) => void)[] = [];
  private n = 0;
  createPack: OfflineEngine['createPack'] = async (o, onProgress, onError) => {
    if (this.failCreate) throw new Error(this.failCreate);
    this.created.push(o);
    const id = `e${this.n++}`;
    this.packs.push({
      id,
      metadata: o.metadata,
      state: 'inactive',
      completedResources: 0,
      requiredResources: 10,
      completedBytes: 0,
    });
    this.progressCb.push(onProgress);
    this.errorCb.push(onError);
    return { id };
  };
  listPacks = async () => {
    if (this.failList) throw new Error('list down');
    return this.packs.map((p) => ({ ...p }));
  };
  resume = async (id: string) => {
    this.calls.push(`resume ${id}`);
    const p = this.packs.find((x) => x.id === id);
    if (p) p.state = 'active';
  };
  pause = async (id: string) => {
    this.calls.push(`pause ${id}`);
    if (this.failPause) throw new Error('no');
    const p = this.packs.find((x) => x.id === id);
    if (p) p.state = 'inactive';
  };
  delete = async (id: string) => {
    this.calls.push(`delete ${id}`);
    if (this.failDelete) throw new Error('locked');
    this.packs = this.packs.filter((x) => x.id !== id);
  };
}

let clock = 1_793_000_000_000;
let ids = 0;
function make(engine = new FakeEngine(), style: unknown = baseStyle) {
  const service = new OfflineMapService({
    engine,
    baseStyle: () => style,
    now: () => (clock += 1000),
    newId: () => `c${ids++}`,
  });
  return { engine, service };
}

describe('OfflineMapService', () => {
  it('download creates one resumed pack per layer with the layer zoom range, cycle and a reduced style', async () => {
    const { engine, service } = make();
    await service.download('Bay Area', region, ['sectional', 'street']);
    expect(engine.created.map((c) => [c.minZoom, c.maxZoom])).toEqual([
      [8, 12],
      [5, 13],
    ]);
    expect(engine.created[0]!.bounds).toEqual([-122.3, 37.3, -121.9, 37.6]);
    expect(Object.keys(JSON.parse(engine.created[0]!.styleJson).sources)).toEqual(['vfr-sectional']);
    expect(engine.calls).toEqual(['resume e0', 'resume e1']);
    const { packs } = service.getSnapshot();
    expect(packs).toHaveLength(2);
    expect(packs.map((p) => p.state.kind)).toEqual(['downloading', 'downloading']);
    const sectional = packs.find((p) => p.context.layer === 'sectional')!;
    expect(sectional.context.cycleEffective).not.toBeNull();
    expect(packs.find((p) => p.context.layer === 'street')!.context.cycleEffective).toBeNull();
  });

  it('a creation failure on one layer is reported and the other layer still downloads', async () => {
    const { engine, service } = make();
    const real = engine.createPack;
    let first = true;
    engine.createPack = async (o, p, e) => {
      if (first) {
        first = false;
        throw new Error('disk full');
      }
      return real(o, p, e);
    };
    await service.download('X', region, ['sectional', 'street']);
    const s = service.getSnapshot();
    expect(s.lastError).toEqual({ kind: 'chartDownloadFailed', region: 'X: disk full' });
    expect(s.packs.map((p) => p.context.layer)).toEqual(['street']);
  });

  it('a corrupt base style throws after the other layers were attempted, and creates nothing for it', async () => {
    const { engine, service } = make(new FakeEngine(), { version: 8 });
    await expect(service.download('X', region, ['street'])).rejects.toBeInstanceOf(AppFailure);
    expect(engine.created).toEqual([]);
    expect(service.getSnapshot().lastError).toEqual({ kind: 'chartCorrupted', region: 'base-style.json' });
  });

  it('pause and resume go through the engine and refresh the state', async () => {
    const { service } = make();
    await service.download('X', region, ['street']);
    await service.pause(service.getSnapshot().packs[0]!);
    expect(service.getSnapshot().packs[0]!.state.kind).toBe('paused');
    await service.resume(service.getSnapshot().packs[0]!);
    expect(service.getSnapshot().packs[0]!.state.kind).toBe('downloading');
  });

  it('a rejecting pause reports and still refreshes', async () => {
    const { engine, service } = make();
    await service.download('X', region, ['street']);
    engine.failPause = true;
    await service.pause(service.getSnapshot().packs[0]!);
    expect(service.getSnapshot().lastError).toEqual({ kind: 'chartDownloadFailed', region: 'Pause failed: no' });
    expect(service.getSnapshot().packs).toHaveLength(1);
  });

  it('delete removes the pack at once and from the engine; a failed delete reports and the pack comes back', async () => {
    const { engine, service } = make();
    await service.download('X', region, ['street']);
    const pack = service.getSnapshot().packs[0]!;
    engine.failDelete = true;
    const done = service.delete(pack);
    expect(service.getSnapshot().packs).toHaveLength(0);
    await done;
    expect(service.getSnapshot().lastError).toEqual({ kind: 'chartDownloadFailed', region: 'Delete failed: locked' });
    expect(service.getSnapshot().packs).toHaveLength(1);
    engine.failDelete = false;
    await service.delete(service.getSnapshot().packs[0]!);
    expect(service.getSnapshot().packs).toHaveLength(0);
    expect(engine.packs).toHaveLength(0);
  });

  it('deleting an unknown pack is a no-op', async () => {
    const { engine, service } = make();
    await service.download('X', region, ['street']);
    const pack = service.getSnapshot().packs[0]!;
    await service.delete(pack);
    await service.delete(pack);
    expect(engine.calls.filter((c) => c.startsWith('delete'))).toHaveLength(1);
  });

  it('redownload replaces a pack with a fresh one for the same layer and region', async () => {
    const { service } = make();
    await service.download('X', region, ['sectional']);
    const old = service.getSnapshot().packs[0]!;
    await service.redownload(old);
    const now = service.getSnapshot().packs;
    expect(now).toHaveLength(1);
    expect(now[0]!.context.id).not.toBe(old.context.id);
    expect(now[0]!.context.bounds).toEqual(region);
  });

  it('a tile or pack error from the engine sets lastError naming the pack and refreshes', async () => {
    const { engine, service } = make();
    await service.download('Bay', region, ['street']);
    engine.errorCb[0]!('e0', 'HTTP 503');
    expect(service.getSnapshot().lastError).toEqual({ kind: 'chartDownloadFailed', region: 'Bay (street): HTTP 503' });
    await service.refresh();
    expect(service.getSnapshot().packs).toHaveLength(1);
  });

  it('an invalid engine pack reads failed (Removed) and counts as not downloaded', async () => {
    const { engine, service } = make();
    await service.download('Bay', region, ['street']);
    engine.packs[0]!.state = 'invalid';
    await service.refresh();
    expect(service.getSnapshot().packs[0]!.state).toEqual({ kind: 'failed', reason: 'Removed' });
    expect(service.status(region, 'street')).toBe('notDownloaded');
  });

  it('a failed list keeps the previous packs instead of reading as empty', async () => {
    const { engine, service } = make();
    await service.download('Bay', region, ['street']);
    engine.failList = true;
    await service.refresh();
    expect(service.getSnapshot().packs).toHaveLength(1);
    expect(service.getSnapshot().lastError?.kind).toBe('chartDownloadFailed');
  });

  it('packs without our context (other metadata) are ignored and sorted newest first; bytes are summed', async () => {
    const { engine, service } = make();
    await service.download('A', region, ['street']);
    await service.download('B', region, ['street']);
    engine.packs.push({
      id: 'foreign',
      metadata: '{"x":1}',
      state: 'complete',
      completedResources: 1,
      requiredResources: 1,
      completedBytes: 5,
    });
    engine.packs[0]!.completedBytes = 100;
    engine.packs[1]!.completedBytes = 250;
    await service.refresh();
    const s = service.getSnapshot();
    expect(s.packs.map((p) => p.context.name)).toEqual(['B', 'A']);
    expect(s.storageUsedBytes).toBe(350);
  });

  it('overlapping refreshes coalesce and the last read wins', async () => {
    const { engine, service } = make();
    await service.download('A', region, ['street']);
    let reads = 0;
    const real = engine.listPacks;
    engine.listPacks = async () => {
      reads++;
      return real();
    };
    const a = service.refresh();
    const b = service.refresh();
    const c = service.refresh();
    await Promise.all([a, b, c]);
    expect(reads).toBe(2);
  });

  it('status uses the packs in the snapshot', async () => {
    const { engine, service } = make();
    await service.download('A', region, ['street']);
    expect(service.status(region, 'street')).toBe('partial'); // still downloading
    engine.packs[0]!.state = 'complete';
    engine.packs[0]!.completedResources = 10;
    await service.refresh();
    expect(service.status(region, 'street')).toBe('ready');
  });

  it('snapshot identity is stable until a change; progress events refresh', async () => {
    const { engine, service } = make();
    await service.download('A', region, ['street']);
    const s1 = service.getSnapshot();
    expect(service.getSnapshot()).toBe(s1);
    engine.packs[0]!.completedResources = 7;
    engine.progressCb[0]!('e0');
    await service.refresh();
    expect(service.getSnapshot()).not.toBe(s1);
    expect(service.getSnapshot().packs[0]!.completedResources).toBe(7);
  });

  it('clearError resets lastError once', async () => {
    const { engine, service } = make();
    engine.failCreate = 'x';
    await service.download('A', region, ['street']);
    expect(service.getSnapshot().lastError).not.toBeNull();
    service.clearError();
    expect(service.getSnapshot().lastError).toBeNull();
  });
});

describe('toEnginePack', () => {
  it('maps RN status and guards missing or garbage values', () => {
    const ok = toEnginePack(
      '1',
      {},
      { state: 'complete', completedResourceCount: 4, completedResourceSize: 900, requiredResourceCount: 4 },
    );
    expect(ok).toMatchObject({ state: 'complete', completedResources: 4, requiredResources: 4, completedBytes: 900 });
    expect(toEnginePack('1', {}, null)).toMatchObject({
      state: 'inactive',
      completedResources: 0,
      requiredResources: 0,
    });
    const bad = toEnginePack(
      '1',
      {},
      { state: 'active', completedResourceCount: Number.NaN, completedResourceSize: -1, requiredResourceCount: 3 },
    );
    expect(bad).toMatchObject({ completedResources: 0, completedBytes: 0, requiredResources: 3 });
  });
});
