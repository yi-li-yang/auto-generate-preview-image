import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { diffScore } from '../src/compare.js';

// The spec's default keepIfDiffBelow.
const KEEP = 0.01;

const solid = (r, g, b, format = 'webp') =>
  sharp({ create: { width: 1200, height: 750, channels: 3, background: { r, g, b } } })[format]().toBuffer();

const box = (w, h, v) => sharp({ create: { width: w, height: h, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer();

async function scene(extra = []) {
  const base = await sharp({ create: { width: 1200, height: 750, channels: 3, background: { r: 20, g: 20, b: 40 } } })
    .png().toBuffer();
  return sharp(base).composite([{ input: await box(300, 100, 240), left: 100, top: 600 }, ...extra]).png().toBuffer();
}

test('the same picture has no difference', async () => {
  const a = await solid(40, 80, 120);
  assert.equal(await diffScore(a, a), 0);
});

test('black against white is the largest difference', async () => {
  assert.ok((await diffScore(await solid(0, 0, 0), await solid(255, 255, 255))) > 0.99);
});

test('a label-sized change in one corner counts as a visible change', async () => {
  // Like a timeline label that changes from 2027 to 2026: small, in a corner, but real.
  const before = await scene();
  const after = await scene([{ input: await box(60, 20, 255), left: 1050, top: 680 }]);
  const d = await diffScore(before, after);
  assert.ok(d >= KEEP, `score ${d} would keep a stale image`);
});

test('a change of a few pixels stays under the keep threshold, like rendering noise', async () => {
  const before = await scene();
  const after = await scene([{ input: await box(2, 2, 255), left: 600, top: 300 }]);
  const d = await diffScore(before, after);
  assert.ok(d > 0 && d < KEEP, `score ${d}`);
});

test('animations with a different number of frames count as fully different', async () => {
  const frame = (v) => sharp({ create: { width: 96, height: 60, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer();
  const anim = async (n) => sharp(await Promise.all(Array.from({ length: n }, (_, i) => frame(i * 20))), { join: { animated: true } })
    .webp({ loop: 0, delay: Array(n).fill(100) }).toBuffer();
  assert.equal(await diffScore(await anim(3), await anim(4)), 1);
});
