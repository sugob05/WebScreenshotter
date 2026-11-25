/** Rebuild the offline manual and its original, accessible SVG illustrations. */
async function buildDocumentation() {
  const { mkdir, readFile, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const imageDirectory = path.join(root, 'docs', 'images');
  await mkdir(imageDirectory, { recursive: true });

  const colors = {
    ink: '#173c32',
    muted: '#465a53',
    green: '#176348',
    pale: '#e6f2eb',
    line: '#bbcfc4',
  };
  const escape = (value) =>
    String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  const text = (x, y, value, size = 22, weight = 400, fill = colors.ink) =>
    `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escape(value)}</text>`;
  const lines = (x, y, values, size = 21, fill = colors.muted) =>
    values.map((value, index) => text(x, y + index * (size + 12), value, size, 400, fill)).join('');
  const box = (x, y, width, height, fill = '#ffffff', stroke = colors.line) =>
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  const field = (x, y, width, label, value) =>
    text(x, y, label, 18, 600) +
    box(x, y + 12, width, 48, '#f8faf8') +
    text(x + 15, y + 44, value, 20);
  const check = (x, y, label, checked = true) =>
    `<rect x="${x}" y="${y - 20}" width="23" height="23" rx="4" fill="${checked ? colors.green : '#fff'}" stroke="${colors.green}" stroke-width="2"/>` +
    (checked
      ? `<path d="M${x + 5} ${y - 9} l5 6 l9 -13" fill="none" stroke="#fff" stroke-width="3"/>`
      : '') +
    text(x + 38, y, label, 20, 600);
  const button = (x, y, width, label) =>
    box(x, y, width, 49, colors.green, colors.green) + text(x + 16, y + 32, label, 20, 600, '#fff');
  const card = (x, y, width, height, heading) =>
    box(x, y, width, height) + text(x + 23, y + 39, heading, width < 400 ? 20 : 25, 700);
  const illustration = (name, title, description, body) => ({
    name,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="690" viewBox="0 0 1120 690" role="img" aria-labelledby="title description">
<title id="title">${escape(title)}</title><desc id="description">${escape(description)}</desc>
<rect width="1120" height="690" fill="#f3f7f4"/>
<g font-family="Segoe UI, Arial, sans-serif">
${text(38, 48, title, 31, 700)}
${text(38, 83, 'WebScreenshotter · Schematische Bedienhilfe mit Beispielwerten', 18, 400, colors.muted)}
${body}
${text(38, 666, 'Die nummerierten Schritte und vollständigen Erläuterungen stehen in der README.', 17, 400, colors.muted)}
</g></svg>\n`,
  });

  const illustrations = [
    illustration(
      '01-node-portabel',
      'Portables Node.js richtig ablegen',
      'Windows-x64-ZIP von nodejs.org laden, entpacken und den Inhalt nach runtime/node kopieren. node.exe liegt direkt in runtime/node.',
      card(38, 115, 330, 246, '1  Offizielles ZIP laden') +
        lines(61, 189, ['nodejs.org', 'Node.js 24 LTS', 'Windows · x64 · ZIP']) +
        text(61, 317, 'node-v24.22.3-win-x64.zip', 18, 600) +
        card(395, 115, 330, 246, '2  ZIP vollständig entpacken') +
        lines(418, 189, [
          'Versionsordner öffnen.',
          'Darin liegen node.exe,',
          'npm.cmd und weitere Dateien.',
        ]) +
        text(418, 317, 'Den Inhalt dieses Ordners kopieren.', 17, 600) +
        card(752, 115, 330, 246, '3  In den Zielordner kopieren') +
        lines(775, 189, [
          'WebScreenshotter öffnen.',
          'runtime → node öffnen',
          'und den Inhalt einfügen.',
        ]) +
        text(775, 317, 'Kein zusätzlicher Versionsunterordner!', 16, 600) +
        box(38, 387, 1044, 100, colors.pale) +
        text(62, 425, 'RICHTIGER PFAD', 18, 700) +
        text(62, 462, 'WebScreenshotter\\runtime\\node\\node.exe', 27, 600) +
        card(38, 510, 1044, 122, 'Danach: WebScreenshotter-starten.cmd doppelklicken') +
        text(
          61,
          594,
          'Node.js führt den lokalen Dienst aus. Die Oberfläche öffnet sich im Standardbrowser.',
          22,
        ),
    ),

    illustration(
      '02-metadaten-urls',
      'Bestand beschreiben und Website-Adressen hinzufügen',
      'Links werden Username, Bestand, Beschreibung und Signatur erfasst. Rechts stehen URLs zeilenweise; TXT-Dateien können in den URL-Bereich gezogen werden.',
      card(38, 115, 510, 510, '1  Bestand & Metadaten') +
        field(61, 188, 462, 'Username *', 'Beispielarchiv') +
        field(61, 278, 462, 'Name des Bestands *', 'Kommunale Websites 2026') +
        field(61, 368, 462, 'Beschreibung', 'Dokumentation ausgewählter Seiten') +
        field(61, 458, 462, 'Vorläufige Signatur', 'WEB-2026') +
        text(61, 572, 'Zusätzliche Dublin-Core-Felder sind möglich.', 20) +
        card(572, 115, 510, 510, '2  Website-Adressen') +
        text(596, 185, 'Einzelne URLs  |  XML-Sitemap', 21, 600) +
        box(596, 208, 462, 145, '#f8faf8') +
        lines(
          612,
          246,
          ['https://example.org/', 'https://example.org/kontakt', 'https://example.org/geschichte'],
          20,
        ) +
        box(596, 380, 462, 110, colors.pale) +
        lines(
          612,
          418,
          ['TXT-Dateien hierher ziehen', 'oder über die Dateiauswahl hinzufügen.'],
          20,
          colors.ink,
        ) +
        lines(
          596,
          538,
          [
            'Eine vollständige URL pro Zeile.',
            'Vorhandene URLs bleiben erhalten.',
            'Doppelte Adressen werden entfernt.',
          ],
          19,
        ),
    ),

    illustration(
      '03-aufnahme-ablage',
      'Aufnahme, Pausen und Ablage einstellen',
      'Browser und Fenstergröße bestimmen die Aufnahme. Zeitabstände werden fest oder zufällig gewählt. Zielordner, Dateiformat, Präfix, Suffix und Nummerierung bestimmen die Ablage.',
      card(38, 115, 510, 510, '3  Aufnahme konfigurieren') +
        field(61, 188, 462, 'Aufnahme-Browser', 'Microsoft Edge') +
        field(61, 280, 218, 'Fensterbreite', '1440 px') +
        field(305, 280, 218, 'Fensterhöhe', '900 px') +
        check(61, 388, 'Gesamte Seite aufnehmen') +
        check(61, 435, 'Durch Scrollen nachladen') +
        field(61, 488, 462, 'Pause: Fester Zeitraum', '2 Sekunden') +
        text(61, 595, 'Alternativ: zufällig zwischen zwei Werten.', 19) +
        card(572, 115, 510, 510, '4  Ablage & Dateinamen') +
        field(596, 188, 462, 'Zielordner *', 'C:\\WebScreenshotter\\aufnahmen') +
        field(596, 278, 462, 'Speicherformat', 'PNG  |  JPG  |  TIF  |  PDF') +
        field(596, 368, 218, 'Präfix', 'web_') +
        field(840, 368, 218, 'Suffix', '_archiv') +
        field(596, 458, 218, 'Startnummer', '7') +
        field(840, 458, 218, 'Mindeststellen', '4') +
        text(596, 579, 'Beispiel: web_0007_archiv.png', 24, 600),
    ),

    illustration(
      '04-pdf-varianten',
      'PDF: einzelne Dateien oder eine Gesamt-PDF',
      'Ohne Häkchen entsteht eine PDF pro URL. Mit Häkchen entsteht nur gesamt.pdf. Die Reihenfolge der URLs bleibt erhalten, Seitenbereiche werden dokumentiert.',
      card(38, 115, 510, 455, 'Checkbox ausgeschaltet') +
        check(61, 204, 'Alle Aufnahmen in einer PDF', false) +
        box(61, 239, 462, 69, '#f8faf8') +
        text(81, 281, 'URL 1 → screenshots/web_0001.pdf', 20) +
        box(61, 328, 462, 69, '#f8faf8') +
        text(81, 370, 'URL 2 → screenshots/web_0002.pdf', 20) +
        box(61, 417, 462, 69, '#f8faf8') +
        text(81, 459, 'URL 3 → screenshots/web_0003.pdf', 20) +
        text(61, 538, 'Eine PDF pro aufgenommener URL.', 22, 600) +
        card(572, 115, 510, 455, 'Checkbox eingeschaltet') +
        check(596, 204, 'Alle Aufnahmen in einer PDF') +
        box(596, 239, 462, 247, colors.pale) +
        text(620, 286, 'gesamt.pdf', 33, 700) +
        lines(
          620,
          336,
          ['URL 1 → Seiten 1–2', 'URL 2 → Seiten 3–4', 'URL 3 → Seiten 5–6'],
          23,
          colors.ink,
        ) +
        text(596, 538, 'Nur die Gesamt-PDF bleibt als Ergebnis.', 20, 600) +
        text(
          38,
          609,
          'Beispiel: drei URLs mit jeweils zwei Bildseiten. Seitenbereiche stehen in METS und Manifest.',
          21,
        ),
    ),

    illustration(
      '05-fortschritt-export',
      'Fortschritt verfolgen und Excel exportieren',
      'Der Auftragsstatus zeigt bearbeitete URLs. Nach Abschluss bietet der Excel-Button aufnahmen.xlsx an. Bilder, METS, Manifest und Prüfsummen liegen im Auftragsordner.',
      card(38, 115, 1044, 455, '5  Auftrag und Ergebnisse') +
        text(61, 191, 'Abgeschlossen · 3 von 3 URLs bearbeitet', 25, 700) +
        box(61, 214, 998, 22, colors.pale) +
        `<rect x="61" y="214" width="998" height="22" rx="11" fill="${colors.green}"/>` +
        text(61, 285, 'URL', 19, 700) +
        text(705, 285, 'HTTP-Status', 19, 700) +
        text(895, 285, 'Ergebnis', 19, 700) +
        text(61, 330, 'https://example.org/', 21) +
        text(728, 330, '200', 21) +
        text(895, 330, 'Aufnahme', 21) +
        text(61, 375, 'https://example.org/kontakt', 21) +
        text(728, 375, '200', 21) +
        text(895, 375, 'Aufnahme', 21) +
        text(61, 420, 'https://example.org/fehlt', 21) +
        text(728, 420, '404', 21) +
        text(895, 420, 'Warnung', 21) +
        button(61, 471, 360, 'Als Excel exportieren (.xlsx)') +
        text(464, 505, '→ aufnahmen.xlsx im Auftragsordner', 24, 600) +
        text(
          38,
          611,
          'Metadaten und Prüfsummen: mets.xml  ·  manifest.json  ·  checksums.sha256',
          22,
        ),
    ),

    illustration(
      '06-browser-darkmode',
      'Browserpfade und Darstellung verwalten',
      'Browser und Einstellungen enthält eigene Programmpfade, Browser testen, die Speicherfunktion und den Darkmode. Der Browser der Oberfläche ist unabhängig vom Aufnahme-Browser.',
      card(38, 115, 640, 457, 'Browser & Einstellungen') +
        text(61, 193, 'Firefox', 27, 700) +
        field(
          61,
          241,
          594,
          'Eigener Programmpfad für Firefox',
          'Leer lassen = automatisch erkennen',
        ) +
        text(61, 337, 'Der portable Firefox liegt unter runtime/firefox.', 21) +
        button(61, 372, 208, 'Browser testen') +
        lines(
          61,
          467,
          [
            'Eigene Pfade erst nach erfolgreichem Test',
            'mit „Einstellungen speichern“ übernehmen.',
          ],
          21,
        ) +
        card(702, 115, 380, 457, 'Darstellung') +
        text(727, 192, 'Darkmode', 23, 700) +
        `<rect x="970" y="166" width="80" height="39" rx="20" fill="${colors.green}"/><circle cx="1030" cy="185.5" r="15" fill="#fff"/>` +
        box(727, 238, 330, 246, '#15271f', '#365a48') +
        text(747, 286, 'WebScreenshotter', 25, 700, '#eef8f0') +
        text(747, 333, 'Dunkle Darstellung', 22, 400, '#cadfd1') +
        text(747, 380, 'Wird sofort angewendet.', 20, 400, '#cadfd1') +
        text(747, 427, 'Bleibt im Browser erhalten.', 19, 400, '#cadfd1') +
        text(
          38,
          610,
          'Die Oberfläche öffnet sich im Standardbrowser. Den Aufnahme-Browser wählen Sie separat.',
          21,
        ),
    ),
  ];
  for (const item of illustrations)
    await writeFile(path.join(imageDirectory, `${item.name}.svg`), item.source, 'utf8');

  // Small renderer for this trusted README only. No user input or runtime dependency.
  // It supports headings, flat lists, tables, links, images, inline code and fenced code.
  const markdown = await readFile(path.join(root, 'README.md'), 'utf8');
  const inline = (source) => {
    const tokens = [];
    const protect = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
    let result = source.replace(/`([^`]+)`/g, (_, code) => protect(`<code>${escape(code)}</code>`));
    result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) =>
      protect(`<figure><img src="${escape(url)}" alt="${escape(alt)}" loading="lazy"/></figure>`),
    );
    result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
      protect(`<a href="${escape(url)}">${escape(label)}</a>`),
    );
    result = escape(result).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return result.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
  };
  const anchor = (heading) =>
    heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N} -]/gu, '')
      .replaceAll(' ', '-');
  const rows = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index];
    if (!row.trim()) {
      index++;
      continue;
    }
    if (row.startsWith('```')) {
      const code = [];
      index++;
      while (index < rows.length && !rows[index].startsWith('```')) code.push(rows[index++]);
      index++;
      blocks.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = row.match(/^(#{1,6}) (.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level} id="${anchor(heading[2])}">${inline(heading[2])}</h${level}>`);
      index++;
      continue;
    }
    if (row.startsWith('|') && /^\|[ :|-]+\|$/.test(rows[index + 1] || '')) {
      const cells = (value, tag) =>
        value
          .trim()
          .slice(1, -1)
          .split('|')
          .map((cell) => `<${tag}>${inline(cell.trim())}</${tag}>`)
          .join('');
      const header = cells(row, 'th');
      const body = [];
      index += 2;
      while (index < rows.length && rows[index].startsWith('|'))
        body.push(`<tr>${cells(rows[index++], 'td')}</tr>`);
      blocks.push(
        `<div class="table-scroll" role="region" aria-label="Tabelle" tabindex="0"><table><thead><tr>${header}</tr></thead><tbody>${body.join('')}</tbody></table></div>`,
      );
      continue;
    }
    if (/^(?:- |\d+\. )/.test(row)) {
      const ordered = /^\d+\. /.test(row);
      const matcher = ordered ? /^\d+\. / : /^- /;
      const items = [];
      while (index < rows.length && matcher.test(rows[index]))
        items.push(`<li>${inline(rows[index++].replace(matcher, ''))}</li>`);
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    if (row.startsWith('> ')) {
      const quote = [];
      while (index < rows.length && rows[index].startsWith('> '))
        quote.push(rows[index++].slice(2));
      blocks.push(`<aside class="note">${inline(quote.join(' '))}</aside>`);
      continue;
    }
    if (row.startsWith('![')) {
      blocks.push(inline(row));
      index++;
      continue;
    }
    const paragraph = [];
    while (index < rows.length && rows[index].trim()) paragraph.push(rows[index++]);
    blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>WebScreenshotter – Anleitung</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,"Segoe UI",sans-serif;line-height:1.65;color:#18382d;background:#f4f7f4}
*{box-sizing:border-box}body{max-width:1120px;margin:auto;padding:2rem}main{background:#fff;padding:clamp(1rem,4vw,3rem);border-radius:1rem}
h1,h2,h3{line-height:1.3;scroll-margin-top:1rem;overflow-wrap:anywhere}h1{font-size:2.1rem}h2{font-size:1.6rem;margin-top:2.8rem;border-bottom:1px solid #c2d3c7;padding-bottom:.5rem}h3{font-size:1.2rem;margin-top:2rem}
a{color:#11623f;text-underline-offset:.18em;overflow-wrap:anywhere}a:focus-visible,[tabindex]:focus-visible{outline:3px solid #bd5b16;outline-offset:4px}
code,pre{font-family:Consolas,monospace}code{background:#eef3ee;padding:.1em .3em;border-radius:.25rem;overflow-wrap:anywhere}pre{background:#edf3ef;padding:1rem;overflow:auto;border-radius:.5rem}pre code{padding:0;white-space:pre}
figure{margin:1.5rem 0}img{display:block;width:100%;height:auto;border:1px solid #bdcfc2;border-radius:.6rem;background:#f3f7f4}
table{border-collapse:collapse;width:100%;font-size:.95rem}th,td{border:1px solid #bdcfc2;padding:.65rem;vertical-align:top;text-align:left}th{background:#e5eee7}.table-scroll{overflow:auto;margin:1rem 0}
li{margin:.35rem 0}.note{border-left:4px solid #176348;background:#eaf3ed;padding:1rem;margin:1.5rem 0}
.skip{display:block;margin-bottom:1rem}@media(max-width:600px){body{padding:.5rem}}
@media(prefers-color-scheme:dark){:root{color:#e0eee4;background:#101e18}main{background:#192c23}a{color:#8be0ac}code,pre{background:#243d30}.note,th{background:#294233}th,td{border-color:#526b5c}}
@media print{body,main{background:white;color:black;padding:0;max-width:none}.skip{display:none}a{color:black}h2,h3{break-after:avoid}figure,pre,tr{break-inside:avoid}pre{white-space:pre-wrap}}
</style></head><body><a class="skip" href="#anleitung-inhalt">Zum Inhalt springen</a><main id="anleitung-inhalt" tabindex="-1">${blocks.join('\n')}</main></body></html>\n`;
  await writeFile(path.join(root, 'ANLEITUNG.html'), html, 'utf8');
  console.log('Sechs SVG-Bedienhilfen und ANLEITUNG.html aus README.md erzeugt.');
}

await buildDocumentation();
