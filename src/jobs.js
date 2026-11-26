/** Coordinates one sequential capture job at a time. Records are authoritative;
 * snapshots are bounded UI projections. Persist after every attempt so failures
 * or process restarts leave a usable manifest and preservation metadata.
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { mkdir, open, appendFile, unlink, rmdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { atomicWrite, APPLICATION_NAME, VERSION } from './config.js';
import { launchBrowser, closeBrowser } from './browsers.js';
import { within } from './async.js';
import { resolveSitemap } from './sitemap.js';
import { filenameFor, InputError } from './validation.js';
import { encodeScreenshot, MAX_PIXELS } from './formats.js';
import { buildMets } from './metadata.js';
import { buildExcel, EXCEL_FILENAME } from './excel.js';
import { createCombinedPdf } from './combined-pdf.js';
import { PDF_PARTS_DIRECTORY, sourceFilePath, outputArtifact } from './artifacts.js';

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed']);
const currentTimestamp = () => new Date().toISOString();
const PRESERVED_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'content-language',
  'content-encoding',
  'date',
  'server',
  'last-modified',
  'etag',
  'cache-control',
  'location',
]);

export function delaySeconds(config, random = Math.random) {
  return config.delayMode === 'random'
    ? config.delayMin + random() * (config.delayMax - config.delayMin)
    : config.delay;
}

/** Retry pauses are independent of the ordinary pause between different URLs. */
export function retryDelaySeconds(config, random = Math.random) {
  return config.retryDelayMode === 'random'
    ? config.retryDelayMin + random() * (config.retryDelayMax - config.retryDelayMin)
    : (config.retryDelay ?? 5);
}

/** Only remove files this attempt created. A failed write must not leave a
 * partial file that blocks the next attempt, nor overwrite an existing file. */
async function writeCaptureFile(filename, data) {
  const handle = await open(filename, 'wx');
  try {
    await handle.writeFile(data);
    await handle.close();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(filename).catch(() => {});
    throw error;
  }
}

export class JobManager extends EventEmitter {
  constructor({
    checkUrl = () => {},
    launch = launchBrowser,
    combinePdf = createCombinedPdf,
  } = {}) {
    super();
    this.jobs = new Map();
    this.active = null;
    this.starting = false;
    this.checkUrl = checkUrl;
    this.launch = launch;
    this.combinePdf = combinePdf;
  }

  /** Keep event-stream messages bounded; exports always use full job.records. */
  snapshot(job) {
    const records = job.currentRecord ? [...job.records, job.currentRecord] : job.records;
    return {
      id: job.id,
      status: job.status,
      collection: job.config.collection,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      total: job.urls.length,
      processed: job.records.length,
      succeeded: job.records.filter((record) => record.filename).length,
      failed: job.records.filter((record) => !record.filename && record.outcome !== 'cancelled')
        .length,
      warnings: job.records.filter((record) => record.outcome === 'warning').length,
      cancelledCount: job.records.filter((record) => record.outcome === 'cancelled').length,
      currentUrl: job.currentUrl,
      nextAt: job.nextAt,
      waitReason: job.waitReason || null,
      currentAttempt: job.currentAttempt || null,
      maxAttempts: (job.config.retries || 0) + 1,
      outputDir: job.outputDir,
      browserInfo: job.browserInfo,
      error: job.error,
      metadataWritten: job.metadataWritten,
      excelWritten: Boolean(job.excelWritten),
      combinedPdf: job.combinedPdf
        ? {
            filename: job.combinedPdf.filename,
            pageCount: job.combinedPdf.pageCount,
            sourceCount: job.combinedPdf.sourceCount,
          }
        : null,
      combinedPdfError: job.combinedPdfError || null,
      cleanupWarning: job.cleanupWarning || null,
      logError: job.logError,
      logs: job.logs.slice(-200),
      records: records
        .slice(-500)
        .map(
          ({
            sequence,
            requestedUrl,
            finalUrl,
            title,
            filename,
            httpStatus,
            outcome,
            error,
            warnings,
            temporaryPdf,
            pdfPages,
            attemptCount,
            pending,
            retryInterrupted,
          }) => ({
            sequence,
            requestedUrl,
            finalUrl,
            title,
            filename,
            httpStatus,
            outcome,
            error,
            warnings,
            temporaryPdf,
            pdfPages,
            attemptCount,
            pending,
            retryInterrupted,
            filePath: outputArtifact(job, { filename, temporaryPdf })?.relativePath || null,
          }),
        ),
    };
  }

  notify(job) {
    this.emit('change', this.snapshot(job));
  }

  log(job, message, level = 'info', details = {}) {
    const entry = { time: currentTimestamp(), level, message, ...details };
    job.logs.push(entry);
    if (job.logs.length > 1000) job.logs.shift();
    job.logPromise = job.logPromise
      .then(() =>
        appendFile(
          path.join(job.outputDir, 'protokoll.jsonl'),
          `${JSON.stringify(entry)}\n`,
          'utf8',
        ),
      )
      .catch((error) => {
        job.logError = `Das Protokoll konnte nicht geschrieben werden: ${error.message}`;
      });
    this.notify(job);
  }

  /** Reserve an isolated output directory before making this job visible. */
  async start(config, browser) {
    if (this.active || this.starting) throw new InputError('Es läuft bereits ein Auftrag.', 409);
    this.starting = true;
    try {
      config.urls?.forEach(this.checkUrl);
      if (config.sitemapUrl) this.checkUrl(config.sitemapUrl);
      const id = randomUUID();
      const startedAt = currentTimestamp();
      const slug =
        config.collection
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-zA-Z0-9_-]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 50) || 'bestand';
      const outputDir = path.join(
        config.outputDir,
        `${slug}_${startedAt.replace(/[:.]/g, '-')}_${id.slice(0, 8)}`,
      );
      await mkdir(config.outputDir, { recursive: true });
      await mkdir(outputDir);
      await mkdir(path.join(outputDir, 'screenshots'));
      if (config.format === 'pdf' && config.combinePdf) {
        await mkdir(path.join(outputDir, PDF_PARTS_DIRECTORY));
      }
      const job = {
        id,
        config,
        selectedBrowser: browser,
        startedAt,
        outputDir,
        status: 'preparing',
        urls: config.urls || [],
        sources: [],
        records: [],
        logs: [],
        logPromise: Promise.resolve(),
        controller: new AbortController(),
        metadataWritten: false,
      };
      this.jobs.set(id, job);
      this.active = job;
      while (this.jobs.size > 20) this.jobs.delete(this.jobs.keys().next().value);
      job.done = this.run(job);
      return this.snapshot(job);
    } finally {
      this.starting = false;
    }
  }

  /** Each artifact is atomically replaced; no half-written XML/JSON is published. */
  async persist(job) {
    // Failed attempts must already be recoverable while a retry is waiting.
    // The active URL remains in remainingUrls until its retry sequence ends.
    const records = job.currentRecord ? [...job.records, job.currentRecord] : job.records;
    const manifest = {
      application: { name: APPLICATION_NAME, version: VERSION },
      metadataStandards: { mets: '2.0', premis: '3.0', dublinCore: '1.1' },
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt || null,
      error: job.error || null,
      config: job.config,
      browser: job.browserInfo || null,
      sitemapSources: job.sources,
      urls: job.urls,
      records,
      remainingUrls: job.urls.slice(job.records.length),
      currentUrl: job.currentUrl || null,
      currentAttempt: job.currentAttempt || null,
      nextAt: job.nextAt || null,
      waitReason: job.waitReason || null,
      combinedPdf: job.combinedPdf || null,
      combinedPdfError: job.combinedPdfError || null,
      cleanupWarning: job.cleanupWarning || null,
    };
    await atomicWrite(path.join(job.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await atomicWrite(path.join(job.outputDir, 'mets.xml'), buildMets({ ...job, records }));
    const checksums = job.records
      .filter((record) => record.filename && !(record.temporaryPdf && job.combinedPdf))
      .map((record) => `${record.sha256}  ${sourceFilePath(record)}`);
    if (job.combinedPdf) checksums.push(`${job.combinedPdf.sha256}  ${job.combinedPdf.filename}`);
    await atomicWrite(path.join(job.outputDir, 'checksums.sha256'), checksums.join('\n') + '\n');
    job.metadataWritten = true;
  }

  async exportExcel(id) {
    const job = this.jobs.get(id);
    if (!job) throw new InputError('Auftrag nicht gefunden.', 404);
    if (!TERMINAL_STATUSES.has(job.status))
      throw new InputError('Bitte den Abschluss oder Abbruch des Auftrags abwarten.', 409);
    // Use the full records, not the 500-row preview sent to the interface.
    await atomicWrite(path.join(job.outputDir, EXCEL_FILENAME), buildExcel(job));
    job.excelWritten = true;
    return { filename: EXCEL_FILENAME };
  }

  stop(id) {
    const job = this.jobs.get(id);
    if (!job) throw new InputError('Auftrag nicht gefunden.', 404);
    if (TERMINAL_STATUSES.has(job.status)) return this.snapshot(job);
    // A second stop during finalization cancels only the optional combined PDF.
    job.pdfController?.abort(new Error('Erstellung der Gesamt-PDF abgebrochen.'));
    if (!job.controller.signal.aborted) {
      job.status = 'stopping';
      job.controller.abort(new Error('Vom Benutzer abgebrochen.'));
      this.log(
        job,
        'Abbruch angefordert. Bereits gespeicherte Aufnahmen und Metadaten bleiben erhalten.',
        'warning',
      );
      if (job.instance) job.closePromise = closeBrowser(job.instance).catch(() => {});
    }
    return this.snapshot(job);
  }

  /** Lifecycle: prepare → capture/wait → finalize → terminal status. Browser
   * failures and user cancellation share cleanup, but keep distinct outcomes. */
  async run(job) {
    const signal = job.controller.signal;
    try {
      this.log(job, 'Auftrag angelegt. Ausgabeverzeichnis ist bereit.');
      await this.persist(job);
      if (job.config.inputMode === 'sitemap') {
        const resolved = await resolveSitemap(job.config.sitemapUrl, {
          signal,
          checkUrl: this.checkUrl,
          onProgress: (message) => this.log(job, message),
        });
        job.urls = resolved.urls;
        job.sources = resolved.sources;
        this.log(
          job,
          `${job.urls.length} eindeutige URLs aus ${job.sources.length} Sitemap-Dateien übernommen.`,
        );
        await this.persist(job);
      }
      signal.throwIfAborted();
      this.log(job, `${job.selectedBrowser.name} wird im Headless-Modus gestartet …`);
      const launching = this.launch(job.selectedBrowser);
      launching.then(
        (browser) => {
          if (signal.aborted || job.finishedAt) closeBrowser(browser).catch(() => {});
        },
        () => {},
      );
      job.instance = await within(
        launching,
        35000,
        'Der Browserstart hat das Zeitlimit überschritten.',
        signal,
      );
      signal.throwIfAborted();
      job.browserController = new AbortController();
      const disconnected = () => {
        job.browserError =
          'Der Aufnahme-Browser wurde unerwartet beendet. Bitte den Browsertest ausführen und lokale Ausführungsrechte prüfen. Noch nicht bearbeitete URLs stehen im Manifest.';
        job.browserController.abort(new Error(job.browserError));
      };
      job.instance.on?.('disconnected', disconnected);
      job.releaseBrowserWatch = () => job.instance?.off?.('disconnected', disconnected);
      if (job.instance.isConnected?.() === false) disconnected();
      const captureSignal = AbortSignal.any([signal, job.browserController.signal]);
      job.browserInfo = {
        id: job.selectedBrowser.id,
        name: job.selectedBrowser.name,
        version: await job.instance.version(),
        executablePath: job.selectedBrowser.executablePath,
        headless: true,
        platform: os.platform(),
        arch: os.arch(),
        automation: 'Playwright 1.65.1',
        protocol:
          job.selectedBrowser.id === 'firefox'
            ? job.selectedBrowser.protocol || 'WebDriver BiDi'
            : 'CDP',
      };
      for (let index = 0; index < job.urls.length; index++) {
        captureSignal.throwIfAborted();
        job.currentAttempt = null;
        job.waitReason = 'page';
        const pause = index === 0 ? 0 : delaySeconds(job.config);
        if (pause > 0) {
          job.status = 'waiting';
          job.nextAt = new Date(Date.now() + pause * 1000).toISOString();
          this.log(job, `Pause: ${pause.toFixed(2)} Sekunden bis zum nächsten Aufruf.`);
          await sleep(pause * 1000, undefined, { signal: captureSignal });
        }
        job.nextAt = null;
        job.waitReason = null;
        job.status = 'running';
        job.currentUrl = job.urls[index];
        this.log(job, `[${index + 1}/${job.urls.length}] ${job.currentUrl}`);
        const record = await this.captureWithRetries(job, index, pause, captureSignal);
        job.records.push(record);
        job.currentRecord = null;
        await this.persist(job);
        this.notify(job);
        if (job.browserError) throw new Error(job.browserError);
      }
      captureSignal.throwIfAborted();
      job.status = 'finalizing';
      job.resultStatus = 'completed';
      this.log(job, 'Alle URLs verarbeitet. Abschlussdokumentation wird gespeichert.');
    } catch (error) {
      job.status = 'finalizing';
      job.resultStatus = signal.aborted ? 'cancelled' : 'failed';
      if (!signal.aborted) job.error = error.message;
      this.log(
        job,
        signal.aborted ? 'Auftrag abgebrochen.' : `Auftrag fehlgeschlagen: ${error.message}`,
        signal.aborted ? 'warning' : 'error',
      );
    } finally {
      // Cancellation or browser failure during a retry pause does not invent
      // another capture event. Keep the last actual attempt and its history.
      if (job.currentRecord) {
        job.records.push({ ...job.currentRecord, pending: false, retryInterrupted: true });
        job.currentRecord = null;
      }
      job.releaseBrowserWatch?.();
      if (job.instance) {
        try {
          await (job.closePromise || closeBrowser(job.instance));
        } catch (error) {
          this.log(
            job,
            `Browser konnte nicht regulär geschlossen werden: ${error.message}`,
            'warning',
          );
        }
      }
      job.instance = null;
      job.currentUrl = null;
      job.nextAt = null;
      job.waitReason = null;
      job.currentAttempt = null;
      if (job.config.format === 'pdf' && job.config.combinePdf) {
        job.status = 'finalizing';
        job.pdfController = new AbortController();
        this.log(job, 'Gesamt-PDF wird aus den gesicherten PDF-Zwischenständen erstellt.');
        try {
          job.combinedPdf = await this.combinePdf(job, {
            signal: job.pdfController.signal,
            onProgress: (completed, total) => {
              if (completed === total || completed % 10 === 0)
                this.log(job, `Gesamt-PDF: ${completed} von ${total} Aufnahmen übernommen.`);
            },
          });
          if (job.combinedPdf) {
            for (const source of job.combinedPdf.sources) {
              const record = job.records.find((item) => item.objectId === source.objectId);
              record.pdfPages = { first: source.firstPage, last: source.lastPage };
            }
            // Publish metadata referring to the complete combined PDF before removing
            // temporary parts. A crash during cleanup still leaves a consistent archive.
            await this.persist(job);
            try {
              for (const record of job.records.filter((item) => item.temporaryPdf)) {
                await unlink(path.join(job.outputDir, sourceFilePath(record)));
              }
              await rmdir(path.join(job.outputDir, PDF_PARTS_DIRECTORY));
            } catch (error) {
              job.cleanupWarning = `Gesamt-PDF gespeichert; PDF-Zwischenstände konnten nicht vollständig entfernt werden: ${error.message}`;
              this.log(job, job.cleanupWarning, 'warning');
            }
          }
          this.log(
            job,
            job.combinedPdf
              ? `${job.combinedPdf.filename} gespeichert (${job.combinedPdf.pageCount} Seiten).`
              : 'Keine Gesamt-PDF erstellt: Es wurde keine Aufnahme gespeichert.',
            job.combinedPdf ? 'success' : 'warning',
          );
        } catch (error) {
          job.combinedPdfError = `Gesamt-PDF konnte nicht erstellt werden: ${error.message}`;
          job.resultStatus = 'failed';
          this.log(job, job.combinedPdfError, 'error');
        } finally {
          job.pdfController = null;
        }
      }
      job.finishedAt = currentTimestamp();
      job.status = signal.aborted ? 'cancelled' : job.resultStatus || 'failed';
      try {
        await this.persist(job);
      } catch (error) {
        job.status = 'failed';
        job.metadataWritten = false;
        job.error = `Abschlussdokumentation konnte nicht vollständig gespeichert werden: ${error.message}`;
        this.log(job, job.error, 'error');
      }
      if (this.active === job) this.active = null;
      this.log(
        job,
        job.metadataWritten
          ? 'METS, Manifest und SHA-256-Prüfsummen gespeichert.'
          : 'Bitte den Ausgabeordner und das Protokoll prüfen.',
        job.metadataWritten ? 'success' : 'error',
      );
      await job.logPromise;
      this.notify(job);
    }
  }

  /** One final record per URL, with a distinct immutable record for every try.
   * Intermediate HTTP error pages are retried before writing any image. The
   * last HTTP response is still captured as a warning, including with retries=0. */
  async captureWithRetries(job, index, initialPause, signal) {
    const attempts = [];
    const maxAttempts = (job.config.retries || 0) + 1;
    let pause = initialPause;
    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
      job.status = 'running';
      job.nextAt = null;
      job.waitReason = null;
      job.currentAttempt = attemptNumber;
      this.notify(job);
      const attempt = await this.capture(job, index, pause, attemptNumber);
      attempts.push(attempt);
      const record = { ...attempt, attempts: [...attempts], attemptCount: attempts.length };
      const retryable = attempt.outcome === 'failure' || attempt.httpStatus >= 400;
      const retryAllowed = retryable && attemptNumber < maxAttempts;
      job.currentRecord = { ...record, pending: retryAllowed && !signal.aborted };
      const status =
        attempt.httpStatus === null
          ? 'kein HTTP-Status (keine Serverantwort)'
          : `HTTP ${attempt.httpStatus}`;
      const outcome = attempt.filename
        ? `${attempt.filename} gespeichert${attempt.warnings.length ? ` · ${attempt.warnings.join(' ')}` : ''}`
        : attempt.error;
      this.log(
        job,
        `Aufnahme ${attempt.sequence}, Versuch ${attemptNumber}/${maxAttempts}: ${status} · ${outcome}`,
        attempt.outcome === 'success'
          ? 'success'
          : attempt.outcome === 'failure'
            ? 'error'
            : 'warning',
        {
          type: 'capture-attempt',
          sequence: attempt.sequence,
          attemptNumber,
          eventId: attempt.eventId,
          requestedUrl: attempt.requestedUrl,
          finalUrl: attempt.finalUrl || null,
          responseUrl: attempt.responseUrl || null,
          httpStatus: attempt.httpStatus,
          httpStatusText: attempt.httpStatusText || null,
          outcome: attempt.outcome,
          error: attempt.error || null,
          startedAt: attempt.startedAt,
          finishedAt: attempt.finishedAt,
        },
      );
      if (!retryAllowed || signal.aborted || job.browserError) return record;

      pause = retryDelaySeconds(job.config);
      job.status = 'waiting';
      job.waitReason = 'retry';
      job.currentAttempt = attemptNumber + 1;
      job.nextAt = new Date(Date.now() + pause * 1000).toISOString();
      this.log(
        job,
        `Wiederholung ${attemptNumber}/${maxAttempts - 1} für ${attempt.requestedUrl} in ${pause.toFixed(2)} Sekunden.`,
        'warning',
        {
          type: 'retry-scheduled',
          sequence: attempt.sequence,
          nextAttempt: attemptNumber + 1,
          delaySeconds: pause,
        },
      );
      await this.persist(job);
      await job.logPromise;
      // Persist and cancellation also work for a configured wait of zero.
      signal.throwIfAborted();
      if (pause > 0) await sleep(pause * 1000, undefined, { signal });
    }
  }

  /** Capture exactly one attempt. File fields are set only after a complete
   * write; a fresh page and response state isolate it from preceding attempts. */
  async capture(job, index, pause, attemptNumber = 1) {
    const { config, instance } = job;
    const hasAnotherAttempt = attemptNumber <= (config.retries || 0);
    const userSignal = job.controller.signal;
    const signal = job.browserController
      ? AbortSignal.any([userSignal, job.browserController.signal])
      : userSignal;
    const record = {
      sequence: config.startNumber + index,
      requestedUrl: job.urls[index],
      startedAt: currentTimestamp(),
      eventId: randomUUID(),
      objectId: randomUUID(),
      attemptNumber,
      httpStatus: null,
      delayBeforeSeconds: pause,
      delayKind: attemptNumber > 1 ? 'retry' : 'page',
      outcome: 'failure',
      warnings: [],
      browser: job.browserInfo,
    };
    let page;
    const operation = (promise) =>
      within(
        promise,
        config.timeout * 1000,
        'Der Browser antwortet nicht innerhalb des eingestellten Zeitlimits. Bitte den Browsertest in den Einstellungen ausführen.',
        signal,
      );
    const recordResponse = (response) => {
      if (record.finishedAt) return;
      if (!response.request().isNavigationRequest() || response.frame() !== page.mainFrame())
        return;
      record.httpStatus = response.status();
      record.httpStatusText = response.statusText();
      record.responseAt = currentTimestamp();
      record.responseUrl = response.url();
      record.responseHeaders = Object.fromEntries(
        Object.entries(response.headers()).filter(([key]) =>
          PRESERVED_RESPONSE_HEADERS.has(key.toLowerCase()),
        ),
      );
      record.redirects ||= [];
      if (response.status() >= 300 && response.status() < 400 && response.status() !== 304)
        record.redirects.push({ url: response.url(), status: response.status() });
    };
    try {
      signal.throwIfAborted();
      const opening = instance.newPage({
        viewport: { width: config.width, height: config.height },
        deviceScaleFactor: 1,
        acceptDownloads: false,
      });
      opening.then(
        (opened) => {
          if (signal.aborted || record.finishedAt)
            within(opened.close(), 3000, 'Seite konnte nicht geschlossen werden.').catch(() => {});
        },
        () => {},
      );
      page = await operation(opening);
      page.setDefaultNavigationTimeout(config.timeout * 1000);
      page.setDefaultTimeout(config.timeout * 1000);
      page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
      page.on('popup', (popup) => popup?.close().catch(() => {}));
      page.on('response', recordResponse);
      record.userAgent = await operation(page.evaluate(() => navigator.userAgent));
      await operation(
        page.goto(record.requestedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: config.timeout * 1000,
        }),
      );
      if (record.httpStatus >= 400 && hasAnotherAttempt)
        throw new Error(`HTTP ${record.httpStatus}: Seitenabruf fehlgeschlagen.`);
      if (config.settleTime) await sleep(config.settleTime * 1000, undefined, { signal });
      // Trigger ordinary lazy-loaded content while bounding infinite scroll pages.
      if (config.lazyLoad && config.fullPage) {
        let finished = false;
        const deadline = Date.now() + 15000;
        for (let step = 0; step < 50 && Date.now() < deadline; step++) {
          signal.throwIfAborted();
          finished = await operation(
            page.evaluate(() => {
              const root = document.scrollingElement || document.documentElement;
              if (root.scrollTop + innerHeight >= root.scrollHeight - 2) return true;
              window.scrollBy(0, Math.max(200, innerHeight * 0.8));
              return false;
            }),
          );
          if (finished) break;
          await sleep(150, undefined, { signal });
        }
        if (!finished)
          record.warnings.push(
            'Automatisches Scrollen erreichte das Zeit-/Schrittlimit; nachgeladene Inhalte können fehlen.',
          );
        await operation(page.evaluate(() => window.scrollTo(0, 0)));
        await sleep(200, undefined, { signal });
      }
      signal.throwIfAborted();
      record.title = await operation(page.title());
      record.finalUrl = page.url();
      const dimensions = config.fullPage
        ? await operation(
            page.evaluate(() => ({
              width: Math.max(
                innerWidth,
                document.documentElement.scrollWidth,
                document.body?.scrollWidth || 0,
              ),
              height: Math.max(
                innerHeight,
                document.documentElement.scrollHeight,
                document.body?.scrollHeight || 0,
              ),
            })),
          )
        : { width: config.width, height: config.height };
      if (dimensions.width * dimensions.height > MAX_PIXELS || dimensions.height > 60000)
        throw new Error(
          'Seite zu groß für eine vollständige Aufnahme (max. 80 Megapixel / 60.000 px Höhe). Bitte Fensterbreite reduzieren oder „Sichtbarer Bereich“ wählen.',
        );
      record.capturedAt = currentTimestamp();
      const image = Buffer.from(
        await operation(
          page.screenshot(
            config.format === 'jpg'
              ? {
                  type: 'jpeg',
                  quality: config.quality,
                  fullPage: config.fullPage,
                  timeout: config.timeout * 1000,
                }
              : { type: 'png', fullPage: config.fullPage, timeout: config.timeout * 1000 },
          ),
        ),
      );
      // Scripts can navigate again while the page settles or the image is taken.
      // Freeze the response metadata with the image before asynchronous encoding
      // and writing; a late HTTP error must not leave a file blocking its retry.
      page.off?.('response', recordResponse);
      if (record.httpStatus >= 400 && hasAnotherAttempt)
        throw new Error(`HTTP ${record.httpStatus}: Seitenabruf fehlgeschlagen.`);
      record.imageWidth = config.format === 'jpg' ? dimensions.width : image.readUInt32BE(16);
      record.imageHeight = config.format === 'jpg' ? dimensions.height : image.readUInt32BE(20);
      const data =
        config.format === 'jpg'
          ? image
          : await encodeScreenshot(image, config.format, {
              title: record.title,
              author: config.username,
              capturedAt: record.capturedAt,
            });
      const filename = filenameFor(config, index);
      const temporaryPdf = config.format === 'pdf' && config.combinePdf;
      const directory = temporaryPdf ? PDF_PARTS_DIRECTORY : 'screenshots';
      await writeCaptureFile(path.join(job.outputDir, directory, filename), data);
      record.filename = filename;
      if (temporaryPdf) record.temporaryPdf = true;
      record.bytes = data.length;
      record.sha256 = createHash('sha256').update(data).digest('hex');
      if (record.httpStatus >= 400)
        record.warnings.push(`HTTP ${record.httpStatus}: Fehlerseite aufgenommen.`);
      if (record.httpStatus === null)
        record.warnings.push('Kein HTTP-Status des Hauptdokuments verfügbar.');
      record.outcome = record.warnings.length ? 'warning' : 'success';
    } catch (error) {
      record.outcome = userSignal.aborted ? 'cancelled' : 'failure';
      record.error = userSignal.aborted ? 'Vom Benutzer abgebrochen.' : error.message;
      if (page && !page.isClosed()) {
        record.finalUrl = page.url();
        record.title ||= await within(page.title(), 2000, 'Titel nicht verfügbar.').catch(() => '');
      }
    } finally {
      page?.off?.('response', recordResponse);
      if (page && !page.isClosed())
        await within(page.close(), 3000, 'Seite konnte nicht geschlossen werden.').catch(() => {});
      record.finishedAt = currentTimestamp();
      record.durationMs = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
    }
    return record;
  }
}
