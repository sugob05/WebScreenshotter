import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { buildMets } from '../src/metadata.js';
import { validateConfig } from '../src/validation.js';

// Windows supplies an XSD 1.0 validator through .NET. The application itself
// remains JavaScript-only and does not need PowerShell to capture or export.
const validator = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$settings = [System.Xml.XmlReaderSettings]::new()
$settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
$settings.XmlResolver = $null
$settings.ValidationType = [System.Xml.ValidationType]::Schema
$settings.Schemas.XmlResolver = $null
[void]$settings.Schemas.Add('http://www.loc.gov/METS/v2', (Join-Path $env:SCREENSHOTTER_TEST_SCHEMAS 'mets2.xsd'))
[void]$settings.Schemas.Add('http://www.loc.gov/premis/v3', (Join-Path $env:SCREENSHOTTER_TEST_SCHEMAS 'premis-v3-0.xsd'))
$settings.Schemas.Compile()
$errorsFound = [System.Collections.Generic.List[string]]::new()
$settings.add_ValidationEventHandler({ param($sender, $event) if ($event.Severity -eq 'Error') { $errorsFound.Add($event.Message) } })
$reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new([Console]::In.ReadToEnd()), $settings)
try { while ($reader.Read()) {} } finally { $reader.Dispose() }
ConvertTo-Json -InputObject @($errorsFound.ToArray()) -Compress
`;

function validate(document) {
  return JSON.parse(
    execFileSync(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', validator],
      {
        input: document,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        env: {
          ...process.env,
          SCREENSHOTTER_TEST_SCHEMAS: fileURLToPath(new URL('./schemas/', import.meta.url)),
        },
      },
    ).trim(),
  );
}

test(
  'Offizielle XSDs: METS 2.0 und eingebettetes PREMIS 3.0, inklusive Leerstand und Fehlern',
  { skip: process.platform !== 'win32' },
  () => {
    const config = validateConfig({
      username: 'Archiv Ä & B',
      collection: 'Webarchiv',
      urls: ['https://example.org/'],
      outputDir: path.resolve('.test-output'),
    });
    const now = '2026-11-24T10:00:00.000Z';
    const job = {
      id: 'test-job',
      config,
      status: 'completed',
      startedAt: now,
      finishedAt: now,
      records: [],
      browserInfo: { name: 'Microsoft Edge', version: '158' },
    };
    assert.deepEqual(
      validate(buildMets(job)),
      [],
      'Auch vor der ersten Aufnahme muss METS gültig sein.',
    );
    const common = {
      startedAt: now,
      finishedAt: now,
      requestedUrl: 'https://example.org/',
      warnings: [],
      durationMs: 200,
    };
    job.records = [
      {
        ...common,
        eventId: 'success-event',
        objectId: 'success-object',
        sequence: 1,
        capturedAt: now,
        filename: 'Ä & #1.png',
        title: 'A < B',
        bytes: 123,
        sha256: 'a'.repeat(64),
        imageWidth: 800,
        imageHeight: 600,
        outcome: 'success',
        httpStatus: 200,
      },
      {
        ...common,
        eventId: 'failure-event',
        sequence: 2,
        outcome: 'failure',
        error: 'Abruf fehlgeschlagen.',
      },
      {
        ...common,
        eventId: 'cancel-event',
        sequence: 3,
        outcome: 'cancelled',
        error: 'Abgebrochen.',
      },
    ];
    const document = buildMets(job);
    assert.deepEqual(validate(document), []);
    job.config.format = 'pdf';
    job.combinedPdf = {
      filename: 'gesamt.pdf',
      objectId: 'combined-object',
      eventId: 'combined-event',
      createdAt: now,
      bytes: 400,
      sha256: 'b'.repeat(64),
      pageCount: 2,
      sourceCount: 1,
      sources: [
        {
          sequence: 1,
          objectId: 'success-object',
          filename: 'einzel.pdf',
          firstPage: 1,
          lastPage: 2,
        },
      ],
    };
    assert.deepEqual(
      validate(buildMets(job)),
      [],
      'Auch die Gesamt-PDF mit Ableitungsereignis muss beiden XSDs entsprechen.',
    );
    job.records[0].temporaryPdf = true;
    job.records[0].pdfPages = { first: 1, last: 2 };
    const combinedOnly = buildMets(job);
    assert.deepEqual(
      validate(combinedOnly),
      [],
      'Nur Gesamt-PDF mit Seitenbereichen muss XSD-konform sein.',
    );
    assert(
      combinedOnly.includes('<mets:area FILEID="FILE_COMBINED" BETYPE="PAGE" BEGIN="1" END="2"/>'),
    );
    assert(!combinedOnly.includes('LOCREF="screenshots/'));
    job.config.retries = 2;
    job.records[0].attemptNumber = 2;
    job.records[0].attempts = [
      {
        ...common,
        sequence: 1,
        eventId: 'retry-failure-event',
        attemptNumber: 1,
        outcome: 'failure',
        httpStatus: 503,
        error: 'HTTP 503: Seitenabruf fehlgeschlagen.',
      },
      { ...job.records[0] },
    ];
    const retried = buildMets(job);
    assert(retried.includes('retry-failure-event'));
    assert(retried.includes('EVENT_0_ATTEMPT_1'));
    assert.deepEqual(
      validate(retried),
      [],
      'Frühere Fehlversuche müssen gültig mit der erhaltenen Gesamt-PDF verknüpft bleiben.',
    );
    delete job.combinedPdf;
    // Negative controls prove that both schemas are actually consulted.
    assert(validate(document.replace('LOCREF=', 'href=')).length > 0);
    assert(
      validate(
        document.replace('<premis:size>123</premis:size>', '<premis:size>invalid</premis:size>'),
      ).length > 0,
    );
    job.records = job.records.slice(1);
    assert.deepEqual(
      validate(buildMets(job)),
      [],
      'Fehlerereignisse ohne Dateien bleiben dokumentiert.',
    );
  },
);
