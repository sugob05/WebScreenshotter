import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
import { PDFDocument } from 'pdf-lib';
import { createApp } from '../../server.js';
import { detectBrowsers } from '../../src/browsers.js';
import { validateConfig } from '../../src/validation.js';
import { delaySeconds } from '../../src/jobs.js';

let app;
let website;
let baseUrl;
let selected;
let available;
const outputDir = path.resolve('.test-output', `integration-${Date.now()}`);
const requestTimes = [];

before(async () => {
  await mkdir(outputDir, { recursive: true });
  website = http.createServer((request, response) => {
    requestTimes.push({ url: request.url, time: Date.now() });
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/page?a=1&b=2' });
      return response.end();
    }
    if (request.url === '/sitemap.xml') {
      response.setHeader('Content-Type', 'application/xml');
      return response.end(
        `<sitemapindex><sitemap><loc>${baseUrl}/pages.xml.gz</loc></sitemap></sitemapindex>`,
      );
    }
    if (request.url === '/pages.xml.gz')
      return response.end(
        gzipSync(
          `<urlset><url><loc>${baseUrl}/page</loc></url><url><loc>${baseUrl}/missing</loc></url><url><loc>${baseUrl}/page</loc></url></urlset>`,
        ),
      );
    if (request.url === '/broken') {
      request.socket.destroy();
      return;
    }
    response.writeHead(request.url === '/missing' ? 404 : 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Test': 'fixture',
      Server: 'Screenshotter-test',
    });
    response.end(
      `<!doctype html><html lang="de"><head><title>Archiv &amp; Ästhetik · ${request.url === '/missing' ? 'Fehlerseite' : 'Testseite'}</title><style>body{margin:0;background:#eef4e8;font-family:Arial}header{padding:45px;background:#17654e;color:white}main{padding:30px;height:1900px}h1{font-size:40px}.bottom{margin-top:1650px;padding:20px;background:#e2b55b}</style></head><body><header><h1>Screenshotter</h1><p>Reale Testaufnahme · äöü &amp; Metadaten</p></header><main><h2>${request.url === '/missing' ? '404 – Nicht gefunden' : 'Das digitale Gedächtnis'}</h2><p>Inhalt am Anfang</p><div class="bottom">Inhalt am Seitenende</div></main></body></html>`,
    );
  });
  await new Promise((resolve) => website.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${website.address().port}`;
  available = (await detectBrowsers()).filter((browser) => browser.available);
  selected = available.find((browser) => browser.id === 'edge') || available[0];
  if (!selected) throw new Error('Kein installierter Browser für die Integrationstests gefunden.');
  app = await createApp({ port: 0 });
});
after(async () => {
  await app?.close();
  if (website) await new Promise((resolve) => website.close(resolve));
});

function config(patch = {}) {
  return validateConfig({
    username: 'Testarchiv',
    collection: 'Integration',
    description: 'Lokaler Funktionstest',
    signature: 'TEST 1',
    metadata: [{ term: 'rights', value: 'Testdaten' }],
    outputDir,
    urls: `${baseUrl}/page`,
    browser: selected.id,
    prefix: 'archiv_',
    suffix: '_test',
    startNumber: 7,
    padding: 4,
    width: 800,
    height: 600,
    fullPage: true,
    lazyLoad: false,
    delay: 0,
    settleTime: 0,
    ...patch,
  });
}
async function execute(patch = {}, browser = selected) {
  const snapshot = await app.manager.start(config({ ...patch, browser: browser.id }), browser);
  const job = app.manager.jobs.get(snapshot.id);
  await job.done;
  assert.equal(job.status, 'completed', job.error || JSON.stringify(job.records));
  return job;
}

test(
  'PNG, JPG, TIFF und PDF: echte Dateien, Metadaten und SHA-256',
  { timeout: 180000 },
  async () => {
    for (const format of ['png', 'jpg', 'tif', 'pdf']) {
      const job = await execute({ format, urls: `${baseUrl}/redirect` });
      assert.equal(job.records.length, 1);
      const record = job.records[0];
      assert.equal(record.outcome, 'success', record.error);
      assert.equal(record.httpStatus, 200);
      assert.equal(record.responseHeaders.server, 'Screenshotter-test');
      assert(record.title.includes('Archiv & Ästhetik'));
      assert(record.finalUrl.includes('/page?a=1&b=2'));
      assert(record.redirects.some((redirect) => redirect.status === 302));
      assert(record.userAgent.length > 10);
      assert.equal(record.filename, `archiv_0007_test.${format}`);
      const bytes = await readFile(path.join(job.outputDir, 'screenshots', record.filename));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sha256);
      assert.equal(
        (await stat(path.join(job.outputDir, 'screenshots', record.filename))).size,
        record.bytes,
      );
      if (format === 'png') {
        assert.equal(bytes.readUInt32BE(16), 800);
        assert(bytes.readUInt32BE(20) > 600);
      }
      if (format === 'jpg') {
        assert.equal(bytes.readUInt16BE(0), 0xffd8);
        assert.equal(bytes.readUInt16BE(bytes.length - 2), 0xffd9);
      }
      if (format === 'tif') assert.equal(bytes.toString('ascii', 0, 2), 'II');
      if (format === 'pdf') assert((await PDFDocument.load(bytes)).getPageCount() >= 2);
      const mets = await readFile(path.join(job.outputDir, 'mets.xml'), 'utf8');
      new SaxesParser({ xmlns: true }).write(mets).close();
      assert(mets.includes(record.sha256));
      assert(mets.includes(record.filename));
      const manifest = JSON.parse(
        await readFile(path.join(job.outputDir, 'manifest.json'), 'utf8'),
      );
      assert.equal(manifest.status, 'completed');
      assert.deepEqual(manifest.remainingUrls, []);
    }
  },
);

test('Alle erkannten Browser nehmen im Headless-Modus auf', { timeout: 120000 }, async () => {
  for (const browser of available) {
    const job = await execute({ fullPage: false }, browser);
    assert.equal(job.records[0].outcome, 'success', job.records[0].error);
    assert.equal(job.records[0].imageHeight, 600);
    assert.equal(job.browserInfo.id, browser.id);
  }
});

test('Sitemap-Index, HTTP-Fehlerseite und fehlgeschlagener Abruf', { timeout: 90000 }, async () => {
  const sitemap = await execute({ inputMode: 'sitemap', sitemapUrl: `${baseUrl}/sitemap.xml` });
  assert.equal(sitemap.urls.length, 2);
  assert.equal(sitemap.sources.length, 2);
  assert.equal(sitemap.records[1].httpStatus, 404);
  assert.equal(sitemap.records[1].outcome, 'warning');
  assert(sitemap.records[1].filename);
  const job = await execute({ urls: [`${baseUrl}/broken`, `${baseUrl}/page`] });
  assert.equal(job.records[0].outcome, 'failure');
  assert(!job.records[0].filename);
  assert.equal(job.records[1].filename, 'archiv_0008_test.png');
  const mets = await readFile(path.join(job.outputDir, 'mets.xml'), 'utf8');
  assert(mets.includes('failedCapture'));
  assert(mets.includes(job.records[0].eventId));
});

test(
  'Feste und zufällige Pausen; Abbruch während einer langen Pause',
  { timeout: 90000 },
  async () => {
    const timed = await execute({ urls: [`${baseUrl}/page`, `${baseUrl}/missing`], delay: 0.2 });
    assert(Date.parse(timed.records[1].startedAt) - Date.parse(timed.records[0].finishedAt) >= 190);
    assert.equal(
      delaySeconds({ delayMode: 'random', delayMin: 2, delayMax: 5 }, () => 0),
      2,
    );
    assert.equal(
      delaySeconds({ delayMode: 'random', delayMin: 2, delayMax: 5 }, () => 0.5),
      3.5,
    );
    const waiting = new Promise((resolve) => {
      const listener = (snapshot) => {
        if (snapshot.status === 'waiting') {
          app.manager.off('change', listener);
          resolve(snapshot);
        }
      };
      app.manager.on('change', listener);
    });
    const snapshot = await app.manager.start(
      config({ urls: [`${baseUrl}/page`, `${baseUrl}/missing`], delay: 30 }),
      selected,
    );
    const job = app.manager.jobs.get(snapshot.id);
    await waiting;
    const start = Date.now();
    app.manager.stop(job.id);
    await job.done;
    assert(Date.now() - start < 10000);
    assert.equal(job.status, 'cancelled');
    assert.equal(job.records.length, 1);
    const manifest = JSON.parse(await readFile(path.join(job.outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.status, 'cancelled');
    assert.equal(manifest.remainingUrls.length, 1);
  },
);

test('HTTP-API schützt Schreibzugriffe, fremde Origins, Host und Dateipfade', async () => {
  const base = `http://127.0.0.1:${app.port}`;
  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  assert.equal(bootstrap.token, app.token);
  assert.equal((await fetch(`${base}/api/jobs`)).status, 403);
  assert.equal(
    (await fetch(`${base}/api/bootstrap`, { headers: { Origin: 'https://evil.test' } })).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Screenshotter-Token': app.token },
        body: '{}',
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/api/jobs`, { headers: { 'X-Screenshotter-Token': app.token } })).status,
    200,
  );
  const last = [...app.manager.jobs.values()].at(-1);
  assert.equal(
    (await fetch(`${base}/api/jobs/${last.id}/files/settings.json?token=${app.token}`)).status,
    404,
  );
  assert.equal(
    (await fetch(`${base}/api/jobs/${last.id}/files/mets.xml?token=${app.token}`)).status,
    200,
  );
  await assert.rejects(
    () => app.manager.start(config({ urls: `${base}/` }), selected),
    /Oberfläche/,
  );
});
