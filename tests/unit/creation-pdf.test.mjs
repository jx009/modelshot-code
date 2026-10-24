import { expect, it } from "vitest";
import { validateLayoutPdf, pdfAssetIds, pdfPageSize, PDF_POINTS_PER_PIXEL } from "../../src/lib/creation/exports/pdf-policy.js";
import { exportFormat, exportSupportsKind, hasExportSignature } from "../../src/lib/creation/contracts/exports.js";

const page = (id, changes = {}) => ({ id, title: id, width: 1920, height: 1080, nodes: [], ...changes });
const document = pages => ({ schemaVersion: 1, kind: "slides", title: "PDF", theme: { name: "Brand", primary: "#111111", accent: "#ffaa00", background: "#ffffff", fontFamily: "sans" }, pages });
it("exports ordered visible slides with mixed sizes, excludes private hidden assets and retains the poster board", () => {
  const image = { id: "image", name: "Image", type: "image", x: 0, y: 0, width: 100, height: 100, assetId: "private" };
  const source = document([page("a"), page("hidden", { hidden: true, nodes: [image] }), page("b", { width: 800, height: 1200, nodes: [{ ...image, assetId: "visible" }, { ...image, id: "invisible", assetId: "omit", visible: false }] })]);
  const { pages } = validateLayoutPdf(source);
  expect(pages.map(page => [page.id, page.width, page.height])).toEqual([["a", 1920, 1080], ["b", 800, 1200]]);
  expect(pdfAssetIds(pages)).toEqual(["visible"]);
  expect(validateLayoutPdf({ ...document([page("poster", { hidden: true })]), kind: "poster" }).pages).toHaveLength(1);
  expect(source.pages).toHaveLength(3);
  expect(PDF_POINTS_PER_PIXEL).toBe(.75);
  expect(pdfPageSize({ width: 321, height: 481 })).toEqual([241, 361]);
});
it("bounds page/total surfaces and text commands before entering a native renderer", () => {
  expect(() => validateLayoutPdf(document([page("hidden", { hidden: true })]))).toThrow("EXPORT_PDF_NO_VISIBLE_PAGES");
  expect(() => validateLayoutPdf(document([page("large", { width: 4000, height: 2001 })]))).toThrow("EXPORT_PDF_BUDGET_EXCEEDED");
  expect(() => validateLayoutPdf(document(Array.from({ length: 31 }, (_, index) => page(`p${index}`, { width: 2000, height: 4000 }))))).toThrow("EXPORT_PDF_BUDGET_EXCEEDED");
  const nodes = Array.from({ length: 32 }, (_, index) => ({ id: `n${index}`, name: "Text", type: "text", text: "中".repeat(16000), x: 0, y: 0, width: 100, height: 100, style: {} }));
  expect(() => validateLayoutPdf(document([page("text", { nodes })]))).toThrow("EXPORT_PDF_BUDGET_EXCEEDED");
});
it("admits only layout kinds and distinguishes a complete generated PDF container from ZIP/truncation", () => {
  const descriptor = exportFormat("pdf");
  expect(exportSupportsKind(descriptor, "poster")).toBe(true);
  expect(exportSupportsKind(descriptor, "slides")).toBe(true);
  for (const kind of ["document", "sheet", "web", undefined]) expect(exportSupportsKind(descriptor, kind)).toBe(false);
  expect(hasExportSignature(Buffer.from("%PDF-1.7\n...\n%%EOF\n"), "pdf")).toBe(true);
  for (const value of ["%PDF-1.7", "PK\x03\x04", "%PDF-1.7\n%%EOF junk"]) expect(hasExportSignature(Buffer.from(value), "pdf")).toBe(false);
});
