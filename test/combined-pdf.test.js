import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { createCombinedPdf } from '../src/combined-pdf.js';
import { validateConfig } from '../src/validation.js';
import { APPLICATION_NAME, VERSION } from '../src/config.js';

const outputRoot = path.resolve('.test-output', `combined-pdf-${Date.now()}`);

async function fixture(name) {
  const outputDir = path.join(outputRoot, name);
  await mkdir(path.join(outputDir, 'screenshots'), { recursive: true });
  return { outputDir, config: { collection: 'Zusammenführung', username: 'Archiv' }, records: [] };
}

async function saveSource(job, filename, dimensions, color) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [index, [width, height]] of dimensions.entries()) {
    const page = document.addPage([width, height]);
    page.drawRectangle({ x: 20, y: 20, width: width - 40, height: height - 40, color });
    page.drawText(`${filename} / ${index + 1}`, {
      x: 30,
      y: height - 50,
      size: 14,
      font,
      color: rgb(1, 1, 1),
    });
  }
  const bytes = Buffer.from(await document.save());
  await writeFile(path.join(job.outputDir, 'screenshots', filename), bytes);
  return bytes;
}

test('Gesamt-PDF bewahrt Seitenreihenfolge, Seitenformate, Quelldateien und Herkunft', async () => {
  const job = await fixture('ordered');
  const firstBytes = await saveSource(
    job,
    'web_0040.pdf',
    [
      [220, 320],
      [220, 340],
    ],
    rgb(0.1, 0.4, 0.3),
  );
  await saveSource(job, 'web_0042.pdf', [[320, 220]], rgb(0.15, 0.3, 0.6));
  job.records = [
    { filename: 'web_0040.pdf', sequence: 40, objectId: 'object-40' },
    { sequence: 41, outcome: 'failure' },
    { filename: 'web_0042.pdf', sequence: 42, objectId: 'object-42' },
  ];
  const progress = [];
  const result = await createCombinedPdf(job, { onProgress: (...counts) => progress.push(counts) });
  const mergedBytes = await readFile(path.join(job.outputDir, result.filename));
  const document = await PDFDocument.load(mergedBytes);
  assert.deepEqual(
    document.getPages().map((page) => [page.getWidth(), page.getHeight()]),
    [
      [220, 320],
      [220, 340],
      [320, 220],
    ],
  );
  assert.deepEqual(
    result.sources.map((source) => [source.sequence, source.firstPage, source.lastPage]),
    [
      [40, 1, 2],
      [42, 3, 3],
    ],
  );
  assert.deepEqual(progress, [
    [1, 2],
    [2, 2],
  ]);
  assert.equal(result.sourceCount, 2);
  assert.equal(result.pageCount, 3);
  assert.equal(result.bytes, mergedBytes.length);
  assert.equal(result.sha256, createHash('sha256').update(mergedBytes).digest('hex'));
  assert.equal(document.getTitle(), 'Zusammenführung – Gesamt-PDF');
  assert.equal(document.getCreator(), `${APPLICATION_NAME} ${VERSION}`);
  assert.deepEqual(
    await readFile(path.join(job.outputDir, 'screenshots', 'web_0040.pdf')),
    firstBytes,
  );
});

test('Keine Scheindatei ohne Aufnahmen oder bei beschädigter Eingabe', async () => {
  const empty = await fixture('empty');
  assert.equal(await createCombinedPdf(empty), null);
  await assert.rejects(access(path.join(empty.outputDir, 'gesamt.pdf')), { code: 'ENOENT' });
  const corrupt = await fixture('corrupt');
  await writeFile(path.join(corrupt.outputDir, 'screenshots', 'kaputt.pdf'), 'invalid PDF');
  corrupt.records = [{ filename: 'kaputt.pdf', sequence: 1 }];
  await assert.rejects(createCombinedPdf(corrupt));
  await assert.rejects(access(path.join(corrupt.outputDir, 'gesamt.pdf')), { code: 'ENOENT' });
});

test('Abbruch einer Zusammenführung veröffentlicht keine unvollständige PDF', async () => {
  const job = await fixture('cancelled');
  await saveSource(job, 'web_1.pdf', [[200, 300]], rgb(0.2, 0.3, 0.4));
  job.records = [{ filename: 'web_1.pdf', objectId: 'object-1', sequence: 1 }];
  const controller = new AbortController();
  await assert.rejects(
    createCombinedPdf(job, {
      signal: controller.signal,
      onProgress: () => controller.abort(new Error('Testabbruch')),
    }),
    /Testabbruch/,
  );
  await assert.rejects(access(path.join(job.outputDir, 'gesamt.pdf')), { code: 'ENOENT' });
  await access(path.join(job.outputDir, 'screenshots', 'web_1.pdf'));
});

test('Gesamt-PDF ist opt-in und ausschließlich für das PDF-Format aktiv', () => {
  const base = {
    username: 'Archiv',
    collection: 'Web',
    urls: ['https://example.org/'],
    outputDir: outputRoot,
  };
  assert.equal(validateConfig({ ...base, format: 'pdf' }).combinePdf, false);
  assert.equal(validateConfig({ ...base, format: 'pdf', combinePdf: true }).combinePdf, true);
  assert.equal(validateConfig({ ...base, format: 'png', combinePdf: true }).combinePdf, false);
  assert.equal(validateConfig({ ...base, format: 'pdf', combinePdf: 'false' }).combinePdf, false);
});
