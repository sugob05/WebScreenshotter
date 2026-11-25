/** Bounded sitemap traversal with deduplication, redirect checks and source history. */
import { gunzipSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
import { InputError, normalizeUrl } from './validation.js';
import { APPLICATION_NAME, VERSION } from './config.js';

const MAX_BYTES = 10 * 1024 * 1024;

/** Read only loc elements in the sitemap namespace; image/video extensions are ignored. */
export function parseSitemap(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new InputError('Sitemaps mit DTDs oder eigenen XML-Entitäten werden nicht verarbeitet.');
  const parser = new SaxesParser({ xmlns: true });
  const stack = [];
  const urls = [];
  let root = '';
  let namespace = '';
  let location = '';
  let entryHasLocation = false;
  let collecting = false;
  parser.on('opentag', (node) => {
    stack.push(node);
    if (stack.length === 1) {
      root = node.local;
      namespace = node.uri;
      if (
        !['urlset', 'sitemapindex'].includes(root) ||
        !['', 'http://www.sitemaps.org/schemas/sitemap/0.9'].includes(namespace)
      )
        throw new InputError(
          'Die XML-Datei enthält weder urlset noch sitemapindex im Sitemap-Namensraum.',
        );
    }
    if (stack.length === 2) entryHasLocation = false;
    if (
      stack.length === 3 &&
      node.local === 'loc' &&
      node.uri === namespace &&
      stack[1].uri === namespace &&
      stack[1].local === (root === 'urlset' ? 'url' : 'sitemap')
    ) {
      if (entryHasLocation)
        throw new InputError('Ein Sitemap-Eintrag enthält mehrere loc-Elemente.');
      location = '';
      collecting = true;
      entryHasLocation = true;
    } else if (collecting)
      throw new InputError('Ein loc-Element darf keine verschachtelten XML-Elemente enthalten.');
  });
  parser.on('text', (text) => {
    if (collecting) location += text;
  });
  parser.on('cdata', (text) => {
    if (collecting) location += text;
  });
  parser.on('closetag', () => {
    if (collecting && stack.length === 3) {
      urls.push(normalizeUrl(location.trim()));
      if (urls.length > 10000)
        throw new InputError(
          'Eine Sitemap enthält mehr als 10.000 Einträge. Bitte einen kleineren Teilindex wählen.',
        );
      collecting = false;
    }
    if (
      stack.length === 2 &&
      stack[1].uri === namespace &&
      stack[1].local === (root === 'urlset' ? 'url' : 'sitemap') &&
      !entryHasLocation
    )
      throw new InputError('Ein Sitemap-Eintrag enthält keine URL (loc).');
    stack.pop();
  });
  parser.on('error', (error) => {
    throw new InputError(`Ungültiges Sitemap-XML: ${error.message}`);
  });
  parser.write(xml).close();
  return { type: root === 'urlset' ? 'urls' : 'index', urls };
}

/** Apply the same size limit before and after decompression. */
async function readLimited(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new InputError('Die Sitemap überschreitet das Limit von 10 MiB.');
    chunks.push(chunk);
  }
  let data = Buffer.concat(chunks);
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data, { maxOutputLength: MAX_BYTES });
  if (data.length > MAX_BYTES) throw new InputError('Die entpackte Sitemap überschreitet 10 MiB.');
  return data.toString('utf8');
}

/** A visited set prevents cycles; a second set preserves unique target order. */
export async function resolveSitemap(
  url,
  { signal, onProgress = () => {}, fetchImpl = fetch, checkUrl = () => {} } = {},
) {
  const visited = new Set();
  const found = new Set();
  const sources = [];
  async function walk(value, depth) {
    signal?.throwIfAborted();
    const current = normalizeUrl(value);
    checkUrl(current);
    if (visited.has(current)) return;
    if (depth > 8) throw new InputError('Die Sitemap ist tiefer als acht Ebenen verschachtelt.');
    if (visited.size >= 100)
      throw new InputError(
        'Der Sitemap-Index enthält mehr als 100 Sitemap-Dateien. Bitte einen kleineren Teilindex wählen.',
      );
    visited.add(current);
    onProgress(`Sitemap lesen: ${current}`);
    const timeout = AbortSignal.timeout(30000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    let requestUrl = current;
    for (let redirect = 0; redirect <= 10; redirect++) {
      checkUrl(requestUrl);
      response = await fetchImpl(requestUrl, {
        signal: requestSignal,
        redirect: 'manual',
        headers: {
          'User-Agent': `${APPLICATION_NAME}/${VERSION} sitemap-reader`,
          Accept: 'application/xml,text/xml,*/*',
        },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirect === 10)
        throw new InputError('Die Sitemap hat eine ungültige Weiterleitungskette.');
      requestUrl = normalizeUrl(new URL(location, requestUrl).href);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new InputError(`Sitemap nicht abrufbar: HTTP ${response.status} (${current})`);
    }
    const parsed = parseSitemap(await readLimited(response));
    sources.push({
      url: current,
      finalUrl: response.url || requestUrl,
      status: response.status,
      retrievedAt: new Date().toISOString(),
      type: parsed.type,
      entries: parsed.urls.length,
    });
    if (parsed.type === 'index') {
      for (const child of parsed.urls) await walk(child, depth + 1);
    } else {
      for (const target of parsed.urls) {
        checkUrl(target);
        found.add(target);
        if (found.size > 10000)
          throw new InputError(
            'Die Sitemap enthält mehr als 10.000 URLs. Bitte einen kleineren Teilindex wählen.',
          );
      }
    }
  }
  await walk(url, 0);
  if (!found.size) throw new InputError('In der Sitemap wurden keine Website-URLs gefunden.');
  return { urls: [...found], sources };
}
