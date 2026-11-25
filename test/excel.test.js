import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
import { buildExcel, EXCEL_HEADERS, EXCEL_FILENAME } from '../src/excel.js';
import { createApp } from '../server.js';

// Read via the ZIP central directory, including its links to local headers.
function unzip(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  let position = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    assert.equal(buffer.readUInt32LE(position), 0x02014b50);
    assert.equal(buffer.readUInt16LE(position + 10), 8);
    const length = buffer.readUInt16LE(position + 28);
    const name = buffer.toString('utf8', position + 46, position + 46 + length);
    const local = buffer.readUInt32LE(position + 42);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const decoded = inflateRawSync(
      buffer.subarray(start, start + buffer.readUInt32LE(position + 20)),
    );
    assert.equal(decoded.length, buffer.readUInt32LE(position + 24));
    const document = decoded.toString('utf8');
    new SaxesParser({ xmlns: true }).write(document).close();
    entries.set(name, document);
    position +=
      46 + length + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
  }
  assert.equal(position, end);
  return entries;
}

function readCells(document) {
  const cells = new Map();
  let cell;
  const parser = new SaxesParser();
  parser.on('opentag', (node) => {
    if (node.name === 'c') {
      cell = { ...node.attributes, text: '' };
      cells.set(cell.r, cell);
    }
    assert.notEqual(node.name, 'f', 'Exportierte Werte dürfen keine Formeln sein.');
  });
  parser.on('text', (text) => {
    if (cell) cell.text += text;
  });
  parser.on('closetag', (node) => {
    if (node.name === 'c') cell = null;
  });
  parser.write(document).close();
  return cells;
}

const common = {
  sequence: 7,
  filename: 'web.archiv_0007.png',
  title: 'Archiv & Überlieferung',
  requestedUrl: 'https://example.org/alt',
  finalUrl: 'https://example.org/neu?a=1&b=2',
  capturedAt: '2026-11-24T10:15:30.000Z',
  httpStatus: 200,
  sha256: '1234567890'.repeat(6) + '1234',
};

test('Excel enthält exakt die acht Spalten, vollständige Dateidaten und typisierte lokale Zeit', () => {
  const outputDir = path.resolve('.test-output', 'Excel & Test');
  const entries = unzip(
    buildExcel({ outputDir, records: [common] }, { timeZone: 'Europe/Berlin' }),
  );
  assert.equal(entries.size, 6);
  const worksheet = entries.get('xl/worksheets/sheet1.xml');
  const cells = readCells(worksheet);
  assert.deepEqual(
    [...cells.values()].slice(0, 8).map((cell) => cell.text),
    EXCEL_HEADERS,
  );
  assert.equal(cells.get('A2').text, '7');
  assert.equal(cells.get('B2').text, 'web.archiv_0007');
  assert.equal(cells.get('C2').text, common.title);
  assert.equal(cells.get('D2').text, common.finalUrl);
  assert.equal(cells.get('F2').text, '200');
  assert.equal(cells.get('G2').text, common.sha256);
  assert.equal(cells.get('G2').t, 'inlineStr');
  assert.equal(cells.get('H2').text, path.join(outputDir, 'screenshots', common.filename));
  const localTime = new Date(Date.UTC(1899, 11, 30) + Number(cells.get('E2').text) * 86400000);
  assert.equal(localTime.toISOString(), '2026-11-24T11:15:30.000Z');
  assert.equal(cells.get('E2').s, '3');
  assert(entries.get('xl/styles.xml').includes('Europe/Berlin'));
  assert(worksheet.includes('<autoFilter ref="A1:H2"/>'));
  assert(worksheet.includes('state="frozen"'));
});

test('Excel bewahrt Fehlerzeilen, Sommerzeit und Titel als Text ohne erfundene Dateien', () => {
  const failure = {
    sequence: 8,
    requestedUrl: 'https://example.org/fehler',
    finalUrl: 'about:blank',
    startedAt: '2026-07-01T10:00:00.000Z',
    title: '=HYPERLINK("https://example.org/") _x0041_\u0001',
  };
  const entries = unzip(
    buildExcel(
      { outputDir: path.resolve('.test-output'), records: [failure] },
      { timeZone: 'Europe/Berlin' },
    ),
  );
  const cells = readCells(entries.get('xl/worksheets/sheet1.xml'));
  for (const column of ['B', 'F', 'G', 'H']) assert.equal(cells.get(`${column}2`).text, '');
  assert.equal(cells.get('D2').text, failure.requestedUrl);
  assert.equal(cells.get('C2').t, 'inlineStr');
  assert.equal(cells.get('C2').text, '=HYPERLINK("https://example.org/") _x005F_x0041_');
  const localTime = new Date(Date.UTC(1899, 11, 30) + Number(cells.get('E2').text) * 86400000);
  assert.equal(localTime.toISOString(), '2026-07-01T12:00:00.000Z');
});

test('Excel exportiert auch große Aufträge vollständig und erlaubt eine leere Übersicht', () => {
  const records = Array.from({ length: 10000 }, (_, index) => ({ ...common, sequence: index + 1 }));
  const entries = unzip(buildExcel({ outputDir: path.resolve('.test-output'), records }));
  const cells = readCells(entries.get('xl/worksheets/sheet1.xml'));
  assert.equal(cells.get('A10001').text, '10000');
  assert.equal(cells.size, 10001 * 8);
  const empty = unzip(buildExcel({ outputDir: path.resolve('.test-output'), records: [] }));
  assert.equal(readCells(empty.get('xl/worksheets/sheet1.xml')).size, 8);
});

test('Excel verweist im Gesamt-PDF-Modus auf die erhaltene Datei und deren SHA-256', () => {
  const outputDir = path.resolve('.test-output', 'combined-excel');
  const combinedPdf = { filename: 'gesamt.pdf', sha256: 'b'.repeat(64) };
  const records = [{ ...common, temporaryPdf: true, pdfPages: { first: 1, last: 2 } }];
  const cells = readCells(
    unzip(buildExcel({ outputDir, records, combinedPdf })).get('xl/worksheets/sheet1.xml'),
  );
  assert.equal(cells.get('B2').text, 'gesamt');
  assert.equal(cells.get('G2').text, combinedPdf.sha256);
  assert.equal(cells.get('H2').text, path.join(outputDir, 'gesamt.pdf'));
  const recovery = readCells(
    unzip(buildExcel({ outputDir, records })).get('xl/worksheets/sheet1.xml'),
  );
  assert.equal(recovery.get('G2').text, common.sha256);
  assert.equal(recovery.get('H2').text, path.join(outputDir, 'pdf-zwischenstand', common.filename));
});

test('Excel-API schützt den Export, wartet auf Abschluss und speichert die heruntergeladene XLSX', async () => {
  const app = await createApp({ port: 0 });
  try {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'screenshotter-excel-'));
    const id = '11111111-1111-4111-8111-111111111111';
    const job = { id, outputDir, status: 'running', records: [common] };
    app.manager.jobs.set(id, job);
    const base = `http://127.0.0.1:${app.port}/api/jobs/${id}`;
    const headers = { 'X-Screenshotter-Token': app.token };
    assert.equal((await fetch(`${base}/export-excel`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${base}/export-excel`, { method: 'POST', headers })).status, 409);
    assert.equal((await fetch(`${base}/files/${EXCEL_FILENAME}`, { headers })).status, 404);
    for (const status of ['completed', 'cancelled', 'failed']) {
      job.status = status;
      const exported = await fetch(`${base}/export-excel`, { method: 'POST', headers });
      assert.equal(exported.status, 200);
      assert.deepEqual(await exported.json(), { filename: EXCEL_FILENAME });
    }
    const download = await fetch(`${base}/files/${EXCEL_FILENAME}?download=1`, { headers });
    assert.equal(download.status, 200);
    assert.equal(
      download.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    assert.match(download.headers.get('content-disposition'), /attachment/);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.deepEqual(bytes, await readFile(path.join(outputDir, EXCEL_FILENAME)));
    assert.equal(unzip(bytes).size, 6);
    assert(job.excelWritten);
  } finally {
    await app.close();
  }
});
