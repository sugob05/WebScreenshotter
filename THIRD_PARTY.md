# Lizenzen und mitgelieferte Software

WebScreenshotter und die eigene Dokumentation stehen unter der Apache License, Version 2.0; der vollständige Text steht in [LICENSE](LICENSE). Die nachfolgend genannten Drittanbieter-Komponenten behalten ihre eigenen Lizenzen und Urheberhinweise.

Das Windows-x64-Paket enthält Node.js 24.22.3 sowie die in `package-lock.json` festgelegten Produktionsabhängigkeiten. Die Node.js-Dateien stammen unverändert aus dem unten genannten Herstellerarchiv. WebScreenshotter ist ein eigenständiges Projekt und kein Produkt von Microsoft oder dem Node.js-Projekt. Aufnahme-Browser werden separat bereitgestellt.

| Bestandteil | Lizenzinformationen im Paket |
| --- | --- |
| Node.js 24.22.3 | `runtime/node/LICENSE`, einschließlich der Hinweise zu enthaltenen Bibliotheken. |
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
- [Playwright-Quellcode](https://github.com/microsoft/playwright)

`runtime/versions.json` im Windows-Paket dokumentiert Quelle, Version und Hashes von Node.js. Die Original-Lizenzdateien und vorhandenen NOTICE-Dateien der Abhängigkeiten bleiben im jeweiligen Paketordner erhalten. Die externen METS-/PREMIS-Prüfschemas unter `test/schemas/` sind keine eigenen Projektwerke; ihre Herkunft und Hinweise stehen in [test/schemas/README.md](test/schemas/README.md).
