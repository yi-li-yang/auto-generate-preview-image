import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globMatch, decide } from '../src/network.js';

test('globs match the URL without its query string', () => {
  assert.equal(globMatch('**/trips/*.csv', 'https://yi-li-yang.github.io/travel-map/trips/yili.csv?v=2'), true);
  assert.equal(globMatch('**/trips/*.csv', 'https://yi-li-yang.github.io/travel-map/trips/sub/yili.csv'), false);
});

test('a single star stays inside one path segment, a double star crosses segments', () => {
  assert.equal(globMatch('http://localhost:5173/*', 'http://localhost:5173/index.html'), true);
  assert.equal(globMatch('http://localhost:5173/*', 'http://localhost:5173/src/main.ts'), false);
  assert.equal(globMatch('http://localhost:5173/**', 'http://localhost:5173/src/main.ts'), true);
  assert.equal(globMatch('http://localhost:5173/**', 'http://localhost:8000/api/x'), false);
});

test('a trailing /** also matches the folder itself, so "/api" cannot slip past a block on "**/api/**"', () => {
  assert.equal(globMatch('**/api/**', 'http://localhost:5173/api'), true);
  assert.equal(globMatch('**/api/**', 'http://localhost:5173/api/analytics/spending?month=1'), true);
  assert.equal(globMatch('**/api/**', 'http://localhost:5173/src/api.ts'), false);
});

test('dots and other regex characters in a glob are literal', () => {
  assert.equal(globMatch('**/a.json', 'http://h/a.json'), true);
  assert.equal(globMatch('**/a.json', 'http://h/aXjson'), false);
});

const rules = {
  fixtures: { '**/api/spending*': 'C:/fx/spending.json' },
  block: ['**/api/**'],
  allow: ['http://localhost:5173/**'],
};

test('a fixture wins over a block rule, so a listed endpoint is served from its file', () => {
  assert.deepEqual(decide('http://localhost:5173/api/spending?m=1', rules), { action: 'fixture', file: 'C:/fx/spending.json' });
});

test('an endpoint with no fixture is blocked even though its origin is allowed', () => {
  assert.deepEqual(decide('http://localhost:5173/api/transactions', rules), { action: 'block' });
});

test('an allowed URL passes', () => {
  assert.deepEqual(decide('http://localhost:5173/src/main.tsx', rules), { action: 'allow' });
});

test('a URL outside the allow list is denied', () => {
  assert.deepEqual(decide('https://fonts.googleapis.com/css2', rules), { action: 'deny' });
});

test('with no allow list, every URL that is not blocked passes', () => {
  assert.deepEqual(decide('https://tiles.openfreemap.org/x.pbf', { fixtures: {}, block: [], allow: null }), { action: 'allow' });
});
