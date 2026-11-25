// Network rules for a capture. Each request is checked in this order:
//   1. fixtures: URL glob -> local file, served in place of the real response
//   2. block:    URL globs that are always aborted
//   3. allow:    URL globs that may pass (no list = everything passes)
//   4. anything else is denied (aborted)
// Fixtures come first, so a listed endpoint is served while every other endpoint under a
// blocked path is stopped. That is how a private app is captured with invented data only.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const globCache = new Map();

function globToRegExp(glob) {
  // A trailing "/**" also matches the folder itself ("**/api/**" matches ".../api").
  let source = '';
  let rest = glob;
  let tail = '';
  if (rest.endsWith('/**')) {
    rest = rest.slice(0, -3);
    tail = '(?:/.*)?';
  }
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (ch === '*' && rest[i + 1] === '*') {
      source += '.*';
      i += 1;
    } else if (ch === '*') {
      source += '[^/]*';
    } else if (ch === '?') {
      source += '[^/]';
    } else {
      source += ch.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}${tail}$`);
}

export function globMatch(glob, url) {
  let re = globCache.get(glob);
  if (!re) {
    re = globToRegExp(glob);
    globCache.set(glob, re);
  }
  return re.test(url.split(/[?#]/)[0]);
}

export function decide(url, { fixtures = {}, block = [], allow = null }) {
  for (const [glob, file] of Object.entries(fixtures)) {
    if (globMatch(glob, url)) return { action: 'fixture', file };
  }
  if (block.some((glob) => globMatch(glob, url))) return { action: 'block' };
  if (allow === null || allow.some((glob) => globMatch(glob, url))) return { action: 'allow' };
  return { action: 'deny' };
}

const CONTENT_TYPES = {
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export function contentTypeFor(file) {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

// Routes every request of a Playwright browser context through the rules.
// Returns the log the capture reads afterwards: what was served from fixtures and what was stopped.
export async function installNetwork(context, rules) {
  const log = { served: [], stopped: [] };
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const verdict = decide(url, rules);
    if (verdict.action === 'fixture') {
      log.served.push({ url, file: verdict.file });
      await route.fulfill({
        status: 200,
        contentType: contentTypeFor(verdict.file),
        headers: { 'access-control-allow-origin': '*' },
        body: readFileSync(verdict.file),
      });
    } else if (verdict.action === 'allow') {
      await route.continue();
    } else {
      log.stopped.push({ url, reason: verdict.action === 'block' ? 'blocked' : 'not allowed' });
      await route.abort('blockedbyclient');
    }
  });
  return log;
}
