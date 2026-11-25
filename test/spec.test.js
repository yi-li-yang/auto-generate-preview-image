import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSpec, loadSpec } from '../src/spec.js';

const repoDir = mkdtempSync(join(tmpdir(), 'agpi-spec-'));

// The smallest spec that is valid.
const minimal = () => ({
  url: 'https://example.org/app/',
  data: 'public',
  dataNote: 'Open data about places; no person appears.',
  watch: ['src/'],
});

const errorsOf = (raw) => validateSpec(raw, { repoDir }).errors;

test('a minimal spec is valid', () => {
  assert.deepEqual(errorsOf(minimal()), []);
});

test('a spec with no data field is rejected', () => {
  const raw = minimal();
  delete raw.data;
  assert.match(errorsOf(raw).join('\n'), /data/);
});

test('data must be "invented" or "public"', () => {
  assert.match(errorsOf({ ...minimal(), data: 'real' }).join('\n'), /data/);
  assert.deepEqual(errorsOf({ ...minimal(), data: 'invented' }), []);
});

test('a spec with no dataNote is rejected', () => {
  const raw = minimal();
  delete raw.dataNote;
  assert.match(errorsOf(raw).join('\n'), /dataNote/);
});

test('keys that start with an underscore are ownership notes and pass', () => {
  assert.deepEqual(errorsOf({ _edit: 'SOURCE — you own this file.', _comment: ['x'], ...minimal() }), []);
});

test('an unknown key is rejected by name, so a typo cannot pass silently', () => {
  assert.match(errorsOf({ ...minimal(), wach: ['src/'] }).join('\n'), /wach/);
});

test('a spec with no url is rejected', () => {
  const raw = minimal();
  delete raw.url;
  assert.match(errorsOf(raw).join('\n'), /url/);
});

test('watch must list at least one path', () => {
  assert.match(errorsOf({ ...minimal(), watch: [] }).join('\n'), /watch/);
});

test('an unknown step names its position', () => {
  const raw = { ...minimal(), steps: [{ wait: 10 }, { clik: '#go' }] };
  assert.match(errorsOf(raw).join('\n'), /steps\[1\].*clik/);
});

test('anim needs its own steps with one recordStart and one recordStop after it', () => {
  const noStop = { ...minimal(), anim: { steps: [{ recordStart: { fps: 10 } }, { wait: 100 }] } };
  assert.match(errorsOf(noStop).join('\n'), /recordStop/);
  const ok = { ...minimal(), anim: { steps: [{ recordStart: { fps: 10 } }, { wait: 100 }, { recordStop: {} }] } };
  assert.deepEqual(errorsOf(ok), []);
});

test('defaults: 1200x750 under 250 KB for the image, 960x600 under 3 MB for the animation', () => {
  const raw = { ...minimal(), anim: { steps: [{ recordStart: { fps: 10 } }, { recordStop: {} }] } };
  const { spec } = validateSpec(raw, { repoDir });
  assert.deepEqual(spec.viewport, { width: 1200, height: 750 });
  assert.equal(spec.deviceScaleFactor, 1);
  assert.deepEqual(spec.output, { width: 1200, height: 750, maxBytes: 250_000, position: 'centre' });
  assert.deepEqual(spec.anim.output, { width: 960, height: 600, maxBytes: 3_000_000, position: 'centre' });
});

test('a url with no scheme is a file path inside the repo', () => {
  const { spec } = validateSpec({ ...minimal(), url: 'build/preview/email.html' }, { repoDir });
  assert.equal(spec.url, pathToFileURL(join(repoDir, 'build/preview/email.html')).href);
});

test('loadSpec fails when a fixture file is missing, and passes when it exists', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agpi-load-'));
  const raw = { ...minimal(), network: { fixtures: { '**/api/a': 'docs/preview/fixtures/a.json' } } };
  writeFileSync(join(dir, 'preview.json'), JSON.stringify(raw));
  assert.throws(() => loadSpec(dir), /docs\/preview\/fixtures\/a\.json/);
  mkdirSync(join(dir, 'docs/preview/fixtures'), { recursive: true });
  writeFileSync(join(dir, 'docs/preview/fixtures/a.json'), '{}');
  assert.equal(loadSpec(dir).network.fixtures['**/api/a'], join(dir, 'docs/preview/fixtures/a.json'));
});

test('loadSpec fails with a clear message when preview.json is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agpi-none-'));
  assert.throws(() => loadSpec(dir), /preview\.json/);
});
