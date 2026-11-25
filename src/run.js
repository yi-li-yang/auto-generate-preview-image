// One capture of one repo, from the spec to the files in docs/:
// checks, prepare, start the app, capture, encode, keep unchanged files, write the record.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadSpec } from './spec.js';
import { openPorts, startServer, runPrepare } from './serve.js';
import { captureAll } from './capture.js';
import { encodeStatic, encodeAnim } from './encode.js';
import { diffScore } from './compare.js';
import { buildRecord, readRecord, sameRecord, writeRecord } from './record.js';
import { git, tryGit, defaultRef, mergeBase, changedPaths, currentBranch } from './git.js';

export const IMAGE_FILE = 'docs/preview.webp';
export const ANIM_FILE = 'docs/preview-anim.webp';

const toolVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

function fileInfo(dir, rel) {
  const path = join(dir, rel);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return { file: rel, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
}

// Writes the new output unless it looks the same as the committed one.
async function writeOutput(dir, rel, encoded, keepIfDiffBelow) {
  const path = join(dir, rel);
  if (existsSync(path)) {
    const old = readFileSync(path);
    const diff = await diffScore(old, encoded.buffer);
    if (diff < keepIfDiffBelow) return { action: 'kept', bytes: old.length, diff };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, encoded.buffer);
    return { action: 'written', bytes: encoded.buffer.length, quality: encoded.quality, diff };
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encoded.buffer);
  return { action: 'written', bytes: encoded.buffer.length, quality: encoded.quality, diff: null };
}

export async function runCapture(repoDir, { headed = false, staticOnly = false, animOnly = false } = {}) {
  const spec = loadSpec(repoDir);
  if (tryGit(repoDir, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    throw new Error(`${repoDir} is not a git repo; the record needs a commit to point at.`);
  }
  const dirty = changedPaths(repoDir, spec.watch);
  if (dirty.length > 0) {
    throw new Error(`uncommitted changes in the watch paths:\n${dirty.map((l) => `  ${l}`).join('\n')}\n`
      + 'Commit them first, so the record names the code the image shows.');
  }
  const open = await openPorts(spec.network.closedPorts);
  if (open.length > 0) {
    throw new Error(`port ${open.join(', ')} answers, but the spec says it must be closed (a real backend?). Stop it first.`);
  }
  if (spec.prepare) runPrepare(spec.prepare, repoDir);

  const server = spec.start ? await startServer({ ...spec.start, cwd: repoDir }) : null;
  let shot;
  try {
    shot = await captureAll(spec, { headed, staticOnly, animOnly });
  } finally {
    if (server) await server.stop();
  }

  const summary = {
    branch: currentBranch(repoDir),
    image: null,
    anim: null,
    record: null,
    served: shot.network.served.length,
    stopped: shot.network.stopped,
  };
  if (shot.png) {
    summary.image = await writeOutput(repoDir, IMAGE_FILE, await encodeStatic(shot.png, spec.output), spec.keepIfDiffBelow);
  }
  if (shot.frames) {
    const encoded = await encodeAnim(shot.frames, { ...spec.anim.output, fps: shot.fps });
    summary.anim = await writeOutput(repoDir, ANIM_FILE, encoded, spec.keepIfDiffBelow);
  }

  const ref = defaultRef(repoDir);
  const commit = ref ? mergeBase(repoDir, ref) : git(repoDir, ['rev-parse', 'HEAD']);
  const next = buildRecord({
    commit,
    capturedAt: new Date().toISOString(),
    url: spec.url,
    toolVersion,
    image: fileInfo(repoDir, IMAGE_FILE),
    anim: spec.anim ? fileInfo(repoDir, ANIM_FILE) : null,
  });
  if (sameRecord(readRecord(repoDir), next)) {
    summary.record = 'unchanged';
  } else {
    writeRecord(repoDir, next);
    summary.record = 'written';
  }
  return summary;
}
