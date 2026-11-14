import { z } from "zod";

export const EXPORTER_VERSION = "layout-pptx-1";
export const EXPORT_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const EXPORT_MAX_BYTES = 64 * 1024 * 1024;
export const EXPORT_WARNINGS = ["FONTS_NOT_EMBEDDED", "OFFICE_LAYOUT_MAY_DIFFER"];
export const EXPORT_FORMATS = Object.freeze({
  pptx: { kind: "slides", version: EXPORTER_VERSION, contentType: EXPORT_CONTENT_TYPE, extension: "pptx", flag: "CREATION_PPTX_EXPORT_ENABLED", warnings: EXPORT_WARNINGS },
  png: { kind: "poster", version: "layout-raster-1", contentType: "image/png", extension: "png", flag: "CREATION_POSTER_EXPORT_ENABLED", warnings: ["SERVER_FONTS_MAY_DIFFER"] },
  jpeg: { kind: "poster", version: "layout-raster-1", contentType: "image/jpeg", extension: "jpg", flag: "CREATION_POSTER_EXPORT_ENABLED", warnings: ["SERVER_FONTS_MAY_DIFFER", "TRANSPARENCY_FLATTENED_WHITE"] },
  svg: { kind: "poster", version: "layout-svg-1", contentType: "image/svg+xml", extension: "svg", flag: "CREATION_SVG_EXPORT_ENABLED", warnings: ["FONTS_NOT_EMBEDDED", "SERVER_FONTS_MAY_DIFFER", "EMBEDDED_IMAGES_REMAIN_RASTER"] },
  pdf: { kinds: ["poster", "slides"], version: "layout-pdf-1", contentType: "application/pdf", extension: "pdf", flag: "CREATION_LAYOUT_PDF_EXPORT_ENABLED", warnings: ["SERVER_FONTS_MAY_DIFFER", "PDF_TEXT_EXTRACTION_MAY_DIFFER", "HIDDEN_SLIDES_AND_NOTES_OMITTED"] },
});
export function exportFormat(format, sourceSchemaVersion = 1, kind) {
  if (sourceSchemaVersion === 3) return (["png", "jpeg", "pdf"].includes(format) && kind === "poster" || ["pdf", "pptx"].includes(format) && kind === "slides") ? { ...EXPORT_FORMATS[format], kind, kinds: undefined, sourceSchemaVersion: 3, version: `html-${format}-1`, flag: "CREATION_HTML_EXPORT_ENABLED", workerKey: `html-${format}`, warnings: [...EXPORT_FORMATS[format].warnings, ...(format === "pptx" ? ["HTML_CSS_CONVERSION_REPORT", "SVG_OBJECTS_MAY_BE_RASTERIZED"] : [])] } : null;
  return sourceSchemaVersion === 1 && Object.hasOwn(EXPORT_FORMATS, format) ? EXPORT_FORMATS[format] : null;
}
export function exportFormatForVersion(format, version) {
  return [exportFormat(format), exportFormat(format, 3, "poster"), exportFormat(format, 3, "slides")].map(item => item?.sourceSchemaVersion === 3 && format === "pdf" ? { ...item, kind: undefined, kinds: ["poster", "slides"] } : item).find(item => item?.version === version) || null;
}
export function exportSupportsKind(descriptor, kind) { return Boolean(descriptor && typeof kind === "string" && (descriptor.kind === kind || descriptor.kinds?.includes(kind))); }
export function exportFormatsForKind(kind) { return Object.keys(EXPORT_FORMATS).filter(format => exportSupportsKind(exportFormat(format, 1, kind), kind)); }
export const requestExportSchema = z.object({ revision: z.number().int().positive(), format: z.enum(["pptx", "png", "jpeg", "svg", "pdf"]), retryKey: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/).optional(), retryAttempt: z.number().int().nonnegative().optional() }).strict()
  .refine(value => Boolean(value.retryKey) === (value.retryAttempt !== undefined), "RETRY_ATTEMPT_REQUIRED");

// Reject type/extension confusion before publishing an output. Checksums protect
// later transport; these magic bytes are not a full file decoder/validator.
export function hasExportSignature(bytes, format) {
  if (!(bytes instanceof Uint8Array)) return false;
  const starts = prefix => prefix.every((value, index) => bytes[index] === value);
  if (format === "pptx") return bytes.length >= 4 && starts([0x50, 0x4b, 0x03, 0x04]);
  if (format === "png") return bytes.length >= 8 && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (format === "jpeg") return bytes.length >= 4 && starts([0xff, 0xd8, 0xff]) && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (format === "pdf") return starts([0x25, 0x50, 0x44, 0x46, 0x2d]) && /%%EOF\s*$/.test(new TextDecoder().decode(bytes.subarray(-32)));
  if (format === "svg") {
    // This identifies our generated container, not arbitrary uploaded SVG.
    // Content safety comes from the closed serializer in exports/svg.js.
    const prefix = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" ');
    return starts(prefix) && new TextDecoder().decode(bytes.subarray(-6)) === "</svg>";
  }
  return false;
}
