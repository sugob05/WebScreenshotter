import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import UPNGPackage from '@pdf-lib/upng';
import { PDFDocument } from 'pdf-lib';
import { JobManager, delaySeconds } from '../src/jobs.js';
import { validateConfig } from '../src/validation.js';
import { createApp } from '../server.js';

const UPNG = UPNGPackage.default || UPNGPackage;
const png = Buffer.from(UPNG.encode([new Uint8Array([20, 90, 40, 255]).buffer], 1, 1, 0));
const root = path.resolve('.test-output', `jobs-${Date.now()}`);
const browser = {
  id: 'chrome',
  name: 'Testbrowser',
  executablePath: '/mock/browser',
  available: true,
};
const config = (patch) =>
  validateConfig({
    username: 'Testperson',
    collection: 'Bestand & Tests',
    outputDir: root,
    urls: ['https://example.org/a'],
    browser: 'chrome',
    prefix: 'web_',
    delay: 0,
    settleTime: 0,
    fullPage: false,
    lazyLoad: false,
    ...patch,
  });

function fakeBrowser({ hang = false } = {}) {
  return {
    version: async () => 'Mock 1.0',
    close: async () => {},
    newPage: async () => {
      if (hang) return new Promise(() => {});
      const listeners = new Map();
      let url = 'about:blank';
      let closed = false;
      const frame = {};
      return {
        setDefaultNavigationTimeout() {},
        setDefaultTimeout() {},
        on: (name, listener) => listeners.set(name, listener),
        mainFrame: () => frame,
        goto: async (value) => {
          url = value;
          if (url.endsWith('/broken')) throw new Error('Test: Netzwerkfehler');
          const status = url.endsWith('/missing') ? 404 : 200;
          listeners.get('response')?.({
            request: () => ({ isNavigationRequest: () => true }),
            frame: () => frame,
            status: () => status,
            statusText: () => (status === 200 ? 'OK' : 'Not Found'),
            url: () => url,
            headers: () => ({ server: 'Fixture', 'set-cookie': 'secret=discarded' }),
          });
        },
        evaluate: async () => 'Test-UserAgent',
        title: async () => 'Testseite',
        url: () => url,
        screenshot: async () => png,
        isClosed: () => closed,
        close: async () => {
          closed = true;
        },
      };
    },
  };
}

test('Auftrag bewahrt Aufrufreihenfolge, Fehler, Dateizuordnung und Hashes', async () => {
  const manager = new JobManager({ launch: async () => fakeBrowser() });
  const first = await manager.start(
    config({
      startNumber: 40,
      urls: ['https://example.org/a', 'https://example.org/broken', 'https://example.org/missing'],
    }),
    browser,
  );
  const job = manager.jobs.get(first.id);
  await job.done;
  assert.equal(job.status, 'completed');
  assert.equal(manager.active, null);
  assert.deepEqual(
    job.records.map((record) => record.outcome),
    ['success', 'failure', 'warning'],
  );
  assert.deepEqual(
    job.records.map((record) => record.filename),
    ['web_0040.png', undefined, 'web_0042.png'],
  );
  assert.equal(job.records[0].sha256, createHash('sha256').update(png).digest('hex'));
  assert.equal(job.records[2].httpStatus, 404);
  assert.equal(job.records[0].responseHeaders['set-cookie'], undefined);
  const saved = JSON.parse(await readFile(path.join(job.outputDir, 'manifest.json'), 'utf8'));
  assert.equal(saved.status, 'completed');
  assert.equal(saved.remainingUrls.length, 0);
  const mets = await readFile(path.join(job.outputDir, 'mets.xml'), 'utf8');
  assert(mets.includes(job.records[1].eventId));
  assert(mets.includes('failedCapture'));
  const checksums = await readFile(path.join(job.outputDir, 'checksums.sha256'), 'utf8');
  assert.equal(checksums.trim().split('\n').length, 2);
  const second = await manager.start(config(), browser);
  await manager.jobs.get(second.id).done;
  assert.notEqual(first.outputDir, second.outputDir);
  assert.equal((await readdir(path.join(first.outputDir, 'screenshots'))).length, 2);
});

test('Abbruch unterbricht eine laufende Pause und bewahrt abgeschlossene Dateien', async () => {
  const manager = new JobManager({ launch: async () => fakeBrowser() });
  const waiting = new Promise((resolve) =>
    manager.on('change', (snapshot) => {
      if (snapshot.status === 'waiting') resolve(snapshot);
    }),
  );
  const snapshot = await manager.start(
    config({ urls: ['https://example.org/a', 'https://example.org/b'], delay: 30 }),
    browser,
  );
  await assert.rejects(() => manager.start(config(), browser), /bereits/);
  await waiting;
  const started = Date.now();
  manager.stop(snapshot.id);
  const job = manager.jobs.get(snapshot.id);
  await job.done;
  assert(Date.now() - started < 3000);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.records.length, 1);
  const saved = JSON.parse(await readFile(path.join(job.outputDir, 'manifest.json'), 'utf8'));
  assert.deepEqual(saved.remainingUrls, ['https://example.org/b']);
  assert.equal(saved.status, 'cancelled');
});

test('Ein nicht antwortender Browser lässt sich während newPage abbrechen', async () => {
  const manager = new JobManager({ launch: async () => fakeBrowser({ hang: true }) });
  const running = new Promise((resolve) =>
    manager.on('change', (snapshot) => {
      if (snapshot.status === 'running') resolve(snapshot);
    }),
  );
  const snapshot = await manager.start(config(), browser);
  await running;
  manager.stop(snapshot.id);
  const job = manager.jobs.get(snapshot.id);
  await job.done;
  assert.equal(job.status, 'cancelled');
  assert.equal(job.records[0].outcome, 'cancelled');
  assert(job.metadataWritten);
});

test('Zufallspause liegt im gewählten Intervall', () => {
  assert.equal(
    delaySeconds({ delayMode: 'random', delayMin: 2, delayMax: 5 }, () => 0),
    2,
  );
  assert.equal(
    delaySeconds({ delayMode: 'random', delayMin: 2, delayMax: 5 }, () => 0.5),
    3.5,
  );
  assert.equal(delaySeconds({ delayMode: 'fixed', delay: 7 }), 7);
});

test('Gesamt-PDF wird im Auftrag, in METS, Manifest und Prüfsummen verknüpft und angeboten', async () => {
  const app = await createApp({ port: 0 });
  app.manager.launch = async () => fakeBrowser();
  try {
    const snapshot = await app.manager.start(
      config({
        format: 'pdf',
        combinePdf: true,
        urls: [
          'https://example.org/a',
          'https://example.org/broken',
          'https://example.org/missing',
        ],
      }),
      browser,
    );
    const job = app.manager.jobs.get(snapshot.id);
    await job.done;
    assert.equal(job.status, 'completed');
    assert.equal(job.combinedPdf.sourceCount, 2);
    const manifest = JSON.parse(await readFile(path.join(job.outputDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.application.name, 'WebScreenshotter');
    assert.equal(manifest.combinedPdf.pageCount, 2);
    const checksums = await readFile(path.join(job.outputDir, 'checksums.sha256'), 'utf8');
    assert.equal(checksums.trim().split('\n').length, 1);
    assert(checksums.includes(`${job.combinedPdf.sha256}  gesamt.pdf`));
    const mets = await readFile(path.join(job.outputDir, 'mets.xml'), 'utf8');
    assert(mets.includes('LOCREF="gesamt.pdf"'));
    assert(mets.includes(job.combinedPdf.objectId));
    assert(mets.includes('<premis:eventType>derivation</premis:eventType>'));
    assert(mets.includes('BETYPE="PAGE" BEGIN="1" END="1"'));
    assert(!mets.includes('LOCREF="screenshots/'));
    assert(!mets.includes('LOCREF="pdf-zwischenstand/'));
    assert.deepEqual(await readdir(path.join(job.outputDir, 'screenshots')), []);
    assert(!(await readdir(job.outputDir)).includes('pdf-zwischenstand'));
    assert.equal(app.manager.snapshot(job).records[0].filePath, 'gesamt.pdf');
    const obsoletePart = `pdf-zwischenstand/${job.records[0].filename}`;
    assert.equal(
      (
        await fetch(
          `http://127.0.0.1:${app.port}/api/jobs/${job.id}/files/${obsoletePart}?token=${app.token}`,
        )
      ).status,
      404,
    );
    const url = `http://127.0.0.1:${app.port}/api/jobs/${job.id}/files/gesamt.pdf`;
    assert.equal((await fetch(url)).status, 403);
    const response = await fetch(`${url}?token=${app.token}&download=1`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal((await PDFDocument.load(await response.arrayBuffer())).getPageCount(), 2);
    const withoutMerge = await app.manager.start(config({ format: 'pdf' }), browser);
    await app.manager.jobs.get(withoutMerge.id).done;
    assert.equal(
      (await readdir(path.join(app.manager.jobs.get(withoutMerge.id).outputDir, 'screenshots')))
        .length,
      1,
    );
    assert.equal(
      (
        await fetch(
          `http://127.0.0.1:${app.port}/api/jobs/${withoutMerge.id}/files/gesamt.pdf?token=${app.token}`,
        )
      ).status,
      404,
    );
  } finally {
    await app.close();
  }
});

test('Abgebrochener PDF-Auftrag erstellt die Gesamt-PDF der bereits gespeicherten Aufnahmen', async () => {
  const manager = new JobManager({ launch: async () => fakeBrowser() });
  manager.on('change', (snapshot) => {
    if (snapshot.status === 'waiting') manager.stop(snapshot.id);
  });
  const snapshot = await manager.start(
    config({
      format: 'pdf',
      combinePdf: true,
      urls: ['https://example.org/a', 'https://example.org/b'],
      delay: 30,
    }),
    browser,
  );
  const job = manager.jobs.get(snapshot.id);
  await job.done;
  assert.equal(job.status, 'cancelled');
  assert.equal(job.combinedPdf.sourceCount, 1);
  assert.equal(job.combinedPdf.pageCount, 1);
  assert(job.metadataWritten);
  assert(!(await readdir(job.outputDir)).includes('pdf-zwischenstand'));
});

test('Fehler der Gesamt-PDF bewahrt rettbare Zwischenstände und dokumentiert den fehlgeschlagenen Abschluss', async () => {
  const manager = new JobManager({
    launch: async () => fakeBrowser(),
    combinePdf: async () => {
      throw new Error('Test: Datenträger voll');
    },
  });
  const snapshot = await manager.start(config({ format: 'pdf', combinePdf: true }), browser);
  const job = manager.jobs.get(snapshot.id);
  await job.done;
  assert.equal(job.status, 'failed');
  assert.equal(job.records[0].outcome, 'success');
  assert(job.metadataWritten);
  assert.equal(manager.snapshot(job).combinedPdf, null);
  assert.match(job.combinedPdfError, /Datenträger voll/);
  const manifest = JSON.parse(await readFile(path.join(job.outputDir, 'manifest.json'), 'utf8'));
  assert.match(manifest.combinedPdfError, /Datenträger voll/);
  assert.equal((await readdir(path.join(job.outputDir, 'pdf-zwischenstand'))).length, 1);
  assert.equal((await readdir(path.join(job.outputDir, 'screenshots'))).length, 0);
  assert.match(
    await readFile(path.join(job.outputDir, 'mets.xml'), 'utf8'),
    /LOCREF="pdf-zwischenstand\//,
  );
  assert.match(manager.snapshot(job).records[0].filePath, /^pdf-zwischenstand\//);
});

test('Browserabsturz beendet den Auftrag und erhält offene URLs sowie PREMIS-Fehler', async () => {
  const instance = Object.assign(new EventEmitter(), fakeBrowser());
  instance.newPage = () => {
    queueMicrotask(() => instance.emit('disconnected'));
    return new Promise(() => {});
  };
  const manager = new JobManager({ launch: async () => instance });
  const snapshot = await manager.start(
    config({ urls: ['https://example.org/a', 'https://example.org/b'] }),
    browser,
  );
  const job = manager.jobs.get(snapshot.id);
  await job.done;
  assert.equal(job.status, 'failed');
  assert.equal(job.records.length, 1);
  assert.equal(job.records[0].outcome, 'failure');
  assert.match(job.error, /unerwartet beendet/);
  const manifest = JSON.parse(await readFile(path.join(job.outputDir, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.remainingUrls, ['https://example.org/b']);
  assert.deepEqual(manifest.metadataStandards, { mets: '2.0', premis: '3.0', dublinCore: '1.1' });
  const mets = await readFile(path.join(job.outputDir, 'mets.xml'), 'utf8');
  assert(mets.includes(job.records[0].eventId));
  assert(mets.includes('failedCapture'));
});

test('Browserabsturz unterbricht auch eine lange Wartepause', async () => {
  const instance = Object.assign(new EventEmitter(), fakeBrowser());
  const manager = new JobManager({ launch: async () => instance });
  manager.on('change', (snapshot) => {
    if (snapshot.status === 'waiting') instance.emit('disconnected');
  });
  const snapshot = await manager.start(
    config({ urls: ['https://example.org/a', 'https://example.org/b'], delay: 86400 }),
    browser,
  );
  const job = manager.jobs.get(snapshot.id);
  await job.done;
  assert.equal(job.status, 'failed');
  assert.equal(job.records.length, 1);
  assert.equal(job.records[0].outcome, 'success');
  assert(job.metadataWritten);
});

test('HTTP-API: Sitzungsschutz, Origin-Prüfung, Eingabeprüfung, erlaubte Downloads', async () => {
  const app = await createApp({ port: 0 });
  app.manager.launch = async () => fakeBrowser();
  try {
    const url = `http://127.0.0.1:${app.port}`;
    assert.equal((await fetch(`${url}/api/jobs`)).status, 403);
    assert.equal(
      (await fetch(`${url}/api/bootstrap`, { headers: { Origin: 'https://evil.test' } })).status,
      403,
    );
    assert.equal(
      (
        await fetch(`${url}/api/jobs`, {
          method: 'POST',
          headers: { 'X-Screenshotter-Token': app.token, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(`${url}/api/jobs`, { headers: { 'X-Screenshotter-Token': app.token } })).status,
      200,
    );
    const snapshot = await app.manager.start(config(), browser);
    await app.manager.jobs.get(snapshot.id).done;
    assert.equal(
      (await fetch(`${url}/api/jobs/${snapshot.id}/files/mets.xml?token=${app.token}`)).status,
      200,
    );
    assert.equal(
      (await fetch(`${url}/api/jobs/${snapshot.id}/files/settings.json?token=${app.token}`)).status,
      404,
    );
    await assert.rejects(() => app.manager.start(config({ urls: [url] }), browser), /Oberfläche/);
  } finally {
    await app.close();
  }
});
