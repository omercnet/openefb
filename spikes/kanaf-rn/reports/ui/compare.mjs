// node compare.mjs <name> <ref.png> <ours.png> <outDir>  -> prints JSON metrics, writes side-by-side
import { createRequire } from 'module';
const require = createRequire('/tmp/spike/tools/');
const sharp = require('sharp');
const pixelmatch = (await import('/tmp/spike/tools/node_modules/pixelmatch/index.js')).default;
const { ssim } = require('ssim.js');

const [name, refPath, oursPath, outDir] = process.argv.slice(2);
const W = 400, H = 1376;
const crop = async (p, top = 0) => {
  const { data } = await sharp(p).extract({ left: 0, top, width: W, height: H - top }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
};
const metrics = async (top) => {
  const a = await crop(refPath, top), b = await crop(oursPath, top);
  const h = H - top;
  const diff = Buffer.alloc(W * h * 4);
  const n = pixelmatch(a, b, diff, W, h, { threshold: 0.1, includeAA: true });
  const s = ssim({ data: new Uint8ClampedArray(a), width: W, height: h }, { data: new Uint8ClampedArray(b), width: W, height: h }).mssim;
  return { ssim: +s.toFixed(4), diffPct: +((100 * n) / (W * h)).toFixed(2), diff };
};
const full = await metrics(0);
const noStatus = await metrics(32); // excluding the iOS status bar (time / date text)
if (outDir) {
  const toPng = (buf, h) => sharp(buf, { raw: { width: W, height: h, channels: 4 } }).png().toBuffer();
  const ref = await sharp(refPath).extract({ left: 0, top: 0, width: W, height: H }).png().toBuffer();
  const ours = await sharp(oursPath).extract({ left: 0, top: 0, width: W, height: H }).png().toBuffer();
  const d = await toPng(full.diff, H);
  await sharp({ create: { width: W * 3 + 20, height: H, channels: 4, background: '#ffffff' } })
    .composite([{ input: ref, left: 0, top: 0 }, { input: ours, left: W + 10, top: 0 }, { input: d, left: 2 * W + 20, top: 0 }])
    .png().toFile(`${outDir}/${name}-side-by-side.png`);
}
console.log(JSON.stringify({ name, full: { ssim: full.ssim, diffPct: full.diffPct }, belowStatusBar: { ssim: noStatus.ssim, diffPct: noStatus.diffPct } }));
