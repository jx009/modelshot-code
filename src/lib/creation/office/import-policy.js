// Shared by the picker, HTTP boundary and isolated import worker.
export const OFFICE_IMPORT_BYTES = 32 * 1024 * 1024;
export const PPTX_MEDIA_COUNT = 128;
export const OFFICE_IMPORT_VERSION = "office-import-3";
export const officeImportBytes = format => format === "pptx" || format === "slides" ? OFFICE_IMPORT_BYTES : 4 * 1024 * 1024;
export const officeImportExtension = kind => ({ document: ".docx", sheet: ".xlsx", slides: ".pptx" })[kind] || "";
