/** METS 2.0 packaging: Dublin Core describes content; PREMIS records provenance.
 * Every file reference must have matching size, hash and object identifiers.
 * Failed captures get events but never fictitious file objects.
 */
import { APPLICATION_NAME, FORMATS, VERSION } from './config.js';
import { sourceFilePath } from './artifacts.js';

export function xml(value) {
  return String(value ?? '')
    .toWellFormed()
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const xmlElement = (name, value) => `<${name}>${xml(value)}</${name}>`;
const premisIdentifier = (entity, value) =>
  `<premis:${entity}Identifier>${xmlElement(`premis:${entity}IdentifierType`, 'UUID')}${xmlElement(`premis:${entity}IdentifierValue`, value)}</premis:${entity}Identifier>`;
const premisAgentLink = (value, role) =>
  `<premis:linkingAgentIdentifier>${xmlElement('premis:linkingAgentIdentifierType', 'local')}${xmlElement('premis:linkingAgentIdentifierValue', value)}${xmlElement('premis:linkingAgentRole', role)}</premis:linkingAgentIdentifier>`;
const premisObjectLink = (value, role) =>
  `<premis:linkingObjectIdentifier>${xmlElement('premis:linkingObjectIdentifierType', 'UUID')}${xmlElement('premis:linkingObjectIdentifierValue', value)}${xmlElement('premis:linkingObjectRole', role)}</premis:linkingObjectIdentifier>`;

export function dublinCore(config, record) {
  const fields = record
    ? [
        ['title', record.title || record.requestedUrl],
        ['source', record.requestedUrl],
        ['date', record.capturedAt || record.startedAt],
        ['type', 'StillImage'],
        ['relation', config.collection],
        ...(record.filename ? [['format', FORMATS[config.format].mime]] : []),
        ...(config.signature ? [['identifier', `${config.signature}/${record.sequence}`]] : []),
      ]
    : [
        ['title', config.collection],
        ['creator', config.username],
        ...(config.description ? [['description', config.description]] : []),
        ...(config.signature ? [['identifier', config.signature]] : []),
        ...config.metadata.map((field) => [field.term, field.value]),
      ];
  return `<oai_dc:dc>${fields.map(([name, value]) => xmlElement(`dc:${name}`, value)).join('')}</oai_dc:dc>`;
}

function premisObject(record, config) {
  return `<premis:object xsi:type="premis:file" version="3.0">
    ${premisIdentifier('object', record.objectId)}
    <premis:objectCharacteristics>
      <premis:compositionLevel>0</premis:compositionLevel>
      <premis:fixity>
      <premis:messageDigestAlgorithm>SHA-256</premis:messageDigestAlgorithm>${xmlElement('premis:messageDigest', record.sha256)}${xmlElement('premis:messageDigestOriginator', APPLICATION_NAME)}</premis:fixity>
      ${xmlElement('premis:size', record.bytes)}
      <premis:format>
      <premis:formatDesignation>${xmlElement('premis:formatName', FORMATS[config.format].name)}</premis:formatDesignation>
      </premis:format>
      <premis:creatingApplication>${xmlElement('premis:creatingApplicationName', APPLICATION_NAME)}${xmlElement('premis:creatingApplicationVersion', VERSION)}${xmlElement('premis:dateCreatedByApplication', record.capturedAt)}</premis:creatingApplication>
      ${
        record.imageWidth
          ? `<premis:objectCharacteristicsExtension>
      <capture:image>${xmlElement('capture:width', record.imageWidth)}${xmlElement('capture:height', record.imageHeight)}<capture:deviceScaleFactor>1</capture:deviceScaleFactor>
      </capture:image>
      </premis:objectCharacteristicsExtension>`
          : ''
      }
    </premis:objectCharacteristics>
    ${xmlElement('premis:originalName', record.filename)}
  </premis:object>`;
}

function premisEvent(record, config) {
  const detail = {
    requestedUrl: record.requestedUrl,
    finalUrl: record.finalUrl || null,
    title: record.title || null,
    startedAt: record.startedAt,
    responseAt: record.responseAt || null,
    capturedAt: record.capturedAt || null,
    finishedAt: record.finishedAt,
    durationMs: record.durationMs,
    responseUrl: record.responseUrl || null,
    httpStatus: record.httpStatus ?? null,
    httpStatusText: record.httpStatusText || null,
    responseHeaders: record.responseHeaders || {},
    redirects: record.redirects || [],
    browser: record.browser || null,
    userAgent: record.userAgent || null,
    viewport: { width: config.width, height: config.height, deviceScaleFactor: 1 },
    fullPage: config.fullPage,
    lazyLoad: config.lazyLoad,
    settleTimeSeconds: config.settleTime,
    delayBeforeSeconds: record.delayBeforeSeconds,
    delayKind: record.delayKind || 'page',
    attemptNumber: record.attemptNumber || 1,
    maximumAttempts: (config.retries || 0) + 1,
    retryInterrupted: Boolean(record.retryInterrupted),
    warnings: record.warnings || [],
    error: record.error || null,
    temporaryPdfPart: Boolean(record.temporaryPdf),
    combinedPdfPages: record.pdfPages || null,
  };
  return `<premis:event version="3.0">
    ${premisIdentifier('event', record.eventId)}<premis:eventType>capture</premis:eventType>
    ${xmlElement('premis:eventDateTime', record.startedAt)}
    <premis:eventDetailInformation>${xmlElement('premis:eventDetail', JSON.stringify(detail))}</premis:eventDetailInformation>
    <premis:eventOutcomeInformation>${xmlElement('premis:eventOutcome', record.outcome)}<premis:eventOutcomeDetail>${xmlElement('premis:eventOutcomeDetailNote', record.error || (record.httpStatus >= 400 ? `HTTP ${record.httpStatus}; die dargestellte Fehlerseite wurde aufgenommen.` : ''))}</premis:eventOutcomeDetail>
      </premis:eventOutcomeInformation>
    ${premisAgentLink('operator', 'executing person')}${premisAgentLink('screenshotter', 'executing software')}${premisAgentLink('browser', 'rendering software')}
    ${record.filename ? premisObjectLink(record.objectId, 'outcome') : ''}
  </premis:event>`;
}

function premisAgent(id, name, type, version) {
  return `<premis:agent version="3.0">
      <premis:agentIdentifier>
      <premis:agentIdentifierType>local</premis:agentIdentifierType>${xmlElement('premis:agentIdentifierValue', id)}</premis:agentIdentifier>${xmlElement('premis:agentName', name)}${xmlElement('premis:agentType', type)}${version ? xmlElement('premis:agentVersion', version) : ''}</premis:agent>`;
}

// METS 2.0 uses mdSec/md, MDID and LOCREF; the namespace alone is not a migration.
const metadataSection = (id, use, type, version, content) =>
  `<mets:md ID="${id}" USE="${use}">
      <mets:mdWrap MDTYPE="${type}" MDTYPEVERSION="${version}">
      <mets:xmlData>${content}</mets:xmlData>
      </mets:mdWrap>
      </mets:md>`;

/** The combined PDF is a derived file, not another website capture. Source
 * object links and page ranges make every part traceable to its original PDF.
 */
function combinedPdfMetadata(job) {
  const combinedPdf = job.combinedPdf;
  if (!combinedPdf) return [];
  const fileObject = { ...combinedPdf, capturedAt: combinedPdf.createdAt };
  const event = `<premis:event version="3.0">
    ${premisIdentifier('event', combinedPdf.eventId)}
    <premis:eventType>derivation</premis:eventType>
    ${xmlElement('premis:eventDateTime', combinedPdf.createdAt)}
    <premis:eventDetailInformation>${xmlElement('premis:eventDetail', JSON.stringify({ operation: 'combine PDFs in capture order', pageCount: combinedPdf.pageCount, sources: combinedPdf.sources }))}</premis:eventDetailInformation>
    <premis:eventOutcomeInformation>
      <premis:eventOutcome>success</premis:eventOutcome>
      </premis:eventOutcomeInformation>
    ${premisAgentLink('screenshotter', 'executing software')}
    ${combinedPdf.sources.map((source) => premisObjectLink(source.objectId, 'source')).join('\n    ')}
    ${premisObjectLink(combinedPdf.objectId, 'outcome')}
  </premis:event>`;
  const description = `<oai_dc:dc>${xmlElement('dc:title', `${job.config.collection} – Gesamt-PDF`)}${xmlElement('dc:creator', job.config.username)}${xmlElement('dc:date', combinedPdf.createdAt)}<dc:format>application/pdf</dc:format>
      <dc:type>Collection</dc:type>${xmlElement('dc:relation', job.config.collection)}</oai_dc:dc>`;
  return [
    metadataSection('DMD_COMBINED', 'DESCRIPTIVE', 'DC', '1.1', description),
    metadataSection(
      'OBJECT_COMBINED',
      'TECHNICAL',
      'PREMIS:OBJECT',
      '3.0',
      premisObject(fileObject, { format: 'pdf' }),
    ),
    metadataSection('EVENT_COMBINED', 'DIGIPROV', 'PREMIS:EVENT', '3.0', event),
  ];
}

function combinedPdfFile(job) {
  const combinedPdf = job.combinedPdf;
  if (!combinedPdf) return '';
  return `<mets:fileGrp USE="combined PDF">
      <mets:file ID="FILE_COMBINED" MDID="DMD_COLLECTION DMD_COMBINED OBJECT_COMBINED EVENT_COMBINED AGENT_TOOL" MIMETYPE="application/pdf" SIZE="${combinedPdf.bytes}" CHECKSUM="${combinedPdf.sha256}" CHECKSUMTYPE="SHA-256" CREATED="${xml(combinedPdf.createdAt)}">
      <mets:FLocat LOCTYPE="URL" LOCREF="${xml(encodeURIComponent(combinedPdf.filename))}"/>
      </mets:file>
      </mets:fileGrp>`;
}

export function buildMets(job) {
  const { config, records } = job;
  const hasIndividualFile = (record) =>
    record.filename && !(record.temporaryPdf && job.combinedPdf);
  const files = records.filter(hasIndividualFile);
  const agents = 'AGENT_OPERATOR AGENT_TOOL AGENT_BROWSER';
  // Earlier failures stay distinct PREMIS events. Only the last attempt can
  // reference the retained image; EVENT_<index> remains its stable metadata ID.
  const earlierEvents = (record, index) =>
    (record.attempts || [])
      .filter((attempt) => attempt.eventId !== record.eventId)
      .map((attempt, position) => ({ id: `EVENT_${index}_ATTEMPT_${position + 1}`, attempt }));
  const recordMetadata = (record, index) =>
    [
      `DMD_${index}`,
      ...earlierEvents(record, index).map(({ id }) => id),
      `EVENT_${index}`,
      ...(record.filename ? [`OBJECT_${index}`] : []),
    ].join(' ');
  const metadata = [
    metadataSection('DMD_COLLECTION', 'DESCRIPTIVE', 'DC', '1.1', dublinCore(config)),
    metadataSection(
      'AGENT_OPERATOR',
      'DIGIPROV',
      'PREMIS:AGENT',
      '3.0',
      premisAgent('operator', config.username, 'person'),
    ),
    metadataSection(
      'AGENT_TOOL',
      'DIGIPROV',
      'PREMIS:AGENT',
      '3.0',
      premisAgent('screenshotter', APPLICATION_NAME, 'software', VERSION),
    ),
    metadataSection(
      'AGENT_BROWSER',
      'DIGIPROV',
      'PREMIS:AGENT',
      '3.0',
      premisAgent(
        'browser',
        job.browserInfo?.name || config.browser,
        'software',
        job.browserInfo?.version,
      ),
    ),
    ...records.flatMap((record, index) => [
      metadataSection(`DMD_${index}`, 'DESCRIPTIVE', 'DC', '1.1', dublinCore(config, record)),
      ...earlierEvents(record, index).map(({ id, attempt }) =>
        metadataSection(id, 'DIGIPROV', 'PREMIS:EVENT', '3.0', premisEvent(attempt, config)),
      ),
      ...(record.filename
        ? [
            metadataSection(
              `OBJECT_${index}`,
              'TECHNICAL',
              'PREMIS:OBJECT',
              '3.0',
              premisObject(record, config),
            ),
          ]
        : []),
      metadataSection(
        `EVENT_${index}`,
        'DIGIPROV',
        'PREMIS:EVENT',
        '3.0',
        premisEvent(record, config),
      ),
    ]),
    ...combinedPdfMetadata(job),
  ];
  const fileSection =
    files.length || job.combinedPdf
      ? `
  <mets:fileSec>
      ${files.length ? '<mets:fileGrp USE="screenshots">' : ''}
    ${records
      .map((record, index) =>
        hasIndividualFile(record)
          ? `<mets:file ID="FILE_${index}" MDID="DMD_COLLECTION ${recordMetadata(record, index)} ${agents}" MIMETYPE="${FORMATS[config.format].mime}" SIZE="${record.bytes}" CHECKSUM="${record.sha256}" CHECKSUMTYPE="SHA-256" CREATED="${xml(record.capturedAt)}">
      <mets:FLocat LOCTYPE="URL" LOCREF="${xml(sourceFilePath(record).split('/').map(encodeURIComponent).join('/'))}"/>
      </mets:file>`
          : '',
      )
      .filter(Boolean)
      .join('\n    ')}
  ${files.length ? '</mets:fileGrp>' : ''}${combinedPdfFile(job)}</mets:fileSec>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<mets:mets xmlns:mets="http://www.loc.gov/METS/v2" xmlns:premis="http://www.loc.gov/premis/v3" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:oai_dc="http://www.openarchives.org/OAI/2.0/oai_dc/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:capture="urn:screenshotter:capture:1" xsi:schemaLocation="http://www.loc.gov/METS/v2 https://www.loc.gov/standards/mets/mets2.xsd http://www.loc.gov/premis/v3 https://www.loc.gov/standards/premis/v3/premis-v3-0.xsd http://www.openarchives.org/OAI/2.0/oai_dc/ https://www.openarchives.org/OAI/2.0/oai_dc.xsd" OBJID="urn:uuid:${xml(job.id)}" LABEL="${xml(config.collection)}" TYPE="Website screenshot collection">
  <mets:metsHdr CREATEDATE="${xml(job.startedAt)}" LASTMODDATE="${xml(job.finishedAt || new Date().toISOString())}" RECORDSTATUS="${xml(job.status)}">
      <mets:agent ROLE="CREATOR" TYPE="INDIVIDUAL">${xmlElement('mets:name', config.username)}</mets:agent>
      <mets:agent ROLE="CREATOR" TYPE="SOFTWARE">
      <mets:name>${APPLICATION_NAME} ${VERSION}</mets:name>
      </mets:agent>
      </mets:metsHdr>
  <mets:mdSec>
    ${metadata.join('\n    ')}
  </mets:mdSec>${fileSection}
  <mets:structSec>
      <mets:structMap TYPE="physical" LABEL="Aufnahmereihenfolge">
      <mets:div TYPE="collection" MDID="DMD_COLLECTION ${agents}" LABEL="${xml(config.collection)}">
    ${records
      .map((record, index) => {
        const pointer = hasIndividualFile(record)
          ? `<mets:fptr FILEID="FILE_${index}"/>`
          : record.pdfPages && job.combinedPdf
            ? `<mets:fptr><mets:area FILEID="FILE_COMBINED" BETYPE="PAGE" BEGIN="${record.pdfPages.first}" END="${record.pdfPages.last}"/></mets:fptr>`
            : '';
        return `<mets:div TYPE="${record.filename ? 'screenshot' : 'failedCapture'}" ORDER="${index + 1}" ORDERLABEL="${record.sequence}" MDID="${recordMetadata(record, index)}" LABEL="${xml(record.requestedUrl)}">${pointer}</mets:div>`;
      })
      .join('\n    ')}
    ${job.combinedPdf ? '<mets:div TYPE="combinedPdf" MDID="DMD_COMBINED OBJECT_COMBINED EVENT_COMBINED" LABEL="Gesamt-PDF"><mets:fptr FILEID="FILE_COMBINED"/></mets:div>' : ''}
  </mets:div>
      </mets:structMap>
      </mets:structSec>
</mets:mets>\n`;
}
