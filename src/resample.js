// Turns frames that arrive whenever the page paints (the CDP screencast) into frames at a steady
// rate. Each tick takes the latest frame painted at or before it, so a still page holds its frame.

export function resample(frames, { fps, start, end }) {
  if (frames.length === 0) throw new Error('no frames were recorded; did the page paint anything?');
  const sorted = [...frames].sort((a, b) => a.ts - b.ts);
  const step = 1000 / fps;
  const count = Math.max(1, Math.floor((end - start) / step + 1e-9));
  const out = [];
  let j = 0;
  for (let i = 0; i < count; i += 1) {
    const tick = start + i * step;
    while (j + 1 < sorted.length && sorted[j + 1].ts <= tick) j += 1;
    out.push(sorted[j].data);
  }
  return out;
}
