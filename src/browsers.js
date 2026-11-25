import os from 'node:os';
/** Locate installed browsers, validate explicit overrides and manage headless instances. */
import path from 'node:path';
import { stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { chromium, firefox } from 'playwright-core';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { InputError, string } from './validation.js';
import { within } from './async.js';
import { ROOT } from './config.js';

export const BUNDLED_FIREFOX = path.join(ROOT, 'runtime', 'firefox', 'firefox.exe');

const NAMES = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  firefox: 'Firefox',
  safari: 'Apple Safari',
};
const execFileAsync = promisify(execFile);

async function registryPaths(id) {
  if (process.platform !== 'win32') return [];
  const executable = {
    chrome: 'chrome.exe',
    edge: 'msedge.exe',
    firefox: 'firefox.exe',
    safari: 'Safari.exe',
  }[id];
  const values = await Promise.all(
    ['HKCU', 'HKLM'].flatMap((hive) =>
      ['64', '32'].map(async (view) => {
        try {
          const { stdout } = await execFileAsync(
            'reg.exe',
            [
              'query',
              `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executable}`,
              '/ve',
              `/reg:${view}`,
            ],
            { windowsHide: true, timeout: 4000 },
          );
          return stdout
            .match(/REG_(?:EXPAND_)?SZ\s+(.+)/)?.[1]
            ?.trim()
            .replace(/^"|"$/g, '');
        } catch {
          return null;
        }
      }),
    ),
  );
  return values.filter(Boolean);
}

function candidates(id) {
  if (process.platform === 'win32') {
    const roots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    const relative = {
      chrome: 'Google/Chrome/Application/chrome.exe',
      edge: 'Microsoft/Edge/Application/msedge.exe',
      firefox: 'Mozilla Firefox/firefox.exe',
      safari: 'Safari/Safari.exe',
    }[id];
    const localFirefox =
      id === 'firefox' && process.env.LOCALAPPDATA
        ? [path.join(process.env.LOCALAPPDATA, 'Mozilla Firefox', 'firefox.exe')]
        : [];
    return [
      ...(id === 'firefox' ? [BUNDLED_FIREFOX] : []),
      ...roots.map((root) => path.join(root, relative)),
      ...localFirefox,
    ];
  }
  if (process.platform === 'darwin') {
    const relative = {
      chrome: 'Google Chrome.app/Contents/MacOS/Google Chrome',
      edge: 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      firefox: 'Firefox.app/Contents/MacOS/firefox',
      safari: 'Safari.app/Contents/MacOS/Safari',
    }[id];
    return [
      path.join('/Applications', relative),
      path.join(os.homedir(), 'Applications', relative),
    ];
  }
  const executables = {
    chrome: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
    edge: ['microsoft-edge', 'microsoft-edge-stable'],
    firefox: ['firefox', 'firefox-esr'],
    safari: [],
  }[id];
  return [
    ...new Set(
      [
        ...(process.env.PATH || '').split(path.delimiter),
        '/usr/bin',
        '/usr/local/bin',
        '/snap/bin',
      ].filter(Boolean),
    ),
  ].flatMap((dir) => executables.map((name) => path.join(dir, name)));
}

async function executableExists(file) {
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Explicit paths take precedence. A bad override never silently selects another browser. */
export async function detectBrowsers(settings = {}) {
  return Promise.all(
    Object.entries(NAMES).map(async ([id, name]) => {
      const customPath = settings.browserPaths?.[id] || '';
      let detectedPath = '';
      for (const file of [...candidates(id), ...(await registryPaths(id))]) {
        if (await executableExists(file)) {
          detectedPath = file;
          break;
        }
      }
      const executablePath = customPath || detectedPath;
      const exists = Boolean(executablePath) && (await executableExists(executablePath));
      const bundled = id === 'firefox' && path.resolve(executablePath || '.') === BUNDLED_FIREFOX;
      return {
        id,
        name,
        bundled,
        protocol: id === 'firefox' ? (bundled ? 'Playwright Firefox' : 'WebDriver BiDi') : 'CDP',
        customPath,
        detectedPath,
        executablePath,
        detected: Boolean(detectedPath),
        available: exists && id !== 'safari',
        reason:
          id === 'safari'
            ? 'Safari hat keinen unterstützten Headless-Modus. Bitte Chrome, Edge oder Firefox verwenden.'
            : customPath && !exists
              ? 'Der hinterlegte Programmpfad ist nicht ausführbar oder existiert nicht.'
              : !exists
                ? 'Nicht gefunden. Browser installieren oder Programmpfad hinterlegen.'
                : '',
      };
    }),
  );
}

export async function validateSettings(raw) {
  const browserPaths = {};
  for (const id of Object.keys(NAMES)) {
    let file = string(raw?.browserPaths?.[id], `${NAMES[id]}-Pfad`, 2000);
    if (file.startsWith('"') && file.endsWith('"')) file = file.slice(1, -1);
    if (file && (!path.isAbsolute(file) || !(await executableExists(file))))
      throw new InputError(`Der Programmpfad für ${NAMES[id]} ist nicht gültig: ${file}`);
    if (file && process.platform === 'win32' && path.extname(file).toLowerCase() !== '.exe')
      throw new InputError('Unter Windows muss der Programmpfad auf eine .exe-Datei zeigen.');
    browserPaths[id] = file;
  }
  return { browserPaths };
}

/** Use isolated browser profiles and retain Chromium sandbox protection. */
export async function launchBrowser(browser) {
  if (!browser?.available)
    throw new InputError(browser?.reason || 'Der ausgewählte Browser ist nicht verfügbar.');
  return (browser.id === 'firefox' ? firefox : chromium).launch({
    executablePath: browser.executablePath,
    headless: true,
    timeout: 30000,
    ...(browser.id === 'firefox'
      ? browser.bundled
        ? {}
        : { channel: 'moz-firefox' }
      : { chromiumSandbox: true }),
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    ...(browser.id === 'firefox'
      ? {}
      : {
          args: [
            '--disable-gpu',
            '--disable-background-networking',
            '--no-first-run',
            '--no-default-browser-check',
          ],
        }),
  });
}

export async function checkBrowser(browser) {
  const instance = await launchBrowser(browser);
  try {
    const page = await within(
      instance.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        acceptDownloads: false,
      }),
      15000,
      'Der Browser hat keine Seite geöffnet. Bitte Browserinstallation und lokale Ausführungsrechte prüfen.',
    );
    await page.setContent(
      '<!doctype html><title>WebScreenshotter Browsertest</title><h1>Bereit</h1>',
      { timeout: 10000 },
    );
    const screenshot = await page.screenshot({ type: 'png', timeout: 10000 });
    return {
      version: await instance.version(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      screenshotBytes: screenshot.length,
    };
  } finally {
    await closeBrowser(instance);
  }
}

export async function closeBrowser(instance) {
  await within(instance.close(), 8000, 'Zeitlimit beim Schließen des Browsers erreicht.');
}
