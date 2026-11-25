// Starts and stops the app for a capture, runs the optional prepare command, and checks that
// ports which must be closed (a real backend) are closed.

import { spawn, spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const tail = (text, n = 3000) => (text.length > n ? `…${text.slice(-n)}` : text);

function portAnswers(port, host) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// Ports from the list that something listens on, on IPv4 or IPv6 localhost.
export async function openPorts(ports) {
  const open = [];
  for (const port of ports) {
    if ((await portAnswers(port, '127.0.0.1')) || (await portAnswers(port, '::1'))) open.push(port);
  }
  return open;
}

async function urlAnswers(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
    await res.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  return Promise.race([exited, sleep(5000)]);
}

export async function startServer({ command, waitUrl, cwd, timeoutMs = 60_000 }) {
  if (await urlAnswers(waitUrl)) {
    throw new Error(`${waitUrl} already answers before the app starts. Stop whatever runs there first, or the capture would show it.`);
  }
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  let output = '';
  const keep = (chunk) => {
    output = tail(output + chunk, 20_000);
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exitCode = null;
  child.once('exit', (code, signal) => {
    exitCode = code ?? signal;
  });
  const stop = () => killTree(child);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitCode !== null) {
      throw new Error(`the start command exited (code ${exitCode}) before ${waitUrl} answered:\n${tail(output)}`);
    }
    if (await urlAnswers(waitUrl)) return { stop, output: () => output };
    await sleep(300);
  }
  await stop();
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${waitUrl}:\n${tail(output)}`);
}

export function runPrepare(command, cwd) {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`the prepare command failed (code ${result.status}):\n${tail(`${result.stdout}${result.stderr}`)}`);
  }
}
