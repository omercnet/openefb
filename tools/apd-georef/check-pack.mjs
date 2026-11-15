#!/usr/bin/env node
// Validates a built us-diagrams pack (PackWriter.swift output) against what the app reads:
// app/src/services/charts/diagramPack.ts (index.json), diagramGeoreference.ts (<ICAO>.json) and the web/charts
// manifest (bytes + sha256 of every file). No dependencies. Usage: node check-pack.mjs <pack dir> [--min N]
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// Untrusted values in a message: their type and at most 24 characters, so a crafted pack cannot flood the log.
const brief = (v) => (typeof v === 'string' ? `${JSON.stringify(v.slice(0, 24))}${v.length > 24 ? ` (${v.length} chars)` : ''}` : typeof v);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const rect = (v) => isObj(v) && ['x', 'y', 'width', 'height'].every((k) => num(v[k]));

function readJson(path, errors) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!isObj(value)) {
      errors.push(`${basename(path)}: the JSON root is not an object`);
      return null;
    }
    return value;
  } catch (e) {
    errors.push(`${basename(path)}: not readable JSON (${e.message})`);
    return null;
  }
}

function checkGeoreference(g, name, errors) {
  if (!isObj(g)) return errors.push(`${name}: not an object`);
  for (const k of ['a', 'b', 'c', 'd', 'tx', 'ty', 'referenceLatitude', 'referenceLongitude']) {
    if (!num(g[k])) errors.push(`${name}: ${k} is not a finite number`);
  }
  for (const k of ['reference', 'pageBox', 'clipBox']) if (!rect(g[k])) errors.push(`${name}: ${k} is not a rect`);
  if (!Array.isArray(g.masks)) errors.push(`${name}: masks is not an array`);
  const d = g.diagnostics;
  if (!isObj(d)) errors.push(`${name}: diagnostics missing`);
  else {
    // What decodeGeoreference requires: without these the app drops the airport's overlay.
    if (!['grid', 'gridRunwayChecked', 'runway'].includes(d.method)) errors.push(`${name}: diagnostics.method is ${brief(d.method)}`);
    if (!['text', 'ocr', 'none'].includes(d.labelSource)) errors.push(`${name}: diagnostics.labelSource is ${brief(d.labelSource)}`);
    for (const k of ['latitudeLabels', 'longitudeLabels', 'rotationDegrees', 'runwaysMatched', 'maskedInsets']) {
      if (!Number.isInteger(d[k])) errors.push(`${name}: diagnostics.${k} is not an integer`);
    }
    if (!num(d.feetPerPoint)) errors.push(`${name}: diagnostics.feetPerPoint is not a number`);
    for (const k of ['scaleRatio', 'runwayResidualFeet', 'runwayMidpointFeet', 'runwayEndFeet', 'runwayBestMidpointFeet', 'runwayMedianMidpointFeet']) {
      if (d[k] !== undefined && d[k] !== null && !num(d[k])) errors.push(`${name}: diagnostics.${k} is not a number`);
    }
  }
  if (Array.isArray(g.masks) && !g.masks.every((m) => isObj(m) && ['centerX', 'centerY', 'radius'].every((k) => num(m[k])))) errors.push(`${name}: a mask is malformed`);
  if (num(g.a) && num(g.b) && num(g.c) && num(g.d) && g.a * g.d - g.b * g.c === 0) errors.push(`${name}: singular transform`);
  if (num(g.referenceLatitude) && Math.abs(g.referenceLatitude) > 90) errors.push(`${name}: latitude out of range`);
  if (num(g.referenceLongitude) && Math.abs(g.referenceLongitude) > 180) errors.push(`${name}: longitude out of range`);
  // The overlay is airport sized: a transform that puts the page far from its own reference point is wrong.
  if (num(g.tx) && num(g.ty) && Math.hypot(g.tx, g.ty) > 50_000) errors.push(`${name}: page origin ${Math.round(Math.hypot(g.tx, g.ty))} m from the reference`);
}

/** Returns { errors, airports, bytes }. */
export function checkPack(dir, { min = 1 } = {}) {
  const errors = [];
  const indexPath = join(dir, 'index.json');
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(indexPath)) return { errors: ['index.json missing'], airports: 0, bytes: 0 };
  const index = readJson(indexPath, errors);
  const manifest = existsSync(manifestPath) ? readJson(manifestPath, errors) : (errors.push('manifest.json missing'), null);
  if (!index) return { errors, airports: 0, bytes: 0 };

  if (index.product !== 'us-diagrams') errors.push(`index.product is ${brief(index.product)}`);
  if (typeof index.edition !== 'string' || !/^\d{2}(0[1-9]|1[0-4])$/.test(index.edition)) errors.push(`index.edition ${brief(index.edition)} is not a d-TPP cycle (YYNN, NN from 01 to 14)`);
  if (typeof index.editionLabel === 'string' && !index.editionLabel.startsWith(`d-TPP cycle ${index.edition}`)) errors.push(`index.editionLabel ${brief(index.editionLabel)} does not name the cycle`);
  for (const k of ['editionLabel', 'aipDate']) if (typeof index[k] !== 'string' || !index[k]) errors.push(`index.${k} missing`);
  if (typeof index.aipDate === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(index.aipDate)) errors.push('index.aipDate is not yyyy-MM-dd');
  if (!Number.isInteger(index.accuracyFeet)) errors.push('index.accuracyFeet is not an integer');
  if (!isObj(index.aerodromes)) return { errors: [...errors, 'index.aerodromes is not an object'], airports: 0, bytes: 0 };

  const named = new Set();
  const icaos = Object.keys(index.aerodromes);
  for (const icao of icaos) {
    const r = index.aerodromes[icao];
    if (!/^[A-Z0-9]{3,4}$/.test(icao)) { errors.push(`${brief(icao)}: not an airport identifier`); continue; }
    if (!isObj(r)) { errors.push(`${icao}: record is not an object`); continue; }
    for (const k of ['chart', 'language', 'scale', 'reason']) if (typeof r[k] !== 'string') errors.push(`${icao}: ${k} is not a string`);
    if (typeof r.sheet !== 'string') errors.push(`${icao}: sheet is not a string`);
    if (r.georeferenced !== true) { errors.push(`${icao}: the US pack lists only georeferenced airports`); continue; }
    if (r.image !== `${icao}.png` || r.georeference !== `${icao}.json`) { errors.push(`${icao}: image/georeference names are ${brief(r.image)}/${brief(r.georeference)}`); continue; }
    named.add(r.image); named.add(r.georeference);
    const png = join(dir, r.image);
    if (!existsSync(png)) errors.push(`${icao}: ${r.image} missing`);
    else if (!readFileSync(png).subarray(0, 8).equals(PNG)) errors.push(`${icao}: ${r.image} is not a PNG`);
    const gp = join(dir, r.georeference);
    if (!existsSync(gp)) errors.push(`${icao}: ${r.georeference} missing`);
    else { const g = readJson(gp, errors); if (g) checkGeoreference(g, r.georeference, errors); }
  }
  if (icaos.length < min) errors.push(`only ${icaos.length} airports, expected at least ${min}`);

  let bytes = 0;
  if (manifest) {
    if (manifest.product !== 'us-diagrams' || manifest.edition !== index.edition) errors.push('manifest product/edition differ from index.json');
    if (manifest.published !== false) errors.push('manifest.published must be false');
    if (!Array.isArray(manifest.files)) errors.push('manifest.files is not an array');
    const listed = new Set();
    for (const [n, f] of (Array.isArray(manifest.files) ? manifest.files : []).entries()) {
      // Names are untrusted: plain file names inside the pack only, never a path or a link out of it.
      if (!isObj(f) || typeof f.name !== 'string' || !SAFE_NAME.test(f.name) || f.name.includes('..')) {
        errors.push(`manifest.files[${n}] has an unsafe or missing name`);
        continue;
      }
      listed.add(f.name);
      const p = join(dir, f.name);
      if (!existsSync(p)) { errors.push(`manifest lists missing file ${f.name}`); continue; }
      if (!lstatSync(p).isFile()) { errors.push(`${f.name}: not a regular file`); continue; }
      const data = readFileSync(p);
      bytes += data.length;
      if (data.length !== f.bytes) errors.push(`${f.name}: ${data.length} bytes, manifest says ${f.bytes}`);
      if (createHash('sha256').update(data).digest('hex') !== f.sha256) errors.push(`${f.name}: sha256 differs from the manifest`);
    }
    for (const n of [...named, 'index.json']) if (!listed.has(n)) errors.push(`${n} is not in the manifest`);
    for (const n of readdirSync(dir)) if (n !== 'manifest.json' && !listed.has(n)) errors.push(`${n} is in the pack but not in the manifest`);
  }
  return { errors, airports: icaos.length, bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const minAt = args.indexOf('--min');
  if (!dir) { console.error('usage: check-pack.mjs <pack dir> [--min N]'); process.exit(2); }
  const { errors, airports, bytes } = checkPack(dir, { min: minAt >= 0 ? Number(args[minAt + 1]) : 1 });
  for (const e of errors) console.error(`FAIL ${e}`);
  console.log(`${airports} airports, ${bytes} bytes, ${errors.length} problems`);
  process.exit(errors.length ? 1 : 0);
}
