import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';

test('Die HTML-Anleitung mit Bildern, Stylesheet und weiterführenden Dateien ist über HTTP erreichbar', async () => {
  const app = await createApp({ port: 0 });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    const response = await fetch(`${base}/ANLEITUNG.html`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(response.headers.get('content-security-policy'), /style-src 'self'/);
    const html = await response.text();
    assert(!html.includes('<style'), 'Die strikte CSP benötigt eine externe CSS-Datei.');
    assert(!html.includes('<script'), 'Die Anleitung bleibt ohne JavaScript lesbar.');
    assert(html.indexOf('id="start-hier"') < html.indexOf('id="portables-nodejs-einrichten"'));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    const targets = new Set(
      [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((match) => match[1]),
    );
    for (const target of targets) {
      if (target.startsWith('#')) {
        assert(ids.includes(target.slice(1)), `Fehlendes Sprungziel: ${target}`);
      } else if (!/^https?:/.test(target)) {
        const asset = await fetch(new URL(target, `${base}/ANLEITUNG.html`));
        assert.equal(asset.status, 200, target);
        if (target.endsWith('.svg'))
          assert.match(asset.headers.get('content-type'), /^image\/svg\+xml/);
        if (target.endsWith('.css')) assert.match(asset.headers.get('content-type'), /^text\/css/);
        assert((await asset.arrayBuffer()).byteLength > 0, target);
      }
    }
    const interfaceHtml = await (await fetch(base)).text();
    assert.equal((interfaceHtml.match(/href="\/ANLEITUNG.html#start-hier"/g) || []).length, 2);
    const license = await fetch(`${base}/LICENSE`);
    assert.match(license.headers.get('content-type'), /^text\/plain/);
    assert.match(await license.text(), /END OF TERMS AND CONDITIONS/);
  } finally {
    await app.close();
  }
});

test('Dokumentationsrouten geben keine privaten Dateien frei und behandeln HEAD und POST korrekt', async () => {
  const app = await createApp({ port: 0 });
  try {
    const base = `http://127.0.0.1:${app.port}`;
    for (const route of [
      '/data/browsers.local.json',
      '/runtime/private/browser.exe',
      '/server.js',
      '/docs/../package.json',
      '/docs/%2e%2e%2fdata/settings.json',
    ]) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 404, route);
      await response.arrayBuffer();
    }
    const head = await fetch(`${base}/ANLEITUNG.html`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.match(head.headers.get('content-type'), /^text\/html/);
    assert(Number(head.headers.get('content-length')) > 0);
    assert.equal(await head.text(), '');
    const post = await fetch(`${base}/ANLEITUNG.html`, { method: 'POST' });
    assert.equal(post.status, 405);
    await post.arrayBuffer();
  } finally {
    await app.close();
  }
});
