// Small wrappers around the git command line. Every call runs in one repo folder.

import { execFileSync } from 'node:child_process';

export function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function tryGit(dir, args) {
  try {
    return git(dir, args);
  } catch {
    return null;
  }
}

// The branch the repo publishes from: the remote's default branch when there is a remote
// (what is merged on GitHub), else the local main or master.
export function defaultRef(dir) {
  const head = tryGit(dir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (head) return head;
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if (tryGit(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null) return ref;
  }
  return null;
}

export function showFile(dir, ref, path) {
  return tryGit(dir, ['show', `${ref}:${path}`]);
}

export function commitExists(dir, sha) {
  return tryGit(dir, ['cat-file', '-e', `${sha}^{commit}`]) !== null;
}

// Commits on `paths` that are in `to` but not in `from`. Null when `from` is not in this repo.
export function countCommits(dir, from, to, paths) {
  if (!commitExists(dir, from)) return null;
  return Number(git(dir, ['rev-list', '--count', `${from}..${to}`, '--', ...paths]));
}

export function branches(dir) {
  const out = tryGit(dir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']);
  return out ? out.split('\n').filter((b) => b && !b.endsWith('/HEAD')) : [];
}

export function changedPaths(dir, paths) {
  const out = git(dir, ['status', '--porcelain', '--', ...paths]);
  return out ? out.split('\n') : [];
}

export function mergeBase(dir, ref) {
  return git(dir, ['merge-base', 'HEAD', ref]);
}

export function currentBranch(dir) {
  return tryGit(dir, ['branch', '--show-current']) || '(detached)';
}
