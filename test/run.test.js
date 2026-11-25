import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { runCapture } from '../src/run.js';
import { repoStatus } from '../src/status.js';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

let colour = '#336699';
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  if (req.url === '/anim') {
    res.end(`<!doctype html><html><head><style>
      @keyframes blink { 0% { background: #000 } 50% { background: #fff } }
      body { margin: 0; animation: blink 400ms steps(1) infinite }</style></head><body></body></html>`);
    return;
  }
  res.end(`<!doctype html><html><body style="margin:0;background:${colour}">
    <h1 style="color:white;font:48px sans-serif;margin:80px">Preview test</h1></body></html>`);
});
let url;
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(async () => {
  await new Promise((r) => server.close(r));
});

function newApp(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agpi-run-'));
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/app.txt'), 'v1');
  writeFileSync(join(dir, 'preview.json'), JSON.stringify({
    url, data: 'public', dataNote: 'a test page', watch: ['src/'], ...extra,
  }));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  return dir;
}

test('capture writes the preview image and a record naming the commit, and the repo is then fresh', async () => {
  const dir = newApp();
  const head = git(dir, 'rev-parse', 'HEAD');
  const summary = await runCapture(dir);
  assert.equal(summary.image.action, 'written');
  const webp = readFileSync(join(dir, 'docs/preview.webp'));
  assert.equal(webp.subarray(8, 12).toString(), 'WEBP');
  const meta = await sharp(webp).metadata();
  assert.deepEqual([meta.width, meta.height], [1200, 750]);
  assert.ok(webp.length <= 250_000);
  const record = JSON.parse(readFileSync(join(dir, 'docs/preview-record.json'), 'utf8'));
  assert.equal(record.commit, head);
  assert.match(record._edit, /^DERIVED/);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'preview');
  assert.equal(repoStatus(dir).verdict, 'fresh');
});

test('a second capture with nothing changed keeps the image file and leaves the record alone', async () => {
  const dir = newApp();
  await runCapture(dir);
  const image = statSync(join(dir, 'docs/preview.webp')).mtimeMs;
  const record = readFileSync(join(dir, 'docs/preview-record.json'), 'utf8');
  const summary = await runCapture(dir);
  assert.equal(summary.image.action, 'kept');
  assert.equal(summary.record, 'unchanged');
  assert.equal(statSync(join(dir, 'docs/preview.webp')).mtimeMs, image);
  assert.equal(readFileSync(join(dir, 'docs/preview-record.json'), 'utf8'), record);
});

test('a visible change replaces the image', async () => {
  const dir = newApp();
  await runCapture(dir);
  colour = '#cc3300';
  try {
    const summary = await runCapture(dir);
    assert.equal(summary.image.action, 'written');
  } finally {
    colour = '#336699';
  }
});

test('capture refuses while a watch path has uncommitted changes', async () => {
  const dir = newApp();
  writeFileSync(join(dir, 'src/app.txt'), 'edited');
  await assert.rejects(runCapture(dir), /uncommitted changes/);
  assert.equal(existsSync(join(dir, 'docs/preview.webp')), false);
});

test('capture refuses while a port that must be closed answers', async () => {
  const blocker = createServer(() => {});
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const { port } = blocker.address();
  try {
    const dir = newApp({ network: { closedPorts: [port] } });
    await assert.rejects(runCapture(dir), new RegExp(`port ${port}`));
  } finally {
    await new Promise((r) => blocker.close(r));
  }
});

test('a spec with anim also writes an animated preview that plays for the recorded time', async () => {
  const dir = newApp({
    url: `${url}anim`,
    anim: { steps: [{ recordStart: { fps: 5 } }, { wait: 1000 }, { recordStop: {} }] },
  });
  const summary = await runCapture(dir);
  assert.equal(summary.anim.action, 'written');
  const meta = await sharp(readFileSync(join(dir, 'docs/preview-anim.webp')), { animated: true }).metadata();
  assert.ok(meta.pages >= 2, `got ${meta.pages} frames`);
  assert.deepEqual([meta.width, meta.pageHeight], [960, 600]);
  // libwebp merges identical neighbouring frames, so count the play time, not the frames:
  // 1000 ms recorded at 5 fps; a real browser may add one 200 ms frame.
  const playMs = meta.delay.reduce((a, b) => a + b, 0);
  assert.ok(playMs === 1000 || playMs === 1200, `plays for ${playMs} ms`);
});
