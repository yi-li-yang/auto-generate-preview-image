import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { meanDiff } from '../src/compare.js';

const solid = (r, g, b, format = 'webp') =>
  sharp({ create: { width: 1200, height: 750, channels: 3, background: { r, g, b } } })[format]().toBuffer();

test('the same picture has no difference', async () => {
  const a = await solid(40, 80, 120);
  assert.equal(await meanDiff(a, a), 0);
});

test('black against white is the largest difference', async () => {
  assert.ok((await meanDiff(await solid(0, 0, 0), await solid(255, 255, 255))) > 0.99);
});

test('a few changed pixels stay under the default keep threshold of 0.005', async () => {
  const base = await sharp({ create: { width: 1200, height: 750, channels: 3, background: { r: 30, g: 30, b: 30 } } })
    .png().toBuffer();
  const dot = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .png().toBuffer();
  const changed = await sharp(base).composite([{ input: dot, left: 600, top: 300 }]).png().toBuffer();
  const d = await meanDiff(base, changed);
  assert.ok(d > 0 && d < 0.005, `diff ${d}`);
});

test('animations with a different number of frames count as fully different', async () => {
  const frame = (v) => sharp({ create: { width: 96, height: 60, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer();
  const anim = async (n) => sharp(await Promise.all(Array.from({ length: n }, (_, i) => frame(i * 20))), { join: { animated: true } })
    .webp({ loop: 0, delay: Array(n).fill(100) }).toBuffer();
  assert.equal(await meanDiff(await anim(3), await anim(4)), 1);
});
