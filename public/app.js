/** Browser-side controller. The server owns jobs and files; this module owns
 * form state, DOM rendering, keyboard focus and event-stream subscriptions.
 * User-provided values enter the DOM through textContent, never innerHTML.
 */
import { decodeUrlText, mergeUrlLists, MAX_URL_IMPORT_BYTES } from './url-import.js';

const queryElement = (selector) => document.querySelector(selector);
const captureForm = queryElement('#capture-form');
const captureField = (name) => captureForm.elements.namedItem(name);
const TERMINAL_STATUSES = ['completed', 'cancelled', 'failed'];
const JOB_STATUS_LABELS = {
  preparing: 'Vorbereitung',
  running: 'Aufnahme läuft',
  waiting: 'Wartezeit',
  finalizing: 'Dokumentation wird gespeichert',
  stopping: 'Wird beendet',
  completed: 'Abgeschlossen',
  cancelled: 'Abgebrochen',
  failed: 'Fehlgeschlagen',
};
const DUBLIN_CORE_LABELS = {
  title: 'Titel',
  creator: 'Urheber',
  subject: 'Thema / Schlagwort',
  description: 'Beschreibung',
  publisher: 'Herausgeber',
  contributor: 'Mitwirkende',
  date: 'Datum',
  type: 'Ressourcentyp',
  format: 'Format',
  identifier: 'Kennung',
  source: 'Quelle',
  language: 'Sprache',
  relation: 'Beziehung',
  coverage: 'Räumlicher / zeitlicher Bezug',
  rights: 'Rechte',
};
let sessionToken = '';
let availableBrowsers = [];
let currentJob = null;
let eventSource;
let isConnected = false;
let isSubmitting = false;
let isImportingUrls = false;
let folderState = null;
let folderRequest = 0;
let previewController;
let saveTimer;
let toastReturnFocus;
let lastAnnouncement = '';
let renderedResultsKey = '';

function createElement(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function showError(message) {
  queryElement('#form-error').textContent = message;
  queryElement('#form-error').hidden = !message;
  if (message) queryElement('#form-error').focus();
}

// Messages remain available until dismissed, including for readers who need time.
function showToast(message) {
  if (!queryElement('#toast').contains(document.activeElement))
    toastReturnFocus = document.activeElement;
  queryElement('#toast-message').textContent = message;
  queryElement('#toast').hidden = false;
}
queryElement('#toast-close').addEventListener('click', () => {
  queryElement('#toast').hidden = true;
  if (toastReturnFocus?.isConnected) toastReturnFocus.focus();
});

/** The theme is a browser preference, independent of browser executable paths. */
function initializeTheme() {
  const darkModeSwitch = queryElement('#dark-mode');
  darkModeSwitch.checked = document.documentElement.dataset.theme === 'dark';
  darkModeSwitch.addEventListener('change', () => {
    const theme = darkModeSwitch.checked ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('screenshotter.theme.v1', theme);
      queryElement('#theme-message').textContent =
        `${theme === 'dark' ? 'Darkmode' : 'Heller Modus'} aktiviert und gespeichert.`;
    } catch {
      queryElement('#theme-message').textContent =
        'Darstellung geändert. Dieser Browser erlaubt kein dauerhaftes Speichern.';
    }
  });
  addEventListener('storage', (event) => {
    if (event.key !== 'screenshotter.theme.v1') return;
    const theme = event.newValue === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    darkModeSwitch.checked = theme === 'dark';
  });
}

async function apiRequest(route, { method = 'GET', data, signal } = {}) {
  const response = await fetch(`/api${route}`, {
    method,
    headers: {
      'X-Screenshotter-Token': sessionToken,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

function readMetadataFields() {
  return [...document.querySelectorAll('.metadata-row')].map((row) => ({
    term: row.querySelector('select').value,
    value: row.querySelector('input').value,
  }));
}

/** Convert DOM strings/checkboxes to the typed request accepted by validation.js. */
function configFromForm() {
  const data = Object.fromEntries(new FormData(captureForm));
  for (const name of [
    'width',
    'height',
    'quality',
    'startNumber',
    'padding',
    'delay',
    'delayMin',
    'delayMax',
    'settleTime',
    'timeout',
    'retries',
    'retryDelay',
    'retryDelayMin',
    'retryDelayMax',
  ])
    data[name] = Number(captureField(name).value);
  data.fullPage = captureField('fullPage').checked;
  // Disabled retry fields still belong to the saved draft and configuration.
  data.retryDelayMode = captureField('retryDelayMode').value;
  data.lazyLoad = captureField('lazyLoad').checked;
  data.combinePdf = captureField('format').value === 'pdf' && captureField('combinePdf').checked;
  data.metadata = readMetadataFields();
  return data;
}

function saveDraft() {
  if (queryElement('#capture-fields').disabled) return;
  try {
    localStorage.setItem('screenshotter.draft.v1', JSON.stringify(configFromForm()));
  } catch {
    /* Browser storage may be disabled; capturing remains available. */
  }
}

/** Drafts are optional; an unreadable draft must not stop application startup. */
function restoreDraft() {
  try {
    const data = JSON.parse(localStorage.getItem('screenshotter.draft.v1') || 'null');
    if (!data || typeof data !== 'object') return;
    for (const [name, value] of Object.entries(data)) {
      if (name === 'metadata') continue;
      const input = captureField(name);
      if (!input) continue;
      if (input instanceof HTMLInputElement && input.type === 'checkbox')
        input.checked = value === true;
      else if (typeof value === 'string' || typeof value === 'number') input.value = value;
    }
    if (Array.isArray(data.metadata))
      data.metadata.slice(0, 100).forEach((item) => {
        if (Object.hasOwn(DUBLIN_CORE_LABELS, item.term)) addMetadata(item.term, item.value);
      });
  } catch {
    /* An invalid draft must not prevent app startup. */
  }
}

/** Dynamic fields retain labels and return keyboard focus when removed. */
function addMetadata(term = 'subject', value = '') {
  if (queryElements('.metadata-row').length >= 100)
    return showToast('Höchstens 100 zusätzliche Felder sind möglich.');
  const row = createElement('div', 'metadata-row');
  const labelTerm = createElement('label', '', 'Dublin-Core-Feld');
  const select = createElement('select');
  for (const [key, label] of Object.entries(DUBLIN_CORE_LABELS))
    select.add(new Option(`${label} · dc:${key}`, key));
  select.value = term;
  labelTerm.append(select);
  const labelValue = createElement('label', '', 'Wert');
  const input = createElement('input');
  input.type = 'text';
  input.maxLength = 10000;
  input.value = value;
  input.placeholder = 'Metadatenwert';
  labelValue.append(input);
  const remove = createElement('button', 'icon-button', '×');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Metadatenfeld entfernen');
  remove.addEventListener('click', () => {
    const nextFocus =
      row.nextElementSibling?.querySelector('select') ||
      row.previousElementSibling?.querySelector('select') ||
      queryElement('#add-metadata');
    row.remove();
    nextFocus.focus();
    saveDraft();
  });
  row.append(labelTerm, labelValue, remove);
  queryElement('#metadata-fields').append(row);
  return input;
}

function queryElements(selector) {
  return [...document.querySelectorAll(selector)];
}

/** Both native file selection and drag/drop use the same atomic import path. */
async function importUrlFiles(selectedFiles) {
  const files = [...selectedFiles];
  if (!files.length || isImportingUrls) return;
  const message = queryElement('#url-import-message');
  if (queryElement('#capture-fields').disabled) {
    showToast('Bitte den laufenden Auftrag abwarten, bevor URLs importiert werden.');
    return;
  }
  isImportingUrls = true;
  updateControls();
  message.className = 'inline-message';
  message.textContent = 'TXT-Dateien werden eingelesen …';
  try {
    if (files.reduce((total, file) => total + file.size, 0) > MAX_URL_IMPORT_BYTES)
      throw new Error('Die ausgewählten TXT-Dateien dürfen zusammen höchstens 2 MiB groß sein.');
    if (files.some((file) => !/\.txt$/i.test(file.name)))
      throw new Error('Bitte nur Dateien mit der Endung .txt auswählen.');
    const importedFiles = [];
    for (const file of files) {
      importedFiles.push({ name: file.name, text: decodeUrlText(await file.arrayBuffer()) });
    }
    const result = mergeUrlLists(captureField('urls').value, importedFiles);
    captureField('urls').value = result.value;
    message.textContent = `${result.added} URLs hinzugefügt, ${result.duplicates} Duplikate übersprungen. Insgesamt ${result.count} URLs.`;
    saveDraft();
  } catch (error) {
    message.className = 'inline-message error';
    message.textContent = `${error.message} Die vorhandene Eingabe wurde nicht verändert.`;
  } finally {
    isImportingUrls = false;
    queryElement('#url-file-input').value = '';
    updateControls();
  }
}

const urlDropZone = queryElement('#url-drop-zone');
let dragDepth = 0;
const containsFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
queryElement('#url-file-input').addEventListener('change', (event) =>
  importUrlFiles(event.target.files),
);
urlDropZone.addEventListener('dragenter', (event) => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  urlDropZone.classList.add('drag-active');
});
urlDropZone.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) urlDropZone.classList.remove('drag-active');
});
urlDropZone.addEventListener('dragover', (event) => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
});
urlDropZone.addEventListener('drop', (event) => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  event.stopPropagation();
  dragDepth = 0;
  urlDropZone.classList.remove('drag-active');
  importUrlFiles(event.dataTransfer.files);
});
// A misplaced file must never navigate away from an unsaved capture form.
window.addEventListener('dragover', (event) => {
  if (containsFiles(event)) event.preventDefault();
});
window.addEventListener('drop', (event) => {
  if (!containsFiles(event)) return;
  event.preventDefault();
  showToast('TXT-Dateien bitte im Bereich Website-Adressen ablegen.');
});

/** Keep visibility, disabled state and native form validation in sync. */
function updateControls() {
  const sitemap = captureField('inputMode').value === 'sitemap';
  queryElement('#urls-panel').hidden = sitemap;
  queryElement('#sitemap-panel').hidden = !sitemap;
  captureField('urls').required = !sitemap;
  captureField('sitemapUrl').required = sitemap;
  captureField('sitemapUrl').disabled = !sitemap;
  captureField('urls').disabled = sitemap;
  queryElement('#url-file-input').disabled = sitemap || isImportingUrls;
  const urls = [
    ...new Set(
      captureField('urls')
        .value.split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  queryElement('#url-count').textContent = sitemap
    ? 'Sitemap'
    : `${urls.length} ${urls.length === 1 ? 'URL' : 'URLs'}`;
  const random = captureField('delayMode').value === 'random';
  queryElement('#fixed-delay').hidden = random;
  queryElement('#random-delay').hidden = !random;
  captureField('delay').disabled = random;
  captureField('delayMin').disabled = !random;
  captureField('delayMax').disabled = !random;
  captureField('delayMax').setCustomValidity(
    random && Number(captureField('delayMax').value) < Number(captureField('delayMin').value)
      ? 'Die maximale Pause muss mindestens so groß wie die minimale Pause sein.'
      : '',
  );
  const retriesEnabled = Number(captureField('retries').value) > 0;
  const randomRetry = captureField('retryDelayMode').value === 'random';
  queryElement('#retry-options').hidden = !retriesEnabled;
  queryElement('#retry-options').disabled = !retriesEnabled;
  queryElement('#fixed-retry-delay').hidden = randomRetry;
  queryElement('#random-retry-delay').hidden = !randomRetry;
  captureField('retryDelay').disabled = !retriesEnabled || randomRetry;
  captureField('retryDelayMin').disabled = !retriesEnabled || !randomRetry;
  captureField('retryDelayMax').disabled = !retriesEnabled || !randomRetry;
  captureField('retryDelayMax').setCustomValidity(
    retriesEnabled &&
      randomRetry &&
      Number(captureField('retryDelayMax').value) < Number(captureField('retryDelayMin').value)
      ? 'Die maximale Wiederholungswartezeit muss mindestens so groß wie die minimale sein.'
      : '',
  );
  captureField('lazyLoad').disabled = !captureField('fullPage').checked;
  const format = captureField('format').value;
  queryElement('#pdf-options').hidden = format !== 'pdf';
  captureField('combinePdf').disabled = format !== 'pdf';
  queryElement('#quality-field').hidden = format !== 'jpg';
  captureField('quality').disabled = format !== 'jpg';
  queryElement('#format-hint').textContent = {
    png: 'PNG bewahrt die Bilddaten ohne Qualitätsverlust.',
    jpg: 'JPEG komprimiert mit einstellbarer Qualität; dabei gehen Bilddetails verloren.',
    tif: 'Unkomprimiertes RGBA-TIFF. Verlustfrei, mit entsprechend größeren Dateien.',
    pdf: 'Die Aufnahme wird auf Bildseiten im A4-Verhältnis verteilt. Kein PDF/A und kein durchsuchbarer Text.',
  }[format];
  const count = String(captureField('startNumber').value || '0').padStart(
    Math.max(1, Math.min(12, Number(captureField('padding').value) || 1)),
    '0',
  );
  queryElement('#filename-preview').textContent =
    format === 'pdf' && captureField('combinePdf').checked
      ? 'gesamt.pdf'
      : `${captureField('prefix').value}${count}${captureField('suffix').value}.${format}`;
  updateStartButton();
}

function updateStartButton() {
  const active = currentJob && !TERMINAL_STATUSES.includes(currentJob.status);
  queryElement('#capture-fields').disabled = Boolean(active);
  queryElement('#start-button').disabled =
    !isConnected ||
    isSubmitting ||
    isImportingUrls ||
    Boolean(active) ||
    !availableBrowsers.some(
      (browser) => browser.id === captureField('browser').value && browser.available,
    );
  queryElement('#start-button').replaceChildren(
    createElement('span', '', active ? '◷' : '▶'),
    document.createTextNode(
      active ? ' Auftrag läuft' : isSubmitting ? ' Auftrag wird angelegt …' : ' Aufnahme starten',
    ),
  );
}

/** Render detection results without inserting filesystem values as HTML. */
function renderBrowsers(list) {
  availableBrowsers = list;
  const selected = captureField('browser').value;
  const select = queryElement('#browser-select');
  select.replaceChildren();
  for (const browser of list.filter((item) => item.id !== 'safari')) {
    const option = new Option(
      `${browser.name}${browser.available ? ' · verfügbar' : ' · nicht verfügbar'}`,
      browser.id,
    );
    option.disabled = !browser.available;
    select.add(option);
  }
  // Preserve explicit choices; local definitions may opt out of auto-selection.
  const preferred =
    list.find((browser) => browser.id === selected && browser.available) ||
    list.find((browser) => browser.available && browser.autoSelect !== false);
  select.value = preferred?.id || '';
  if (!preferred) {
    const prompt = list.some((browser) => browser.available)
      ? 'Bitte einen verfügbaren Aufnahme-Browser wählen'
      : 'Kein Browser gefunden – bitte Einstellungen öffnen';
    const option = new Option(prompt, '');
    select.prepend(option);
    select.value = '';
  }
  queryElement('#browser-settings').replaceChildren();
  for (const browser of list) {
    const row = createElement('section', 'browser-setting');
    row.setAttribute('aria-label', browser.name);
    const head = createElement('div', 'browser-setting-head');
    head.append(
      createElement(
        'span',
        'browser-symbol',
        { chrome: '◉', edge: 'e', firefox: '◔', safari: '◈' }[browser.id],
      ),
      createElement('strong', '', browser.name),
      createElement(
        'span',
        `browser-status${browser.available ? '' : ' unavailable'}`,
        browser.available
          ? '● Verfügbar'
          : browser.id === 'safari'
            ? 'Kein Headless-Modus'
            : 'Nicht verfügbar',
      ),
    );
    const pathRow = createElement('div', 'browser-path-row');
    const label = createElement('label', '', `Eigener Programmpfad für ${browser.name}`);
    const input = createElement('input');
    input.name = browser.id;
    input.value = browser.customPath;
    input.placeholder = browser.detectedPath || 'Vollständiger Pfad zur Browserdatei';
    input.autocomplete = 'off';
    label.append(input);
    pathRow.append(label);
    const test = createElement('button', 'secondary-button', 'Browser testen');
    test.setAttribute('aria-label', `${browser.name}: Browser testen`);
    test.type = 'button';
    test.disabled = browser.id === 'safari';
    const note = createElement(
      'p',
      'browser-note',
      browser.reason || `Automatisch erkannt: ${browser.detectedPath || '–'}`,
    );
    note.setAttribute('role', 'status');
    test.addEventListener('click', async () => {
      test.disabled = true;
      note.textContent = 'Browser wird gestartet und eine Testaufnahme erzeugt …';
      try {
        const result = await apiRequest('/browser-test', {
          method: 'POST',
          data: {
            browser: browser.id,
            browserPaths: Object.fromEntries(new FormData(queryElement('#settings-form'))),
          },
        });
        note.textContent = `${result.version} · Testaufnahme erfolgreich (${result.screenshotBytes.toLocaleString('de-DE')} Bytes) · ${result.userAgent}`;
      } catch (error) {
        note.textContent = `Test fehlgeschlagen: ${error.message}`;
      } finally {
        test.disabled = false;
      }
    });
    pathRow.append(test);
    row.append(head, pathRow, note);
    queryElement('#browser-settings').append(row);
  }
  updateStartButton();
}

function fileLink(job, file, label) {
  const link = createElement('a', '', label);
  link.href = `/api/jobs/${job.id}/files/${file.split('/').map(encodeURIComponent).join('/')}?token=${encodeURIComponent(sessionToken)}&download=1`;
  link.setAttribute('download', file.split('/').pop());
  return link;
}

function excelExportButton(job, links) {
  const button = createElement('button', 'secondary-button', 'Als Excel exportieren (.xlsx)');
  button.type = 'button';
  button.disabled = !job.processed;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Excel-Datei wird erstellt …';
    try {
      const result = await apiRequest(`/jobs/${job.id}/export-excel`, { method: 'POST', data: {} });
      job.excelWritten = true;
      let link = links.querySelector('[data-excel-download]');
      if (!link) {
        link = fileLink(job, result.filename, '↓ aufnahmen.xlsx');
        link.dataset.excelDownload = 'true';
        links.append(link);
      }
      link.click();
      showToast('Excel-Übersicht im Ausgabeordner gespeichert. Der Download wurde gestartet.');
    } catch (error) {
      showToast(`Excel-Export fehlgeschlagen: ${error.message}`);
    } finally {
      button.disabled = !job.processed;
      button.textContent = 'Als Excel exportieren (.xlsx)';
    }
  });
  return button;
}

function renderJob(job) {
  // Announce milestones only. The half-second countdown must not flood speech.
  const announcementKey = `${job.id}:${job.status}:${job.processed}:${job.currentAttempt}`;
  if (announcementKey !== lastAnnouncement) {
    queryElement('#job-announcement').textContent =
      `${JOB_STATUS_LABELS[job.status] || job.status}. ${job.processed} von ${job.total} bearbeitet, ${job.succeeded} gespeichert, ${job.failed} Fehler.`;
    if (job.currentAttempt > 1)
      queryElement('#job-announcement').textContent +=
        ` Wiederholung ${job.currentAttempt - 1} von ${job.maxAttempts - 1}.`;
    lastAnnouncement = announcementKey;
  }
  currentJob = job;
  const finished = TERMINAL_STATUSES.includes(job.status);
  queryElement('#job-state').textContent = JOB_STATUS_LABELS[job.status] || job.status;
  queryElement('#status-light').className = `status-light ${job.status}`;
  queryElement('#stop-button').hidden = finished;
  queryElement('#stop-button').disabled = job.status === 'stopping';
  const processed = job.processed || 0;
  queryElement('#progress-count').replaceChildren(
    document.createTextNode(String(processed)),
    createElement('span', '', ` / ${job.total}`),
  );
  queryElement('#progress-bar').value = job.total ? (processed / job.total) * 100 : 0;
  queryElement('#progress-title').textContent =
    job.status === 'completed'
      ? job.failed
        ? `Verarbeitung beendet · ${job.failed} fehlgeschlagene Aufnahme${job.failed === 1 ? '' : 'n'}`
        : job.warnings
          ? 'Verarbeitung beendet · bitte Warnungen prüfen'
          : 'Alle Aufnahmen abgeschlossen'
      : `${JOB_STATUS_LABELS[job.status] || job.status} · ${job.collection}`;
  queryElement('#progress-detail').textContent = finished
    ? `${job.succeeded} gespeichert · ${job.total - processed} noch nicht bearbeitet`
    : job.currentUrl
      ? `${job.currentUrl}${job.currentAttempt ? ` · Versuch ${job.currentAttempt} von ${job.maxAttempts}` : ''}`
      : 'Auftrag wird vorbereitet …';
  if (job.status === 'waiting') updateCountdown();
  const log = queryElement('#log');
  const follow = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const rows = job.logs.map((entry) => {
    const row = createElement('div', `log-row ${entry.level}`);
    const time = createElement('time', '', new Date(entry.time).toLocaleTimeString('de-DE'));
    time.dateTime = entry.time;
    row.append(time, createElement('span', '', entry.message));
    return row;
  });
  log.replaceChildren(...rows);
  if (follow) log.scrollTop = log.scrollHeight;
  const summary = queryElement('#result-summary');
  summary.hidden = !processed;
  summary.replaceChildren(
    createElement('span', '', `${job.succeeded} gespeichert`),
    createElement('span', job.failed ? 'has-errors' : '', `${job.failed} Fehler`),
    createElement('span', job.warnings ? 'has-warnings' : '', `${job.warnings} Warnungen`),
  );
  if (job.cancelledCount)
    summary.append(createElement('span', 'has-warnings', `${job.cancelledCount} abgebrochen`));
  queryElement('#job-error').textContent = [
    job.error,
    job.logError,
    job.combinedPdfError,
    job.cleanupWarning,
  ]
    .filter(Boolean)
    .join(' ');
  queryElement('#job-error').hidden = !queryElement('#job-error').textContent;
  const files = queryElement('#result-files');
  files.hidden = !finished;
  const resultsKey = `${job.id}:${job.status}:${job.metadataWritten}:${job.excelWritten}:${job.combinedPdf?.filename}`;
  if (finished && resultsKey !== renderedResultsKey) {
    renderedResultsKey = resultsKey;
    const links = createElement('div', 'download-links');
    if (job.combinedPdf)
      links.append(
        fileLink(
          job,
          job.combinedPdf.filename,
          `Gesamt-PDF herunterladen (${job.combinedPdf.pageCount} Seiten)`,
        ),
      );
    if (job.metadataWritten)
      for (const filename of ['mets.xml', 'manifest.json', 'checksums.sha256', 'protokoll.jsonl'])
        links.append(fileLink(job, filename, `↓ ${filename}`));
    if (job.excelWritten) {
      const link = fileLink(job, 'aufnahmen.xlsx', '↓ aufnahmen.xlsx');
      link.dataset.excelDownload = 'true';
      links.append(link);
    }
    const path = createElement('p', '', `Gespeichert in: ${job.outputDir}`);
    const excelHelp = createElement(
      'p',
      '',
      'Excel enthält alle bearbeiteten URLs. Datum und Uhrzeit werden in der Zeitzone dieses PCs ausgegeben.',
    );
    files.replaceChildren(path, excelExportButton(job, links), excelHelp, links);
  }
  queryElement('#results-details').hidden = !job.records.length;
  queryElement('#results-body').replaceChildren(
    ...job.records.map((record) => {
      const row = createElement('tr');
      const source = createElement('td');
      source.append(
        createElement('div', '', record.title || record.requestedUrl),
        createElement('small', '', record.requestedUrl),
      );
      if (record.filePath) {
        const label = record.pdfPages
          ? `↓ Gesamt-PDF · Seiten ${record.pdfPages.first}–${record.pdfPages.last}`
          : `↓ ${record.filename}${record.temporaryPdf ? ' (Zwischenstand)' : ''}`;
        source.append(fileLink(job, record.filePath, label));
      }
      if (record.error) source.append(createElement('small', '', record.error));
      if (record.warnings?.length)
        source.append(createElement('small', '', record.warnings.join(' ')));
      if (record.attemptCount > 1)
        source.append(createElement('small', '', `${record.attemptCount} Versuche dokumentiert.`));
      if (record.retryInterrupted)
        source.append(createElement('small', '', 'Weitere Wiederholungen wurden beendet.'));
      row.append(
        createElement('td', '', String(record.sequence)),
        source,
        createElement('td', '', String(record.httpStatus ?? '–')),
        createElement(
          'td',
          '',
          record.pending
            ? 'Wiederholung läuft'
            : {
                success: 'Gespeichert',
                warning: 'Warnung',
                failure: 'Fehler',
                cancelled: 'Abgebrochen',
              }[record.outcome] || record.outcome,
        ),
      );
      return row;
    }),
  );
  updateStartButton();
}

function updateCountdown() {
  if (currentJob?.status !== 'waiting' || !currentJob.nextAt) return;
  const remaining = Math.max(0, Math.ceil((Date.parse(currentJob.nextAt) - Date.now()) / 1000));
  queryElement('#progress-detail').textContent =
    currentJob.waitReason === 'retry'
      ? `Wiederholung ${currentJob.currentAttempt - 1} von ${currentJob.maxAttempts - 1} in ${remaining.toLocaleString('de-DE')} Sekunden.`
      : `Nächster Seitenaufruf in ${remaining.toLocaleString('de-DE')} Sekunden.`;
}
setInterval(updateCountdown, 500);

function setConnection(online) {
  isConnected = online;
  queryElement('#connection-dot').className = `online-dot${online ? '' : ' offline'}`;
  queryElement('#connection-text').textContent = online
    ? 'Lokaler Dienst verbunden'
    : 'Verbindung unterbrochen';
  updateStartButton();
}

/** EventSource reconnects automatically; bootstrap recovers the latest job snapshot. */
function connectEvents() {
  eventSource?.close();
  eventSource = new EventSource(`/api/events?token=${encodeURIComponent(sessionToken)}`);
  eventSource.addEventListener('open', () => setConnection(true));
  eventSource.addEventListener('error', () => setConnection(false));
  eventSource.addEventListener('ready', (event) => {
    const jobs = JSON.parse(event.data);
    const recent = jobs.find((job) => !TERMINAL_STATUSES.includes(job.status)) || jobs.at(-1);
    if (recent) renderJob(recent);
  });
  eventSource.addEventListener('job', (event) => {
    const job = JSON.parse(event.data);
    if (!currentJob || job.startedAt >= currentJob.startedAt) renderJob(job);
  });
}

function showActiveView({ moveFocus = false } = {}) {
  // The skip link is an in-page anchor, not navigation to another application view.
  if (location.hash === '#main') {
    queryElement('#main').focus();
    return;
  }
  const settings = location.hash === '#einstellungen';
  queryElement('#capture-view').hidden = settings;
  queryElement('#settings-view').hidden = !settings;
  queryElement('#page-crumb').textContent = settings ? 'Browser & Einstellungen' : 'Neue Aufnahme';
  queryElements('[data-view]').forEach((link) => {
    const active = link.dataset.view === (settings ? 'settings' : 'capture');
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (moveFocus) queryElement(settings ? '#settings-title' : '#capture-title').focus();
}
addEventListener('hashchange', () => showActiveView({ moveFocus: true }));

/** Ignore late directory replies so rapid navigation cannot select a stale path. */
async function browseFolder(directory) {
  const request = ++folderRequest;
  const restoreFolderFocus =
    queryElement('#folder-list').contains(document.activeElement) ||
    queryElement('#folder-roots').contains(document.activeElement);
  queryElement('#folder-message').textContent = 'Ordner werden geladen …';
  queryElement('#folder-select').disabled = true;
  try {
    const data = await apiRequest(
      `/directories${directory ? `?path=${encodeURIComponent(directory)}` : ''}`,
    );
    if (request !== folderRequest) return;
    folderState = data;
    queryElement('#folder-path').value = data.current;
    queryElement('#folder-up').disabled = data.parent === data.current;
    queryElement('#folder-list').replaceChildren(
      ...data.directories.map((dir) => {
        const button = createElement('button', 'folder-item');
        button.type = 'button';
        button.append(createElement('span', '', '▱'), document.createTextNode(dir.name));
        button.addEventListener('click', () => browseFolder(dir.path));
        return button;
      }),
    );
    queryElement('#folder-roots').replaceChildren(
      ...[...new Set([data.home, ...data.roots])].map((root) => {
        const button = createElement(
          'button',
          'secondary-button',
          root === data.home ? 'Benutzerordner' : root,
        );
        button.type = 'button';
        button.addEventListener('click', () => browseFolder(root));
        return button;
      }),
    );
    queryElement('#folder-message').textContent = data.truncated
      ? 'Die ersten 1.000 Unterordner werden angezeigt. Weitere Pfade können direkt eingegeben werden.'
      : data.directories.length
        ? `${data.directories.length} Unterordner`
        : 'Dieser Ordner enthält keine sichtbaren Unterordner.';
    queryElement('#folder-select').disabled = false;
    if (restoreFolderFocus) queryElement('#folder-path').focus();
  } catch (error) {
    if (request === folderRequest)
      queryElement('#folder-message').textContent = `Ordner nicht zugänglich: ${error.message}`;
  }
}

queryElement('#choose-folder').addEventListener('click', async () => {
  queryElement('#folder-dialog').showModal();
  await browseFolder(captureField('outputDir').value);
});
queryElement('#folder-up').addEventListener('click', () => browseFolder(folderState?.parent));
queryElement('#folder-go').addEventListener('click', () =>
  browseFolder(queryElement('#folder-path').value),
);
queryElement('#folder-path').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    browseFolder(event.target.value);
  }
});
queryElement('#folder-select').addEventListener('click', () => {
  if (!folderState) return;
  captureField('outputDir').value = folderState.current;
  queryElement('#folder-dialog').close();
  saveDraft();
});
queryElements('[data-close]').forEach((button) =>
  button.addEventListener('click', () => document.getElementById(button.dataset.close).close()),
);
queryElement('#help-open').addEventListener('click', () =>
  queryElement('#help-dialog').showModal(),
);
queryElement('#add-metadata').addEventListener('click', () => {
  addMetadata()?.focus();
  saveDraft();
});
captureForm.addEventListener('input', () => {
  updateControls();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 300);
});
captureForm.addEventListener('change', () => {
  updateControls();
  saveDraft();
});
// Native validation can otherwise try to focus a field inside a closed details.
captureForm.addEventListener(
  'invalid',
  (event) => {
    const disclosure = event.target.closest('details');
    if (disclosure) disclosure.open = true;
  },
  true,
);
captureField('sitemapUrl').addEventListener('input', () => {
  previewController?.abort();
  queryElement('#sitemap-result').textContent = '';
});

queryElement('#sitemap-preview').addEventListener('click', async () => {
  const button = queryElement('#sitemap-preview');
  const result = queryElement('#sitemap-result');
  if (!captureField('sitemapUrl').reportValidity()) return;
  previewController?.abort();
  previewController = new AbortController();
  button.disabled = true;
  result.className = 'inline-message';
  result.textContent = 'Sitemap wird eingelesen …';
  try {
    const data = await apiRequest('/sitemap', {
      method: 'POST',
      data: { url: captureField('sitemapUrl').value },
      signal: previewController.signal,
    });
    result.textContent = `${data.count.toLocaleString('de-DE')} eindeutige URLs in ${data.sources.length} Sitemap-Dateien gefunden. Erste URL: ${data.urls[0]}`;
    queryElement('#url-count').textContent = `${data.count.toLocaleString('de-DE')} URLs`;
  } catch (error) {
    if (error.name !== 'AbortError') {
      result.className = 'inline-message error';
      result.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
});

captureForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');
  if (isSubmitting || (currentJob && !TERMINAL_STATUSES.includes(currentJob.status))) return;
  if (!captureForm.reportValidity()) return;
  saveDraft();
  const config = configFromForm();
  isSubmitting = true;
  updateStartButton();
  try {
    const job = await apiRequest('/jobs', { method: 'POST', data: config });
    // A running job may already have emitted a more recent event than the POST reply.
    if (currentJob?.id !== job.id) renderJob(job);
    queryElement('#status-heading').focus({ preventScroll: true });
    queryElement('#status-section').scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  } catch (error) {
    showError(error.message);
  } finally {
    isSubmitting = false;
    updateStartButton();
  }
});
queryElement('#stop-button').addEventListener('click', async () => {
  if (!currentJob) return;
  queryElement('#stop-button').disabled = true;
  try {
    renderJob(await apiRequest(`/jobs/${currentJob.id}/stop`, { method: 'POST', data: {} }));
  } catch (error) {
    showToast(error.message);
    queryElement('#stop-button').disabled = false;
  }
});
queryElement('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const message = queryElement('#settings-message');
  button.disabled = true;
  message.textContent = '';
  message.className = 'inline-message';
  try {
    const data = await apiRequest('/settings', {
      method: 'PUT',
      data: { browserPaths: Object.fromEntries(new FormData(event.target)) },
    });
    renderBrowsers(data.browsers);
    message.textContent = 'Einstellungen gespeichert.';
    showToast('Browser-Einstellungen gespeichert.');
  } catch (error) {
    message.textContent = error.message;
    message.className = 'inline-message error';
  } finally {
    button.disabled = false;
  }
});
queryElement('#rescan-browsers').addEventListener('click', async () => {
  const button = queryElement('#rescan-browsers');
  button.disabled = true;
  try {
    renderBrowsers((await apiRequest('/browsers')).browsers);
    showToast('Browsersuche abgeschlossen.');
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});

/** Establish defaults, restore the draft, then subscribe to live job updates. */
async function initialize() {
  initializeTheme();
  showActiveView();
  updateControls();
  try {
    const response = await fetch('/api/bootstrap');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    sessionToken = data.token;
    captureField('outputDir').value = data.defaultOutputDir;
    renderBrowsers(data.browsers);
    restoreDraft();
    if (
      !availableBrowsers.some(
        (browser) => browser.id === captureField('browser').value && browser.available,
      )
    )
      captureField('browser').value =
        availableBrowsers.find((browser) => browser.available && browser.autoSelect !== false)
          ?.id || '';
    queryElement('#app-version').textContent = `v${data.version}`;
    const recent =
      data.jobs.find((job) => !TERMINAL_STATUSES.includes(job.status)) || data.jobs.at(-1);
    if (recent) renderJob(recent);
    updateControls();
    connectEvents();
  } catch (error) {
    setConnection(false);
    showError(
      `Der lokale Dienst ist nicht erreichbar: ${error.message}. Bitte WebScreenshotter starten und die Seite neu laden.`,
    );
  }
}
initialize();
