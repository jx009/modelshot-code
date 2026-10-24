import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { documentPdfModel } from "../../src/lib/creation/exports/document-pdf-model.js";
import { layoutDocumentPdf } from "../../src/lib/creation/exports/document-pdf-layout.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { exportFormat, exportFormatForVersion, exportFormatsForKind } from "../../src/lib/creation/contracts/exports.js";

const runs = text => [{ text }];
const source = blocks => ({ schemaVersion: 1, kind: "document", title: "报告", sections: [{ id: "section", title: "正文", blocks }] });
const paragraph = (id, text) => ({ id, type: "paragraph", runs: runs(text) });
const measure = (text, style) => [...text].length * style.size * .55;
const contents = pages => pages.flatMap(page => page.commands.filter(command => command.type === "line").flatMap(line => line.parts.filter(p => p.type === "text").map(p => p.text))).join("");

it("chooses document-specific versions without reinterpreting existing layout PDF jobs", () => {
  expect(exportFormatsForKind("document")).toContain("pdf");
  for (const schema of [1, 2]) {
    const descriptor = exportFormat("pdf", schema, "document");
    expect(descriptor.workerKey).not.toBe("pdf");
    expect(exportFormatForVersion("pdf", descriptor.version)).toBe(descriptor);
    expect(exportFormatForVersion("docx", descriptor.version)).toBeNull();
  }
  expect(exportFormatForVersion("pdf", "layout-pdf-1")).toBe(exportFormat("pdf"));
});
it("reads browser-edited native text directly and does not mutate either source format", () => {
  const native = JSON.parse(readFileSync(new URL("../fixtures/creation-native-document-browser.json", import.meta.url), "utf8"));
  const before = structuredClone(native), model = documentPdfModel(native);
  expect(contents(layoutDocumentPdf(model, measure))).toContain("后退时保存：");
  expect(native).toEqual(before);
  const semantic = source([paragraph("p", "locked text")]); semantic.sections[0].blocks[0].locked = true;
  expect(contents(layoutDocumentPdf(documentPdfModel(semantic), measure))).toContain("locked text");
  expect(semantic.sections[0].blocks[0].locked).toBe(true);
});
it("paginates long paragraphs without truncation and keeps all lines within page bounds", () => {
  const value = "中文 English longword 😀 e\u0301 ".repeat(500);
  const pages = layoutDocumentPdf(documentPdfModel(source([paragraph("p", value)])), measure);
  expect(pages.length).toBeGreaterThan(3);
  expect(contents(pages)).toBe(value);
  for (const page of pages) for (const line of page.commands) {
    expect(line.y).toBeGreaterThanOrEqual(0); expect(line.y + line.height).toBeLessThanOrEqual(page.height);
    expect(line.width).toBeLessThanOrEqual(line.available + .01);
  }
});
it("preserves rich runs, list numbering, images and explicit page breaks", () => {
  const input = source([
    { id: "title", type: "heading", level: 1, runs: [{ text: "Heading", marks: { bold: true, color: "#123456" } }] },
    { id: "list", type: "list", ordered: true, start: 5, items: [{ id: "a", depth: 0, runs: runs("first") }, { id: "b", depth: 0, runs: runs("second") }] },
    { id: "photo", type: "image", assetId: "photo", width: 120, height: 80 },
    { id: "break", type: "pageBreak" }, paragraph("end", "LAST PAGE"),
  ]);
  const model = documentPdfModel(toNativeDocumentArtifact(input, "unit")), pages = layoutDocumentPdf(model, measure);
  expect(contents(pages)).toContain("5. first6. second");
  expect(contents([pages.at(-1)])).toContain("LAST PAGE");
  expect(pages.length).toBe(2);
  const parts = pages.flatMap(page => page.commands.flatMap(command => command.parts || []));
  expect(parts).toContainEqual(expect.objectContaining({ type: "image", assetId: "photo" }));
  expect(parts.find(part => part.text === "Heading").style).toMatchObject({ bold: true, color: "#123456" });
});
it("repeats table headers and resolves footer fields after pagination with no body overlap", () => {
  const input = source([{ id: "table", type: "table", headerRows: 1, rows: Array.from({ length: 90 }, (_, index) => ({ id: `r${index}`, cells: [
    { id: `a${index}`, runs: runs(index ? `ROW ${index}` : "REPEAT HEADER") }, { id: `b${index}`, runs: runs(index ? `${index * 5}` : "AMOUNT") },
  ] })) }]);
  input.page = { header: "REPORT HEADER", footer: "INTERNAL", pageNumbers: true };
  const model = documentPdfModel(input), pages = layoutDocumentPdf(model, measure);
  expect(pages.length).toBeGreaterThan(2);
  for (const page of pages) {
    expect(contents([page])).toContain("REPEAT HEADER"); expect(contents([page])).toContain("REPORT HEADER");
    expect(page.commands.flatMap(command => command.parts || []).filter(p => p.type === "field")).toHaveLength(1);
    const footer = page.commands.find(command => command.parts?.some(p => p.text === "INTERNAL"));
    for (const cell of page.commands.filter(command => command.type === "cell")) expect(cell.y + cell.height).toBeLessThan(footer.y);
  }
  for (let i = 1; i < 90; i++) expect(contents(pages)).toContain(`ROW ${i}`);
});
it("rejects complex native layout instead of dropping it and enforces pagination bounds", () => {
  const input = toNativeDocumentArtifact(source([paragraph("p", "Text")]), "unit");
  input.snapshot.body.paragraphs[0].paragraphStyle.tabStops = [{ offset: 30, alignment: 2 }];
  expect(() => documentPdfModel(input)).toThrow("EXPORT_DOCUMENT_PDF_UNSUPPORTED");
  const model = documentPdfModel(source([paragraph("p", "Text")]));
  model.blocks = Array.from({ length: 101 }, () => ({ ...model.blocks[0], breakBefore: true }));
  expect(() => layoutDocumentPdf(model, measure)).toThrow("EXPORT_DOCUMENT_PDF_TOO_MANY_PAGES");
  const table = documentPdfModel(source([{ id: "t", type: "table", rows: [{ id: "r", cells: [{ id: "c", runs: runs("Very long cell ".repeat(1000)) }] }] }]));
  expect(() => layoutDocumentPdf(table, measure)).toThrow("EXPORT_DOCUMENT_PDF_ROW_TOO_TALL");
});

it("rechecks hanging-indent widths, uses native tab stops and aligns cells vertically", () => {
  const model = documentPdfModel(source([paragraph("p", "prefix abcdefghijklmnop xyz") ]));
  const block = model.blocks[0]; block.left = 40; block.first = -40;
  model.page.width = model.page.left + model.page.right + 120;
  const pages = layoutDocumentPdf(model, measure);
  expect(contents(pages)).toBe("prefix abcdefghijklmnop xyz");
  for (const line of pages[0].commands.filter(c => c.type === "line")) expect(line.width).toBeLessThanOrEqual(line.available + .01);
  const native = toNativeDocumentArtifact(source([paragraph("p", "a\tb"), { id: "t", type: "table", rows: [{ id: "r", cells: [{ id: "c", runs: runs("Bottom") }] }] }]), "tabs");
  native.snapshot.documentStyle.defaultTabStop = 54;
  const row = Object.values(native.snapshot.tableSource)[0].tableRows[0];
  row.trHeight = { val: { v: 80 }, hRule: 1 }; row.tableCells[0].vAlign = 4;
  const commands = layoutDocumentPdf(documentPdfModel(native), measure)[0].commands;
  expect(commands[0].parts[0].width + commands[0].parts[1].width).toBe(54);
  const cell = commands.find(c => c.type === "cell"), bottom = commands.find(c => c.parts?.some(p => p.text === "Bottom"));
  expect(bottom.y).toBeGreaterThan(cell.y + 40);
});
