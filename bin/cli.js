#!/usr/bin/env node
// auto-generate-preview-image: makes a repo's README preview image from its running app.

import { resolve } from 'node:path';
import { runCapture, IMAGE_FILE, ANIM_FILE } from '../src/run.js';
import { RECORD_FILE } from '../src/record.js';
import { scan } from '../src/status.js';
import { tryGit } from '../src/git.js';

const HELP = `auto-generate-preview-image: makes a repo's README preview image from its running app.

Usage:
  auto-generate-preview-image capture [--static-only | --anim-only] [--headed]
      Run in an app repo. Reads preview.json and writes ${IMAGE_FILE},
      ${ANIM_FILE} (if the spec has "anim") and ${RECORD_FILE}.
      --headed shows the browser and slows each step, so you can watch the run.

  auto-generate-preview-image status [dir] [--fetch]
      Lists every repo in dir that has a preview.json, and whether its preview is fresh,
      stale, pending merge or missing. Without dir: inside a repo, the folder that holds
      the repo; anywhere else, the current folder.
      --fetch runs "git fetch" in each repo first.
`;

const OPTIONS = {
  capture: new Set(['--static-only', '--anim-only', '--headed']),
  status: new Set(['--fetch']),
};

const kb = (bytes) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${Math.round(bytes / 1000)} KB`);

function describe(output) {
  if (!output) return 'not captured';
  const quality = output.quality ? ` (quality ${output.quality})` : '';
  const why = output.action === 'kept' ? ' (no visible change)' : '';
  return `${output.action} ${kb(output.bytes)}${quality}${why}`;
}

async function capture(flags) {
  const summary = await runCapture(process.cwd(), {
    headed: flags.has('--headed'),
    staticOnly: flags.has('--static-only'),
    animOnly: flags.has('--anim-only'),
  });
  console.log(`branch: ${summary.branch}`);
  console.log(`${IMAGE_FILE.padEnd(26)} ${describe(summary.image)}`);
  if (summary.anim || flags.has('--anim-only')) console.log(`${ANIM_FILE.padEnd(26)} ${describe(summary.anim)}`);
  console.log(`${RECORD_FILE.padEnd(26)} ${summary.record}`);
  if (summary.served > 0) console.log(`fixture responses served: ${summary.served}`);
  if (summary.stopped.length > 0) {
    console.log(`requests stopped by the network rules: ${summary.stopped.length}`);
    for (const s of summary.stopped) console.log(`  ${s.url} (${s.reason})`);
  }
}

function status(args, flags) {
  // Inside a repo, look at the folder that holds it and its sibling repos;
  // anywhere else, look at the current folder.
  const inRepo = tryGit(process.cwd(), ['rev-parse', '--is-inside-work-tree']) === 'true';
  const dir = resolve(args[0] ?? (inRepo ? '..' : '.'));
  const notes = [];
  if (flags.has('--fetch')) {
    for (const row of scan(dir)) {
      if (tryGit(row.dir, ['fetch', '--quiet']) === null) notes.push(`${row.name}: git fetch failed`);
    }
  }
  const rows = scan(dir);
  if (rows.length === 0) {
    console.log(`No repo in ${dir} has a preview.json.`);
    return;
  }
  const line = (cells) => cells.map((c, i) => String(c).padEnd([28, 15, 12, 22, 0][i])).join('').trimEnd();
  console.log(line(['repo', 'verdict', 'UI commits', 'captured', 'data']));
  for (const r of rows) {
    console.log(line([r.name, r.verdict, r.commits ?? '-', r.capturedAt ? r.capturedAt.slice(0, 16).replace('T', ' ') : '-', r.data ?? '-']));
    if (r.note) notes.push(`${r.name}: ${r.note}`);
  }
  if (notes.length > 0) console.log(`\n${notes.join('\n')}`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help')) {
    console.log(HELP);
    return;
  }
  const [cmd, ...rest] = argv;
  if (!OPTIONS[cmd]) throw new Error(`unknown command "${cmd}". Run with --help.`);
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  for (const flag of flags) {
    if (!OPTIONS[cmd].has(flag)) throw new Error(`unknown option ${flag} for ${cmd}. Run with --help.`);
  }
  if (flags.has('--static-only') && flags.has('--anim-only')) {
    throw new Error('use --static-only or --anim-only, not both');
  }
  const args = rest.filter((a) => !a.startsWith('--'));
  if (cmd === 'capture') await capture(flags);
  else status(args, flags);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
});
