import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { detectBrowsers, BUNDLED_FIREFOX } from '../src/browsers.js';

test('Firefox-Erkennung findet den portablen Testbrowser; ungültige eigene Pfade werden nicht übergangen', async () => {
  const exists = await access(BUNDLED_FIREFOX).then(
    () => true,
    () => false,
  );
  const detected = (await detectBrowsers()).find((browser) => browser.id === 'firefox');
  if (process.platform === 'win32' && exists) {
    assert.equal(detected.executablePath, BUNDLED_FIREFOX);
    assert.equal(detected.bundled, true);
    assert.equal(detected.protocol, 'Playwright Firefox');
    assert(detected.available);
  }
  const custom = (
    await detectBrowsers({ browserPaths: { firefox: BUNDLED_FIREFOX + '.missing' } })
  ).find((browser) => browser.id === 'firefox');
  assert.equal(custom.available, false);
  assert.equal(custom.customPath, BUNDLED_FIREFOX + '.missing');
});
