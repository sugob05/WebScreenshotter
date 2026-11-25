import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { parseSitemap, resolveSitemap } from '../src/sitemap.js';

test('Sitemap verarbeitet Namensräume, CDATA und XML-Entities; Bild-URLs bleiben außen vor', () => {
  const xml =
    '<s:urlset xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://example.org/image"><s:url><s:loc>https://example.org/?a=1&amp;b=2</s:loc><image:image><image:loc>https://example.org/image.jpg</image:loc></image:image></s:url><s:url><s:loc><![CDATA[https://example.org/ä]]></s:loc></s:url></s:urlset>';
  assert.deepEqual(parseSitemap(xml).urls, [
    'https://example.org/?a=1&b=2',
    'https://example.org/%C3%A4',
  ]);
});
test('Sitemap lehnt externe Entitäten, falsches XML und fehlende URLs ab', () => {
  for (const xml of [
    '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset/>',
    '<html/>',
    '<urlset><url></url></urlset>',
    '<urlset><url><loc>file:///secret</loc></url></urlset>',
    '<urlset><url></urlset>',
    '<urlset><url><loc>https://example.org/</loc><loc>https://example.org/x</loc></url></urlset>',
  ])
    assert.throws(() => parseSitemap(xml));
});
test('Verschachtelte Gzip-Sitemaps lösen sich ohne Schleifen oder Duplikate auf', async () => {
  const pages = {
    'https://example.org/index.xml':
      '<sitemapindex><sitemap><loc>https://example.org/part.xml.gz</loc></sitemap><sitemap><loc>https://example.org/index.xml</loc></sitemap></sitemapindex>',
    'https://example.org/part.xml.gz': gzipSync(
      '<urlset><url><loc>https://example.org/a</loc></url><url><loc>https://example.org/a</loc></url><url><loc>https://example.org/b</loc></url></urlset>',
    ),
  };
  const result = await resolveSitemap('https://example.org/index.xml', {
    fetchImpl: async (url) => new Response(pages[url], { status: 200 }),
  });
  assert.deepEqual(result.urls, ['https://example.org/a', 'https://example.org/b']);
  assert.equal(result.sources.length, 2);
});
test('Sitemap-Weiterleitungen werden geprüft; Fehlercodes werden gemeldet', async () => {
  await assert.rejects(
    () =>
      resolveSitemap('https://example.org/a', {
        fetchImpl: async () => new Response('', { status: 404 }),
      }),
    /404/,
  );
  const checked = [];
  await assert.rejects(
    () =>
      resolveSitemap('https://example.org/a', {
        fetchImpl: async () =>
          new Response('', { status: 302, headers: { location: 'https://blocked.test/' } }),
        checkUrl: (url) => {
          checked.push(url);
          if (url.includes('blocked.test')) throw new Error('Gesperrt');
        },
      }),
    /Gesperrt/,
  );
  assert(checked.includes('https://blocked.test/'));
});
