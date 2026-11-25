/** Convert captured PNG pixels to archival image/PDF output without print CSS.
 * JPEG is captured directly by the browser and does not pass through this encoder.
 */
import UPNGPackage from '@pdf-lib/upng';
import { PDFDocument } from 'pdf-lib';
import { encodeTiff } from './tiff.js';
import { APPLICATION_NAME, VERSION } from './config.js';

export const MAX_PIXELS = 80_000_000;
const UPNG = UPNGPackage.default || UPNGPackage;

/** Long images become consecutive A4-ratio pages, without discarding pixel rows. */
export async function encodeScreenshot(
  pngBuffer,
  format,
  { title = '', author = '', capturedAt = new Date().toISOString() } = {},
) {
  if (format === 'png') return pngBuffer;
  const png = UPNG.decode(
    pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength),
  );
  if (png.width * png.height > MAX_PIXELS)
    throw new Error(
      'Die Aufnahme überschreitet das Limit von 80 Megapixeln. Bitte die Fensterbreite reduzieren oder nur den sichtbaren Bereich aufnehmen.',
    );
  const rgba = Buffer.from(UPNG.toRGBA8(png)[0]);
  if (format === 'tif') return encodeTiff(rgba, png.width, png.height);
  if (format !== 'pdf') throw new Error(`Unbekanntes Zielformat: ${format}`);
  const document = await PDFDocument.create();
  document.setTitle(title);
  document.setAuthor(author);
  document.setProducer(`${APPLICATION_NAME} / pdf-lib`);
  document.setCreator(`${APPLICATION_NAME} ${VERSION}`);
  document.setCreationDate(new Date(capturedAt));
  document.setModificationDate(new Date(capturedAt));
  // Preserve the actual screenshot rather than switching the website to print CSS.
  // Long pages are split into consecutive A4-ratio sheets with no cropped rows.
  const pageWidth = 595.276;
  const pageHeight = 841.89;
  const rowsPerPage = Math.max(1, Math.floor((png.width * pageHeight) / pageWidth));
  for (let y = 0; y < png.height; y += rowsPerPage) {
    const rows = Math.min(rowsPerPage, png.height - y);
    const slice = rgba.subarray(y * png.width * 4, (y + rows) * png.width * 4);
    const pngSlice = UPNG.encode(
      [slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength)],
      png.width,
      rows,
      0,
    );
    const embedded = await document.embedPng(pngSlice);
    const height = (rows * pageWidth) / png.width;
    const page = document.addPage([pageWidth, pageHeight]);
    page.drawImage(embedded, { x: 0, y: pageHeight - height, width: pageWidth, height });
  }
  return Buffer.from(await document.save());
}
