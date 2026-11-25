# Mitgelieferte Software

Das Windows-x64-Paket enthält Node.js 24.22.3 und Firefox 159.0 (Playwright-Build 1572). Die Programmdateien stammen unverändert aus den unten genannten Herstellerarchiven. WebScreenshotter ist ein eigenständiges Projekt und kein Produkt von Mozilla, Microsoft oder dem Node.js-Projekt.

| Bestandteil | Lizenzinformationen im Paket |
| --- | --- |
| Node.js 24.22.3 | `runtime/node/LICENSE`, einschließlich der Hinweise zu enthaltenen Bibliotheken. |
| Firefox 159.0 / Playwright 1572 | `runtime/firefox-LICENSE.html`; auch im Browser unter `about:license`. MPL 2.0 und dort aufgeführte weitere Lizenzen. |
| playwright-core 1.65.1 | Apache-2.0; `node_modules/playwright-core/LICENSE` und `NOTICE`. |
| pdf-lib 1.17.1 | MIT; Lizenz im jeweiligen Paketordner. |
| @pdf-lib/upng 1.0.1, @pdf-lib/standard-fonts 1.0.0 | MIT; Lizenzen in den jeweiligen Paketordnern. |
| pako 1.0.11 | MIT und Zlib; Lizenz im Paketordner. |
| saxes 6.0.0 | ISC; Lizenz im Paketordner. |
| tslib 1.14.1 | 0BSD; Lizenz im Paketordner. |
| xmlchars 2.2.0 | MIT; Lizenz im Paketordner. |

Bezugsquellen und Quellcode:

- [Node.js 24.22.3](https://nodejs.org/en/blog/release/v24.22.3) mit offiziellen SHA-256-Prüfsummen. Archiv und `node.exe` wurden damit verglichen.
- [Node.js Quellcode 24.22.3](https://nodejs.org/dist/v24.22.3/node-v24.22.3.tar.gz)
- [Playwright Firefox 1572 für Windows x64](https://cdn.playwright.dev/dbazure/download/playwright/builds/firefox/1572/firefox-win64.zip)
- [Playwright Firefox-Buildquellen und Patches](https://github.com/microsoft/playwright/tree/v1.65.1/browser_patches/firefox)
- [Mozilla Firefox-Quellcode](https://hg.mozilla.org/releases/mozilla-release/)

`runtime/versions.json` dokumentiert Quellen, Versionen und Hashes. Der Firefox-Archivhash dokumentiert die per HTTPS bezogene Datei; er wurde nicht mit einer separat signierten Prüfsummenliste abgeglichen. Die zur Automation passende Firefox-Ausgabe wird hier als „Firefox (mitgeliefert)“ angezeigt; es handelt sich nicht um die PortableApps-Ausgabe. Browser und Automationsbibliothek beim Aktualisieren gemeinsam prüfen. Die Original-Lizenzdateien bleiben im Paket erhalten.
