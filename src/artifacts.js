/** File locations are shared by exports, metadata and the HTTP allowlist. */
export const PDF_PARTS_DIRECTORY = 'pdf-zwischenstand';

export function sourceFilePath(record) {
  if (!record.filename) return null;
  return `${record.temporaryPdf ? PDF_PARTS_DIRECTORY : 'screenshots'}/${record.filename}`;
}

export function outputArtifact(job, record) {
  if (!record.filename) return null;
  if (record.temporaryPdf && job.combinedPdf) {
    return { ...job.combinedPdf, relativePath: job.combinedPdf.filename };
  }
  return { filename: record.filename, sha256: record.sha256, relativePath: sourceFilePath(record) };
}
