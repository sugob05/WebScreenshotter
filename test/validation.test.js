import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateConfig, parseUrls, filenameFor, normalizeUrl } from '../src/validation.js';

const base = {
  username: 'Archiv',
  collection: 'Testbestand',
  outputDir: path.resolve('.test-output'),
  urls: 'https://example.org/',
  browser: 'edge',
  prefix: 'web_',
};
test('URL-Normalisierung, Umlaute, Reihenfolge und Deduplizierung', () => {
  assert.deepEqual(
    parseUrls('https://example.org\nhttps://example.org/\nhttps://example.org/ä?a=1&b=2'),
    ['https://example.org/', 'https://example.org/%C3%A4?a=1&b=2'],
  );
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://name:password@example.org/',
    'keine-url',
  ])
    assert.throws(() => normalizeUrl(url));
});
test('Benennung behält Reihenfolge, Startnummer und Mindeststellenzahl', () => {
  const config = validateConfig({
    ...base,
    startNumber: 998,
    padding: 3,
    suffix: '_archiv',
    format: 'tif',
  });
  assert.equal(filenameFor(config, 0), 'web_998_archiv.tif');
  assert.equal(filenameFor(config, 2), 'web_1000_archiv.tif');
  assert.equal(
    filenameFor(validateConfig({ ...base, startNumber: 0, padding: 6 }), 0),
    'web_000000.png',
  );
});
test('Ungültige Pflichtwerte, Zahlen, Pfade und Begriffe werden abgewiesen', () => {
  for (const patch of [
    { username: '' },
    { collection: '' },
    { width: -1 },
    { width: 1.5 },
    { padding: 30 },
    { timeout: null },
    { outputDir: 'relative/path' },
    { prefix: '../' },
    { suffix: '\\escape' },
    { format: 'exe' },
    { browser: 'safari' },
    { delayMode: 'random', delayMin: 5, delayMax: 2 },
    { metadata: [{ term: 'injected', value: 'bad' }] },
  ])
    assert.throws(() => validateConfig({ ...base, ...patch }), JSON.stringify(patch));
});
test('Sitemap-Konfiguration und wiederholte Dublin-Core-Felder', () => {
  const config = validateConfig({
    ...base,
    inputMode: 'sitemap',
    sitemapUrl: 'https://example.org/sitemap.xml',
    metadata: [
      { term: 'subject', value: 'Ort' },
      { term: 'subject', value: 'Kultur' },
      { term: 'rights', value: '   ' },
    ],
  });
  assert.equal(config.urls, undefined);
  assert.equal(config.metadata.length, 2);
});

test('Retry-Konfiguration validiert Anzahl, aktive Wartezeiten und Zufallsgrenzen', () => {
  assert.equal(validateConfig(base).retries, 0);
  for (const patch of [
    { retries: -1 },
    { retries: 1.5 },
    { retries: 21 },
    { retries: null },
    { retries: 1, retryDelay: -1 },
    { retries: 1, retryDelay: null },
    { retries: 1, retryDelay: 86401 },
    { retryDelayMode: 'invalid' },
    { retries: 1, retryDelayMode: 'random', retryDelayMin: 8, retryDelayMax: 2 },
    { retries: 1, retryDelayMode: 'random', retryDelayMax: 'NaN' },
  ])
    assert.throws(() => validateConfig({ ...base, ...patch }), JSON.stringify(patch));
  const random = validateConfig({
    ...base,
    retries: 2,
    retryDelayMode: 'random',
    retryDelayMin: 0.5,
    retryDelayMax: 3,
  });
  assert.equal(random.retries, 2);
  assert.equal(random.retryDelayMin, 0.5);
  assert.equal(random.retryDelayMax, 3);
  assert.doesNotThrow(() =>
    validateConfig({
      ...base,
      retries: 0,
      retryDelayMode: 'random',
      retryDelayMin: 10,
      retryDelayMax: 1,
    }),
  );
  assert.doesNotThrow(() =>
    validateConfig({ ...base, retries: 1, retryDelay: 0, retryDelayMin: -1 }),
  );
});
