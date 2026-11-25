// Measures how different two images (or two animations) look: the mean absolute pixel
// difference of small copies, from 0 (the same) to 1 (black against white). A new capture that
// differs by less than the spec's keepIfDiffBelow keeps the committed file, so a re-run with no
// visible change adds no new binary to git.

import sharp from 'sharp';

const W = 160;
const H = 100;

async function pagesOf(buf) {
  const meta = await sharp(buf, { animated: true }).metadata();
  return meta.pages ?? 1;
}

async function smallRaw(buf, pages) {
  return sharp(buf, { animated: pages > 1 })
    .resize(W, H, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();
}

export async function meanDiff(a, b) {
  const [pagesA, pagesB] = await Promise.all([pagesOf(a), pagesOf(b)]);
  if (pagesA !== pagesB) return 1;
  const [ra, rb] = await Promise.all([smallRaw(a, pagesA), smallRaw(b, pagesB)]);
  if (ra.length !== rb.length) return 1;
  let sum = 0;
  for (let i = 0; i < ra.length; i += 1) sum += Math.abs(ra[i] - rb[i]);
  return sum / (ra.length * 255);
}
