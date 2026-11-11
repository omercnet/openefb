// Port of ServiceTests/IsraelAirportDiagramTests.swift (10 of 12 tests; the region gate belongs to L1 and the nearest
// aerodrome ordering to the overlay, M4), plus the georeference interface M4 consumes (Q6).
import type { ChartPackServiceLike } from './chartPackService';
import {
  clipCorners,
  coordinateForPagePoint,
  decodeGeoreference,
  metresPerDegree,
  pagePointForCoordinate,
  type AirportDiagramGeoreference,
} from './diagramGeoreference';
import {
  decodeDiagramIndex,
  DIAGRAM_PRODUCT,
  IsraelDiagramPack,
  loadDiagramPack,
  loadGeoreference,
  type DiagramIndex,
  type DiagramIndexRecord,
} from './diagramPack';
import type { ChartPackInstalled } from './manifest';
import { bytesOf, MemoryFileSystem } from './testSupport';

const record = (icao: string, georeferenced: boolean, reason = 'accepted'): DiagramIndexRecord => ({
  chart: `AD 2 ${icao} ADC`,
  language: 'en',
  scale: 'bar only',
  georeferenced,
  reason,
  sheet: `${icao}.pdf`,
  image: georeferenced ? `${icao}.png` : null,
  georeference: georeferenced ? `${icao}.json` : null,
});

const index = (records: Record<string, DiagramIndexRecord>, edition = '2026-08'): DiagramIndex => ({
  product: 'il-diagrams',
  edition,
  editionLabel: 'AIRAC AMDT 001/2026 (06 AUG 2026)',
  aipDate: '2026-08-06',
  accuracyFeet: 100,
  aerodromes: records,
});

const pack = (idx: DiagramIndex, files: string[]) =>
  new IsraelDiagramPack(idx, (name) => (files.includes(name) ? `/d/${name}` : null));

/** A georeference placed at LLBG: 6.78 m per PDF point, north-up, page 1000 x 700 pt. */
const page = { x: 0, y: 0, width: 1000, height: 700 };
const georeference: AirportDiagramGeoreference = {
  a: 6.78,
  b: 0,
  c: 0,
  d: 6.78,
  tx: -3390,
  ty: -2373,
  reference: page,
  referenceLatitude: 32.0094,
  referenceLongitude: 34.8856,
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
};

function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

// MARK: Availability

test('A georeferenced aerodrome with its files is drawable; ICAO lookup ignores case', () => {
  const p = pack(index({ LLBG: record('LLBG', true) }), ['LLBG.png', 'LLBG.json', 'LLBG.pdf']);
  const a = p.availability('llbg');
  expect(a.kind).toBe('georeferenced');
  expect(a.kind === 'georeferenced' && a.record.chart).toBe('AD 2 LLBG ADC');
  expect(p.georeferencedICAOs).toEqual(['LLBG']);
  expect(p.diagramFiles('LLBG')).toEqual({
    imagePath: '/d/LLBG.png',
    georeferencePath: '/d/LLBG.json',
    sheetPath: '/d/LLBG.pdf',
  });
});

test('A diagram that failed the gate is sheet only: never drawn, still viewable', () => {
  const failed = record('LLHZ', false, 'runway cross-check failed: worst runway error 72 ft');
  const p = pack(index({ LLHZ: failed }), ['LLHZ.pdf']);
  expect(p.availability('LLHZ')).toEqual({ kind: 'sheetOnly', record: failed });
  expect(p.georeferencedICAOs).toEqual([]);
  expect(p.sheetPath('LLHZ')).not.toBeNull();
  expect(p.diagramFiles('LLHZ')).toBeNull();
});

test('A georeferenced record whose image is missing degrades to the sheet, not to a guess', () => {
  const r = record('LLBG', true);
  const p = pack(index({ LLBG: r }), ['LLBG.json', 'LLBG.pdf']);
  expect(p.availability('LLBG')).toEqual({ kind: 'sheetOnly', record: r });
  expect(p.georeferencedICAOs).toEqual([]);
});

test('Unknown aerodrome, or a record with no files at all, has no diagram', () => {
  const p = pack(index({ LLBG: record('LLBG', false) }), []);
  expect(p.availability('LLBG')).toEqual({ kind: 'none' });
  expect(p.availability('LLKS')).toEqual({ kind: 'none' });
  expect(p.availability('constructor')).toEqual({ kind: 'none' }); // JS-only: prototype keys are not aerodromes
  expect(p.availability('__proto__')).toEqual({ kind: 'none' });
});

// MARK: Same decode as the US overlay

test('Georeference JSON from the pack decodes through the shared decoder and places the clip box at the airport', () => {
  const decoded = decodeGeoreference(JSON.stringify(georeference));
  expect(decoded).toEqual(georeference);
  const corners = clipCorners(decoded);
  expect(corners).toHaveLength(4);
  // Page centre lands within 50 m of the reference point; the chart spans about 6.8 km east-west.
  const centre = coordinateForPagePoint(decoded, { x: 500, y: 350 });
  expect(metres(centre, { lat: 32.0094, lon: 34.8856 })).toBeLessThan(50);
  expect(Math.abs(metres(corners[0], corners[3]) - 6780)).toBeLessThan(100);
  // top-left, bottom-left, bottom-right, top-right
  expect(corners[0].lat).toBeGreaterThan(corners[1].lat);
  expect(corners[0].lon).toBeLessThan(corners[3].lon);
});

test('Index JSON written by tools/caai-apd decodes', () => {
  const json = `{"product":"il-diagrams","edition":"2026-08","editionLabel":"AIRAC AMDT 001/2026 (06 AUG 2026)","aipDate":"2026-08-06","accuracyFeet":100,
   "aerodromes":{"LLHA":{"chart":"AD 2 LLHA ADC","language":"en","scale":"bar only","georeferenced":false,
   "reason":"1 runway in the database","sheet":"LLHA.pdf"}}}`;
  const decoded = decodeDiagramIndex(json);
  expect(decoded.aerodromes.LLHA.image).toBeNull();
  expect(decoded.aerodromes.LLHA.georeferenced).toBe(false);
});

test('The badge shows the edition and the accuracy the diagrams were gated to', () => {
  expect(pack(index({}), []).badgeText).toBe('CAAI aerodrome diagrams AIRAC AMDT 001/2026 (06 AUG 2026) \u00b1100 ft');
});

// MARK: Edition gating

const installedRecord = (edition = '2026-08'): ChartPackInstalled => ({
  product: 'il-diagrams',
  edition,
  editionLabel: 'x',
  files: [{ name: 'index.json', bytes: 1, sha256: '00' }],
  installedAtMs: 0,
});

/** A stub ChartPackService over an in-memory folder (like the Swift StubPackService). */
function installedPack(indexEdition: string, extraFiles: Record<string, string> = {}) {
  const fs = new MemoryFileSystem();
  fs.put('/d/index.json', bytesOf(JSON.stringify(index({ LLBG: record('LLBG', false) }, indexEdition))));
  for (const [name, text] of Object.entries(extraFiles)) fs.put(`/d/${name}`, bytesOf(text));
  const installed = installedRecord();
  const service = {
    product: DIAGRAM_PRODUCT,
    installed: async () => installed,
    fileLocation: (_r: ChartPackInstalled, name: string) => (fs.exists(`/d/${name}`) ? `/d/${name}` : null),
  } as unknown as ChartPackServiceLike;
  return { fs, service };
}

test('An edition that was not published and validated at download is never shown', async () => {
  const { fs, service } = installedPack('2026-08');
  expect(await loadDiagramPack({ service, fs, servedEdition: null, allowUnpublished: false })).toBeNull();
  expect(await loadDiagramPack({ service, fs, servedEdition: '2025-02', allowUnpublished: false })).toBeNull();
});

test('A served edition loads; the developer setting lifts the gate', async () => {
  const { fs, service } = installedPack('2026-08');
  expect((await loadDiagramPack({ service, fs, servedEdition: '2026-08', allowUnpublished: false }))?.edition).toBe(
    '2026-08',
  );
  expect((await loadDiagramPack({ service, fs, servedEdition: null, allowUnpublished: true }))?.edition).toBe(
    '2026-08',
  );
});

test('An index that belongs to a different edition than the installed one is rejected', async () => {
  const { fs, service } = installedPack('2025-02');
  expect(await loadDiagramPack({ service, fs, servedEdition: '2026-08', allowUnpublished: false })).toBeNull();
});

// JS-only guards (port notes S1c)

test('loadGeoreference returns the decoded transform with the image path, and null for a bad or missing file', async () => {
  const fs = new MemoryFileSystem();
  const p = pack(index({ LLBG: record('LLBG', true) }), ['LLBG.png', 'LLBG.json', 'LLBG.pdf']);
  expect(await loadGeoreference(p, fs, 'LLBG')).toBeNull(); // file listed but unreadable
  fs.put('/d/LLBG.json', bytesOf(JSON.stringify(georeference)));
  const ok = await loadGeoreference(p, fs, 'llbg');
  expect(ok?.imagePath).toBe('/d/LLBG.png');
  expect(ok?.georeference.referenceLatitude).toBe(32.0094);
  fs.put('/d/LLBG.json', bytesOf('{"a":1}'));
  const logs: string[] = [];
  expect(await loadGeoreference(p, fs, 'LLBG', (m) => logs.push(m))).toBeNull();
  expect(logs).toHaveLength(1);
  expect(await loadGeoreference(p, fs, 'LLHZ')).toBeNull();
});

test('a singular or off-globe georeference is rejected, and the inverse round-trips', () => {
  expect(() => decodeGeoreference(JSON.stringify({ ...georeference, a: 0, d: 0 }))).toThrow();
  expect(() => decodeGeoreference(JSON.stringify({ ...georeference, referenceLatitude: 95 }))).toThrow();
  expect(() =>
    decodeGeoreference(
      JSON.stringify({ ...georeference, diagnostics: { ...georeference.diagnostics, method: 'guess' } }),
    ),
  ).toThrow();
  expect(() => decodeGeoreference('nope')).toThrow();
  const p = pagePointForCoordinate(georeference, coordinateForPagePoint(georeference, { x: 123, y: 456 }));
  expect(p.x).toBeCloseTo(123, 6);
  expect(p.y).toBeCloseTo(456, 6);
  const m = metresPerDegree(32);
  expect(m.lat).toBeGreaterThan(110_000);
  expect(m.lon).toBeLessThan(m.lat);
});

test('a rotated transform places the clip corners consistently with its inverse', () => {
  const rotated: AirportDiagramGeoreference = { ...georeference, a: 0, b: 6.78, c: -6.78, d: 0, tx: 0, ty: 0 };
  for (const corner of clipCorners(rotated)) {
    const back = pagePointForCoordinate(rotated, corner);
    expect(coordinateForPagePoint(rotated, back).lat).toBeCloseTo(corner.lat, 9);
  }
});

test('an index with a wrong-typed field is rejected', () => {
  expect(() =>
    decodeDiagramIndex(
      '{"product":"il-diagrams","edition":"x","editionLabel":"y","aipDate":"z","accuracyFeet":"100","aerodromes":{}}',
    ),
  ).toThrow();
  expect(() => decodeDiagramIndex('[]')).toThrow();
});
