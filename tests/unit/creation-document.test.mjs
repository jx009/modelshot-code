import { expect, it } from "vitest";
import { textDocumentSchema, documentOperationsSchema } from "../../src/lib/creation/contracts/document.js";
import { documentLanguageInputSchema, validateDocumentLanguageResult } from "../../src/lib/creation/contracts/document-language.js";
import { applyDocumentOperations, applyDocumentWithInverse, replaceDocumentText } from "../../src/lib/creation/document-operations.js";

const paragraph = (id, text, extra = {}) => ({ id, type: "paragraph", runs: [{ text, marks: {} }], ...extra });
const fixture = () => textDocumentSchema.parse({ schemaVersion: 1, kind: "document", title: "报告", sections: [
  { id: "first", title: "概览", blocks: [paragraph("intro", "咖啡☕和🧋，售价 18 元"), paragraph("locked", "固定数据", { locked: true })] },
  { id: "second", title: "数据", blocks: [{ id: "table", type: "table", rows: [{ id: "row", cells: [{ id: "cell-a", runs: [{ text: "商品" }] }, { id: "cell-b", runs: [{ text: "18" }] }] }] }] },
] });
const patch = (text = "20") => ({ op: "replaceDocumentText", sectionId: "second", blockId: "table", leafId: "cell-b", start: 0, end: 2, expectedText: "18", text });
const edit = () => documentLanguageInputSchema.parse({ purpose: "document.edit", prompt: "价格改为 20", artifactId: "doc", baseRevision: 1, sectionId: "second", blockIds: ["table"] });

it("keeps stable IDs across sections, list items, rows and cells and refuses nonrectangular tables", () => {
  const doc = fixture();
  expect(doc.page).toMatchObject({ size: "A4", pageNumbers: true, marginLeft: 54 });
  doc.sections[1].blocks[0].rows[0].cells[0].id = "intro";
  expect(() => textDocumentSchema.parse(doc)).toThrow("DUPLICATE_DOCUMENT_ID");
  doc.sections[1].blocks[0].rows[0].cells[0].id = "table";
  expect(() => textDocumentSchema.parse(doc)).toThrow("DUPLICATE_DOCUMENT_ID");
  const malformed = fixture(); malformed.sections[1].blocks[0].rows.push({ id: "row2", cells: [{ id: "cell-c", runs: [] }] });
  expect(() => textDocumentSchema.parse(malformed)).toThrow("DOCUMENT_TABLE_SHAPE");
});

it("changes only the target cell and keeps other sections, paragraphs and cells by reference", () => {
  const original = fixture(), next = applyDocumentOperations(original, documentOperationsSchema.parse([patch()]));
  expect(next.sections[0]).toBe(original.sections[0]);
  expect(next.sections[1].blocks[0].rows[0].cells[0]).toBe(original.sections[1].blocks[0].rows[0].cells[0]);
  expect(next.sections[1].blocks[0].rows[0].cells[1].runs[0].text).toBe("20");
  expect(original.sections[1].blocks[0].rows[0].cells[1].runs[0].text).toBe("18");
});

it("preserves unselected inline styles and restores exact run segmentation through undo", () => {
  const doc = fixture(); doc.sections[0].blocks[0].runs = [{ text: "Coffee ", marks: { bold: true } }, { text: "18 dollars", marks: { italic: true } }];
  const op = { op: "replaceDocumentText", sectionId: "first", blockId: "intro", leafId: "intro", start: 7, end: 9, expectedText: "18", text: "20" };
  const changed = applyDocumentWithInverse(doc, [op]);
  expect(changed.document.sections[0].blocks[0].runs).toEqual([{ text: "Coffee ", marks: { bold: true } }, { text: "20 dollars", marks: { italic: true } }]);
  expect(applyDocumentOperations(changed.document, changed.inverse)).toEqual(doc);
});

it("checks UTF-16 selection boundaries, expected text, insertions and deletions", () => {
  const runs = [{ text: "A🧋B", marks: { bold: true } }];
  expect(() => replaceDocumentText(runs, { start: 2, end: 3, expectedText: "", text: "X" })).toThrow("DOCUMENT_RANGE_INVALID");
  expect(() => replaceDocumentText(runs, { start: 1, end: 3, expectedText: "wrong", text: "X" })).toThrow("DOCUMENT_TEXT_CHANGED");
  expect(replaceDocumentText(runs, { start: 1, end: 3, expectedText: "🧋", text: "" })).toEqual([{ text: "AB", marks: { bold: true } }]);
  expect(replaceDocumentText([], { start: 0, end: 0, expectedText: "", text: "new" })).toEqual([{ text: "new", marks: {} }]);
  expect(replaceDocumentText(runs, { start: 4, end: 4, expectedText: "", text: "!" })[0].text).toBe("A🧋B!");
});

it("enforces locks, preserves block identity, and leaves the source unchanged on a failed multi-operation change", () => {
  const doc = fixture(), before = JSON.stringify(doc);
  const forbidden = { op: "replaceDocumentText", sectionId: "first", blockId: "locked", leafId: "locked", start: 0, end: 4, expectedText: "固定数据", text: "覆盖" };
  expect(() => applyDocumentOperations(doc, [patch(), forbidden])).toThrow("DOCUMENT_BLOCK_LOCKED");
  expect(JSON.stringify(doc)).toBe(before);
  expect(() => applyDocumentOperations(doc, [{ op: "replaceDocumentBlock", sectionId: "first", blockId: "intro", block: paragraph("new", "new") }])).toThrow("DOCUMENT_BLOCK_IDENTITY_CHANGED");
});

it("restores a compound insertion, movement, text edit and lock without cloning unrelated sections", () => {
  const doc = fixture(), block = textDocumentSchema.parse({ ...doc, sections: [{ id: "new-section", title: "", blocks: [paragraph("added", "新增", { locked: true })] }] }).sections[0].blocks[0];
  const ops = [{ op: "insertDocumentBlock", sectionId: "first", index: 1, block }, patch(), { op: "moveDocumentBlock", sectionId: "first", blockId: "intro", index: 2 }];
  const changed = applyDocumentWithInverse(doc, ops);
  expect(applyDocumentOperations(changed.document, changed.inverse)).toEqual(doc);
});

it("rejects unsafe links, executable fields and overlong inline content", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,test", "https://user:pass@example.com", "https://example.com\n"]) {
    const doc = fixture(); doc.sections[0].blocks[0].runs[0].marks = { link: url }; expect(textDocumentSchema.safeParse(doc).success).toBe(false);
  }
  const doc = fixture(); doc.sections[0].blocks[0].runs[0].marks = { link: "https://example.com/page?q=1" };
  expect(textDocumentSchema.safeParse(doc).success).toBe(true);
  doc.sections[0].blocks[0].html = "<script>"; expect(textDocumentSchema.safeParse(doc).success).toBe(false);
  delete doc.sections[0].blocks[0].html; doc.sections[0].blocks[0].runs[0].text = "a".repeat(16001);
  expect(textDocumentSchema.safeParse(doc).success).toBe(false);
});

it("allows only the selected AI blocks and rejects lock changes, section-wide edits and unknown assets", () => {
  const input = edit(), doc = fixture();
  expect(validateDocumentLanguageResult(input, { operations: [patch()] }, doc)).toEqual({ operations: [patch()] });
  for (const op of [{ op: "setDocumentTitle", title: "Changed" }, { op: "setDocumentLock", sectionId: "second", blockId: "table", locked: false }, { ...patch(), sectionId: "first", blockId: "intro", leafId: "intro" }]) expect(() => validateDocumentLanguageResult(input, { operations: [op] }, doc)).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  const image = { id: "table", locked: false, type: "image", assetId: "unowned", width: 100, height: 100 };
  expect(() => validateDocumentLanguageResult(input, { operations: [{ op: "replaceDocumentBlock", sectionId: "second", blockId: "table", block: image }] }, doc)).toThrow("LANGUAGE_UNKNOWN_ASSET");
});

it("binds an AI text selection to one exact splice instead of allowing shifted or enlarged edits", () => {
  const input = { ...edit(), range: { blockId: "table", leafId: "cell-b", start: 0, end: 2, expectedText: "18" } };
  expect(validateDocumentLanguageResult(input, { operations: [patch()] }, fixture()).operations).toHaveLength(1);
  expect(() => validateDocumentLanguageResult(input, { operations: [patch(), { ...patch(), expectedText: "20", text: "22" }] }, fixture())).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  expect(() => validateDocumentLanguageResult(input, { operations: [{ ...patch(), end: 1, expectedText: "1" }] }, fixture())).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
});

it("validates requested outline count and exact section identity, and rejects empty AI sections", () => {
  const outline = { title: "Report", sections: [{ id: "s", title: "Summary", brief: "Facts only" }] };
  expect(() => validateDocumentLanguageResult({ purpose: "document.outline", sectionCount: 2 }, outline)).toThrow("LANGUAGE_OUTLINE_MISMATCH");
  const input = { purpose: "document.section", sectionId: "s", title: "Summary", brief: "Facts only", documentTitle: outline.title, headings: outline.sections.map(({ id, title }) => ({ id, title })), assetIds: [] };
  const section = { id: "s", title: "Summary", blocks: [paragraph("p", "Hello")] };
  expect(validateDocumentLanguageResult(input, section).id).toBe("s");
  expect(() => validateDocumentLanguageResult(input, { ...section, id: "other" })).toThrow("LANGUAGE_DOCUMENT_MISMATCH");
  expect(() => validateDocumentLanguageResult(input, { ...section, blocks: [paragraph("p", " ")] })).toThrow("LANGUAGE_EMPTY_DOCUMENT");
});
