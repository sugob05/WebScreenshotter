import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBrowsers } from '../src/browsers.js';

// An existing executable is enough for detection; these tests never launch it.
// Inject definitions so tests do not depend on anyone's private browser setup.
test('Lokale Browserdefinitionen erhalten Pfad, Protokoll und ausdrückliche Auswahl', async () => {
  const definitions = {
    firefox: { executablePath: process.execPath, protocol: 'playwright', autoSelect: false },
  };
  const detected = (await detectBrowsers({}, definitions)).find(
    (browser) => browser.id === 'firefox',
  );
  assert.equal(detected.executablePath, process.execPath);
  assert.equal(detected.available, true);
  assert.equal(detected.autoSelect, false);
  assert.equal(detected.protocol, 'Playwright Firefox');

  const explicit = (
    await detectBrowsers({ browserPaths: { firefox: process.execPath } }, definitions)
  ).find((browser) => browser.id === 'firefox');
  assert.equal(explicit.protocol, 'Playwright Firefox');
  assert.equal(explicit.customPath, process.execPath);
});

test('Eigene Browserpfade haben Vorrang; lokale Protokolle werden nicht auf andere Dateien übertragen', async () => {
  const definitions = {
    firefox: { executablePath: process.execPath, protocol: 'playwright', autoSelect: false },
  };
  const missingPath = process.execPath + '.missing';
  const custom = (
    await detectBrowsers({ browserPaths: { firefox: missingPath } }, definitions)
  ).find((browser) => browser.id === 'firefox');
  assert.equal(custom.available, false);
  assert.equal(custom.executablePath, missingPath);
  assert.equal(custom.protocol, 'WebDriver BiDi');

  const standard = (await detectBrowsers({ browserPaths: { firefox: process.execPath } }, {})).find(
    (browser) => browser.id === 'firefox',
  );
  assert.equal(standard.available, true);
  assert.equal(standard.protocol, 'WebDriver BiDi');
  assert.equal(standard.autoSelect, true);
});
