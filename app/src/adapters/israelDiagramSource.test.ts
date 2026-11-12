// Ports ServiceTests/IsraelAirportDiagramTests `nearestGeoreferencedAerodromes` (the overlay offers the pack's georeferenced
// aerodromes nearest first, and only those) end to end through the S1c pack, the adapter and the overlay controller, plus the
// adapter's guards. The region gate of that suite is L1's.
import type { AirportDiagramGeoreference } from '../services/charts/diagramGeoreference';
import { clipCornersForImageSource } from '../services/charts/diagramGeoreference';
import { IsraelDiagramPack, type DiagramIndexRecord } from '../services/charts/diagramPack';
import { bytesOf, MemoryFileSystem } from '../services/charts/testSupport';
import { DiagramOverlayController, type DiagramCamera } from '../domain/diagram/overlayController';
import { createIsraelDiagramSource } from './israelDiagramSource';
import { createTerminalPdfSource, fileUri } from './terminalPdfSource';
import { cycleWithCode, makeTerminalChart } from '../services/terminal/dtpp';

const rec = (icao: string, georeferenced: boolean): DiagramIndexRecord => ({
  chart: `AD 2 ${icao} ADC`,
  language: 'en',
  scale: 'bar only',
  georeferenced,
  reason: 'accepted',
  sheet: `${icao}.pdf`,
  image: georeferenced ? `${icao}.png` : null,
  georeference: georeferenced ? `${icao}.json` : null,
});
const page = { x: 0, y: 0, width: 1000, height: 700 };
const geo = (lat: number, lon: number): AirportDiagramGeoreference => ({
  a: 6.78,
  b: 0,
  c: 0,
  d: 6.78,
  tx: -3390,
  ty: -2373,
  reference: page,
  referenceLatitude: lat,
  referenceLongitude: lon,
  pageBox: page,
  clipBox: page,
  masks: [],
  diagnostics: {
    method: 'runway',
    labelSource: 'none',
    latitudeLabels: 0,
    longitudeLabels: 0,
    rotationDegrees: 0,
    feetPerPoint: 22.2,
    scaleRatio: null,
    runwaysMatched: 3,
    runwayResidualFeet: 31,
    runwayMidpointFeet: 30,
    runwayEndFeet: 90,
    runwayBestMidpointFeet: 12,
    runwayMedianMidpointFeet: 25,
    maskedInsets: 0,
  },
});
const AERODROMES: Record<string, { latitude: number; longitude: number }> = {
  LLBG: { latitude: 32.0094, longitude: 34.8856 },
  LLHZ: { latitude: 32.1809, longitude: 34.8334 },
  LLHA: { latitude: 32.8094, longitude: 35.0431 },
};

function setup(opts: { files?: string[]; fail?: string } = {}) {
  const records = { LLBG: rec('LLBG', true), LLHZ: rec('LLHZ', true), LLHA: rec('LLHA', false) };
  const files = opts.files ?? ['LLBG.png', 'LLBG.json', 'LLHZ.png', 'LLHZ.json', 'LLHA.pdf'];
  const pack = new IsraelDiagramPack(
    {
      product: 'il-diagrams',
      edition: '2026-08',
      editionLabel: 'x',
      aipDate: '2026-08-06',
      accuracyFeet: 100,
      aerodromes: records,
    },
    (name) => (files.includes(name) ? `/d/${name}` : null),
  );
  const fs = new MemoryFileSystem();
  for (const icao of ['LLBG', 'LLHZ']) {
    fs.put(`/d/${icao}.json`, bytesOf(JSON.stringify(geo(AERODROMES[icao]!.latitude, AERODROMES[icao]!.longitude))));
    fs.put(`/d/${icao}.png`, new Uint8Array([1]));
  }
  const logs: string[] = [];
  const source = createIsraelDiagramSource({
    loadPack: async () => pack,
    fs,
    israel: {
      aerodrome: async (code: string) => {
        if (code === opts.fail) throw new Error('db down');
        const a = AERODROMES[code];
        return a ? ({ code, ...a } as never) : null;
      },
    },
    log: (m) => logs.push(m),
  });
  return { source, fs, pack, logs };
}
const cam = (lat: number, lon: number, zoom = 15): DiagramCamera => ({
  center: { lat, lon },
  zoom,
  northEast: { lat: lat + 0.01, lon: lon + 0.01 },
  southWest: { lat: lat - 0.01, lon: lon - 0.01 },
});
const controller = (source: ReturnType<typeof setup>['source']) =>
  new DiagramOverlayController({ source, enabled: () => true, remotelyDisabled: () => false });

describe('Israel diagram source', () => {
  it('nearestGeoreferencedAerodromes: only georeferenced ones, nearest first', async () => {
    const { source } = setup();
    const near = (lat: number, lon: number) =>
      source.candidates('israel', { lat, lon }, 5).then((c) =>
        c
          .map((x) => ({ icao: x.icao, d: Math.hypot(x.position.lat - lat, x.position.lon - lon) }))
          .sort((a, b) => a.d - b.d)
          .map((x) => x.icao),
      );
    expect(await near(32.18, 34.83)).toEqual(['LLHZ', 'LLBG']); // sheet-only LLHA is never offered
    expect(await near(32.01, 34.88)).toEqual(['LLBG', 'LLHZ']);
  });

  it('the overlay draws the diagrams through the pack, with the S1c ImageSource corner order', async () => {
    const { source } = setup();
    const c = controller(source);
    await c.setRegion('israel');
    await c.onCamera(cam(32.18, 34.83));
    const s = c.getSnapshot();
    expect(s.shownAirports).toEqual(['LLBG', 'LLHZ']);
    const llhz = s.slots.find((x) => x.image.icao === 'LLHZ')!.image;
    expect(llhz.imageUri).toBe('file:///d/LLHZ.png');
    expect(llhz.coordinates).toEqual(clipCornersForImageSource(geo(32.1809, 34.8334)));
    expect(llhz.coordinates).toHaveLength(4);
    // top-left is north-west of bottom-right (north-up page)
    expect(llhz.coordinates[0]![1]).toBeGreaterThan(llhz.coordinates[2]![1]);
    expect(llhz.coordinates[0]![0]).toBeLessThan(llhz.coordinates[2]![0]);
  });

  it('the US draws nothing (no precomputed pack yet)', async () => {
    const { source } = setup();
    expect(await source.candidates('us', { lat: 37, lon: -122 }, 10)).toEqual([]);
    expect(await source.diagramFor('us', 'KPAO')).toMatchObject({ kind: 'unavailable' });
  });

  it('missing pack, sheet-only, unreadable georeference and missing image are unavailable, never a wrong overlay', async () => {
    const { source, fs, logs } = setup();
    expect((await source.diagramFor('israel', 'LLHA')).kind).toBe('unavailable');
    expect((await source.diagramFor('israel', 'LLXX')).kind).toBe('unavailable');
    fs.put('/d/LLBG.json', bytesOf('{"a":1}'));
    expect(await source.diagramFor('israel', 'LLBG')).toMatchObject({
      kind: 'unavailable',
      reason: 'georeference unreadable',
    });
    expect(logs.length).toBe(1);
    fs.files.delete('/d/LLHZ.png');
    expect(await source.diagramFor('israel', 'LLHZ')).toMatchObject({
      kind: 'unavailable',
      reason: 'diagram image missing',
    });
    const none = createIsraelDiagramSource({ loadPack: async () => null, fs, israel: { aerodrome: async () => null } });
    expect(await none.candidates('israel', { lat: 0, lon: 0 }, 1)).toEqual([]);
    expect(await none.diagramFor('israel', 'LLBG')).toMatchObject({ kind: 'unavailable' });
  });

  it('one aerodrome lookup failing does not hide the others', async () => {
    const { source, logs } = setup({ fail: 'LLHZ' });
    const c = await source.candidates('israel', { lat: 32, lon: 34.8 }, 5);
    expect(c.map((x) => x.icao)).toEqual(['LLBG']);
    expect(logs[0]).toContain('LLHZ');
  });

  it('a pack that goes away between camera moves yields no candidates (a rejecting loadPack is a candidate-lookup failure the controller ignores)', async () => {
    const { fs } = setup();
    const src = createIsraelDiagramSource({
      loadPack: () => Promise.reject(new Error('io')),
      fs,
      israel: { aerodrome: async () => null },
    });
    const c = controller(src);
    await c.setRegion('israel');
    await c.onCamera(cam(32, 34.8));
    expect(c.getSnapshot().slots).toEqual([]);
  });
});

describe('terminal PDF source', () => {
  it('returns a file uri for the downloaded PDF (path or uri) and the end of the chart cycle', async () => {
    const chart = makeTerminalChart('APD', 'AIRPORT DIAGRAM', '00001AD.PDF', '2611');
    const src = createTerminalPdfSource({ pdfPath: async () => '/cache/x.pdf' }, () => Date.UTC(2026, 10, 15));
    expect(await src.pdfUri(chart)).toBe('file:///cache/x.pdf');
    expect(fileUri('file:///a')).toBe('file:///a');
    expect(src.cycleExpiry('2611')).toBe(cycleWithCode('2611', Date.UTC(2026, 10, 15))!.expirationMs);
    expect(src.cycleExpiry('9999')).toBeNull();
    await expect(
      createTerminalPdfSource({ pdfPath: () => Promise.reject(new Error('offline')) }).pdfUri(chart),
    ).rejects.toThrow('offline');
  });
});
