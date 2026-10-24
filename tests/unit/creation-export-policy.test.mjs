import { expect, it } from "vitest";
import { exportFormat, exportFormatsForKind, hasExportSignature, requestExportSchema } from "../../src/lib/creation/contracts/exports.js";
import { validatePosterExport, checkPosterImagePixels } from "../../src/lib/creation/exports/raster-policy.js";

const poster = (width = 2000, height = 4000) => ({ schemaVersion: 1, kind: "poster", title: "Poster", theme: { name: "Test", primary: "#112233", accent: "#ffee00", background: "#ffffff00", fontFamily: "sans" }, pages: [{ id: "page", title: "Poster", width, height, nodes: [] }] });

it("separates poster formats from PPTX, validates paired retry fields and does not permit extra export knobs", () => {
  expect(exportFormatsForKind("poster")).toEqual(["png", "jpeg", "svg", "pdf"]);
  expect(exportFormatsForKind("slides")).toEqual(["pptx", "pdf"]);
  expect(exportFormatsForKind("document")).toEqual(["docx", "markdown", "pdf"]);
  expect(exportFormat("markdown")).toMatchObject({ extension: "markdown.zip", contentType: "application/zip", flag: "CREATION_MARKDOWN_EXPORT_ENABLED" });
  expect(exportFormat("markdown", 2)).toMatchObject({ version: "univer-document-markdown-1", sourceSchemaVersion: 2, workerKey: "univer-markdown", flag: "CREATION_NATIVE_MARKDOWN_EXPORT_ENABLED" });
  expect(hasExportSignature(Uint8Array.from([0x50, 0x4b, 3, 4]), "markdown")).toBe(true);
  expect(exportFormatsForKind("web")).toEqual(["zip"]);
  expect(exportFormat("zip")).toMatchObject({ extension: "zip", contentType: "application/zip", flag: "CREATION_WEB_EXPORT_ENABLED" });
  expect(exportFormat("jpeg")).toMatchObject({ extension: "jpg", contentType: "image/jpeg" });
  expect(exportFormat("__proto__")).toBeNull();
  for (const format of ["pptx", "docx", "markdown", "xlsx", "png", "jpeg", "zip", "svg", "pdf"]) expect(requestExportSchema.parse({ revision: 3, format })).toEqual({ revision: 3, format });
  for (const extra of [{ scale: 8 }, { format: "exe" }, { retryAttempt: 2 }, { retryKey: "a-retry-key-123456" }]) expect(requestExportSchema.safeParse({ revision: 3, format: "png", ...extra }).success).toBe(false);
});

it("rejects oversized canvases before allocating native surfaces, including rounding at the pixel boundary", () => {
  expect(validatePosterExport(poster(), "png")).toMatchObject({ width: 2000, height: 4000 });
  expect(() => validatePosterExport(poster(2000.01, 4000), "jpeg")).toThrow("EXPORT_POSTER_SIZE_UNSUPPORTED");
  expect(() => validatePosterExport({ ...poster(), kind: "slides" }, "png")).toThrow("EXPORT_KIND_UNSUPPORTED");
  expect(() => validatePosterExport(poster(), "pdf")).toThrow("EXPORT_FORMAT_UNSUPPORTED");
  expect(() => validatePosterExport({ ...poster(), pages: [...poster().pages, { ...poster().pages[0], id: "second" }] }, "png")).toThrow();
});

it("bounds aggregate decoded image pixels independently of compressed file size", () => {
  expect(() => checkPosterImagePixels(new Map([["a", { width: 4000, height: 4000 }]]))).not.toThrow();
  expect(() => checkPosterImagePixels(new Map([["a", { width: 4000, height: 4000 }], ["b", { width: 1, height: 1 }]]))).toThrow("EXPORT_IMAGE_PIXELS_EXCEEDED");
  expect(() => checkPosterImagePixels(new Map([["a", { width: Infinity, height: 1 }]]))).toThrow("EXPORT_IMAGE_UNSUPPORTED");
});

it("refuses a mislabeled output and truncated PNG/JPEG before upload", () => {
  const signatures = { pptx: [0x50, 0x4b, 3, 4], png: [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10], jpeg: [255, 216, 255, 224, 255, 217] };
  for (const [format, bytes] of Object.entries(signatures)) {
    expect(hasExportSignature(Uint8Array.from(bytes), format)).toBe(true);
    expect(hasExportSignature(Uint8Array.from(bytes.slice(0, 3)), format)).toBe(false);
    for (const other of Object.keys(signatures).filter(value => value !== format)) expect(hasExportSignature(Uint8Array.from(bytes), other)).toBe(false);
  }
});
