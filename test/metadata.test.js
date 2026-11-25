import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SaxesParser } from 'saxes';
import { buildMets } from '../src/metadata.js';
import { validateConfig } from '../src/validation.js';

test('METS enthält gültiges XML, Dateiverknüpfungen, Prüfsummen, DC, PREMIS und Fehlerereignisse', () => {
  const config = validateConfig({
    username: 'A & B',
    collection: '<Bestand>',
    description: 'Beschreibung',
    signature: 'SIG 1',
    urls: ['https://example.org/'],
    outputDir: path.resolve('.test-output'),
    metadata: [{ term: 'rights', value: '© Test' }],
  });
  const now = new Date().toISOString();
  const common = {
    startedAt: now,
    capturedAt: now,
    finishedAt: now,
    durationMs: 300,
    warnings: [],
    requestedUrl: 'https://example.org/?a=1&b=2',
    browser: { name: 'Edge', version: '140' },
    userAgent: 'test-agent',
  };
  const job = {
    id: '1111',
    status: 'completed',
    startedAt: now,
    finishedAt: now,
    config,
    browserInfo: { name: 'Edge', version: '140' },
    records: [
      {
        ...common,
        sequence: 1,
        filename: 'test_0001.png',
        title: 'A < B & C\u0001',
        bytes: 100,
        sha256: 'a'.repeat(64),
        objectId: 'object-1',
        eventId: 'event-1',
        httpStatus: 200,
        outcome: 'success',
        imageWidth: 1440,
        imageHeight: 900,
      },
      {
        ...common,
        sequence: 2,
        objectId: 'object-2',
        eventId: 'event-2',
        outcome: 'failure',
        error: 'net::ERR_NAME_NOT_RESOLVED',
      },
    ],
  };
  const output = buildMets(job);
  const ids = new Set();
  const references = [];
  const tags = [];
  let eventCount = 0;
  let fileCount = 0;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', (error) => {
    throw error;
  });
  parser.on('opentag', (node) => {
    tags.push(node.name);
    if (node.name === 'premis:event') eventCount++;
    if (node.name === 'mets:file') fileCount++;
    for (const attr of Object.values(node.attributes)) {
      if (attr.name === 'ID') {
        assert(!ids.has(attr.value), `Doppelte ID ${attr.value}`);
        ids.add(attr.value);
      }
      if (['MDID', 'FILEID'].includes(attr.name)) references.push(...attr.value.split(' '));
    }
  });
  parser.write(output).close();
  assert.equal(eventCount, 2);
  assert.equal(fileCount, 1);
  references.forEach((id) => assert(ids.has(id), `Fehlende ID ${id}`));
  for (const name of [
    'dc:title',
    'dc:rights',
    'premis:fixity',
    'premis:agent',
    'mets:mdSec',
    'mets:md',
    'mets:structSec',
    'mets:structMap',
  ])
    assert(tags.includes(name));
  assert(output.includes('xmlns:mets="http://www.loc.gov/METS/v2"'));
  assert(output.includes('https://www.loc.gov/standards/mets/mets2.xsd'));
  assert(output.includes('LOCREF="screenshots/test_0001.png"'));
  assert(!/mets:(dmdSec|amdSec|techMD|digiprovMD)|DMDID=|ADMID=|xlink:/.test(output));
  assert(output.includes('test-agent'));
  assert(output.includes('a'.repeat(64)));
  assert(output.includes('screenshots/test_0001.png'));
  assert(!output.includes('\u0001'));
});
