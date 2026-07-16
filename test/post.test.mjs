import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { keyCutout, fitContain, fitCover, quantizePalette } from '../dist/index.js';

const MAGENTA = [255, 0, 255];

/** A synthetic "model output": magenta backdrop, opaque grey block inside. */
async function keyedImage(w = 100, h = 80) {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${w}" height="${h}" fill="#ff00ff"/>
    <rect x="${w / 4}" y="${h / 4}" width="${w / 2}" height="${h / 2}" fill="#607080"/>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

test('keyCutout clears the keyed backdrop into real alpha', async () => {
  const cut = await keyCutout(await keyedImage(), MAGENTA, 110);
  assert.ok(cut.borderKeyFrac > 0.95, `border ${cut.borderKeyFrac}`);
  assert.ok(cut.clearedFrac > 0.5 && cut.clearedFrac < 0.9, `cleared ${cut.clearedFrac}`);
  const { data, info } = await sharp(Buffer.from(cut.bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, 'corner pixel is transparent');
  const mid = ((info.width * (info.height / 2) + info.width / 2) | 0) * 4;
  assert.equal(data[mid + 3], 255, 'subject pixel stays opaque');
});

test('keyCutout refuses to guess when the key was ignored', async () => {
  const svg = '<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" fill="#334455"/></svg>';
  const input = new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
  const cut = await keyCutout(input, MAGENTA, 110);
  assert.equal(cut.clearedFrac, 0);
  assert.ok(cut.borderKeyFrac < 0.5);
  assert.equal(cut.bytes, input, 'input returned untouched');
});

test('fitContain lands on exact target px without cropping the subject', async () => {
  const cut = await keyCutout(await keyedImage(200, 100), MAGENTA, 110);
  const fitted = await fitContain(cut.bytes, 64, 48);
  const meta = await sharp(Buffer.from(fitted)).metadata();
  assert.equal(meta.width, 64);
  assert.equal(meta.height, 48);
});

test('fitCover fills the exact target', async () => {
  const fitted = await fitCover(await keyedImage(128, 128), 32, 32);
  const meta = await sharp(Buffer.from(fitted)).metadata();
  assert.equal(meta.width, 32);
  assert.equal(meta.height, 32);
});

test('quantizePalette locks every opaque pixel onto the palette', async () => {
  const palette = [[26, 28, 44], [244, 244, 244]];
  const q = await quantizePalette(await keyedImage(20, 20), palette);
  const { data } = await sharp(Buffer.from(q)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let o = 0; o < data.length; o += 4) {
    if (data[o + 3] < 8) continue;
    const rgb = [data[o], data[o + 1], data[o + 2]];
    assert.ok(palette.some((p) => p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2]),
      `pixel ${rgb.join(',')} is not a palette colour`);
  }
});
