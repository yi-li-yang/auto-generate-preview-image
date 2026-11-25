// Encodes screenshots as WebP under a byte budget. It tries the highest quality first and steps
// down only as far as the budget needs, so an image is never degraded more than necessary.

import sharp from 'sharp';

const STATIC_QUALITIES = [82, 76, 70, 64, 58, 50];
const ANIM_QUALITIES = [75, 65, 55, 45, 35];

function cropPosition(position) {
  if (position === 'attention') return sharp.strategy.attention;
  if (position === 'entropy') return sharp.strategy.entropy;
  return position;
}

function overBudget(kind, maxBytes, smallest) {
  return new Error(
    `could not get the ${kind} under ${maxBytes} bytes; the smallest was ${smallest.bytes} bytes `
    + `at quality ${smallest.quality}. Show less detail, or raise the budget in the spec.`,
  );
}

export async function encodeStatic(png, { width, height, maxBytes, position }) {
  let smallest = null;
  for (const quality of STATIC_QUALITIES) {
    const buffer = await sharp(png)
      .resize(width, height, { fit: 'cover', position: cropPosition(position) })
      .webp({ quality, effort: 6 })
      .toBuffer();
    if (buffer.length <= maxBytes) return { buffer, quality };
    if (!smallest || buffer.length < smallest.bytes) smallest = { bytes: buffer.length, quality };
  }
  throw overBudget('image', maxBytes, smallest);
}

export async function encodeAnim(frames, { width, height, maxBytes, position, fps }) {
  const resized = await Promise.all(frames.map((frame) => sharp(frame)
    .resize(width, height, { fit: 'cover', position: cropPosition(position) })
    .png()
    .toBuffer()));
  const delay = Array(resized.length).fill(Math.round(1000 / fps));
  let smallest = null;
  for (const quality of ANIM_QUALITIES) {
    const buffer = await sharp(resized, { join: { animated: true } })
      .webp({ quality, loop: 0, delay, effort: 4 })
      .toBuffer();
    if (buffer.length <= maxBytes) return { buffer, quality };
    if (!smallest || buffer.length < smallest.bytes) smallest = { bytes: buffer.length, quality };
  }
  throw overBudget('animation', maxBytes, smallest);
}
