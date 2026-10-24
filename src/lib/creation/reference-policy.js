// Shared metadata only. ZIP/XML readers are never imported by a web route.
export const REFERENCE_TEXT_BYTES = 256 * 1024;
export const REFERENCE_OFFICE_BYTES = 4 * 1024 * 1024;
export const REFERENCE_SESSION_BYTES = 32 * 1024 * 1024;
export const REFERENCE_CONTEXT_BYTES = 128 * 1024;
export const REFERENCE_MAX_FILES = 8;
export const REFERENCE_READER_VERSION = "office-reference-1";
export const REFERENCE_READER_HEARTBEAT = "creation-reference-reader";
export const REFERENCE_TYPES = {
  txt: { mime: "text/plain", accepted: ["text/plain"] },
  md: { mime: "text/markdown", accepted: ["text/markdown", "text/plain"] },
  csv: { mime: "text/csv", accepted: ["text/csv", "text/plain", "application/vnd.ms-excel"] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", office: true },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", office: true },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", office: true },
};
export const referenceType = extension => Object.hasOwn(REFERENCE_TYPES, extension) ? REFERENCE_TYPES[extension] : null;
export const referenceContentType = type => type.office ? type.mime : `${type.mime}; charset=utf-8`;
