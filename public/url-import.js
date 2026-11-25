/** Pure URL-file parsing shared by the interface and tests; no upload is needed. */
export const MAX_URL_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_URL_COUNT = 10000;

export function decodeUrlText(bytes) {
  const data = new Uint8Array(bytes);
  const encoding =
    data[0] === 0xff && data[1] === 0xfe
      ? 'utf-16le'
      : data[0] === 0xfe && data[1] === 0xff
        ? 'utf-16be'
        : 'utf-8';
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch {
    throw new Error(
      'Die Textdatei ist nicht lesbar. Bitte als UTF-8 oder UTF-16 mit BOM speichern.',
    );
  }
}

function readUrlLines(text, label) {
  const addresses = [];
  for (const [index, line] of text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\n|\r/)
    .entries()) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    let address;
    try {
      if (value.length > 8192 || /[\u0000-\u0020\u007f]/u.test(value)) throw new Error();
      address = new URL(value);
      if (!['https:', 'http:'].includes(address.protocol) || address.username || address.password) {
        throw new Error();
      }
    } catch {
      throw new Error(
        `${label}, Zeile ${index + 1}: Bitte eine vollständige HTTP(S)-URL ohne Zugangsdaten angeben.`,
      );
    }
    addresses.push(address.href);
    if (addresses.length > MAX_URL_COUNT)
      throw new Error('Höchstens 10.000 URLs pro Auftrag sind möglich.');
  }
  return addresses;
}

/** Validate the complete batch before replacing the input. Existing URLs stay first. */
export function mergeUrlLists(existingText, files) {
  const addresses = new Set(readUrlLines(existingText, 'Vorhandene Eingabe'));
  const before = addresses.size;
  let imported = 0;
  for (const file of files) {
    if (!/\.txt$/i.test(file.name))
      throw new Error(`${file.name}: Bitte nur TXT-Dateien auswählen.`);
    const entries = readUrlLines(file.text, file.name);
    imported += entries.length;
    for (const address of entries) addresses.add(address);
    if (addresses.size > MAX_URL_COUNT)
      throw new Error('Höchstens 10.000 eindeutige URLs pro Auftrag sind möglich.');
  }
  if (!imported) throw new Error('Die ausgewählten TXT-Dateien enthalten keine URLs.');
  return {
    value: [...addresses].join('\n'),
    count: addresses.size,
    added: addresses.size - before,
    duplicates: imported - (addresses.size - before),
  };
}
