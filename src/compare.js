// Scores how different two images (or two animations) look, from 0 (the same) to 1 (black
// against white). The score is the largest mean difference in any small area of a reduced copy,
// not the mean over the whole picture: a real change (a label, a number) is local, and an
// average over the whole picture would hide it, while rendering noise is spread thin. A new
// capture that scores under the spec's keepIfDiffBelow keeps the committed file, so a re-run with
// no visible change adds no new binary to git.

import sharp from 'sharp';

const W = 300;
const H = 190;
const BLOCK = 10;

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

export async function diffScore(a, b) {
  const [pagesA, pagesB] = await Promise.all([pagesOf(a), pagesOf(b)]);
  if (pagesA !== pagesB) return 1;
  const [ra, rb] = await Promise.all([smallRaw(a, pagesA), smallRaw(b, pagesB)]);
  if (ra.length !== rb.length) return 1;
  const rows = H * pagesA; // the frames of an animation are stacked
  let worst = 0;
  for (let by = 0; by < rows; by += BLOCK) {
    for (let bx = 0; bx < W; bx += BLOCK) {
      let sum = 0;
      for (let y = by; y < by + BLOCK; y += 1) {
        for (let x = bx; x < bx + BLOCK; x += 1) {
          const i = (y * W + x) * 3;
          sum += Math.abs(ra[i] - rb[i]) + Math.abs(ra[i + 1] - rb[i + 1]) + Math.abs(ra[i + 2] - rb[i + 2]);
        }
      }
      worst = Math.max(worst, sum / (BLOCK * BLOCK * 3 * 255));
    }
  }
  return worst;
}
