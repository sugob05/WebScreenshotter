import test from 'node:test';
import assert from 'node:assert/strict';
import UPNGPackage from '@pdf-lib/upng';
import { PDFDocument } from 'pdf-lib';
import { encodeScreenshot } from '../src/formats.js';
import { encodeTiff } from '../src/tiff.js';
const UPNG = UPNGPackage.default || UPNGPackage;

function testImage(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = i % 256;
    pixels[i * 4 + 1] = 100;
    pixels[i * 4 + 2] = 200;
    pixels[i * 4 + 3] = 255;
  }
  return {
    pixels,
    png: Buffer.from(
      UPNG.encode(
        [pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength)],
        width,
        height,
        0,
      ),
    ),
  };
}
test('PNG bleibt unverändert; TIFF lässt sich bytegenau als RGBA rekonstruieren', async () => {
  const { pixels, png } = testImage(17, 29);
  assert.deepEqual(await encodeScreenshot(png, 'png'), png);
  const tif = await encodeScreenshot(png, 'tif');
  assert.equal(tif.toString('ascii', 0, 2), 'II');
  assert.equal(tif.readUInt16LE(2), 42);
  const tags = new Map();
  const ifd = tif.readUInt32LE(4);
  for (let i = 0; i < tif.readUInt16LE(ifd); i++) {
    const pos = ifd + 2 + i * 12;
    tags.set(tif.readUInt16LE(pos), tif.readUInt32LE(pos + 8));
  }
  assert.equal(tags.get(256), 17);
  assert.equal(tags.get(257), 29);
  assert.equal(tags.get(259), 1);
  assert.equal(tags.get(338), 2);
  assert.deepEqual(tif.subarray(tags.get(273), tags.get(273) + tags.get(279)), pixels);
  assert.throws(() => encodeTiff(Buffer.alloc(2), 2, 2));
});
test('Lange Screenshots ergeben mehrere lesbare PDF-Bildseiten mit Titel', async () => {
  const { png } = testImage(100, 380);
  const result = await encodeScreenshot(png, 'pdf', { title: 'Prüfung ä & ö', author: 'Archiv' });
  assert.equal(result.toString('ascii', 0, 5), '%PDF-');
  const document = await PDFDocument.load(result);
  assert.equal(document.getPageCount(), 3);
  assert.equal(document.getTitle(), 'Prüfung ä & ö');
  assert.equal(document.getAuthor(), 'Archiv');
});
