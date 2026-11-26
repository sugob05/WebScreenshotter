/** Product constants and local settings. Legacy paths remain valid after renaming. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DATA_DIR = path.resolve(
  process.env.WEBSCREENSHOTTER_DATA_DIR ||
    process.env.SCREENSHOTTER_DATA_DIR ||
    path.join(ROOT, 'data'),
);
export const APPLICATION_NAME = 'WebScreenshotter';
export const VERSION = '1.3.1';
export const DC_TERMS = [
  'title',
  'creator',
  'subject',
  'description',
  'publisher',
  'contributor',
  'date',
  'type',
  'format',
  'identifier',
  'source',
  'language',
  'relation',
  'coverage',
  'rights',
];
export const FORMATS = {
  png: { extension: 'png', mime: 'image/png', name: 'PNG' },
  jpg: { extension: 'jpg', mime: 'image/jpeg', name: 'JPEG' },
  tif: { extension: 'tif', mime: 'image/tiff', name: 'TIFF' },
  pdf: { extension: 'pdf', mime: 'application/pdf', name: 'PDF' },
};

/** Publish a whole file via a same-directory rename; UUIDs prevent writer collisions. */
export async function atomicWrite(file, data) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, data, { flag: 'wx' });
  await rename(temporary, file);
}

/** Missing settings are normal; corrupt settings must be reported, not discarded. */
export async function loadSettings() {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, 'settings.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Die gespeicherten Einstellungen sind nicht lesbar.', { cause: error });
    return { browserPaths: { chrome: '', edge: '', firefox: '', safari: '' } };
  }
}

export async function saveSettings(settings) {
  await mkdir(DATA_DIR, { recursive: true });
  await atomicWrite(path.join(DATA_DIR, 'settings.json'), JSON.stringify(settings, null, 2));
}
