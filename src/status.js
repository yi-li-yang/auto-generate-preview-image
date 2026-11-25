// Decides whether each repo's preview is out of date, from git alone (no network unless the
// caller fetched first). It reads the default branch, because that is what readers see.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { SPEC_FILE } from './spec.js';
import { RECORD_FILE } from './record.js';
import { defaultRef, showFile, countCommits, branches } from './git.js';

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function repoStatus(dir) {
  const row = { name: basename(dir), dir, ref: null, verdict: 'error', commits: null, capturedAt: null, data: null, note: '' };
  const spec = parseJson(readFileSync(join(dir, SPEC_FILE), 'utf8'));
  if (!spec || !Array.isArray(spec.watch) || spec.watch.length === 0) {
    row.note = `${SPEC_FILE} is not valid or has no watch paths`;
    return row;
  }
  row.data = spec.data ?? null;
  row.ref = defaultRef(dir);
  if (!row.ref) {
    row.note = 'no default branch found';
    return row;
  }
  const record = parseJson(showFile(dir, row.ref, RECORD_FILE) ?? '');
  if (!record) {
    const elsewhere = branches(dir).find((b) => b !== row.ref && showFile(dir, b, RECORD_FILE) !== null);
    row.verdict = elsewhere ? 'pending merge' : 'missing';
    if (elsewhere) row.note = `record on ${elsewhere}`;
    return row;
  }
  row.capturedAt = record.capturedAt ?? null;
  const commits = countCommits(dir, record.commit, row.ref, spec.watch);
  if (commits === null) {
    row.verdict = 'stale';
    row.note = `the recorded commit ${String(record.commit).slice(0, 7)} is not in this clone; run with --fetch`;
    return row;
  }
  row.commits = commits;
  row.verdict = commits === 0 ? 'fresh' : 'stale';
  return row;
}

export function scan(parent) {
  return readdirSync(parent, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(parent, d.name, SPEC_FILE)))
    .map((d) => repoStatus(join(parent, d.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
