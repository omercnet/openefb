// node --test tools/apd-georef/check-pack.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { checkPack } from './check-pack.mjs';

const rect = { x: 0, y: 0, width: 100, height: 100 };
const geo = { a: 1, b: 0, c: 0, d: 1, tx: -50, ty: -50, reference: rect, referenceLatitude: 37.4, referenceLongitude: -122.1, pageBox: rect, clipBox: rect, masks: [], diagnostics: { method: 'gridRunwayChecked', labelSource: 'text', latitudeLabels: 2, longitudeLabels: 2, rotationDegrees: 0, feetPerPoint: 6.5, scaleRatio: 1, runwaysMatched: 2, runwayResidualFeet: 20, maskedInsets: 0 } };
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]);

const made = [];
// Every temporary pack is removed when the file finishes, also after a failed assertion.
after(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

function pack(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-'));
  made.push(dir);
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
});

test('a corrupted file is caught by the manifest hash', () => {
  const dir = pack(({ files }) => { files['KPAO.png'] = Buffer.concat([png, Buffer.from('!')]); }); // manifest was computed before the change
  assert.ok(checkPack(dir).errors.some((e) => /KPAO.png/.test(e)));
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
});

test('too few airports fails the minimum', () => {
  const dir = pack();
  assert.ok(checkPack(dir, { min: 3 }).errors.some((e) => /expected at least 3/.test(e)));
});

test('empty diagnostics, which the app refuses to decode, fail', () => {
  const dir = pack(({ files, manifest }) => {
    files['KPAO.json'] = Buffer.from(JSON.stringify({ ...geo, diagnostics: {} }));
    manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
  });
  assert.match(checkPack(dir).errors.join('\n'), /diagnostics\.method/);
});

test('a manifest name that is a path or traversal is rejected, not read', () => {
  const dir = pack(({ manifest }) => { manifest.files.push({ name: '../../etc/passwd', bytes: 1, sha256: 'x' }, { name: '/etc/hosts', bytes: 1, sha256: 'x' }); });
  const errors = checkPack(dir).errors;
  assert.equal(errors.filter((e) => /unsafe or missing name/.test(e)).length, 2);
  assert.ok(!errors.some((e) => /passwd|hosts/.test(e)));
});
