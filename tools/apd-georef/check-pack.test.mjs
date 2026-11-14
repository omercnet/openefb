// node --test tools/apd-georef/check-pack.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPack } from './check-pack.mjs';

const rect = { x: 0, y: 0, width: 100, height: 100 };
const geo = { a: 1, b: 0, c: 0, d: 1, tx: -50, ty: -50, reference: rect, referenceLatitude: 37.4, referenceLongitude: -122.1, pageBox: rect, clipBox: rect, masks: [], diagnostics: {} };
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]);

function pack(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-'));
  const files = { 'KPAO.png': png, 'KPAO.json': Buffer.from(JSON.stringify(geo)) };
  const index = {
    product: 'us-diagrams', edition: '2611', editionLabel: 'd-TPP cycle 2611 (12 NOV 2026)', aipDate: '2026-11-12', accuracyFeet: 50,
    aerodromes: { KPAO: { chart: 'KPAO.PDF', language: 'en', scale: 'as charted', georeferenced: true, reason: 'accepted', sheet: '', image: 'KPAO.png', georeference: 'KPAO.json' } },
  };
  files['index.json'] = Buffer.from(JSON.stringify(index));
  const manifest = { product: 'us-diagrams', edition: '2611', published: false, files: Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') })) };
  mutate({ files, index, manifest });
  for (const [n, d] of Object.entries(files)) writeFileSync(join(dir, n), d);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

test('a well-formed pack passes', () => {
  const dir = pack();
  assert.deepEqual(checkPack(dir).errors, []);
  rmSync(dir, { recursive: true });
});

test('a corrupted file is caught by the manifest hash', () => {
  const dir = pack(({ files }) => { files['KPAO.png'] = Buffer.concat([png, Buffer.from('!')]); }); // manifest was computed before the change
  assert.ok(checkPack(dir).errors.some((e) => /KPAO.png/.test(e)));
  rmSync(dir, { recursive: true });
});

test('a singular transform, a non-PNG image and a wrong product fail', () => {
  const dir = pack(({ files, index, manifest }) => {
    files['KPAO.json'] = Buffer.from(JSON.stringify({ ...geo, a: 0, d: 0 }));
    files['KPAO.png'] = Buffer.from('not a png');
    index.product = 'il-diagrams';
    files['index.json'] = Buffer.from(JSON.stringify(index));
    manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
  });
  const errors = checkPack(dir).errors.join('\n');
  assert.match(errors, /singular/);
  assert.match(errors, /not a PNG/);
  assert.match(errors, /index.product/);
  rmSync(dir, { recursive: true });
});

test('too few airports fails the minimum', () => {
  const dir = pack();
  assert.ok(checkPack(dir, { min: 3 }).errors.some((e) => /expected at least 3/.test(e)));
  rmSync(dir, { recursive: true });
});
