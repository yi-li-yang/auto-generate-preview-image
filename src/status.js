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

// The spec's text: from the default branch first (that is what status judges), then from the
// checked-out files, then from any branch (a preview that is not merged yet). A repo whose owner
// is busy on another branch is still found.
function findSpecText(dir) {
  const ref = defaultRef(dir);
  if (ref) {
    const text = showFile(dir, ref, SPEC_FILE);
    if (text !== null) return text;
  }
  const file = join(dir, SPEC_FILE);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  for (const branch of branches(dir)) {
    const text = showFile(dir, branch, SPEC_FILE);
    if (text !== null) return text;
  }
  return null;
}

export function repoStatus(dir) {
  const row = { name: basename(dir), dir, ref: null, verdict: 'error', commits: null, capturedAt: null, data: null, note: '' };
  const spec = parseJson(findSpecText(dir) ?? '');
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
    .filter((d) => d.isDirectory())
    .map((d) => join(parent, d.name))
    .filter((dir) => existsSync(join(dir, SPEC_FILE))
      || (existsSync(join(dir, '.git')) && findSpecText(dir) !== null))
    .map((dir) => repoStatus(dir))
    .sort((a, b) => a.name.localeCompare(b.name));
}
