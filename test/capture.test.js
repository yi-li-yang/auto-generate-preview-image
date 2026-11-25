import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { validateSpec } from '../src/spec.js';
import { captureAll } from '../src/capture.js';

// A fake backend that holds "real" data, and a page server that forwards /api to it the way a
// Vite dev server does. The privacy tests check the backend is never reached.
let backendHits = 0;
const backend = createServer((req, res) => {
  backendHits += 1;
  res.setHeader('content-type', 'application/json');
  res.end('{"value":"REAL"}');
});

const fetchInto = (path, key) => `fetch('${path}').then(r => r.json()).then(j => { document.body.dataset.${key} = j.value })
  .catch(() => { document.body.dataset.${key} = 'failed' });`;

const PAGES = {
  '/': `<!doctype html><html><body style="margin:0;background:#0000ff">
    <div id="secret" style="position:absolute;left:400px;top:250px;width:400px;height:250px;background:#ff0000"></div>
    <button id="go" style="position:absolute;left:0;top:0" onclick="document.body.style.background='#00ff00'">go</button>
    <script>document.body.dataset.now = new Date().toISOString();</script></body></html>`,
  '/anim': `<!doctype html><html><head><style>
    @keyframes blink { 0% { background: #000 } 50% { background: #fff } }
    #box { position: fixed; inset: 0; animation: blink 400ms steps(1) infinite }
    </style></head><body><div id="box"></div></body></html>`,
  '/app': `<!doctype html><html><body><script>${fetchInto('/api/a', 'a')} ${fetchInto('/api/b', 'b')}</script></body></html>`,
  '/app-a': `<!doctype html><html><body><script>${fetchInto('/api/a', 'a')}</script></body></html>`,
};

let pagePort;
const pageServer = createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const fwd = request({ host: '127.0.0.1', port: backend.address().port, path: req.url, method: req.method }, (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    });
    req.pipe(fwd);
    return;
  }
  const html = PAGES[req.url];
  res.writeHead(html ? 200 : 404, { 'content-type': 'text/html' });
  res.end(html ?? 'not found');
});

const fixtureDir = mkdtempSync(join(tmpdir(), 'agpi-fx-'));
const fixtureA = join(fixtureDir, 'a.json');
writeFileSync(fixtureA, '{"value":"invented"}');

before(async () => {
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  await new Promise((r) => pageServer.listen(0, '127.0.0.1', r));
  pagePort = pageServer.address().port;
});

after(async () => {
  await new Promise((r) => backend.close(r));
  await new Promise((r) => pageServer.close(r));
});

const specFor = (path, extra = {}) => {
  const { spec, errors } = validateSpec({
    url: `http://127.0.0.1:${pagePort}${path}`,
    data: 'invented',
    dataNote: 'test page',
    watch: ['src/'],
    ...extra,
  }, { repoDir: fixtureDir });
  assert.deepEqual(errors, []);
  return spec;
};

async function pixel(png, x, y) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return [data[i], data[i + 1], data[i + 2]];
}

test('the static capture is the viewport size, hides what the spec hides, and runs the steps', async () => {
  const spec = specFor('/', { hide: ['#secret'], steps: [{ click: '#go' }] });
  const { png } = await captureAll(spec, { staticOnly: true });
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 750);
  assert.deepEqual(await pixel(png, 600, 375), [0, 255, 0]); // green background, red box hidden
});

test('a fixed clock is the time the page sees from its first script', async () => {
  const spec = specFor('/', {
    clock: '2030-01-02T03:04:05Z',
    steps: [{ waitForFunction: "document.body.dataset.now.startsWith('2030-01-02')" }],
  });
  await captureAll(spec, { staticOnly: true }); // the step times out if the clock is not fixed
});

test('the animation records at a steady rate and catches the page changing', async () => {
  const spec = specFor('/anim', {
    viewport: { width: 320, height: 200 },
    timeoutMs: 15_000,
    anim: { steps: [{ recordStart: { fps: 10 } }, { wait: 1200 }, { recordStop: {} }] },
  });
  const { frames, fps } = await captureAll(spec, { animOnly: true });
  assert.equal(fps, 10);
  // 1200 ms at 10 fps is 12 frames; a real browser may add a few ms, so 13 is allowed.
  assert.ok(frames.length === 12 || frames.length === 13, `got ${frames.length} frames`);
  const means = await Promise.all(frames.map(async (f) => (await sharp(f).stats()).channels[0].mean));
  assert.ok(means.some((m) => m < 50), 'a black frame');
  assert.ok(means.some((m) => m > 200), 'a white frame');
});

test('control: with no network rules, the page reaches the backend through the forward', async () => {
  const before = backendHits;
  const spec = specFor('/app', { steps: [{ waitForFunction: "document.body.dataset.b === 'REAL'" }] });
  await captureAll(spec, { staticOnly: true });
  assert.ok(backendHits > before);
});

const privateRules = () => ({
  fixtures: { '**/api/a': fixtureA },
  block: ['**/api/**'],
  allow: [`http://127.0.0.1:${pagePort}/**`],
  failOnBlocked: true,
});

test('an endpoint with no fixture is stopped before the backend, and the capture fails naming it', async () => {
  const before = backendHits;
  const spec = specFor('/app', {
    network: privateRules(),
    steps: [{ waitForFunction: 'document.body.dataset.b !== undefined' }],
  });
  await assert.rejects(captureAll(spec, { staticOnly: true }), /\/api\/b/);
  assert.equal(backendHits, before);
});

test('a listed endpoint is served from its fixture and the backend is never reached', async () => {
  const before = backendHits;
  const spec = specFor('/app-a', {
    network: privateRules(),
    steps: [{ waitForFunction: "document.body.dataset.a === 'invented'" }],
  });
  const result = await captureAll(spec, { staticOnly: true });
  assert.equal(backendHits, before);
  assert.ok(result.network.served.some((s) => s.url.endsWith('/api/a')));
});
