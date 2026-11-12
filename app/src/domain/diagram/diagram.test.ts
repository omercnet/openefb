// No Swift test covers the overlay decision logic or ChartPDFView (AirportDiagramOverlay is MapLibre-bound; the
// georeferencer suites belong to S1c and tools/apd-georef). Cases are written from the Swift control flow.
import type { Coordinate, Region } from '../core';
import { DIAGRAM_IMAGE_SOURCE_IDS, DIAGRAM_LAYER_SPECS, DIAGRAM_SOURCE_IDS, diagramSources } from './layers';
import {
  backingOpacityAt,
  DIAGRAM_RETRY_AFTER_MS,
  DiagramOverlayController,
  type DiagramCamera,
  type DiagramCandidate,
  type DiagramLookup,
  type DiagramPackSource,
} from './overlayController';
import { makeTerminalChart } from '../../services/terminal/dtpp';
import { expiryBanner, PDF_OPEN_FAILED, PdfChartController, type ChartPdfSource } from './pdfChart';
import { validateRegistry } from '../map/layerSpec';
import { ALL_SOURCE_IDS, layerSpecsFor } from '../map/registry';

const here: Coordinate = { lat: 37.46, lon: -122.11 };
const cam = (zoom: number, center = here): DiagramCamera => ({
  center,
  zoom,
  northEast: { lat: center.lat + 0.01, lon: center.lon + 0.01 },
  southWest: { lat: center.lat - 0.01, lon: center.lon - 0.01 },
});
const img = (icao: string, at = here) => ({
  icao,
  imageUri: `file:///${icao}.png`,
  // top-left, top-right, bottom-right, bottom-left as [lon, lat] (clipCornersForImageSource order)
  coordinates: [
    [at.lon - 0.01, at.lat + 0.01],
    [at.lon + 0.01, at.lat + 0.01],
    [at.lon + 0.01, at.lat - 0.01],
    [at.lon - 0.01, at.lat - 0.01],
  ] as [number, number][],
});

class FakeSource implements DiagramPackSource {
  list: DiagramCandidate[] = [];
  lookups = new Map<string, DiagramLookup | Error>();
  asked: string[] = [];
  candidateCalls = 0;
  failCandidates = false;
  gate: Promise<void> | null = null;
  candidates = async (_r: Region, _c: Coordinate, _n: number) => {
    this.candidateCalls++;
    if (this.failCandidates) throw new Error('db');
    return this.list;
  };
  diagramFor = async (_r: Region, icao: string): Promise<DiagramLookup> => {
    this.asked.push(icao);
    const r = this.lookups.get(icao) ?? { kind: 'ready' as const, image: img(icao) };
    if (this.gate) await this.gate;
    if (r instanceof Error) throw r;
    return r;
  };
}
const cand = (icao: string, dLat = 0): DiagramCandidate => ({
  icao,
  position: { lat: here.lat + dLat, lon: here.lon },
});

function make(opts: { enabled?: boolean; remote?: boolean } = {}) {
  const source = new FakeSource();
  let t = 1_000_000;
  const state = { enabled: opts.enabled ?? true, remote: opts.remote ?? false };
  const c = new DiagramOverlayController({
    source,
    enabled: () => state.enabled,
    remotelyDisabled: () => state.remote,
    now: () => t,
  });
  return { c, source, state, advance: (ms: number) => (t += ms) };
}

describe('DiagramOverlayController', () => {
  it('loads the 3 nearest candidates at zoom >= 13.5 and shows them at >= 14', async () => {
    const { c, source } = make();
    source.list = [cand('D', 0.04), cand('A', 0.001), cand('C', 0.03), cand('B', 0.01)];
    await c.onCamera(cam(14));
    expect(source.asked.sort()).toEqual(['A', 'B', 'C']);
    const s = c.getSnapshot();
    expect(s.shownAirports).toEqual(['A', 'B', 'C']);
    expect(s.visible).toBe(true);
    expect(s.isShowing).toBe(true);
    expect(s.slots.map((x) => x.slot).sort()).toEqual([0, 1, 2]);
  });

  it('preloads at 13.5 without showing; below that does nothing', async () => {
    const { c, source } = make();
    source.list = [cand('A')];
    await c.onCamera(cam(13.4));
    expect(source.candidateCalls).toBe(0);
    await c.onCamera(cam(13.6));
    expect(c.getSnapshot()).toMatchObject({ shownAirports: ['A'], visible: false, isShowing: false });
    await c.onCamera(cam(14.2));
    expect(c.getSnapshot().isShowing).toBe(true);
  });

  it('disabled or remotely disabled: hidden and nothing loads', async () => {
    const a = make({ enabled: false });
    a.source.list = [cand('A')];
    await a.c.onCamera(cam(15));
    expect(a.source.asked).toEqual([]);
    const b = make({ remote: true });
    b.source.list = [cand('A')];
    await b.c.onCamera(cam(15));
    expect(b.source.asked).toEqual([]);
  });

  it('toggling off hides without dropping loaded diagrams, toggling on shows them again', async () => {
    const { c, source, state } = make();
    source.list = [cand('A')];
    await c.onCamera(cam(15));
    state.enabled = false;
    await c.refresh();
    expect(c.getSnapshot()).toMatchObject({ visible: false, isShowing: false, shownAirports: ['A'] });
    state.enabled = true;
    await c.refresh();
    expect(c.getSnapshot().isShowing).toBe(true);
    expect(source.asked).toEqual(['A']);
  });

  it('unavailable stays unavailable for the session and is not asked again', async () => {
    const { c, source } = make();
    source.list = [cand('A')];
    source.lookups.set('A', { kind: 'unavailable', reason: 'no diagram' });
    await c.onCamera(cam(15));
    await c.onCamera(cam(15));
    expect(source.asked).toEqual(['A']);
    expect(c.getSnapshot().shownAirports).toEqual([]);
  });

  it('a failed load is retried only after 5 minutes and is reported meanwhile; success clears it', async () => {
    const { c, source, advance } = make();
    source.list = [cand('A')];
    source.lookups.set('A', new Error('net'));
    await c.onCamera(cam(15));
    expect(c.getSnapshot().failedAirports).toEqual(['A']);
    advance(DIAGRAM_RETRY_AFTER_MS - 1);
    await c.onCamera(cam(15));
    expect(source.asked).toEqual(['A']);
    advance(2);
    source.lookups.delete('A');
    await c.onCamera(cam(15));
    expect(source.asked).toEqual(['A', 'A']);
    expect(c.getSnapshot()).toMatchObject({ failedAirports: [], shownAirports: ['A'] });
  });

  it('a candidate lookup failure is ignored (retried on the next camera change)', async () => {
    const { c, source } = make();
    source.failCandidates = true;
    await c.onCamera(cam(15));
    expect(c.getSnapshot().slots).toEqual([]);
    source.failCandidates = false;
    source.list = [cand('A')];
    await c.onCamera(cam(15));
    expect(c.getSnapshot().shownAirports).toEqual(['A']);
  });

  it('an airport already loading is not requested twice', async () => {
    const { c, source } = make();
    source.list = [cand('A')];
    let open!: () => void;
    source.gate = new Promise<void>((r) => (open = r));
    const first = c.onCamera(cam(15));
    const second = c.onCamera(cam(15));
    await new Promise((r) => setTimeout(r, 0));
    open();
    await Promise.all([first, second]);
    expect(source.asked).toEqual(['A']);
  });

  it('a region change drops everything, and a load still in flight from the old region is discarded', async () => {
    const { c, source } = make();
    source.list = [cand('A')];
    let open!: () => void;
    source.gate = new Promise<void>((r) => (open = r));
    source.lookups.set('A', { kind: 'ready', image: { ...img('A'), imageUri: 'file:///old-region.png' } });
    const pending = c.onCamera(cam(15));
    await new Promise((r) => setTimeout(r, 0));
    source.lookups.set('A', { kind: 'ready', image: { ...img('A'), imageUri: 'file:///new-region.png' } });
    const switchedLoad = source.gate;
    source.gate = null;
    const switched = c.setRegion('israel');
    await switched;
    expect(c.getSnapshot().slots[0]!.image.imageUri).toBe('file:///new-region.png');
    open(); // the old-region lookup finishes last, with the same airport
    await switchedLoad;
    await pending;
    expect(c.getSnapshot().slots).toHaveLength(1);
    expect(c.getSnapshot().slots[0]!.image.imageUri).toBe('file:///new-region.png');
  });

  it('with all slots used, the diagram farthest from the camera is evicted for a nearer one', async () => {
    const { c, source } = make();
    source.list = [cand('A', 0.001), cand('B', 0.002), cand('C', 0.003)];
    await c.onCamera(cam(15));
    const far = cam(15, { lat: here.lat + 0.5, lon: here.lon });
    source.list = [cand('D', 0.5)];
    await c.onCamera(far);
    expect(c.getSnapshot().shownAirports).toHaveLength(3);
    expect(c.getSnapshot().shownAirports).toContain('D');
    expect(new Set(c.getSnapshot().slots.map((s) => s.slot)).size).toBe(3);
  });

  it('dispose stops updates; subscribers see changes', async () => {
    const { c, source } = make();
    let calls = 0;
    c.subscribe(() => calls++);
    source.list = [cand('A')];
    await c.onCamera(cam(15));
    expect(calls).toBeGreaterThan(0);
    c.dispose();
    const before = calls;
    await c.onCamera(cam(15, { lat: 0, lon: 0 }));
    expect(calls).toBe(before);
  });
});

describe('diagram layers', () => {
  it('registry is valid for both regions with the diagram slots below the airport dots', () => {
    expect(validateRegistry(layerSpecsFor('us'), ALL_SOURCE_IDS)).toEqual([]);
    const ids = layerSpecsFor('us').map((s) => s.id);
    expect(ids.indexOf('apd-image-layer-0')).toBeLessThan(ids.indexOf('airport-circles'));
    expect(ids.indexOf('apd-image-layer-0')).toBeGreaterThan(ids.indexOf('ownship-symbol'));
    expect(DIAGRAM_LAYER_SPECS).toHaveLength(6);
    expect(DIAGRAM_SOURCE_IDS).toHaveLength(6);
    expect(DIAGRAM_IMAGE_SOURCE_IDS).toHaveLength(3);
  });

  it('diagramSources passes the quad through in TL, TR, BR, BL order and shows only occupied slots while visible', async () => {
    const { c, source } = make();
    source.list = [cand('A')];
    await c.onCamera(cam(15));
    const d = diagramSources(c.getSnapshot());
    const a = d.images['apd-image-0']!;
    expect(a.url).toBe('file:///A.png');
    expect(a.coordinates).toEqual(img('A').coordinates);
    expect(a.coordinates[0]).toEqual([here.lon - 0.01, here.lat + 0.01]); // top-left
    expect(a.coordinates[1]).toEqual([here.lon + 0.01, here.lat + 0.01]); // top-right
    expect(a.coordinates[3]).toEqual([here.lon - 0.01, here.lat - 0.01]); // bottom-left
    expect(d.visibility).toMatchObject({
      'apd-image-layer-0': true,
      'apd-backing-layer-0': true,
      'apd-image-layer-1': false,
    });
    expect(d.geojson['apd-backing-0']!.features).toHaveLength(1);
    expect(d.images['apd-image-1']).toBeUndefined();
    c.getSnapshot();
    await c.onCamera(cam(13.7));
    expect(diagramSources(c.getSnapshot()).visibility['apd-image-layer-0']).toBe(false);
  });

  it('backing opacity interpolates between the zoom stops and clamps outside', () => {
    expect(backingOpacityAt(10)).toBe(0.85);
    expect(backingOpacityAt(14.5)).toBeCloseTo(0.91, 9);
    expect(backingOpacityAt(20)).toBe(0.97);
    expect(backingOpacityAt(Number.NaN)).toBe(0.85);
  });
});

describe('PdfChartController', () => {
  const chart = makeTerminalChart('APD', 'AIRPORT DIAGRAM', '00001AD.PDF', '2611');
  const mkSource = (): ChartPdfSource & { calls: number; next: Promise<string> | Error | string } => ({
    calls: 0,
    next: 'file:///a.pdf',
    pdfUri(this: { calls: number; next: Promise<string> | Error | string }) {
      this.calls++;
      const n = this.next;
      if (n instanceof Error) return Promise.reject(n);
      return Promise.resolve(n);
    },
    cycleExpiry: () => null,
  });

  it('loading then loaded, or failed with the message, and retry works', async () => {
    const src = mkSource();
    const c = new PdfChartController(src, chart);
    expect(c.getSnapshot()).toEqual({ kind: 'loading' });
    src.next = new Error('offline');
    await c.load();
    expect(c.getSnapshot()).toEqual({ kind: 'failed', message: 'offline' });
    src.next = 'file:///a.pdf';
    await c.load();
    expect(c.getSnapshot()).toEqual({ kind: 'loaded', uri: 'file:///a.pdf' });
  });

  it('a stale result never overwrites a newer load (retry race)', async () => {
    let releaseOld!: (u: string) => void;
    const old = new Promise<string>((r) => (releaseOld = r));
    const src = mkSource();
    src.next = old;
    const c = new PdfChartController(src, chart);
    const first = c.load();
    src.next = 'file:///new.pdf';
    await c.load();
    releaseOld('file:///old.pdf');
    await first;
    expect(c.getSnapshot()).toEqual({ kind: 'loaded', uri: 'file:///new.pdf' });
  });

  it('a viewer that cannot open the file turns loaded into failed', async () => {
    const c = new PdfChartController(mkSource(), chart);
    c.openFailed();
    expect(c.getSnapshot().kind).toBe('loading'); // ignored unless loaded
    await c.load();
    c.openFailed();
    expect(c.getSnapshot()).toEqual({ kind: 'failed', message: PDF_OPEN_FAILED });
  });

  it('a non-Error rejection still yields text', async () => {
    const src = mkSource();
    src.pdfUri = () => Promise.reject('boom');
    const c = new PdfChartController(src, chart);
    await c.load();
    expect(c.getSnapshot()).toEqual({ kind: 'failed', message: 'boom' });
  });
});

describe('expiryBanner', () => {
  const end = Date.UTC(2026, 11, 10, 9, 1);
  it('none for an unknown cycle or a fresh one; expired reads EXPIRED with the end date', () => {
    expect(expiryBanner('2611', null, end)).toBeNull();
    expect(expiryBanner('2611', end, end - 20 * 86_400_000)).toBeNull();
    const b = expiryBanner('2611', end, end + 1000)!;
    expect(b.severity).toBe('warning');
    expect(b.text).toBe('EXPIRED: cycle 2611 ended Dec 10, 2026');
  });
});
