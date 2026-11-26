# WebScreenshotter 1.3.0 – Prüfstand vom 26. November 2026

## Ergänzungen in Version 1.3.0

- Konfigurierbare Retries unter „Weitere Aufnahmeoptionen“: 0–20 zusätzliche Versuche, feste oder zufällige Wartezeiten, standardmäßig ausgeschaltet.
- Separate Protokoll- und PREMIS-Ereignisse für alle tatsächlichen Versuche, einschließlich HTTP-Status bzw. ausdrücklich fehlender Serverantwort; Sicherung bereits vor einer Retry-Pause.
- Fortschritt, Dateinamen, Excel und Gesamt-PDF bleiben auf ein Ergebnis pro URL bezogen. Abbruch während einer Retry-Pause erhält die bisherigen Fehlversuche.
- **47 von 47 automatisierten Tests bestanden**, keine übersprungenen Tests. Die Retry-Prüfungen umfassen Fehler mit anschließendem Erfolg, ausgeschöpfte Versuche, feste und zufällige Pausen, fehlende Serverantwort, Screenshotfehler nach HTTP 200, späte Navigation auf eine Fehlerseite, Abbruch, Browserabsturz, bestehende Dateien und Gesamt-PDF.
- METS 2.0 und PREMIS 3.0 bestehen die offiziellen XSD-Prüfungen auch mit mehreren Ereignissen pro URL. JavaScript-Syntax und Dokumentationsverweise geprüft: 55 eindeutige HTML-Anker, 13 lokale Dateiverweise und sechs gültige SVG-Dateien.
- Die neuen Retry-Tests verwenden synthetische Browserantworten. Echte Website-Aufnahmen und die visuelle Bedienung der neuen Felder wurden für diese Version nicht erneut im Browser geprüft.

## Ergänzungen in Version 1.2.3

- Aufnahmekopf in Haupttitel „WebScreenshotter“ und erklärende Unterüberschrift getrennt; Seitenleisten-Beschriftung auf den gewünschten Wortlaut „Autmatisiertes Anfertigen von Screenshots im Browser“ geändert.
- README um vollständige Bedienungsanleitung, Abbildungen, Entstehungsgeschichte und detaillierte Einrichtung von portablem Node.js erweitert.
- Nur noch `WebScreenshotter-starten.cmd` als Einstieg; die frühere Weiterleitung wurde entfernt.
- Fehlermeldungen zu Node.js und Abhängigkeiten verweisen auf die Installationsabschnitte der README.
- `ANLEITUNG.html` bietet dieselbe Anleitung zum lokalen Öffnen im Browser. Sechs eigens erzeugte SVG-Abbildungen sind ausdrücklich als schematische Bedienhilfen gekennzeichnet, mit Titel, Beschreibung und Alternativtext versehen und visuell geprüft.
- JavaScript-Syntaxprüfung bestanden; 54 eindeutige HTML-Anker, 13 lokale Dateiverweise und sechs gültige SVG-Dateien geprüft.
- CMD-Fehlerpfad in einem separaten Ordner ohne portable Laufzeit und ohne Node.js im Suchpfad ausgeführt: erwarteter Fehlerstatus und Hinweise auf README, Node.js-Abschnitt und HTML-Anleitung bestätigt.

## Ergänzungen in Version 1.2.2

- Firefox wird einheitlich als „Firefox“ angezeigt; die daraus erzeugte Pfadbeschriftung lautet „Eigener Programmpfad für Firefox“.
- Slogans im Seitenbereich und im Aufnahmekopf entfernt. Neue Hauptüberschrift: „WebScreenshotter - Tool zum automatisierten Anfertigen von Screenshots mit Metadaten.“
- Beschriftung links oben und Seitentitel auf „Lokales Websitescreenshottool“ angepasst.
- Portable Laufzeiten unter `runtime/` und `runtimes/` werden von Git ignoriert. Die `.gitignore` wird auch im Windows-Paket mitgeliefert.
- Beschriftungen im Quelltext abgeglichen; JavaScript-Syntaxprüfung erfolgreich.

## Ergänzungen in Version 1.2.1

- Der CMD-Starter öffnet die Oberfläche über den Windows-Standardbrowser. Die vorherige Sonderbehandlung für ein sichtbares Fenster des portablen Firefox wurde entfernt.
- Der portable Firefox ist als optionale Headless-Testumgebung gekennzeichnet und wird bei neuen Eingaben nicht automatisch ausgewählt. Ausdrücklich gewählte oder gespeicherte Browser bleiben erhalten.
- Syntaxprüfung erfolgreich; alle 35 Funktionstests mit der mitgelieferten Node.js-Laufzeit bestanden, keine Tests übersprungen.
- Das tatsächliche Öffnen eines Browserfensters über die Windows-Zuordnung wurde in dieser eingeschränkten Umgebung nicht geprüft.

## Ergänzungen in Version 1.2.0

- Windows-x64-Paket mit Node.js 24.22.3, Firefox 159.0 (Playwright-Build 1572), vollständigen Produktionsabhängigkeiten und Original-Lizenzhinweisen. Node-Archiv und `node.exe` stimmen mit den veröffentlichten SHA-256-Prüfsummen überein. Herkunft und Hashes stehen in `runtime/versions.json`.
- TXT-Import per nativer Dateiauswahl und Drop-Ereignis. Vorhandene URLs bleiben erhalten; Duplikate werden entfernt. UTF-8, UTF-16 mit BOM, Zeilenenden, Kommentarzeilen, Fehlerangaben und Größen-/Anzahllimits berücksichtigt.
- PDF-Auswahl jetzt alternativ: einzelne PDFs oder ausschließlich `gesamt.pdf`. Zwischenstände werden nach Speicherung der Gesamt-PDF und konsistenter Metadaten entfernt. Fehler erhalten rettbare Zwischenstände. Excel und API verweisen auf tatsächlich vorhandene Dateien; METS enthält Seitenbereiche der Gesamt-PDF.

| Prüfung 1.2.0 | Ergebnis |
| --- | --- |
| Syntax und Funktionstests | **35 von 35 Tests bestanden**, keine übersprungenen Tests; mit der mitgelieferten Node.js-Version ausgeführt. |
| Portabler Starter | Aus dem zusammengestellten Paket mit einem auf Windows-Systemordner beschränkten `PATH` gestartet. Keine systemweite Node.js-Installation verwendet, keine Nachinstallation beim Start. Lokale HTTP-Oberfläche erreichbar, mitgelieferter Firefox am relativen Paketpfad erkannt. Das automatische Öffnen des sichtbaren Firefox-Fensters wurde für diesen Test mit `--no-open` ausgelassen. |
| METS 2.0 / PREMIS 3.0 | Auch der Modus mit ausschließlich einer Gesamt-PDF und `mets:area`-Seitenbereichen besteht die offiziellen XSD-Prüfungen. |
| PDF und Excel | Einzel-/Gesamtmodus, Entfernen der Zwischenstände, Abbruch, Zusammenführungsfehler, Dateiverweise, SHA-256 und Excel-Zuordnung zur erhaltenen PDF geprüft. |
| TXT-Dateiauswahl | Reale TXT-Datei über den Dateidialog eingelesen: eine neue URL ergänzt, ein Duplikat übersprungen. |
| Drop und Fehlerfall | Drop mit einer Testdatei über denselben DOM-Ereignisweg ausgelöst; neue URL ergänzt, zwei Duplikate entfernt. Ungültige zweite Zeile gemeldet und bisherige Eingabe erhalten. Kein physischer Drag aus dem Windows-Explorer geprüft. |
| PDF über die Oberfläche | Drei synthetische Aufnahmen ergeben genau eine sechsseitige PDF. Ergebnislinks zeigen Seiten 1–2, 3–4 und 5–6; keine Einzel-PDFs oder PDF-Zwischenstände verbleiben. |
| Zugänglichkeit | axe-core 4.14.0 auf der erweiterten Aufnahmeseite: keine gemeldeten Verstöße, 30 bestandene Regeln; Kontrastprüfung unvollständig. Bei 320 CSS-Pixeln kein horizontales Überlaufen; Importbereich visuell geprüft. Keine Browser-Konsolenfehler. |
| Firefox | Mitgelieferten Firefox erkannt und echten Headless-Start versucht. Browserprozess startet; `newPage` endet hier mit `Target crashed`. Diagnose: `RenderCompositorSWGL failed mapping default framebuffer` sowie ein fehlgeschlagener Registrierungszugriff. Erfolgreiche echte Firefox-Aufnahme in dieser Umgebung nicht bestätigt. |

Die Tests der Oberfläche verwenden ausdrücklich synthetische Aufnahmen. Sie bestätigen den Import, die Bedienung und die Dateiausgabe, nicht das Rendering durch Firefox. Der Browser-Sandboxschutz wurde nicht abgeschaltet. Ein Praxistest auf einem gewöhnlichen Windows-PC über den mitgelieferten Starter bleibt erforderlich. Die bisherigen Grenzen der Screenreader-/WCAG-Prüfung gelten weiter.

## Bisheriger Prüfstand 1.1.0 vom 24. November 2026

Die vorhandene Anwendung wurde weitergeführt. Bereits vorhanden waren die deutsche Oberfläche, Metadatenfelder, URL- und Sitemap-Eingabe, Browsererkennung, Zeitsteuerung, Ordnerauswahl, Benennung, Fortschrittsanzeige und die vier Ausgabeformate. Der bisherige Export verwendete METS 1.

## Änderungen

- Anwendung in **WebScreenshotter** umbenannt. `WebScreenshotter-starten.cmd` startet die Anwendung; der bisherige Starter bleibt als Weiterleitung erhalten.
- In Version 1.1.0 zusätzliche `gesamt.pdf` ergänzt; Version 1.2.0 ersetzt dieses Verhalten durch die oben beschriebene alternative PDF-Ausgabe.
- Gesamt-PDF in Manifest, SHA-256-Liste und METS 2.0 aufgenommen, einschließlich eigenem PREMIS-Dateiobjekt, Ableitungsereignis und Zuordnung der Quellseiten.
- Darkmode unter **Einstellungen → Darstellung** ergänzt. Die Auswahl wird sofort angewendet und im Browser gespeichert.
- Oberfläche überarbeitet: eindeutige Beschriftungen, Tastaturfokus und Fokusrückgabe, Sprunglink, zugängliche Dialognamen, zurückhaltende Statusmeldungen, größere Bedienelemente, responsive Darstellung, Kontrastfarben sowie Regeln für reduzierte Bewegung und Kontrastdesigns.
- JavaScript, HTML und CSS einheitlich formatiert, Variablen und Hilfsfunktionen verständlicher benannt, Zuständigkeiten und besondere Abläufe kommentiert. `WARTUNG.md` beschreibt Module, Datenverträge, Fehlerbehandlung und weitere Prüfungen.
- Excel-Export als echte XLSX-Datei mit den acht gewünschten Spalten, sortierbaren Datumswerten, Filter und fixierter Kopfzeile ergänzt. Der Export speichert `aufnahmen.xlsx` im Auftragsordner und bietet die Datei zum Download an.
- Metadatenexport vollständig auf METS 2.0 umgestellt: Namensraum, `mdSec/md`, `MDID`, `LOCREF` und `structSec`.
- Dublin Core 1.1 und PREMIS 3.0 eingebettet; Dateiobjekte, Ereignisse und Agenten bleiben mit den Aufnahmen verknüpft.
- METS-, PREMIS- und Dublin-Core-Versionen im JSON-Manifest angegeben; Antwort-URL im PREMIS-Ereignis ergänzt.
- Ungültige einzelne Unicode-Surrogate bei der XML-Ausgabe bereinigt.
- Unerwartetes Beenden des Browsers beendet den Auftrag, unterbricht auch Wartepausen und erhält Ereignisse, Prüfsummen und offene URLs.
- Oberfläche und Kurzanleitung auf METS 2.0 aktualisiert; ausführliche Start- und Bedienungsanleitung ergänzt.

## Ergebnisse

| Prüfung | Ergebnis |
| --- | --- |
| `npm run check` | Alle JavaScript-Dateien syntaktisch gültig. |
| `npm test` | **30 von 30 Tests bestanden**, kein übersprungener Test auf diesem Windows-PC. |
| Gesamt-PDF | Reihenfolge, unterschiedliche Seitengrößen, SHA-256, Seitenbereiche, unveränderte Quellen, leere/defekte Eingaben, Abbruch, Teilauftrag und Zusammenführungsfehler geprüft. API-Download nur für tatsächlich erzeugte Gesamt-PDFs freigegeben. |
| PDF-Darstellung | Drei Seiten der Gesamt-PDF mit Poppler gerendert und mit den einzeln gerenderten Quellseiten verglichen: PNG-Dateien identisch. Erste und letzte Seite zusätzlich visuell geprüft. |
| Excel-Export | Acht Spalten, Dateipfade, Hashes als Text, Weiterleitungen, fehlgeschlagene Aufnahmen, Sommer-/Winterzeit, Formelvermeidung, 10.000 Einträge und authentifizierter Download geprüft. |
| Excel-Datei und Bedienung | XLSX mit zwei unabhängigen Lesern (openpyxl und artifact-tool) geöffnet. Export-Button mit einem abgeschlossenen Testauftrag in der Oberfläche betätigt: Datei im Auftragsordner gespeichert und Download-Link angezeigt. |
| METS 2.0 + PREMIS 3.0 | Ausgabe gegen beide offiziellen XSDs validiert; auch Gesamt-PDF samt Ableitung, leerer Auftrag, Fehler und Abbruch. Negative Kontrollen weisen ungültige METS-Attribute und PREMIS-Werte zurück. |
| Dateiformate | PNG, TIFF und mehrseitiges PDF mit Testbild geprüft. Echte Browseraufnahmen, insbesondere JPG, siehe Einschränkung unten. |
| Benutzeroberfläche | Hell- und Dunkelmodus visuell geprüft. Darkmode per Leertaste umgeschaltet und nach Neuladen erhalten. Bei 320 CSS-Pixeln Breite kein horizontales Überlaufen auf Aufnahme- und Einstellungsseite. |
| Bedienung der Gesamt-PDF | PDF-Option über die Oberfläche aktiviert. Auftrag mit zwei synthetischen Browseraufnahmen ausgeführt: zwei Einzel-PDFs und vierseitige Gesamt-PDF erzeugt; Download-Link angezeigt. |
| Tastaturbedienung | Sprunglink, Ansichtswechsel, Darkmode, PDF-Option, Metadaten hinzufügen/entfernen, Hilfe- und Ordnerdialog einschließlich Escape/Fokusrückgabe sowie Fokus auf den Auftragsstatus geprüft. |
| Automatische Zugänglichkeitsprüfung | axe-core 4.14.0: 0 gemeldete Verstöße auf der hellen Aufnahmeseite (27 bestandene Regeln) und in den dunklen Einstellungen (25 bestandene Regeln). Die Kontrastregel blieb in beiden Läufen unvollständig und wurde separat geprüft. |
| Textkontraste | Aus tatsächlich dargestellten Vorder-/Hintergrundfarben ermittelt: dunkle Einstellungen 63 Textelemente, Minimum 5,33:1; helle Aufnahmeseite einschließlich Ergebnissen 164 Textelemente, Minimum 5,8:1. Deaktivierte und visuell verborgene Elemente ausgenommen. |
| Chrome und Edge | Gefunden und headless gestartet. Seitenöffnung/Rendering in der eingeschränkten Testumgebung fehlgeschlagen. |
| Firefox | Auf diesem PC nicht installiert; keine echte Aufnahme geprüft. |
| Safari | Nicht als Headless-Aufnahme-Browser unterstützt; dies wird in Oberfläche und Anleitung erklärt. |

## Grenzen der Oberflächenprüfung

Die automatischen Ergebnisse und die Stichproben mit Tastatur und schmalem Ansichtsfenster sind keine vollständige WCAG-Zertifizierung. Ein Praxistest mit Screenreader sowie separate Prüfungen bei 200/400 Prozent Browser-Zoom und mit Windows-Kontrastdesigns stehen noch aus. Die erzeugten PDFs enthalten Website-Bilder und sind keine getaggten PDF/UA-Dokumente.

Der Testauftrag der Oberflächenprüfung verwendete einen nur im Prüfskript eingesetzten synthetischen Browser. Er bestätigt Bedienung, Auftragsablauf und Ausgabe, ersetzt aber keine echte Aufnahme einer externen Website. Die produktive Anwendung enthält diese Prüfhilfe nicht.

## Offener Praxistest

Die vollständigen Integrationstests wurden ausgeführt, konnten hier aber keine erfolgreiche Browseraufnahme erstellen. Die Diagnose des Edge-Unterprozesses meldet wiederholte Grafikprozess-Abstürze mit Exitcode `0xC0000022` (Zugriff verweigert), anschließend `GPU process isn't usable`. Chrome öffnete ebenfalls keine Aufnahmeseite innerhalb des Zeitlimits. Damit ist die Ende-zu-Ende-Funktion auf diesem PC noch nicht bestätigt. Die Browser-Sandbox wurde nicht abgeschaltet.

Nach der ergänzten Absturzbehandlung wurde der betroffene Integrationstest erneut ausgeführt: Der Auftrag endet nun nach etwa neun Sekunden mit einem dokumentierten Browserfehler; Manifest und METS 2.0 werden gespeichert. Das bestätigt die neue Fehlerbehandlung, jedoch keinen erfolgreichen Screenshot.

Für den noch offenen Praxistest im normalen lokalen Terminal außerhalb der eingeschränkten Ausführungsumgebung:

```powershell
cd E:\Codex\Screenshotter
npm run test:integration
npm start
```

Vor produktiven Aufnahmen in den Einstellungen **Browser testen** ausführen. Die Integrationstests arbeiten ausschließlich mit einer eigens gestarteten lokalen Testwebsite und schreiben Testdaten nach `.test-output/`.
