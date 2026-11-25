import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPorts, startServer, runPrepare } from '../src/serve.js';

async function freePort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

async function listen(port) {
  const s = createServer((req, res) => res.end('ok'));
  await new Promise((r) => s.listen(port, '127.0.0.1', r));
  return s;
}

const answers = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
    await r.text();
    return true;
  } catch {
    return false;
  }
};

const dir = mkdtempSync(join(tmpdir(), 'agpi-serve-'));
writeFileSync(join(dir, 'server.cjs'), `
require('node:http').createServer((q, s) => s.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');
`);

test('openPorts reports a port while something listens on it, and not after', async () => {
  const port = await freePort();
  const s = await listen(port);
  assert.deepEqual(await openPorts([port]), [port]);
  await new Promise((r) => s.close(r));
  assert.deepEqual(await openPorts([port]), []);
});

test('startServer waits until the URL answers, and stop ends the process', async () => {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const server = await startServer({ command: `node server.cjs ${port}`, waitUrl: url, cwd: dir, timeoutMs: 20_000 });
  assert.equal(await answers(url), true);
  await server.stop();
  assert.equal(await answers(url), false);
});

test('startServer refuses when something already answers at the URL', async () => {
  const port = await freePort();
  const s = await listen(port);
  await assert.rejects(
    startServer({ command: `node server.cjs ${port}`, waitUrl: `http://127.0.0.1:${port}/`, cwd: dir, timeoutMs: 5_000 }),
    /already answers/,
  );
  await new Promise((r) => s.close(r));
});

test('startServer fails with the exit code when the command dies before the URL answers', async () => {
  const port = await freePort();
  await assert.rejects(
    startServer({ command: 'node -e "process.exit(3)"', waitUrl: `http://127.0.0.1:${port}/`, cwd: dir, timeoutMs: 10_000 }),
    /exited \(code 3\)/,
  );
});

test('runPrepare runs the command in the repo, and a failing command stops the capture', () => {
  runPrepare('node -e "require(\'fs\').writeFileSync(\'made.txt\', \'x\')"', dir);
  assert.equal(existsSync(join(dir, 'made.txt')), true);
  assert.throws(() => runPrepare('node -e "process.exit(2)"', dir), /prepare.*code 2/);
});
