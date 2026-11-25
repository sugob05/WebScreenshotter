/**
 * Builds the optional reading copy from the already saved individual PDFs.
 * Page copying keeps image bytes and page order intact; websites are not loaded again.
 * The returned provenance is shared by the manifest, PREMIS and download interface.
 */
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { PDFDocument } from 'pdf-lib';
import { atomicWrite, APPLICATION_NAME, VERSION } from './config.js';
import { sourceFilePath } from './artifacts.js';

export const COMBINED_PDF_FILENAME = 'gesamt.pdf';
// pdf-lib keeps the destination in memory. Bound input size and page count so a
// large collection fails with a useful message instead of exhausting the process.
export const MAX_COMBINED_PDF_BYTES = 256 * 1024 * 1024;
export const MAX_COMBINED_PDF_PAGES = 5000;

export async function createCombinedPdf(job, { onProgress = () => {}, signal } = {}) {
  const savedRecords = job.records.filter((record) => record.filename);
  if (!savedRecords.length) return null;

  let totalBytes = 0;
  for (const record of savedRecords) {
    signal?.throwIfAborted();
    const sourcePath = path.join(job.outputDir, sourceFilePath(record));
    totalBytes += (await stat(sourcePath)).size;
    if (totalBytes > MAX_COMBINED_PDF_BYTES) {
      throw new Error(
        'Die Einzel-PDFs überschreiten zusammen 256 MiB. Bitte kleinere Aufträge für die Gesamt-PDF verwenden.',
      );
    }
  }

  const document = await PDFDocument.create();
  const createdAt = new Date().toISOString();
  document.setTitle(`${job.config.collection} – Gesamt-PDF`);
  document.setAuthor(job.config.username);
  document.setCreator(`${APPLICATION_NAME} ${VERSION}`);
  document.setProducer(`${APPLICATION_NAME} / pdf-lib`);
  document.setCreationDate(new Date(createdAt));
  document.setModificationDate(new Date(createdAt));
  const sources = [];

  for (const [index, record] of savedRecords.entries()) {
    // Yield between source documents so progress and cancellation remain usable.
    await yieldToEventLoop();
    signal?.throwIfAborted();
    const sourceBytes = await readFile(path.join(job.outputDir, sourceFilePath(record)));
    const sourceDocument = await PDFDocument.load(sourceBytes);
    const firstPage = document.getPageCount() + 1;
    if (document.getPageCount() + sourceDocument.getPageCount() > MAX_COMBINED_PDF_PAGES) {
      throw new Error(
        'Die Gesamt-PDF würde mehr als 5.000 Seiten enthalten. Bitte kleinere Aufträge verwenden.',
      );
    }
    const copiedPages = await document.copyPages(sourceDocument, sourceDocument.getPageIndices());
    copiedPages.forEach((page) => document.addPage(page));
    sources.push({
      sequence: record.sequence,
      objectId: record.objectId,
      filename: record.filename,
      firstPage,
      lastPage: document.getPageCount(),
    });
    onProgress(index + 1, savedRecords.length);
  }

  signal?.throwIfAborted();
  const bytes = Buffer.from(await document.save());
  signal?.throwIfAborted();
  // Publish only a complete document. Failed or cancelled merges leave no link
  // claiming a partial PDF is complete, and never alter the individual files.
  await atomicWrite(path.join(job.outputDir, COMBINED_PDF_FILENAME), bytes);
  return {
    filename: COMBINED_PDF_FILENAME,
    createdAt,
    objectId: randomUUID(),
    eventId: randomUUID(),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: document.getPageCount(),
    sourceCount: sources.length,
    sources,
  };
}
