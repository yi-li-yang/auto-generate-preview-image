import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resample } from '../src/resample.js';

const A = { ts: 0, data: 'A' };
const B = { ts: 150, data: 'B' };
const C = { ts: 420, data: 'C' };

test('each tick takes the latest frame painted at or before it', () => {
  // fps 10 -> ticks at 0, 100, 200, 300, 400 ms
  assert.deepEqual(resample([A, B, C], { fps: 10, start: 0, end: 500 }), ['A', 'A', 'B', 'B', 'B']);
});

test('a frame painted exactly on a tick is used for that tick', () => {
  assert.deepEqual(resample([A, B, C], { fps: 10, start: 50, end: 250 }), ['A', 'B']);
});

test('a tick before the first frame uses the first frame', () => {
  assert.deepEqual(resample([B], { fps: 10, start: 0, end: 200 }), ['B', 'B']);
});

test('frames that arrive out of order are sorted by time first', () => {
  assert.deepEqual(resample([C, A, B], { fps: 10, start: 0, end: 300 }), ['A', 'A', 'B']);
});

test('no recorded frames is an error, not an empty animation', () => {
  assert.throws(() => resample([], { fps: 10, start: 0, end: 500 }), /no frames/);
});
