# WebScreenshotter – Wartung

Die Anwendung bleibt JavaScript, HTML und CSS ohne Build-Schritt. Node.js ab Version 22 startet den lokalen Dienst; `WebScreenshotter-starten.cmd` ist der einzige Windows-Starter. Alte Verknüpfungen auf `Screenshotter-starten.cmd` müssen auf diesen Namen umgestellt werden.

Das portable Windows-x64-Paket enthält unter `runtime/` Node.js und die zur festgelegten Playwright-Version passende Firefox-Ausgabe. Der Starter bevorzugt die relative Laufzeit und lädt keine Pakete nach. `scripts/build-portable.js` kopiert ausschließlich freigegebene Projektdateien und die gesperrten Produktionsabhängigkeiten; Einstellungen, Browserprofile, Aufnahmen und Prüfdaten werden ausgeschlossen. Quellen und Prüfsummen stehen in `runtime/versions.json`, Lizenzhinweise in `THIRD_PARTY.md`. Browser und Playwright immer zusammen aktualisieren.

Die Oberfläche wird über die Betriebssystem-Zuordnung für HTTP-Adressen im Standardbrowser geöffnet. Dieser Start ist unabhängig vom gewählten Headless-Aufnahme-Browser. Der portable Firefox dient ausschließlich optionalen Headless-Tests; die Anwendung startet damit kein sichtbares Fenster und wählt ihn nicht automatisch als Aufnahme-Browser aus. Eine ausdrücklich gewählte oder gespeicherte Browserauswahl bleibt erhalten.

## Zuständigkeiten

| Datei | Aufgabe |
| --- | --- |
| `server.js` | HTTP-Routen, Sitzungsschutz, erlaubte Downloads und Ereignisstrom. |
| `src/config.js` | Produktname, Version, Formate, lokale Einstellungen und atomare Dateischreibvorgänge. |
| `src/validation.js` | Vertrauensgrenze: API-Eingaben validieren und normalisieren. |
| `src/browsers.js` | Installierte Browser finden, explizite Pfade prüfen, Browser starten und schließen. |
| `src/jobs.js` | Auftragszustände, Reihenfolge, Abbruch, Browserfehler, Zwischenstände und Abschluss. |
| `src/formats.js`, `src/tiff.js` | Aufgenommene Bilddaten in PDF bzw. TIFF umwandeln. |
| `src/combined-pdf.js` | Einzel-PDFs in Reihenfolge kopieren und Herkunft mit Seitenbereichen zurückgeben. |
| `src/artifacts.js` | Speicherorte der erhaltenen Dateien und temporären PDF-Teile für API, METS und Excel vereinheitlichen. |
| `src/metadata.js` | METS 2.0 mit Dublin Core und PREMIS 3.0 erzeugen. |
| `src/excel.js` | XLSX mit genau acht Spalten, typisierten Datumswerten und sicheren Textzellen. |
| `src/sitemap.js`, `src/async.js` | Begrenzte Sitemap-Auflösung sowie Zeitlimits und Abbruchsignale. |
| `public/index.html` | Semantische Struktur, Beschriftungen und Dialoge. |
| `public/app.js` | Formularzustand, DOM-Ausgabe, Tastaturfokus, Auftragsanzeige und Ereignisstrom. |
| `public/theme.js`, `public/styles.css` | Frühes Laden der Farbauswahl und gemeinsame Farben, Abstände und Größen. |
| `public/url-import.js` | Reine TXT-Dekodierung und URL-Prüfung ohne DOM-Abhängigkeit; Dateiauswahl und Drop nutzen denselben Importweg. |
| `scripts/build-docs.js` | Erzeugt sechs beschriftete SVG-Abbildungen und die offline lesbare HTML-Anleitung aus der README; benötigt nur Node.js. |

## Daten und Ablauf

Ein Auftrag enthält seine geprüfte `config`, URLs in Eingabereihenfolge sowie `records`. Jede bearbeitete URL erzeugt genau einen abschließenden Record, auch bei Fehlern. `sequence` ist die eingestellte Laufnummer. `filename`, `bytes` und `sha256` werden erst nach erfolgreichem Speichern vergeben.

Ab Version 1.3.0 enthält `records` genau ein abschließendes Ergebnis pro URL. Die obersten Ergebnisfelder beschreiben den letzten Versuch; `attempts` bewahrt alle tatsächlichen Versuche mit separaten Ereigniskennungen und `attemptCount` deren Anzahl. Während einer Retry-Pause liegt der aktuelle URL-Datensatz in `job.currentRecord`; `persist()` nimmt ihn mit `pending: true` in Manifest und METS auf, während die URL noch in `remainingUrls` steht. Der Fortschrittszähler steigt erst nach Ende der Wiederholungsfolge. Ein Abbruch während der Pause erhält den letzten tatsächlichen Versuch mit `retryInterrupted: true`, ohne einen weiteren Abruf zu erfinden.

`retries` zählt zusätzliche Versuche (0–20). `retryDelayMode`, `retryDelay`, `retryDelayMin` und `retryDelayMax` steuern ausschließlich die Retry-Pause. HTTP-Fehlerseiten werden vor einem weiteren Versuch ohne Bilddatei dokumentiert; die letzte erreichbare HTTP-Fehlerseite bleibt als Warnungsaufnahme erhalten. `capture-attempt`-Protokolleinträge enthalten einen numerischen HTTP-Status oder `null`, falls keine Antwort vorliegt. METS verknüpft alle PREMIS-Ereignisse mit der einen URL-Struktur, Excel und Gesamt-PDF verwenden weiterhin nur das erhaltene Ergebnis. Geschlossene Versuche ignorieren verspätete Response-Ereignisse.

Der Ablauf ist `preparing` → `running`/`waiting` → `finalizing` → `completed`, `cancelled` oder `failed`. `JobManager.run()` übernimmt den Abschluss auch bei Ausnahmen. Browserabsturz und Benutzerabbruch haben unterschiedliche Ergebnisse. Testbrowser und PDF-Zusammenführung können am Konstruktor des JobManagers ersetzt werden, ohne die Produktionsimplementierung umzuschreiben.

`snapshot()` begrenzt Protokoll und Ergebnistabelle für die Oberfläche. METS, Manifest, Gesamt-PDF und Excel greifen immer auf die vollständigen Records zu. Neue Exporte dürfen deshalb nicht auf dem verkürzten Snapshot aufbauen.

Bei `format: 'pdf'` und `combinePdf: true` entsteht ausschließlich `gesamt.pdf`. Die Aufnahme sichert zunächst `temporaryPdf`-Records unter `pdf-zwischenstand/`. `combinedPdf.sources` hält für jede Quelle Objekt-ID und ersten/letzten Seitenindex (ab 1) fest; `record.pdfPages` übernimmt diesen Bereich. Fehlerhafte Abrufe liefern keine Quelldatei. Gesamt-PDF und METS/Manifest werden vor dem Entfernen der Zwischenstände gespeichert. METS verweist danach über `area` mit `BETYPE="PAGE"` auf die Gesamt-PDF. PREMIS behält die historischen Quellobjekte. Ein Fehler beim Zusammenführen erhält alle Zwischenstände und wird als `combinedPdfError` angezeigt und gespeichert. Bei einem Bereinigungsfehler bleiben Gesamt-PDF und Warnung erhalten.

Nach einem Abbruch der Aufnahme wird aus den fertigen Einzel-PDFs noch die Gesamt-PDF erzeugt. Ein weiterer Abbruch während dieser Phase bricht nur die Zusammenführung ab. Das Ergebnis wird erst nach vollständiger Erstellung atomar veröffentlicht. Die Zusammenführung ist wegen der speicherbasierten PDF-Bibliothek auf 256 MiB Quelldaten und 5.000 Seiten begrenzt.

`outputArtifact()` liefert die tatsächlich erhaltene Datei einschließlich SHA-256. API-Downloads, Excel und die Ergebnisanzeige müssen diesen Weg verwenden: Im Gesamt-PDF-Modus stehen in den Records weiterhin die Namen und Hashes der historischen Zwischenstände. Diese dürfen nach dem Zusammenführen nicht als aktuelle Downloadpfade ausgegeben werden.

Der TXT-Import liest Dateien lokal, prüft den gesamten Stapel vor der Änderung und ergänzt die vorhandene Eingabe. Die Parserfunktionen sind direkt mit Node testbar. Drag-and-drop darf die Seite weder navigieren noch die während eines laufenden Auftrags gesperrte Eingabe ändern; die native Dateiauswahl ist die Tastaturalternative.

## Änderungen sicher durchführen

1. Neue Optionen in HTML, `configFromForm()` und `validateConfig()` ergänzen. Ausgeblendete Eingaben müssen deaktiviert sein, damit versteckte Pflichtfelder keine Validierung blockieren.
2. Bei Dateien immer Manifest, Prüfsummen, METS/PREMIS und Download-Allowlist mitdenken. Kein frei übergebener Pfad darf über die HTTP-API heruntergeladen werden.
3. Benutzertexte mit `textContent` ausgeben. Für XML ausschließlich `xml()` verwenden. Excel-Texte bleiben Zeichenketten, auch wenn sie mit `=` beginnen.
4. Farben ausschließlich als semantische CSS-Variablen ergänzen und in beiden Themes prüfen. Native Labels, Checkboxen, Radios, Buttons und Dialoge beibehalten. Neue Dialoge brauchen einen zugänglichen Namen und eine sinnvolle Fokusrückgabe.
5. Neue Funktionen mit einem passenden Verhaltens- oder Dateiformattest prüfen. Vor Freigabe die folgenden Befehle ausführen.

```powershell
npm run check
npm test
# Portable Laufzeit ohne separat installiertes Node.js:
.\runtime\node\node.exe --test test/*.test.js
# Paket erstellen (zuvor runtime und Abhängigkeiten bereitstellen):
.\runtime\node\node.exe scripts/build-portable.js
# Benötigt installierte Aufnahme-Browser und deren lokale Ausführungsrechte:
npm run test:integration
# Optionales Entwicklerwerkzeug, keine Laufzeitabhängigkeit:
npx prettier@3.9.10 --write public src server.js scripts test prettier.config.js
```

`prettier.config.js` hält die Formatierung fest. Kommentare erklären Zuständigkeiten, Datenverträge, besondere Formatanforderungen und Fehlerbehandlung; sie sollen nicht lediglich jede Codezeile wiederholen.

## Manuelle Prüfung der Oberfläche

Beide Farbschemata prüfen, Darkmode umschalten und neu laden. Mit Tab, Umschalt+Tab, Pfeiltasten, Leertaste, Enter und Escape alle Formulare und Dialoge bedienen. Nach dem Entfernen eines Metadatenfelds darf der Fokus nicht verloren gehen. Der Sprunglink führt zum Hauptinhalt. Statusmeldungen werden über eine zurückhaltende Live-Region ausgegeben; der laufende Countdown liest nicht ständig neu vor.

Bei 320 CSS-Pixeln Breite und bei 200/400 % Zoom müssen alle Bedienelemente erreichbar bleiben. Nur die Ergebnistabelle darf als zweidimensionaler Inhalt horizontal scrollen. Kontraste, vergrößerte Schrift, reduzierte Bewegung und Windows-Kontrastdesigns prüfen. Automatische Prüfungen etwa mit axe-core ergänzen die Tastatur- und Screenreaderprüfung, ersetzen sie aber nicht.

Die PDF-Dateien enthalten Abbildungen von Websites und sind keine getaggten, screenreadertauglichen PDF/UA-Dokumente. Die barrierearme Bedienoberfläche und die Zugänglichkeit der aufgenommenen Website-Inhalte sind getrennte Eigenschaften.

## Kompatibilität

`screenshotter.draft.v1`, `screenshotter.theme.v1`, der API-Token-Header und bestehende PREMIS-/XML-Kennungen behalten ihre bisherigen Namen. Sie sind technische Identifikatoren und dürfen nicht allein wegen einer Änderung des Produktnamens umbenannt werden. `WEBSCREENSHOTTER_DATA_DIR` ist der neue optionale Datenpfad; `SCREENSHOTTER_DATA_DIR` bleibt als Rückfall erhalten. Alte Archive werden nicht nachträglich verändert.
