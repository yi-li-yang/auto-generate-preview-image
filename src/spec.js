// Reads and checks a repo's preview spec (preview.json at the repo root).
// validateSpec returns every problem at once, so an author fixes the file in one pass.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SPEC_FILE = 'preview.json';

const TOP_KEYS = new Set([
  'url', 'prepare', 'start', 'data', 'dataNote', 'watch', 'viewport', 'deviceScaleFactor',
  'colorScheme', 'timezoneId', 'locale', 'reducedMotion', 'clock', 'hide', 'network', 'steps',
  'output', 'anim', 'keepIfDiffBelow', 'timeoutMs',
]);
const ANIM_KEYS = new Set([
  'steps', 'viewport', 'deviceScaleFactor', 'colorScheme', 'reducedMotion', 'clock', 'output',
]);
const NETWORK_KEYS = new Set(['fixtures', 'block', 'allow', 'failOnBlocked', 'closedPorts']);
const OUTPUT_KEYS = new Set(['width', 'height', 'maxBytes', 'position']);

const isString = (v) => typeof v === 'string' && v.length > 0;
const isStringArray = (v) => Array.isArray(v) && v.every(isString);
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;
const isPair = (v) => Array.isArray(v) && v.length === 2;

// Each step is an object with exactly one key. The value check returns true when the value is valid.
const STEP_CHECKS = {
  goto: isString,
  waitFor: isString,
  waitForFunction: isString,
  waitForLoadState: (v) => ['load', 'domcontentloaded', 'networkidle'].includes(v),
  click: isString,
  hover: isString,
  fill: (v) => isPair(v) && isString(v[0]) && typeof v[1] === 'string',
  select: (v) => isPair(v) && isString(v[0]) && typeof v[1] === 'string',
  press: isString,
  wait: (v) => Number.isFinite(v) && v >= 0,
  eval: isString,
  mouse: (v) => isPair(v) && v.every(Number.isFinite),
  recordStart: (v) => v && typeof v === 'object' && Number.isFinite(v.fps) && v.fps >= 1 && v.fps <= 30,
  recordStop: (v) => v && typeof v === 'object',
};

const DEFAULT_OUTPUT = { width: 1200, height: 750, maxBytes: 250_000, position: 'centre' };
const DEFAULT_ANIM_OUTPUT = { width: 960, height: 600, maxBytes: 3_000_000, position: 'centre' };

function checkUnknownKeys(obj, allowed, where, errors) {
  for (const key of Object.keys(obj)) {
    if (key.startsWith('_')) continue; // ownership notes such as _edit and _comment
    if (!allowed.has(key)) errors.push(`${where}: unknown key "${key}"`);
  }
}

function checkSteps(steps, where, { recording }, errors) {
  if (!Array.isArray(steps)) {
    errors.push(`${where}: must be a list of steps`);
    return;
  }
  let starts = 0;
  let stops = 0;
  steps.forEach((step, i) => {
    const keys = step && typeof step === 'object' ? Object.keys(step) : [];
    if (keys.length !== 1) {
      errors.push(`${where}[${i}]: a step is an object with exactly one key`);
      return;
    }
    const [name] = keys;
    const check = STEP_CHECKS[name];
    if (!check) {
      errors.push(`${where}[${i}]: unknown step "${name}"`);
      return;
    }
    if (!check(step[name])) errors.push(`${where}[${i}]: bad value for "${name}"`);
    if (name === 'recordStart') {
      if (!recording) errors.push(`${where}[${i}]: recordStart belongs in anim.steps only`);
      starts += 1;
    }
    if (name === 'recordStop') {
      if (!recording) errors.push(`${where}[${i}]: recordStop belongs in anim.steps only`);
      if (starts === 0) errors.push(`${where}[${i}]: recordStop comes before any recordStart`);
      stops += 1;
    }
  });
  if (recording && (starts !== 1 || stops !== 1)) {
    errors.push(`${where}: needs exactly one recordStart and one recordStop after it`);
  }
}

function checkOutput(output, where, errors) {
  if (output === undefined) return;
  if (!output || typeof output !== 'object') {
    errors.push(`${where}: must be an object`);
    return;
  }
  checkUnknownKeys(output, OUTPUT_KEYS, where, errors);
  for (const key of ['width', 'height', 'maxBytes']) {
    if (output[key] !== undefined && !isPositiveInt(output[key])) {
      errors.push(`${where}.${key}: must be a positive whole number`);
    }
  }
  if (output.position !== undefined && !isString(output.position)) {
    errors.push(`${where}.position: must be a string`);
  }
}

function checkContextFields(obj, where, errors) {
  if (obj.viewport !== undefined
    && !(obj.viewport && isPositiveInt(obj.viewport.width) && isPositiveInt(obj.viewport.height))) {
    errors.push(`${where}viewport: needs whole-number width and height`);
  }
  if (obj.deviceScaleFactor !== undefined
    && !(Number.isFinite(obj.deviceScaleFactor) && obj.deviceScaleFactor > 0)) {
    errors.push(`${where}deviceScaleFactor: must be a number above 0`);
  }
  if (obj.colorScheme !== undefined && !['light', 'dark', 'no-preference'].includes(obj.colorScheme)) {
    errors.push(`${where}colorScheme: must be "light", "dark" or "no-preference"`);
  }
  if (obj.reducedMotion !== undefined && !['reduce', 'no-preference'].includes(obj.reducedMotion)) {
    errors.push(`${where}reducedMotion: must be "reduce" or "no-preference"`);
  }
  if (obj.clock !== undefined && Number.isNaN(Date.parse(obj.clock))) {
    errors.push(`${where}clock: must be a date and time, for example "2026-11-25T09:30:00Z"`);
  }
}

function checkNetwork(network, errors) {
  if (network === undefined) return;
  if (!network || typeof network !== 'object') {
    errors.push('network: must be an object');
    return;
  }
  checkUnknownKeys(network, NETWORK_KEYS, 'network', errors);
  const { fixtures, block, allow, failOnBlocked, closedPorts } = network;
  if (fixtures !== undefined
    && !(fixtures && typeof fixtures === 'object' && Object.values(fixtures).every(isString))) {
    errors.push('network.fixtures: must map URL globs to file paths');
  }
  if (block !== undefined && !isStringArray(block)) errors.push('network.block: must be a list of URL globs');
  if (allow !== undefined && !isStringArray(allow)) errors.push('network.allow: must be a list of URL globs');
  if (failOnBlocked !== undefined && typeof failOnBlocked !== 'boolean') {
    errors.push('network.failOnBlocked: must be true or false');
  }
  if (closedPorts !== undefined && !(Array.isArray(closedPorts) && closedPorts.every(isPositiveInt))) {
    errors.push('network.closedPorts: must be a list of port numbers');
  }
}

function toPageUrl(url, repoDir) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  return pathToFileURL(join(repoDir, url)).href;
}

export function validateSpec(raw, { repoDir }) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { spec: null, errors: ['the spec must be a JSON object'] };
  }
  checkUnknownKeys(raw, TOP_KEYS, 'preview.json', errors);

  if (!isString(raw.url)) errors.push('url: required, the page to open');
  if (!['invented', 'public'].includes(raw.data)) {
    errors.push('data: required, "invented" (data about people is made up) or "public"');
  }
  if (!isString(raw.dataNote)) errors.push('dataNote: required, say where the data comes from and why it may be shown');
  if (!(isStringArray(raw.watch) && raw.watch.length > 0)) {
    errors.push('watch: required, the paths whose changes make the preview out of date');
  }
  if (raw.prepare !== undefined && !isString(raw.prepare)) errors.push('prepare: must be a command');
  if (raw.start !== undefined
    && !(raw.start && isString(raw.start.command) && isString(raw.start.waitUrl))) {
    errors.push('start: needs "command" and "waitUrl"');
  }
  if (raw.hide !== undefined && !isStringArray(raw.hide)) errors.push('hide: must be a list of selectors');
  if (raw.timezoneId !== undefined && !isString(raw.timezoneId)) errors.push('timezoneId: must be a string');
  if (raw.locale !== undefined && !isString(raw.locale)) errors.push('locale: must be a string');
  if (raw.timeoutMs !== undefined && !isPositiveInt(raw.timeoutMs)) errors.push('timeoutMs: must be a positive whole number');
  if (raw.keepIfDiffBelow !== undefined && !(Number.isFinite(raw.keepIfDiffBelow) && raw.keepIfDiffBelow >= 0)) {
    errors.push('keepIfDiffBelow: must be a number from 0');
  }
  checkContextFields(raw, '', errors);
  checkNetwork(raw.network, errors);
  if (raw.steps !== undefined) checkSteps(raw.steps, 'steps', { recording: false }, errors);
  checkOutput(raw.output, 'output', errors);

  if (raw.anim !== undefined) {
    if (!raw.anim || typeof raw.anim !== 'object') {
      errors.push('anim: must be an object');
    } else {
      checkUnknownKeys(raw.anim, ANIM_KEYS, 'anim', errors);
      checkSteps(raw.anim.steps, 'anim.steps', { recording: true }, errors);
      checkContextFields(raw.anim, 'anim.', errors);
      checkOutput(raw.anim.output, 'anim.output', errors);
    }
  }

  if (errors.length > 0) return { spec: null, errors };

  const network = raw.network ?? {};
  const spec = {
    url: toPageUrl(raw.url, repoDir),
    prepare: raw.prepare ?? null,
    start: raw.start ? { timeoutMs: 60_000, ...raw.start } : null,
    data: raw.data,
    dataNote: raw.dataNote,
    watch: raw.watch,
    viewport: raw.viewport ?? { width: 1200, height: 750 },
    deviceScaleFactor: raw.deviceScaleFactor ?? 1,
    colorScheme: raw.colorScheme ?? null,
    timezoneId: raw.timezoneId ?? null,
    locale: raw.locale ?? null,
    reducedMotion: raw.reducedMotion ?? null,
    clock: raw.clock ?? null,
    hide: raw.hide ?? [],
    network: {
      fixtures: { ...(network.fixtures ?? {}) },
      block: network.block ?? [],
      allow: network.allow ?? null,
      failOnBlocked: network.failOnBlocked ?? false,
      closedPorts: network.closedPorts ?? [],
    },
    steps: raw.steps ?? [],
    output: { ...DEFAULT_OUTPUT, ...(raw.output ?? {}) },
    anim: raw.anim
      ? {
        steps: raw.anim.steps,
        viewport: raw.anim.viewport ?? null,
        deviceScaleFactor: raw.anim.deviceScaleFactor ?? null,
        colorScheme: raw.anim.colorScheme ?? null,
        reducedMotion: raw.anim.reducedMotion ?? null,
        clock: raw.anim.clock ?? null,
        output: { ...DEFAULT_ANIM_OUTPUT, ...(raw.anim.output ?? {}) },
      }
      : null,
    keepIfDiffBelow: raw.keepIfDiffBelow ?? 0.005,
    timeoutMs: raw.timeoutMs ?? 30_000,
  };
  return { spec, errors: [] };
}

export class SpecError extends Error {}

export function loadSpec(repoDir) {
  const file = join(repoDir, SPEC_FILE);
  if (!existsSync(file)) throw new SpecError(`No ${SPEC_FILE} in ${repoDir}. Write one first (see the README).`);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new SpecError(`${SPEC_FILE} is not valid JSON: ${err.message}`);
  }
  const { spec, errors } = validateSpec(raw, { repoDir });
  if (spec) {
    for (const [glob, rel] of Object.entries(spec.network.fixtures)) {
      const abs = join(repoDir, rel);
      if (!existsSync(abs)) errors.push(`network.fixtures["${glob}"]: no file at ${rel}`);
      spec.network.fixtures[glob] = abs;
    }
  }
  if (errors.length > 0) throw new SpecError(`${SPEC_FILE} has problems:\n- ${errors.join('\n- ')}`);
  return spec;
}
