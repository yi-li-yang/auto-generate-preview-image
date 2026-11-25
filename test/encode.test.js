import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { encodeStatic, encodeAnim } from '../src/encode.js';

// A detailed test picture: random noise over a gradient, so WebP cannot compress it to nothing.
async function noisyPng(width, height, seed = 1) {
  const raw = Buffer.alloc(width * height * 3);
  let x = seed;
  for (let i = 0; i < raw.length; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    raw[i] = ((i / 3) % width) * (255 / width) * 0.5 + (x % 128);
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const solidPng = (width, height, r, g, b) =>
  sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png().toBuffer();

const isWebp = (buf) => buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';

test('the static image is a WebP of the output size, under the byte budget', async () => {
  const png = await noisyPng(1600, 1000);
  const out = await encodeStatic(png, { width: 1200, height: 750, maxBytes: 250_000, position: 'centre' });
  assert.ok(isWebp(out.buffer));
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 750);
  assert.ok(out.buffer.length <= 250_000, `got ${out.buffer.length} bytes`);
});

test('with room in the budget the image keeps its quality; with a tight budget it drops quality to fit', async () => {
  const png = await noisyPng(1200, 750, 7);
  const generous = await encodeStatic(png, { width: 1200, height: 750, maxBytes: 5_000_000, position: 'centre' });
  // A budget one byte under the size sharp itself makes at the top quality.
  const top = await sharp(png).resize(1200, 750, { fit: 'cover' }).webp({ quality: generous.quality, effort: 6 }).toBuffer();
  const tight = await encodeStatic(png, { width: 1200, height: 750, maxBytes: top.length - 1, position: 'centre' });
  assert.ok(tight.quality < generous.quality, `tight ${tight.quality} vs generous ${generous.quality}`);
  assert.ok(tight.buffer.length < top.length);
});

test('an impossible budget fails and says the smallest size reached', async () => {
  const png = await noisyPng(1200, 750, 3);
  await assert.rejects(
    encodeStatic(png, { width: 1200, height: 750, maxBytes: 1_000, position: 'centre' }),
    /1000 bytes.*smallest was \d+ bytes/,
  );
});

test('the animation has one page per frame, loops forever, and keeps the frame timing', async () => {
  const frames = await Promise.all([
    solidPng(1200, 750, 255, 0, 0), solidPng(1200, 750, 0, 255, 0), solidPng(1200, 750, 0, 0, 255),
    solidPng(1200, 750, 255, 255, 0), solidPng(1200, 750, 0, 255, 255), solidPng(1200, 750, 255, 0, 255),
  ]);
  const out = await encodeAnim(frames, { width: 960, height: 600, maxBytes: 3_000_000, position: 'centre', fps: 10 });
  assert.ok(isWebp(out.buffer));
  const meta = await sharp(out.buffer, { animated: true }).metadata();
  assert.equal(meta.pages, 6);
  assert.equal(meta.width, 960);
  assert.equal(meta.pageHeight, 600);
  assert.equal(meta.loop, 0);
  assert.deepEqual(meta.delay, [100, 100, 100, 100, 100, 100]);
});
