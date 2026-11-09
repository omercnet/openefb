#!/usr/bin/env node
// Compare a screenshot with its SwiftUI reference (reference/<name>.png, 1032x1376 pt = iPad Pro 13-inch portrait).
// Both images are resized to 1032x1376; the 400 pt leading strip and the whole frame are scored separately.
// Prints JSON (SSIM, differing-pixel share) and writes <out>/<name>-side-by-side.png and <name>-diff.png.
//
//   node scripts/compare.mjs <screenshot.png> [reference.png] [--out dir]
//   node scripts/compare.mjs --dir <screens dir> [--out dir]   (every <dir>/<name>.png with a reference/ipad-<name>.png
//                                                              or reference/<name>.png counterpart)
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
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

async function rgba(path, width) {
  const { data, info } = await sharp(path).resize(W, H, { fit: 'fill' }).extract({ left: 0, top: 0, width, height: H })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

async function score(shot, ref, width) {
  const [a, b] = await Promise.all([rgba(shot, width), rgba(ref, width)]);
  const diff = new Uint8ClampedArray(a.data.length);
  const differing = pixelmatch(a.data, b.data, diff, width, H, { threshold: 0.1 });
  return { ssim: Math.round(ssim(a, b).mssim * 10000) / 10000, diffShare: Math.round((differing / (width * H)) * 10000) / 10000, diff };
}

async function compare(shot, ref, outDir) {
  const name = basename(shot, '.png');
  const strip = await score(shot, ref, STRIP);
  const frame = await score(shot, ref, W);
  mkdirSync(outDir, { recursive: true });
  const sideBySide = join(outDir, `${name}-side-by-side.png`);
  const diffPng = join(outDir, `${name}-diff.png`);
  const [left, right] = await Promise.all([shot, ref].map((p) => sharp(p).resize(W, H, { fit: 'fill' }).png().toBuffer()));
  await sharp({ create: { width: W * 2 + 16, height: H, channels: 3, background: '#FF00FF' } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: W + 16, top: 0 }]).png().toFile(sideBySide);
  await sharp(Buffer.from(frame.diff.buffer), { raw: { width: W, height: H, channels: 4 } }).png().toFile(diffPng);
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
const pairs = dir
  ? (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.png')).map((f) => [join(dir, f), referenceFor(f)]).filter(([, r]) => r)
  : [[args[0], args[1] ?? (args[0] && referenceFor(args[0]))]];
if (pairs.length === 0 || pairs.some(([s, r]) => !s || !r)) {
  console.error('usage: compare.mjs <screenshot.png> [reference.png] [--out dir] | --dir <screens> [--out dir]');
  process.exit(dir ? 0 : 2); // a directory without matching screenshots is not an error (nothing to compare)
}
const results = [];
for (const [shot, ref] of pairs) results.push(await compare(resolve(shot), resolve(ref), outDir));
console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
