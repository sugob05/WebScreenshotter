import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeUrlText, mergeUrlLists } from '../public/url-import.js';

test('TXT-Import hängt an, normalisiert URLs und behält die Reihenfolge ohne Duplikate', () => {
  const result = mergeUrlLists('https://example.org', [
    {
      name: 'eins.TXT',
      text: '\uFEFF# Kommentar\r\nhttps://example.org/\r\nhttps://example.org/a#inhalt\r\n',
    },
    { name: 'zwei.txt', text: 'https://bücher.example/\rhttps://example.org/a#inhalt' },
  ]);
  assert.equal(
    result.value,
    'https://example.org/\nhttps://example.org/a#inhalt\nhttps://xn--bcher-kva.example/',
  );
  assert.equal(result.added, 2);
  assert.equal(result.duplicates, 2);
});

test('TXT-Import benennt fehlerhafte Zeilen und lehnt ungeeignete Inhalte ab', () => {
  assert.throws(
    () => mergeUrlLists('', [{ name: 'links.txt', text: 'https://example.org/\nfile:///secret' }]),
    /links.txt, Zeile 2/,
  );
  for (const text of [
    'https://user:pass@example.org',
    'https://example.org/ hier',
    '\u0000https://example.org',
  ]) {
    assert.throws(() => mergeUrlLists('', [{ name: 'links.txt', text }]), /Zeile 1/);
  }
  assert.throws(
    () => mergeUrlLists('', [{ name: 'links.csv', text: 'https://example.org' }]),
    /TXT/,
  );
  assert.throws(
    () => mergeUrlLists('', [{ name: 'leer.txt', text: '\n# Kommentar\n' }]),
    /keine URLs/,
  );
  assert.throws(
    () =>
      mergeUrlLists('', [
        {
          name: 'gross.txt',
          text: Array.from({ length: 10001 }, (_, i) => `https://example.org/${i}`).join('\n'),
        },
      ]),
    /10.000/,
  );
});

test('TXT-Import liest UTF-8 und UTF-16 mit BOM und verwirft fehlerhafte Kodierungen', () => {
  const value = 'https://example.org/ä\r\n';
  assert.equal(decodeUrlText(new TextEncoder().encode(value)), value);
  const littleEndian = Buffer.from('\uFEFF' + value, 'utf16le');
  assert.equal(decodeUrlText(littleEndian), value);
  const bigEndian = Buffer.from(littleEndian).swap16();
  assert.equal(decodeUrlText(bigEndian), value);
  assert.throws(() => decodeUrlText(Uint8Array.from([0xc3, 0x28])), /nicht lesbar/);
});
