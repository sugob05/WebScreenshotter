/** Validate untrusted API input once and return a normalized capture configuration. */
import path from 'node:path';
import { DC_TERMS, FORMATS } from './config.js';

export class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function string(value, label, max = 2000, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new InputError(`${label}: Bitte Text eingeben.`);
  const result = value.trim();
  if (required && !result) throw new InputError(`${label} fehlt.`);
  if (result.length > max)
    throw new InputError(`${label} darf höchstens ${max} Zeichen enthalten.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(result))
    throw new InputError(`${label} enthält unzulässige Steuerzeichen.`);
  return result;
}

function number(value, label, min, max, fallback, integer = false) {
  const result = value === undefined ? fallback : Number(value);
  if (
    value === '' ||
    value === null ||
    !Number.isFinite(result) ||
    result < min ||
    result > max ||
    (integer && !Number.isInteger(result))
  ) {
    throw new InputError(
      `${label}: Bitte ${integer ? 'eine ganze Zahl' : 'einen Wert'} zwischen ${min} und ${max} eingeben.`,
    );
  }
  return result;
}

/** Only HTTP(S) targets without embedded credentials are accepted. */
export function normalizeUrl(value) {
  let url;
  try {
    url = new URL(string(value, 'URL', 8192, true));
  } catch {
    throw new InputError(
      `Ungültige URL: ${String(value).slice(0, 150)}. Bitte mit https:// oder http:// angeben.`,
    );
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new InputError('Nur HTTP- und HTTPS-Adressen sind erlaubt.');
  if (url.username || url.password)
    throw new InputError('Zugangsdaten dürfen nicht in einer URL stehen.');
  return url.href;
}

export function parseUrls(input) {
  if (typeof input !== 'string' && !Array.isArray(input))
    throw new InputError('Bitte mindestens eine URL angeben.');
  const values = Array.isArray(input) ? input : input.split(/\r?\n/);
  if (values.length > 10000)
    throw new InputError('Pro Auftrag sind höchstens 10.000 URLs möglich.');
  const urls = [
    ...new Set(
      values.filter((value) => typeof value === 'string' && value.trim()).map(normalizeUrl),
    ),
  ];
  if (!urls.length) throw new InputError('Bitte mindestens eine URL angeben.');
  return urls;
}

/** Sequence numbers follow input order, including unsuccessful capture attempts. */
export function filenameFor(config, index) {
  const counter = String(config.startNumber + index).padStart(config.padding, '0');
  return `${config.prefix}${counter}${config.suffix}.${FORMATS[config.format].extension}`;
}

/** UI defaults are repeated here because API callers may omit or forge fields. */
export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new InputError('Ungültige Auftragsdaten.');
  const retries = number(raw.retries, 'Wiederholungsversuche', 0, 20, 0, true);
  const retryDelayMode = raw.retryDelayMode || 'fixed';
  const fixedRetries = retries > 0 && retryDelayMode === 'fixed';
  const randomRetries = retries > 0 && retryDelayMode === 'random';
  const config = {
    username: string(raw.username, 'Username', 200, true),
    collection: string(raw.collection, 'Name des Bestands', 500, true),
    description: string(raw.description, 'Beschreibung', 10000),
    signature: string(raw.signature, 'Vorläufige Signatur', 500),
    metadata: [],
    inputMode: raw.inputMode || 'urls',
    browser: raw.browser || 'edge',
    format: raw.format || 'png',
    combinePdf: raw.format === 'pdf' && raw.combinePdf === true,
    outputDir: string(raw.outputDir, 'Zielordner', 2000, true),
    prefix: string(raw.prefix, 'Präfix', 80),
    suffix: string(raw.suffix, 'Suffix', 80),
    startNumber: number(raw.startNumber, 'Startnummer', 0, 999999999, 1, true),
    padding: number(raw.padding, 'Anzahl Stellen', 1, 12, 4, true),
    width: number(raw.width, 'Fensterbreite', 320, 7680, 1440, true),
    height: number(raw.height, 'Fensterhöhe', 240, 4320, 900, true),
    quality: number(raw.quality, 'JPEG-Qualität', 1, 100, 92, true),
    fullPage: raw.fullPage !== false,
    lazyLoad: raw.lazyLoad !== false,
    delayMode: raw.delayMode || 'fixed',
    delay: number(raw.delay, 'Pause', 0, 86400, 2),
    delayMin: number(raw.delayMin, 'Minimale Pause', 0, 86400, 2),
    delayMax: number(raw.delayMax, 'Maximale Pause', 0, 86400, 5),
    settleTime: number(raw.settleTime, 'Wartezeit nach Seitenaufbau', 0, 120, 2),
    timeout: number(raw.timeout, 'Zeitlimit pro Seitenaufruf', 5, 300, 45),
    retries,
    retryDelayMode,
    retryDelay: number(
      fixedRetries ? raw.retryDelay : undefined,
      'Wartezeit vor Wiederholung',
      0,
      86400,
      5,
    ),
    retryDelayMin: number(
      randomRetries ? raw.retryDelayMin : undefined,
      'Minimale Wiederholungswartezeit',
      0,
      86400,
      2,
    ),
    retryDelayMax: number(
      randomRetries ? raw.retryDelayMax : undefined,
      'Maximale Wiederholungswartezeit',
      0,
      86400,
      10,
    ),
  };
  if (!['urls', 'sitemap'].includes(config.inputMode))
    throw new InputError('Unbekannte Eingabeart.');
  if (config.inputMode === 'urls') config.urls = parseUrls(raw.urls);
  else config.sitemapUrl = normalizeUrl(raw.sitemapUrl);
  if (!['chrome', 'edge', 'firefox'].includes(config.browser))
    throw new InputError(
      'Bitte Chrome, Edge oder Firefox wählen. Safari unterstützt diesen Headless-Betrieb nicht.',
    );
  if (!Object.hasOwn(FORMATS, config.format)) throw new InputError('Unbekanntes Speicherformat.');
  if (!['fixed', 'random'].includes(config.delayMode))
    throw new InputError('Unbekannte Pausenart.');
  if (config.delayMode === 'random' && config.delayMax < config.delayMin)
    throw new InputError('Die maximale Pause muss mindestens so groß wie die minimale Pause sein.');
  if (!['fixed', 'random'].includes(config.retryDelayMode))
    throw new InputError('Unbekannte Wartezeitart für Wiederholungsversuche.');
  if (config.retryDelayMode === 'random' && config.retryDelayMax < config.retryDelayMin)
    throw new InputError(
      'Die maximale Wiederholungswartezeit muss mindestens so groß wie die minimale sein.',
    );
  if (!path.isAbsolute(config.outputDir))
    throw new InputError('Bitte einen absoluten Pfad für den Zielordner angeben.');
  config.outputDir = path.resolve(config.outputDir);
  if (/[<>:"/\\|?*\u0000-\u001F]/u.test(config.prefix + config.suffix))
    throw new InputError(
      'Präfix und Suffix dürfen keine Pfadtrenner oder diese Zeichen enthalten: < > : " / \\ | ? *',
    );
  if (/[. ]$/.test(config.suffix) || /^[. ]/.test(config.prefix))
    throw new InputError(
      'Dateinamen dürfen nicht mit Punkt/Leerzeichen beginnen oder vor der Dateiendung damit enden.',
    );
  if (raw.metadata !== undefined && !Array.isArray(raw.metadata))
    throw new InputError('Ungültige Metadatenfelder.');
  if ((raw.metadata?.length || 0) > 100)
    throw new InputError('Höchstens 100 zusätzliche Metadatenfelder sind möglich.');
  for (const field of raw.metadata || []) {
    if (!field || !DC_TERMS.includes(field.term))
      throw new InputError('Unbekanntes Dublin-Core-Feld.');
    const value = string(field.value, 'Metadatenwert', 10000);
    if (value) config.metadata.push({ term: field.term, value });
  }
  return config;
}
