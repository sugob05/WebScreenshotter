import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import UPNGPackage from '@pdf-lib/upng';
import { PDFDocument } from 'pdf-lib';
import { JobManager, retryDelaySeconds } from '../src/jobs.js';
import { validateConfig } from '../src/validation.js';

const UPNG = UPNGPackage.default || UPNGPackage;
const png = Buffer.from(UPNG.encode([new Uint8Array([20, 90, 40, 255]).buffer], 1, 1, 0));
const outputRoot = path.resolve('.test-output', 'retries-' + Date.now());
const selectedBrowser = {
  id: 'chrome',
  name: 'Retry-Testbrowser',
  executablePath: '/mock/browser',
  available: true,
};
const configuration = (patch = {}) =>
  validateConfig({
    username: 'Archiv',
    collection: 'Wiederholungen',
    outputDir: outputRoot,
    urls: ['https://example.org/a'],
    browser: 'chrome',
    prefix: 'web_',
    delay: 0,
    settleTime: 0,
    fullPage: false,
    lazyLoad: false,
    ...patch,
  });

/** Each new page consumes one planned attempt. HTTP responses and rendering
 * failures are independent, just as a screenshot can fail after HTTP 200. */
function plannedBrowser(plans) {
  const instance = new EventEmitter();
  const requests = [];
  let screenshots = 0;
  let connected = true;
  instance.version = async () => 'Retry fixture 1';
  instance.isConnected = () => connected;
  instance.close = async () => {
    connected = false;
  };
  instance.newPage = async () => {
    const plan = plans[requests.length] || { status: 200 };
    const listeners = new Map();
    const frame = {};
    let currentUrl = 'about:blank';
    let closed = false;
    const respond = (status) =>
      listeners.get('response')?.({
        request: () => ({ isNavigationRequest: () => true }),
        frame: () => frame,
        status: () => status,
        statusText: () => 'Fixture status',
        url: () => currentUrl,
        headers: () => ({ server: 'Retry fixture' }),
      });
    return {
      setDefaultTimeout() {},
      setDefaultNavigationTimeout() {},
      on: (name, listener) => listeners.set(name, listener),
      off: (name, listener) => {
        if (listeners.get(name) === listener) listeners.delete(name);
      },
      mainFrame: () => frame,
      goto: async (url) => {
        currentUrl = url;
        requests.push({ url, time: Date.now() });
        if (plan.status !== null) respond(plan.status ?? 200);
        if (plan.disconnect) {
          connected = false;
          instance.emit('disconnected');
          throw new Error('Browser disconnected');
        }
        if (plan.error) throw new Error(plan.error);
      },
      evaluate: async () => 'Retry fixture user agent',
      title: async () => 'Versuchsseite',
      url: () => currentUrl,
      screenshot: async () => {
        screenshots++;
        if (plan.screenshotError) throw new Error(plan.screenshotError);
        await plan.beforeScreenshot?.();
        if (plan.screenshotStatus !== undefined) respond(plan.screenshotStatus);
        return png;
      },
      isClosed: () => closed,
      close: async () => {
        closed = true;
      },
    };
  };
  return {
    instance,
    requests,
    get screenshots() {
      return screenshots;
    },
  };
}

async function run(plans, patch = {}) {
  const fixture = plannedBrowser(plans);
  const manager = new JobManager({ launch: async () => fixture.instance });
  const started = await manager.start(configuration(patch), selectedBrowser);
  const job = manager.jobs.get(started.id);
  await job.done;
  const manifest = JSON.parse(await readFile(path.join(job.outputDir, 'manifest.json'), 'utf8'));
  const logs = (await readFile(path.join(job.outputDir, 'protokoll.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const mets = await readFile(path.join(job.outputDir, 'mets.xml'), 'utf8');
  return { fixture, manager, job, manifest, logs, mets };
}

test('HTTP-Fehler werden wiederholt; jede URL behält genau eine Nummer und Datei', async () => {
  const { fixture, manager, job, manifest, logs, mets } = await run(
    [{ status: 503 }, { status: 429 }, { status: 200 }, { status: 200 }],
    {
      retries: 2,
      retryDelay: 0.04,
      startNumber: 7,
      urls: ['https://example.org/a', 'https://example.org/b'],
    },
  );
  assert.equal(job.status, 'completed');
  assert.equal(job.records.length, 2);
  assert.deepEqual(
    fixture.requests.map((request) => request.url),
    [
      'https://example.org/a',
      'https://example.org/a',
      'https://example.org/a',
      'https://example.org/b',
    ],
  );
  assert.equal(
    fixture.screenshots,
    2,
    'Zwischengeschaltete Fehlerseiten erzeugen keine Bilddateien',
  );
  assert.deepEqual(await readdir(path.join(job.outputDir, 'screenshots')), [
    'web_0007.png',
    'web_0008.png',
  ]);
  assert.deepEqual(
    job.records[0].attempts.map((attempt) => attempt.httpStatus),
    [503, 429, 200],
  );
  assert.equal(job.records[0].outcome, 'success');
  assert.equal(job.records[0].attemptCount, 3);
  assert.equal(manager.snapshot(job).processed, 2);
  assert.equal(manager.snapshot(job).succeeded, 2);
  assert.equal(manager.snapshot(job).failed, 0);
  assert.equal(manifest.remainingUrls.length, 0);
  assert.deepEqual(
    logs.filter((entry) => entry.type === 'capture-attempt').map((entry) => entry.httpStatus),
    [503, 429, 200, 200],
  );
  assert(
    logs
      .filter((entry) => entry.type === 'retry-scheduled')
      .every((entry) => entry.delaySeconds === 0.04),
  );
  for (const attempt of job.records[0].attempts) assert(mets.includes(attempt.eventId));
  assert.equal(new Set(job.records[0].attempts.map((attempt) => attempt.eventId)).size, 3);
  assert.equal((mets.match(/<premis:eventType>capture<\/premis:eventType>/g) || []).length, 4);
  assert(mets.includes('EVENT_0_ATTEMPT_1 EVENT_0_ATTEMPT_2 EVENT_0'));
  assert(fixture.requests[1].time - fixture.requests[0].time >= 35);
  assert.deepEqual(
    job.records[0].attempts.map((attempt) => attempt.delayBeforeSeconds),
    [0, 0.04, 0.04],
  );
});

test('0 Retries bleibt Standard; ein Netzwerkfehler erfindet keinen HTTP-Status', async () => {
  assert.equal(configuration().retries, 0);
  const { fixture, job, logs, manifest } = await run([
    { status: null, error: 'DNS-Auflösung fehlgeschlagen' },
  ]);
  assert.equal(fixture.requests.length, 1);
  assert.equal(job.records[0].attemptCount, 1);
  assert.equal(job.records[0].httpStatus, null);
  assert.equal(manifest.records[0].attempts[0].httpStatus, null);
  const entry = logs.find((item) => item.type === 'capture-attempt');
  assert.equal(entry.httpStatus, null);
  assert.match(entry.message, /kein HTTP-Status/);
  assert.match(entry.error, /DNS/);
});

test('Ausgeschöpfte Netzwerk-Retries bleiben protokolliert und die nächste URL folgt', async () => {
  const { fixture, job, logs } = await run(
    [
      ...Array.from({ length: 3 }, () => ({ status: null, error: 'Verbindung unterbrochen' })),
      { status: 200 },
    ],
    { retries: 2, retryDelay: 0, urls: ['https://example.org/a', 'https://example.org/b'] },
  );
  assert.equal(fixture.requests.length, 4);
  assert.equal(job.records[0].outcome, 'failure');
  assert.equal(job.records[0].attemptCount, 3);
  assert.equal(job.records[0].filename, undefined);
  assert.equal(job.records[1].filename, 'web_0002.png');
  assert.equal(
    logs.filter((entry) => entry.type === 'capture-attempt' && entry.outcome === 'failure').length,
    3,
  );
});

test('Letzte HTTP-Fehlerseite bleibt nach ausgeschöpften Retries als Warnung erhalten', async () => {
  const { fixture, job, logs } = await run([{ status: 404 }, { status: 404 }, { status: 404 }], {
    retries: 2,
    retryDelay: 0,
  });
  assert.equal(fixture.requests.length, 3);
  assert.equal(fixture.screenshots, 1);
  assert.equal(job.records[0].httpStatus, 404);
  assert.equal(job.records[0].outcome, 'warning');
  assert.equal(job.records[0].filename, 'web_0001.png');
  assert.deepEqual(
    logs.filter((entry) => entry.type === 'capture-attempt').map((entry) => entry.httpStatus),
    [404, 404, 404],
  );
  const withoutRetries = await run([{ status: 404 }]);
  assert.equal(withoutRetries.fixture.requests.length, 1);
  assert.equal(withoutRetries.job.records[0].outcome, 'warning');
});

test('Aufnahmefehler nach HTTP 200 wird wiederholt und behält seinen tatsächlichen Status', async () => {
  const { job, logs } = await run(
    [{ status: 200, screenshotError: 'Screenshot-Zeitlimit' }, { status: 200 }],
    { retries: 1, retryDelay: 0 },
  );
  assert.deepEqual(
    job.records[0].attempts.map((attempt) => attempt.outcome),
    ['failure', 'success'],
  );
  const first = logs.find((entry) => entry.type === 'capture-attempt');
  assert.equal(first.httpStatus, 200);
  assert.match(first.error, /Screenshot/);
  assert.equal((await readdir(path.join(job.outputDir, 'screenshots'))).length, 1);
});

test('Eine späte Navigation zur HTTP-Fehlerseite hinterlässt keine Datei vor dem Retry', async () => {
  const { job, logs } = await run([{ status: 200, screenshotStatus: 503 }, { status: 200 }], {
    retries: 1,
    retryDelay: 0,
  });
  assert.equal(job.records[0].outcome, 'success');
  assert.equal(job.records[0].attempts[0].filename, undefined);
  assert.deepEqual(
    logs.filter((entry) => entry.type === 'capture-attempt').map((entry) => entry.httpStatus),
    [503, 200],
  );
  assert.deepEqual(await readdir(path.join(job.outputDir, 'screenshots')), ['web_0001.png']);
});

test('Retry-Pausen sind zufällig im gewählten Bereich und von Seitenpausen unabhängig', async () => {
  assert.equal(
    retryDelaySeconds({ retryDelayMode: 'fixed', retryDelay: 7 }, () => 0),
    7,
  );
  assert.equal(
    retryDelaySeconds({ retryDelayMode: 'random', retryDelayMin: 2, retryDelayMax: 8 }, () => 0),
    2,
  );
  assert.equal(
    retryDelaySeconds({ retryDelayMode: 'random', retryDelayMin: 2, retryDelayMax: 8 }, () => 0.5),
    5,
  );
  assert.equal(
    retryDelaySeconds({ retryDelayMode: 'random', retryDelayMin: 2, retryDelayMax: 8 }, () => 1),
    8,
  );
  const { job, logs } = await run([{ status: 503 }, { status: 200 }], {
    retries: 1,
    retryDelayMode: 'random',
    retryDelayMin: 0.01,
    retryDelayMax: 0.02,
  });
  const pause = logs.find((entry) => entry.type === 'retry-scheduled').delaySeconds;
  assert(pause >= 0.01 && pause <= 0.02);
  assert.equal(job.records[0].attempts[1].delayBeforeSeconds, pause);
  assert.equal(job.records[0].attempts[1].delayKind, 'retry');
});

test('Abbruch während einer Retry-Pause erhält bereits gesicherte Fehlversuche', async () => {
  const fixture = plannedBrowser([{ status: 503 }]);
  const manager = new JobManager({ launch: async () => fixture.instance });
  let retryPersisted;
  const persisted = new Promise((resolve) => {
    retryPersisted = resolve;
  });
  const persist = manager.persist.bind(manager);
  manager.persist = async (job) => {
    await persist(job);
    if (job.waitReason === 'retry') retryPersisted(job);
  };
  const started = await manager.start(
    configuration({ retries: 2, retryDelay: 30 }),
    selectedBrowser,
  );
  const job = manager.jobs.get(started.id);
  await persisted;
  const checkpoint = JSON.parse(await readFile(path.join(job.outputDir, 'manifest.json'), 'utf8'));
  assert.equal(checkpoint.records[0].attempts[0].httpStatus, 503);
  assert.equal(checkpoint.records[0].pending, true);
  assert.deepEqual(checkpoint.remainingUrls, ['https://example.org/a']);
  const checkpointXml = await readFile(path.join(job.outputDir, 'mets.xml'), 'utf8');
  assert(checkpointXml.includes(job.currentRecord.eventId));
  assert.equal(manager.snapshot(job).processed, 0);
  const stoppedAt = Date.now();
  manager.stop(job.id);
  await job.done;
  assert(Date.now() - stoppedAt < 3000);
  assert.equal(job.status, 'cancelled');
  assert.equal(fixture.requests.length, 1);
  assert.equal(job.records[0].attemptCount, 1);
  assert.equal(job.records[0].retryInterrupted, true);
  assert.equal(job.records[0].attempts[0].outcome, 'failure');
  assert.equal(job.currentRecord, null);
  assert.equal(job.nextAt, null);
});

test('Browserabsturz beendet auch bei aktivierten Retries den Auftrag nachvollziehbar', async () => {
  const { fixture, job } = await run([{ status: 200, disconnect: true }], {
    retries: 2,
    retryDelay: 0,
  });
  assert.equal(job.status, 'failed');
  assert.equal(fixture.requests.length, 1);
  assert.equal(job.records[0].attemptCount, 1);
  assert.match(job.error, /unerwartet beendet/);
});

test('Gesamt-PDF nimmt nach Retry nur das erhaltene Ergebnis auf', async () => {
  const { job, mets } = await run([{ status: 503 }, { status: 200 }], {
    retries: 1,
    retryDelay: 0,
    format: 'pdf',
    combinePdf: true,
  });
  assert.equal(job.combinedPdf.sourceCount, 1);
  assert.equal(job.records.length, 1);
  assert.equal(job.records[0].attemptCount, 2);
  assert.equal(
    (await PDFDocument.load(await readFile(path.join(job.outputDir, 'gesamt.pdf')))).getPageCount(),
    1,
  );
  assert.deepEqual(await readdir(path.join(job.outputDir, 'screenshots')), []);
  assert(!(await readdir(job.outputDir)).includes('pdf-zwischenstand'));
  assert.equal(
    (await readFile(path.join(job.outputDir, 'checksums.sha256'), 'utf8')).trim().split('\n')
      .length,
    1,
  );
  assert(mets.includes('EVENT_0_ATTEMPT_1'));
  assert(mets.includes('combinedPdfPages'));
});

test('Eine vorhandene Datei wird auch bei Schreibfehler-Retries nicht gelöscht', async () => {
  let manager;
  const fixture = plannedBrowser([
    {
      status: 200,
      beforeScreenshot: async () => {
        await writeFile(
          path.join(manager.active.outputDir, 'screenshots', 'web_0001.png'),
          'Vorhandene Datei',
        );
      },
    },
    { status: 200 },
  ]);
  manager = new JobManager({ launch: async () => fixture.instance });
  const started = await manager.start(
    configuration({ retries: 1, retryDelay: 0 }),
    selectedBrowser,
  );
  const job = manager.jobs.get(started.id);
  await job.done;
  assert.equal(job.records[0].outcome, 'failure');
  assert.equal(job.records[0].attemptCount, 2);
  assert.equal(
    await readFile(path.join(job.outputDir, 'screenshots', 'web_0001.png'), 'utf8'),
    'Vorhandene Datei',
  );
});
