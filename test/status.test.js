import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoStatus, scan } from '../src/status.js';

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

function write(dir, rel, text) {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

const SPEC = JSON.stringify({ url: 'https://example.org/', data: 'public', dataNote: 'n', watch: ['src/'] });
const record = (commit) => JSON.stringify({ _edit: 'DERIVED', commit, capturedAt: '2026-11-25T10:00:00Z' });

// A repo on main with a spec and one UI file. Returns the folder.
function newRepo(parent, name = 'app') {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  write(dir, 'preview.json', SPEC);
  write(dir, 'src/a.txt', 'v1');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  return dir;
}

// Captures "at" the current main: the record names the commit the UI was at.
function commitRecord(dir) {
  const at = git(dir, 'rev-parse', 'HEAD');
  write(dir, 'docs/preview-record.json', record(at));
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'preview');
}

test('a repo whose record names the latest UI commit is fresh', () => {
  const dir = newRepo(mkdtempSync(join(tmpdir(), 'agpi-st-')));
  commitRecord(dir);
  const s = repoStatus(dir);
  assert.equal(s.verdict, 'fresh');
  assert.equal(s.commits, 0);
});

test('a UI commit after the record makes the repo stale, and counts the commits', () => {
  const dir = newRepo(mkdtempSync(join(tmpdir(), 'agpi-st-')));
  commitRecord(dir);
  write(dir, 'src/a.txt', 'v2');
  git(dir, 'commit', '-q', '-am', 'ui change');
  write(dir, 'src/a.txt', 'v3');
  git(dir, 'commit', '-q', '-am', 'ui change 2');
  const s = repoStatus(dir);
  assert.equal(s.verdict, 'stale');
  assert.equal(s.commits, 2);
});

test('a commit outside the watch paths keeps the repo fresh', () => {
  const dir = newRepo(mkdtempSync(join(tmpdir(), 'agpi-st-')));
  commitRecord(dir);
  write(dir, 'README.md', 'words');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'docs');
  assert.equal(repoStatus(dir).verdict, 'fresh');
});

test('a record that exists only on another branch is pending merge', () => {
  const dir = newRepo(mkdtempSync(join(tmpdir(), 'agpi-st-')));
  git(dir, 'switch', '-q', '-c', 'preview-image');
  commitRecord(dir);
  git(dir, 'switch', '-q', 'main');
  assert.equal(repoStatus(dir).verdict, 'pending merge');
});

test('a repo with no record anywhere is missing', () => {
  const dir = newRepo(mkdtempSync(join(tmpdir(), 'agpi-st-')));
  assert.equal(repoStatus(dir).verdict, 'missing');
});

test('a squash-merged preview branch is fresh on main, then stale after the next UI commit', () => {
  const dir = newRepo(mkdtempSync(join(tmpdir(), 'agpi-st-')));
  git(dir, 'switch', '-q', '-c', 'preview-image');
  commitRecord(dir); // the record names main's commit, the merge base
  git(dir, 'switch', '-q', 'main');
  git(dir, 'merge', '-q', '--squash', 'preview-image');
  git(dir, 'commit', '-q', '-m', 'squash: preview');
  assert.equal(repoStatus(dir).verdict, 'fresh');
  write(dir, 'src/a.txt', 'v2');
  git(dir, 'commit', '-q', '-am', 'ui change');
  assert.equal(repoStatus(dir).verdict, 'stale');
});

test('status reads the remote default branch, not the branch that is checked out', () => {
  const parent = mkdtempSync(join(tmpdir(), 'agpi-st-'));
  const origin = newRepo(parent, 'origin-src');
  commitRecord(origin);
  const bare = join(parent, 'origin.git');
  git(parent, 'clone', '-q', '--bare', origin, bare);
  const clone = join(parent, 'clone');
  git(parent, 'clone', '-q', bare, clone);
  // Work in progress on another branch, with a UI commit that main does not have.
  git(clone, 'switch', '-q', '-c', 'feature');
  write(clone, 'src/a.txt', 'wip');
  git(clone, 'commit', '-q', '-am', 'wip');
  const s = repoStatus(clone);
  assert.equal(s.ref, 'origin/main');
  assert.equal(s.verdict, 'fresh');
});

test('scan lists every subfolder that has a preview.json, by name', () => {
  const parent = mkdtempSync(join(tmpdir(), 'agpi-scan-'));
  commitRecord(newRepo(parent, 'b-app'));
  newRepo(parent, 'a-app');
  mkdirSync(join(parent, 'not-an-app'));
  const rows = scan(parent);
  assert.deepEqual(rows.map((r) => [r.name, r.verdict]), [['a-app', 'missing'], ['b-app', 'fresh']]);
});
