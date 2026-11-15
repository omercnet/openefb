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
    product: 'us-diagrams', edition: '2611', editionLabel: 'd-TPP cycle 2611 (29 OCT 2026)', aipDate: '2026-10-29', accuracyFeet: 50,
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
  const dir = pack(({ files }) => { files['KPAO.png'] = Buffer.concat([png.subarray(0, png.length - 1), Buffer.from('y')]); }); // same length and signature; the manifest was computed before the change
  const errors = checkPack(dir).errors;
  assert.ok(errors.some((e) => /KPAO.png: sha256 differs/.test(e)));
  assert.ok(!errors.some((e) => /bytes, manifest says/.test(e)));
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

test('JSON roots that are not objects, and a numeric edition, are rejected', () => {
  for (const [file, value] of [['index.json', null], ['manifest.json', null], ['KPAO.json', null]]) {
    const dir = pack(({ files, manifest }) => {
      if (file === 'manifest.json') return;
      files[file] = Buffer.from(JSON.stringify(value));
      manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
    });
    if (file === 'manifest.json') writeFileSync(join(dir, 'manifest.json'), 'null');
    assert.ok(checkPack(dir).errors.some((e) => new RegExp(`${file}: the JSON root is not an object`).test(e)), file);
  }
  const dir = pack(({ files, index, manifest }) => {
    index.edition = 2611;
    files['index.json'] = Buffer.from(JSON.stringify(index));
    manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
  });
  assert.ok(checkPack(dir).errors.some((e) => /index.edition/.test(e)));
});

test('impossible cycles such as 0000 and 2699 are rejected, real ones pass', () => {
  for (const edition of ['0000', '2699', '2615']) {
    const dir = pack(({ files, index, manifest }) => {
      index.edition = edition;
      manifest.edition = edition;
      files['index.json'] = Buffer.from(JSON.stringify(index));
      manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
    });
    assert.ok(checkPack(dir).errors.some((e) => /not a d-TPP cycle/.test(e)), edition);
  }
  for (const edition of ['2601', '2613', '2614']) {
    const dir = pack(({ files, index, manifest }) => {
      index.edition = edition;
      manifest.edition = edition;
      files['index.json'] = Buffer.from(JSON.stringify(index));
      manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
    });
    assert.deepEqual(checkPack(dir).errors.filter((e) => /not a d-TPP cycle/.test(e)), [], edition);
  }
});

test('messages never echo a long or hostile value from the pack', () => {
  const secret = 'SECRET-' + 'x'.repeat(5000);
  const dir = pack(({ files, index, manifest }) => {
    index.product = secret;
    index.edition = secret;
    index.editionLabel = secret;
    index.aerodromes[secret] = index.aerodromes.KPAO;
    files['index.json'] = Buffer.from(JSON.stringify(index));
    manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
  });
  const errors = checkPack(dir).errors;
  assert.ok(errors.length > 0);
  assert.ok(errors.every((e) => e.length < 200 && !e.includes('x'.repeat(30))), errors.join('\n').slice(0, 300));
});

test('a non-string edition object reports errors instead of crashing the checker', () => {
  const dir = pack(({ files, index, manifest }) => {
    index.edition = { toString: null, valueOf: null };
    files['index.json'] = Buffer.from(JSON.stringify(index));
    manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
  });
  assert.ok(checkPack(dir).errors.some((e) => /index.edition/.test(e)));
});

test('an edition label that does not name exactly the edition is rejected', () => {
  for (const label of ['d-TPP cycle 26110 (29 OCT 2026)', 'd-TPP cycle 2611 (29 OCT 2026) extra', 'd-TPP cycle 2611 (00 JAN 2026)', 'd-TPP cycle 2611 (99 XYZ 2026)', 'd-TPP cycle 2611 (12 ABC 0000)', 'd-TPP cycle 2611 (12 NOV 2026)', 'd-TPP cycle 2610 (29 OCT 2026)', 'FAA cycle 2611']) {
    const dir = pack(({ files, index, manifest }) => {
      index.editionLabel = label;
      files['index.json'] = Buffer.from(JSON.stringify(index));
      manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
    });
    const errors = checkPack(dir).errors;
    assert.ok(errors.some((e) => /index.editionLabel .* is not "d-TPP cycle 2611 \(29 OCT 2026\)"/.test(e)), label);
    assert.ok(!errors.some((e) => /index.edition /.test(e)), 'the edition itself is valid');
  }
});

test('an aipDate that is not the cycle\'s effective date is rejected', () => {
  for (const aipDate of ['2026-11-12', '2026-02-30', 'soon']) {
    const dir = pack(({ files, index, manifest }) => {
      index.aipDate = aipDate;
      files['index.json'] = Buffer.from(JSON.stringify(index));
      manifest.files = Object.entries(files).map(([name, d]) => ({ name, bytes: d.length, sha256: createHash('sha256').update(d).digest('hex') }));
    });
    assert.ok(checkPack(dir).errors.some((e) => /index.aipDate .* is not the effective date 2026-10-29 of cycle 2611/.test(e)), aipDate);
  }
});
