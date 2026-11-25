import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
};

test('capture in a folder with no preview.json exits 1 and says what is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agpi-cli-'));
  const r = run(['capture'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /preview\.json/);
});

test('an unknown option exits 1 and names it', () => {
  const r = run(['status', '--fetchh'], tmpdir());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--fetchh/);
});

test('an unknown command exits 1', () => {
  const r = run(['snap'], tmpdir());
  assert.equal(r.status, 1);
  assert.match(r.stderr, /snap/);
});

// A parent folder holding one app repo, like E:\GitHub. Returns [parent, app folder].
function reposFolder() {
  const parent = mkdtempSync(join(tmpdir(), 'agpi-cli-st-'));
  const dir = join(parent, 'my-app');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'preview.json'), JSON.stringify({ url: 'https://example.org/', data: 'public', dataNote: 'n', watch: ['src/'] }));
  writeFileSync(join(dir, 'src/a.txt'), 'v1');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env });
  execFileSync('git', ['add', '.'], { cwd: dir, env });
  execFileSync('git', ['commit', '-q', '-m', 'start'], { cwd: dir, env });
  return [parent, dir];
}

test('status prints one row per repo with its verdict and exits 0', () => {
  const [parent] = reposFolder();
  const r = run(['status', parent], tmpdir());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /my-app\s+missing/);
});

test('status with no folder, run inside a repo, scans the folder that holds the repo', () => {
  const [, dir] = reposFolder();
  const r = run(['status'], dir);
  assert.match(r.stdout, /my-app\s+missing/);
});

test('status with no folder, run in a folder of repos, scans that folder', () => {
  const [parent] = reposFolder();
  const r = run(['status'], parent);
  assert.match(r.stdout, /my-app\s+missing/);
});
