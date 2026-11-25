// The capture record, docs/preview-record.json: which commit of the app a preview shows.
// `status` reads it to decide whether a preview is out of date. The commit is the merge base of
// the capture with the default branch, so the record stays right after a squash merge.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const RECORD_FILE = 'docs/preview-record.json';

export function buildRecord({ commit, capturedAt, url, toolVersion, image, anim }) {
  return {
    _edit: 'DERIVED — written by auto-generate-preview-image capture. Never edit; the next capture rewrites it.',
    commit,
    capturedAt,
    url,
    tool: toolVersion,
    image,
    ...(anim ? { anim } : {}),
  };
}

export function readRecord(dir) {
  const file = join(dir, RECORD_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// True when nothing a reader cares about changed: the same commit, page and output bytes.
// The capture time alone is no reason to write the file again.
export function sameRecord(a, b) {
  if (!a || !b) return false;
  return a.commit === b.commit
    && a.url === b.url
    && a.image?.sha256 === b.image?.sha256
    && (a.anim?.sha256 ?? null) === (b.anim?.sha256 ?? null);
}

export function writeRecord(dir, record) {
  const file = join(dir, RECORD_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
}
