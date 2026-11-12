#!/usr/bin/env node
// Compare a screenshot with its SwiftUI reference (reference/<name>.png, 1032x1376 pt = iPad Pro 13-inch portrait).
// Both images are resized to 1032x1376; the 400 pt leading strip and the whole frame are scored separately.
// Prints JSON (SSIM, differing-pixel share) and writes <out>/<name>-side-by-side.png and <name>-diff.png.
//
//   node scripts/compare.mjs <screenshot.png> [reference.png] [--out dir]
//   node scripts/compare.mjs --dir <screens dir> [--out dir]   (every <dir>/<name>.png with a reference/ipad-<name>.png
//                                                              or reference/<name>.png counterpart)
// Gate: add `--gate <ios|android>` (thresholds from scripts/fidelity-thresholds.json, or `--thresholds <file>`) to exit 1
// when a screen's strip SSIM (or its whole-frame SSIM where the entry says "metric": "frame") is below its floor or a screen
// listed for the platform was not captured. `--json <file>` writes
// the results (with the gate verdict) to a file in addition to stdout. Android: `--shot-dpr 2 --shot-top 24 --ref-top 32 --rows 900`.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import sharp from 'sharp';
import ssimModule from 'ssim.js';

const ssim = ssimModule.ssim ?? ssimModule.default ?? ssimModule;
const W = 1032;
const H = 1376;
const STRIP = 400;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Screen name -> reference file, for screenshots named after the kanaf-dev://<screen> route.
const REFERENCE_FOR = { map: 'ipad-map-day.png', night: 'ipad-map-night.png', airport: 'ipad-airport-KSQL.png' };

// The screenshot at 1 pt per pixel. iOS screenshots are scaled to the reference size (1032x1376). With --shot-dpr <n> (Android,
// where the emulator's density is 2 and its screen is not the reference's aspect) the screenshot is divided by n instead, so a
// 400 dp column is 400 px wide like the reference's 400 pt column, and both images are cropped to the rows both have.
async function loadShot(path) {
  if (!shotDpr) return sharp(path).resize(W, H, { fit: 'fill' }).png().toBuffer();
  const { width, height } = await sharp(path).metadata();
  return sharp(path).resize(Math.round(width / shotDpr), Math.round(height / shotDpr), { fit: 'fill' }).png().toBuffer();
}

async function rgba(buf, width, box, top) {
  const { data, info } = await sharp(buf).extract({ left: 0, top, width: Math.min(width, box.w), height: box.h })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

async function score(shotBuf, refBuf, width, box) {
  const [a, b] = await Promise.all([rgba(shotBuf, width, box, shotTop), rgba(refBuf, width, box, refTop)]);
  const diff = new Uint8ClampedArray(a.data.length);
  const differing = pixelmatch(a.data, b.data, diff, a.width, a.height, { threshold: 0.1 });
  return { ssim: Math.round(ssim(a, b).mssim * 10000) / 10000, diffShare: Math.round((differing / (a.width * a.height)) * 10000) / 10000, diff, width: a.width, height: a.height };
}

async function compare(shot, ref, outDir) {
  const name = basename(shot, '.png');
  const left = await loadShot(shot);
  const right = await sharp(ref).resize(W, H, { fit: 'fill' }).png().toBuffer();
  const shotMeta = await sharp(left).metadata();
  const box = { w: Math.min(W, shotMeta.width), h: Math.min(rows || H, H - refTop, shotMeta.height - shotTop) };
  const strip = await score(left, right, STRIP, box);
  const frame = await score(left, right, W, box);
  mkdirSync(outDir, { recursive: true });
  const sideBySide = join(outDir, `${name}-side-by-side.png`);
  const diffPng = join(outDir, `${name}-diff.png`);
  await sharp({ create: { width: W * 2 + 16, height: H, channels: 3, background: '#FF00FF' } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: W + 16, top: 0 }]).png().toFile(sideBySide);
  await sharp(Buffer.from(frame.diff.buffer), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toFile(diffPng);
  return {
    screenshot: shot, reference: ref,
    strip: { ssim: strip.ssim, diffShare: strip.diffShare },
    frame: { ssim: frame.ssim, diffShare: frame.diffShare },
    sideBySide, diff: diffPng,
  };
}

function referenceFor(shot) {
  const name = basename(shot, '.png');
  const candidates = [REFERENCE_FOR[name], `ipad-${name}.png`, `${name}.png`].filter(Boolean).map((f) => join(ROOT, 'reference', f));
  return candidates.find(existsSync) ?? null;
}

const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); return i >= 0 ? args.splice(i, 2)[1] : null; };
const outDir = resolve(flag('--out') ?? join(ROOT, 'reports', 'out', 'compare'));
const dir = flag('--dir');
const gate = flag('--gate');
const thresholdsFile = flag('--thresholds');
const jsonFile = flag('--json');
const shotDpr = Number(flag('--shot-dpr') ?? 0);
// Alignment crops (Android): rows dropped above the screenshot (its status bar, in dp) and above the reference (the iOS status
// bar, 32 pt), and how many rows are compared (the bottom toolbar sits at the bottom of a different-height screen).
const shotTop = Number(flag('--shot-top') ?? 0);
const refTop = Number(flag('--ref-top') ?? 0);
const rows = Number(flag('--rows') ?? 0);
const pairs = dir
  ? (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.png')).map((f) => [join(dir, f), referenceFor(f)]).filter(([, r]) => r)
  : [[args[0], args[1] ?? (args[0] && referenceFor(args[0]))]];
if ((pairs.length === 0 && !gate) || pairs.some(([s, r]) => !s || !r)) {
  console.error('usage: compare.mjs <screenshot.png> [reference.png] [--out dir] | --dir <screens> [--out dir]');
  process.exit(dir ? 0 : 2); // a directory without matching screenshots is not an error (nothing to compare)
}
const results = [];
for (const [shot, ref] of pairs) results.push(await compare(resolve(shot), resolve(ref), outDir));

let failed = false;
if (gate) {
  const table = JSON.parse(readFileSync(resolve(thresholdsFile ?? join(ROOT, 'scripts', 'fidelity-thresholds.json')), 'utf8'))[gate];
  if (!table) { console.error(`compare: no thresholds for platform '${gate}'`); process.exit(2); }
  const byName = new Map(results.map((r) => [basename(r.screenshot, '.png'), r]));
  const verdicts = Object.entries(table).map(([screen, t]) => {
    const floor = t.interim ?? t.min;
    const r = byName.get(screen);
    // The leading 400 pt strip, or with "metric": "frame" the whole frame (a screen that is not a strip, such as the Log).
    const metric = t.metric ?? 'strip';
    if (metric !== 'strip' && metric !== 'frame') { console.error(`compare: ${gate} ${screen}: unknown metric '${metric}' (strip or frame)`); process.exit(2); }
    const got = r ? r[metric].ssim : null;
    // "referencePending": the SwiftUI reference is not in the repo yet (Q6 / PR #48): no gate until it lands and the entry is dropped.
    if (t.referencePending && !r) return { screen, metric, floor, target: t.min, ssim: null, pass: true, pending: true };
    return { screen, metric, floor, target: t.min, ssim: got, pass: got !== null && got >= floor };
  });
  for (const v of verdicts) {
    const what = v.metric === 'strip' ? 'ssim' : `${v.metric} ssim`;
    console.error(v.pending ? `fidelity ${gate} ${v.screen}: reference pending (Q6), not gated` : `fidelity ${gate} ${v.screen}: ${what} ${v.ssim ?? 'MISSING'} floor ${v.floor} (target ${v.target}) ${v.pass ? 'ok' : 'FAIL'}`);
  }
  failed = verdicts.some((v) => !v.pass);
  for (const r of results) r.gate = verdicts.find((v) => v.screen === basename(r.screenshot, '.png')) ?? null;
}
const out = JSON.stringify(results.length === 1 ? results[0] : results, null, 2);
if (jsonFile) writeFileSync(resolve(jsonFile), out);
console.log(out);
if (failed) process.exit(1);
