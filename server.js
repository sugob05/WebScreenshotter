/** Loopback-only HTTP server. Static files and authenticated API routes are
 * allowlisted; downloads cannot be used to read arbitrary local paths.
 */
import http from 'node:http';
import path from 'node:path';
import { outputArtifact } from './src/artifacts.js';
import os from 'node:os';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, VERSION, loadSettings, saveSettings } from './src/config.js';
import { validateConfig, InputError, normalizeUrl } from './src/validation.js';
import { detectBrowsers, validateSettings, checkBrowser } from './src/browsers.js';
import { resolveSitemap } from './src/sitemap.js';
import { JobManager } from './src/jobs.js';
import { EXCEL_FILENAME } from './src/excel.js';

const CONTENT_TYPES = {
  '': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.tif': 'image/tiff',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.sha256': 'text/plain; charset=utf-8',
};

// Documentation is public, but no directory is exposed wholesale. In particular,
// runtime files, local settings and arbitrary project files stay inaccessible.
const DOCUMENTATION_FILES = new Map(
  [
    'ANLEITUNG.html',
    'README.md',
    'WARTUNG.md',
    'PRUEFBERICHT.md',
    'THIRD_PARTY.md',
    'LICENSE',
    'test/schemas/README.md',
    'docs/anleitung.css',
    ...[
      '01-node-portabel',
      '02-metadaten-urls',
      '03-aufnahme-ablage',
      '04-pdf-varianten',
      '05-fortschritt-export',
      '06-browser-darkmode',
    ].map((name) => `docs/images/${name}.svg`),
  ].map((filename) => [`/${filename}`, filename]),
);

function sendJson(response, data, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
}

/** Limit request memory before parsing JSON; browser-supplied content is untrusted. */
async function readJsonBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json'))
    throw new InputError('JSON wird erwartet.', 415);
  const buffers = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new InputError('Die Anfrage ist größer als 2 MiB.', 413);
    buffers.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(buffers).toString('utf8'));
  } catch {
    throw new InputError('Ungültige JSON-Daten.');
  }
}

async function streamFile(response, file, attachment = false, headOnly = false) {
  const info = await stat(file);
  if (!info.isFile()) throw new InputError('Datei nicht gefunden.', 404);
  response.writeHead(200, {
    'Content-Type':
      path.extname(file).toLowerCase() === '.xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': 'no-store',
    ...(attachment
      ? {
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
        }
      : {}),
  });
  if (headOnly) return response.end();
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}

async function listFolders(directory) {
  const current = directory ? path.resolve(directory) : os.homedir();
  const entries = await readdir(current, { withFileTypes: true });
  let roots = ['/'];
  if (process.platform === 'win32') {
    const drives = await Promise.all(
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async (letter) => {
        const drive = `${letter}:\\`;
        try {
          return (await stat(drive)).isDirectory() ? drive : null;
        } catch {
          return null;
        }
      }),
    );
    roots = drives.filter(Boolean);
  }
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return {
    current,
    parent: path.dirname(current),
    roots,
    home: os.homedir(),
    truncated: directories.length > 1000,
    directories: directories
      .slice(0, 1000)
      .map((entry) => ({ name: entry.name, path: path.join(current, entry.name) })),
  };
}

/** The returned close function owns jobs, event-stream clients and the listener. */
export async function createApp({ port = Number(process.env.PORT || 4317) } = {}) {
  const token = randomBytes(32).toString('hex');
  let settings = await loadSettings();
  let actualPort;
  const clients = new Set();
  const manager = new JobManager({
    checkUrl: (value) => {
      const url = new URL(value);
      if (
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        Number(url.port || (url.protocol === 'https:' ? 443 : 80)) === actualPort
      )
        throw new InputError(
          'Die WebScreenshotter-Oberfläche selbst kann nicht als Aufnahmeziel verwendet werden.',
        );
    },
  });
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    try {
      const validHosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      if (!validHosts.includes(request.headers.host)) throw new InputError('Ungültiger Host.', 403);
      if (
        request.headers.origin &&
        !validHosts.some((host) => request.headers.origin === `http://${host}`)
      )
        throw new InputError('Fremde Herkunft ist nicht erlaubt.', 403);
      if (
        ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site']) &&
        request.url?.startsWith('/api/')
      )
        throw new InputError('Die API ist nur für die lokale Oberfläche zugänglich.', 403);
      const url = new URL(request.url, `http://127.0.0.1:${actualPort}`);
      const route = url.pathname;
      if (route === '/api/bootstrap' && request.method === 'GET') {
        return sendJson(response, {
          token,
          version: VERSION,
          platform: process.platform,
          defaultOutputDir: path.join(ROOT, 'aufnahmen'),
          browsers: await detectBrowsers(settings),
          settings,
          jobs: [...manager.jobs.values()].map((job) => manager.snapshot(job)),
        });
      }
      if (route.startsWith('/api/')) {
        const supplied = String(
          request.headers['x-screenshotter-token'] || url.searchParams.get('token') || '',
        );
        if (
          supplied.length !== token.length ||
          !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
        )
          throw new InputError('Ungültiger Sitzungsschlüssel. Bitte die Seite neu laden.', 403);
        if (route === '/api/settings' && request.method === 'PUT') {
          const validated = await validateSettings(await readJsonBody(request));
          await saveSettings(validated);
          settings = validated;
          return sendJson(response, { settings, browsers: await detectBrowsers(settings) });
        }
        if (route === '/api/browsers' && request.method === 'GET')
          return sendJson(response, { browsers: await detectBrowsers(settings) });
        if (route === '/api/browser-test' && request.method === 'POST') {
          const input = await readJsonBody(request);
          const browsers = await detectBrowsers(
            input.browserPaths
              ? await validateSettings({ browserPaths: input.browserPaths })
              : settings,
          );
          return sendJson(
            response,
            await checkBrowser(browsers.find((browser) => browser.id === input.browser)),
          );
        }
        if (route === '/api/directories' && request.method === 'GET')
          return sendJson(response, await listFolders(url.searchParams.get('path')));
        if (route === '/api/sitemap' && request.method === 'POST') {
          const input = await readJsonBody(request);
          const controller = new AbortController();
          response.on('close', () => {
            if (!response.writableEnded) controller.abort();
          });
          const resolved = await resolveSitemap(normalizeUrl(input.url), {
            signal: controller.signal,
            checkUrl: manager.checkUrl,
          });
          return sendJson(response, { ...resolved, count: resolved.urls.length });
        }
        if (route === '/api/jobs' && request.method === 'POST') {
          const config = validateConfig(await readJsonBody(request));
          const browser = (await detectBrowsers(settings)).find(
            (browser) => browser.id === config.browser,
          );
          if (!browser?.available)
            throw new InputError(browser?.reason || 'Browser nicht verfügbar.');
          return sendJson(response, await manager.start(config, browser), 201);
        }
        if (route === '/api/jobs' && request.method === 'GET')
          return sendJson(
            response,
            [...manager.jobs.values()].map((job) => manager.snapshot(job)),
          );
        if (route === '/api/events' && request.method === 'GET') {
          response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
          });
          response.write(
            `event: ready\ndata: ${JSON.stringify([...manager.jobs.values()].map((job) => manager.snapshot(job)))}\n\n`,
          );
          clients.add(response);
          const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
          request.on('close', () => {
            clearInterval(heartbeat);
            clients.delete(response);
          });
          return;
        }
        const stopMatch = route.match(/^\/api\/jobs\/([a-f0-9-]+)\/stop$/);
        if (stopMatch && request.method === 'POST')
          return sendJson(response, manager.stop(stopMatch[1]));
        const excelMatch = route.match(/^\/api\/jobs\/([a-f0-9-]+)\/export-excel$/);
        if (excelMatch && request.method === 'POST')
          return sendJson(response, await manager.exportExcel(excelMatch[1]));
        const fileMatch = route.match(/^\/api\/jobs\/([a-f0-9-]+)\/files\/(.+)$/);
        if (fileMatch && request.method === 'GET') {
          const job = manager.jobs.get(fileMatch[1]);
          if (!job) throw new InputError('Auftrag nicht gefunden.', 404);
          const relative = decodeURIComponent(fileMatch[2]);
          const allowed = [
            'mets.xml',
            'manifest.json',
            'checksums.sha256',
            'protokoll.jsonl',
            ...(job.excelWritten ? [EXCEL_FILENAME] : []),
            ...(job.combinedPdf ? [job.combinedPdf.filename] : []),
            ...job.records
              .filter((record) => record.filename)
              .map((record) => outputArtifact(job, record).relativePath),
          ];
          if (!allowed.includes(relative)) throw new InputError('Datei nicht gefunden.', 404);
          return await streamFile(
            response,
            path.join(job.outputDir, relative),
            url.searchParams.get('download') === '1',
          );
        }
        throw new InputError('Endpunkt nicht gefunden.', 404);
      }
      if (!['GET', 'HEAD'].includes(request.method))
        throw new InputError('Methode nicht erlaubt.', 405);
      const publicFiles = {
        '/': 'index.html',
        '/index.html': 'index.html',
        '/app.js': 'app.js',
        '/theme.js': 'theme.js',
        '/url-import.js': 'url-import.js',
        '/styles.css': 'styles.css',
        '/icon.svg': 'icon.svg',
      };
      const relativeFile = publicFiles[route]
        ? `public/${publicFiles[route]}`
        : DOCUMENTATION_FILES.get(route);
      if (!relativeFile) throw new InputError('Seite nicht gefunden.', 404);
      return await streamFile(
        response,
        path.join(ROOT, relativeFile),
        false,
        request.method === 'HEAD',
      );
    } catch (error) {
      if (response.headersSent) return response.end();
      const status =
        error.status || (error.code === 'ENOENT' ? 404 : error.code === 'EACCES' ? 403 : 500);
      sendJson(response, { error: error.message || 'Unbekannter Fehler.' }, status);
    }
  });
  manager.on('change', (snapshot) => {
    const data = `event: job\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const client of clients) {
      if (!client.destroyed) client.write(data);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  actualPort = server.address().port;
  const close = async () => {
    if (manager.active) {
      const job = manager.active;
      manager.stop(job.id);
      await job.done;
    }
    for (const client of clients) client.end();
    await new Promise((resolve) => server.close(resolve));
  };
  return { server, manager, port: actualPort, token, close };
}

function openBrowser(url) {
  // Let the operating system open the interface in the user's default browser.
  // Headless capture browsers are selected separately and never launch the UI.
  const command =
    process.platform === 'win32'
      ? 'rundll32.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log(`Bitte im Browser öffnen: ${url}`));
  child.unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const app = await createApp();
    const url = `http://127.0.0.1:${app.port}`;
    console.log(`\nWebScreenshotter ${VERSION}\n${url}\n\nZum Beenden Strg+C drücken.\n`);
    if (process.argv.includes('--open') && !process.argv.includes('--no-open')) openBrowser(url);
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await app.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error(
      error.code === 'EADDRINUSE'
        ? 'Der Port ist bereits belegt. Bitte die laufende WebScreenshotter-Instanz verwenden oder PORT anders setzen.'
        : error.message,
    );
    process.exitCode = 1;
  }
}
