/** Minimal XLSX serialization using JavaScript and built-in ZIP compression.
 * Dates are numeric Excel values; strings are never interpreted as formulas.
 */
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { xml } from './metadata.js';
import { outputArtifact } from './artifacts.js';

export const EXCEL_FILENAME = 'aufnahmen.xlsx';
export const EXCEL_HEADERS = [
  'ID',
  'Dateiname (ohne Endung)',
  'Titel der URL',
  'Abgerufene Adresse',
  'Datum / Uhrzeit',
  'Statuscode',
  'Sha256 des Screenshots',
  'Dateipfad',
];
const SPREADSHEET_NAMESPACE = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RELATIONSHIP_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const COLUMN_WIDTHS = [12, 34, 48, 62, 43, 15, 70, 85];

// A small OOXML workbook needs only these six XML parts. Keeping the ZIP
// writer here avoids adding an Office installation or a native dependency.
const crcTable = Uint32Array.from({ length: 256 }, (_, entryIndex) => {
  let value = entryIndex;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function checksum(buffer) {
  let crcValue = 0xffffffff;
  for (const byte of buffer) crcValue = crcTable[(crcValue ^ byte) & 255] ^ (crcValue >>> 8);
  return (crcValue ^ 0xffffffff) >>> 0;
}

/** Write local entries, a central directory and an end record per the ZIP layout. */
function zip(entries) {
  const files = [];
  const directory = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const filename = Buffer.from(name, 'utf8');
    const data = Buffer.from(XML_DECLARATION + content, 'utf8');
    const compressed = deflateRawSync(data);
    const crcValue = checksum(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); // UTF-8 names
    header.writeUInt16LE(8, 8); // DEFLATE
    header.writeUInt16LE(33, 12); // 1980-01-01, deterministic ZIP timestamp
    header.writeUInt32LE(crcValue, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    header.copy(central, 6, 4, 28);
    central.writeUInt32LE(offset, 42);
    files.push(header, filename, compressed);
    directory.push(central, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, centralDirectory, end]);
}

function textCell(reference, value, style = 0) {
  // Inline strings keep URLs, hashes and leading '=' characters as text.
  // Escape literal OOXML escape sequences so Excel does not reinterpret them.
  const text = String(value ?? '')
    .toWellFormed()
    .slice(0, 32767)
    .toWellFormed()
    .replace(/_(?=x[0-9a-f]{4}_)/gi, '_x005F_')
    .replace(/\r/g, '_x000D_');
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}

function numberCell(reference, value, style = 2) {
  return Number.isFinite(value)
    ? `<c r="${reference}" s="${style}"><v>${value}</v></c>`
    : `<c r="${reference}" s="${style}"/>`;
}

/** Convert an instant to wall-clock time in the export PC's zone. Excel has no timezone type. */
function excelDate(value, formatter) {
  const instant = new Date(value);
  if (!value || !Number.isFinite(instant.getTime())) return undefined;
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  // Captures use contemporary dates; Excel's 1900 leap-year quirk is included.
  return (local - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Exactly one spreadsheet row per attempted URL; missing file fields stay empty. */
export function buildExcel(
  job,
  { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {},
) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const dateFormat = xml(`dd.mm.yyyy hh:mm:ss "${timeZone}"`);
  const rows = [
    `<row r="1" ht="34" customHeight="1">${EXCEL_HEADERS.map((value, columnIndex) => textCell(`${String.fromCharCode(65 + columnIndex)}1`, value, 1)).join('')}</row>`,
  ];
  for (const [entryIndex, record] of job.records.entries()) {
    const rowNumber = entryIndex + 2;
    const address =
      [record.finalUrl, record.responseUrl, record.requestedUrl].find((value) =>
        /^https?:\/\//i.test(value || ''),
      ) || '';
    const timestamp = record.capturedAt || record.responseAt || record.startedAt;
    const artifact = outputArtifact(job, record);
    const filename = artifact ? path.parse(artifact.filename).name : '';
    const filePath = artifact ? path.join(job.outputDir, artifact.relativePath) : '';
    const textValues = [
      [filename, 1],
      [record.title || '', 2],
      [address, 3],
      [filePath, 7],
    ];
    const lineCount = Math.max(
      1,
      ...textValues.map(([value, column]) =>
        value
          .split(/\r?\n/)
          .reduce(
            (sum, line) => sum + Math.max(1, Math.ceil(line.length / (COLUMN_WIDTHS[column] - 3))),
            0,
          ),
      ),
    );
    const height = Math.min(409, 8 + lineCount * 16);
    rows.push(
      `<row r="${rowNumber}" ht="${height}" customHeight="1">${[
        numberCell(`A${rowNumber}`, record.sequence),
        textCell(`B${rowNumber}`, filename),
        textCell(`C${rowNumber}`, record.title),
        textCell(`D${rowNumber}`, address),
        numberCell(`E${rowNumber}`, excelDate(timestamp, formatter), 3),
        numberCell(`F${rowNumber}`, record.httpStatus),
        textCell(`G${rowNumber}`, artifact?.sha256 || ''),
        textCell(`H${rowNumber}`, filePath),
      ].join('')}</row>`,
    );
  }
  const range = `A1:H${rows.length}`;
  return zip({
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      </Types>`,
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="${RELATIONSHIP_NAMESPACE}/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${SPREADSHEET_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}">
      <bookViews>
      <workbookView/>
      </bookViews>
      <sheets>
      <sheet name="Aufnahmen" sheetId="1" r:id="rId1"/>
      </sheets>
      </workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="${RELATIONSHIP_NAMESPACE}/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="${RELATIONSHIP_NAMESPACE}/styles" Target="styles.xml"/>
      </Relationships>`,
    'xl/styles.xml': `<styleSheet xmlns="${SPREADSHEET_NAMESPACE}">
      <numFmts count="1">
      <numFmt numFmtId="164" formatCode="${dateFormat}"/>
      </numFmts>
      <fonts count="2">
      <font>
      <sz val="11"/>
      <color rgb="FF253C36"/>
      <name val="Calibri"/>
      </font>
      <font>
      <b/>
      <sz val="11"/>
      <color rgb="FFFFFFFF"/>
      <name val="Calibri"/>
      </font>
      </fonts>
      <fills count="3">
      <fill>
      <patternFill patternType="none"/>
      </fill>
      <fill>
      <patternFill patternType="gray125"/>
      </fill>
      <fill>
      <patternFill patternType="solid">
      <fgColor rgb="FF17654E"/>
      <bgColor indexed="64"/>
      </patternFill>
      </fill>
      </fills>
      <borders count="1">
      <border>
      <left/>
      <right/>
      <top/>
      <bottom/>
      <diagonal/>
      </border>
      </borders>
      <cellStyleXfs count="1">
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
      </cellStyleXfs>
      <cellXfs count="4">
      <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
      </xf>
      <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">
      <alignment vertical="center" wrapText="1"/>
      </xf>
      <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1">
      <alignment vertical="top"/>
      </xf>
      <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1">
      <alignment vertical="top"/>
      </xf>
      </cellXfs>
      <cellStyles count="1">
      <cellStyle name="Normal" xfId="0" builtinId="0"/>
      </cellStyles>
      </styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${SPREADSHEET_NAMESPACE}">
      <dimension ref="${range}"/>
      <sheetViews>
      <sheetView workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
      <selection pane="bottomLeft" activeCell="A2" sqref="A2"/>
      </sheetView>
      </sheetViews>
      <sheetFormatPr defaultRowHeight="30"/>
      <cols>${COLUMN_WIDTHS.map((width, entryIndex) => `<col min="${entryIndex + 1}" max="${entryIndex + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>
      <sheetData>${rows.join('')}</sheetData>
      <autoFilter ref="${range}"/>
      </worksheet>`,
  });
}
