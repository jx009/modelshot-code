import { expect, it } from "vitest";
import { TextX, Univer, UniverInstanceType, validateDocumentStructure } from "@univerjs/core";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { applyNativeDocumentOperations, nativeDocumentSelection, nativeDocumentTargetFromReference, validateNativeDocumentSelection } from "../../src/lib/creation/native-document-edit.js";
import { languageInputSchema, validateLanguageResult } from "../../src/lib/creation/contracts/language.js";
import { creationLanguageMessages } from "../../src/lib/domain/creation/language-provider.js";

const runs = text => [{ text, marks: {} }];
const source = () => toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "Report", page: { header: "Header", footer: "Footer", pageNumbers: true }, sections: [{ id: "s", title: "Section", blocks: [
  { id: "p", type: "paragraph", runs: [{ text: "Hello😀", marks: { bold: true } }, { text: " world", marks: {} }, { text: "Link", marks: { link: "https://example.test" } }] },
  { id: "list", type: "list", ordered: true, items: [{ id: "item", depth: 0, runs: runs("List item") }] },
  { id: "table", type: "table", rows: [{ id: "row", cells: [{ id: "cell1", runs: runs("Table cell") }, { id: "cell2", runs: runs("Untouched") }] }] },
  { id: "image", type: "image", assetId: "asset", width: 200, height: 100, alt: "Picture" },
  { id: "break", type: "pageBreak" }, { id: "tail", type: "paragraph", runs: runs("Private tail") },
] }] }, "unit");
const selected = (content, text, segmentId = "") => {
  const body = segmentId ? (content.snapshot.headers[segmentId] || content.snapshot.footers[segmentId]).body : content.snapshot.body;
  const start = body.dataStream.indexOf(text);
  return { ...nativeDocumentSelection(content, { unitId: "unit", segmentId, start, end: start + text.length }), artifactId: "a", baseRevision: 1 };
};
const operation = (target, text, index = 0) => ({ op: "replaceNativeText", segmentId: target.segmentId, ...target.spans[index], text });

it("replaces mixed-style text and hyperlink contents while retaining table/image/list anchors and all unrelated segments", () => {
  const original = source(), before = structuredClone(original);
  const target = selected(original, "Hello😀 world\x1fLink\x1e");
  expect(target.spans.map(span => span.expectedText)).toEqual(["Hello😀", " world", "Link"]);
  const operations = [operation(target, "你好😀"), operation(target, "朋友们", 1), operation(target, "查看网站", 2)];
  const result = applyNativeDocumentOperations(original, operations, target), snapshot = result.snapshot;
  expect(original).toEqual(before); expect(snapshot.body.dataStream).toContain("你好😀朋友们\x1f查看网站\x1e\r");
  expect(validateDocumentStructure(snapshot)).toEqual([]);
  for (const key of ["headers", "footers", "lists", "tableSource", "drawings", "drawingsOrder", "documentStyle", "resources", "custom"]) expect(snapshot[key]).toEqual(before.snapshot[key]);
  const link = snapshot.body.customRanges[0];
  expect(snapshot.body.dataStream.slice(link.startIndex + 1, link.endIndex)).toBe("查看网站");
  expect(link.rangeId).toBe(before.snapshot.body.customRanges[0].rangeId);
  const bold = snapshot.body.textRuns.find(run => run.ts.bl === 1);
  expect(snapshot.body.dataStream.slice(bold.st, bold.ed)).toBe("你好😀");
  expect(snapshot.body.dataStream[snapshot.body.customBlocks[0].startIndex]).toBe("\b");
  const engine = new Univer();
  try { expect(engine.createUnit(UniverInstanceType.UNIVER_DOC, structuredClone(snapshot)).getSnapshot().body).toEqual(snapshot.body); }
  finally { engine.dispose(); }
});

it("edits text inside a table cell without changing its structure or other cell contents", () => {
  const original = source(), target = selected(original, "Table cell");
  const next = applyNativeDocumentOperations(original, [operation(target, "A much longer rewritten cell😀")], target);
  expect(validateDocumentStructure(next.snapshot)).toEqual([]);
  expect(next.snapshot.tableSource).toEqual(original.snapshot.tableSource);
  expect(next.snapshot.body.dataStream).toContain("Untouched");
  expect(next.snapshot.body.tables[0].tableId).toBe(original.snapshot.body.tables[0].tableId);
  expect(next.snapshot.body.tables[0].endIndex).toBe(original.snapshot.body.tables[0].endIndex + "A much longer rewritten cell😀".length - "Table cell".length);
});

it("retains paragraph and style boundaries across a multi-paragraph selection without giving the model structural tokens", () => {
  const original = source(), stream = original.snapshot.body.dataStream;
  const start = stream.indexOf(" world"), end = stream.indexOf("List item") + 9;
  const target = { ...nativeDocumentSelection(original, { unitId: "unit", segmentId: "", start, end }), artifactId: "a", baseRevision: 1 };
  const input = languageInputSchema.parse({ ...target, purpose: "document.native.edit", prompt: "Polish these paragraphs" });
  const messages = creationLanguageMessages({ input, source: original, assets: [] }), context = JSON.parse(messages[1].content).source;
  expect(context.spans.map(span => span.expectedText)).toEqual([" world", "Link", "List item"]);
  expect(context.spans[0].paragraphId).toBe(context.spans[1].paragraphId); expect(context.spans[2].paragraphId).not.toBe(context.spans[0].paragraphId);
  expect(messages[1].content).not.toContain("Private tail"); expect(messages[1].content).not.toContain("tableSource");
  expect(messages[0].content).toContain("replaceNativeText");
  expect(() => validateLanguageResult(input, { operations: [operation(target, "new\rparagraph")] }, original)).toThrow();
});

it("supports isolated header/footer text and refuses field contents or a disabled document", () => {
  const original = source(), headerId = Object.keys(original.snapshot.headers)[0], footerId = Object.keys(original.snapshot.footers)[0];
  const target = selected(original, "Header", headerId);
  const next = applyNativeDocumentOperations(original, [operation(target, "New header")], target);
  expect(next.snapshot.body).toEqual(original.snapshot.body); expect(next.snapshot.footers).toEqual(original.snapshot.footers);
  expect(next.snapshot.headers[headerId].body.dataStream).toBe("New header\r\n");
  expect(() => selected(original, "1", footerId)).toThrow("NATIVE_DOCUMENT_AI_PROTECTED");
  original.snapshot.disabled = true;
  expect(() => applyNativeDocumentOperations(original, [operation(target, "Hidden overwrite")], target)).toThrow("NATIVE_DOCUMENT_AI_PROTECTED");
});

it("rejects stale text, revision drift, scope expansion and splitting UTF-16 surrogate pairs", () => {
  const original = source(), target = selected(original, "Hello😀");
  expect(nativeDocumentTargetFromReference(target, { content: original, revision: 1 }, "a")).toEqual(target);
  expect(() => nativeDocumentTargetFromReference(target, { content: original, revision: 2 }, "a")).toThrow("LANGUAGE_SELECTION_CHANGED");
  expect(() => validateNativeDocumentSelection({ ...target, unitId: "other" }, original)).toThrow("LANGUAGE_SELECTION_CHANGED");
  const outside = selected(original, "Private tail");
  expect(() => applyNativeDocumentOperations(original, [operation(outside, "Changed")], target)).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  expect(() => applyNativeDocumentOperations(original, [{ ...operation(target, "Changed"), expectedText: "Stale😀" }], target)).toThrow();
  expect(() => nativeDocumentSelection(original, { unitId: "unit", segmentId: "", start: 0, end: 6 })).toThrow("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
  expect(() => applyNativeDocumentOperations(original, [operation(target, "\ud800")], target)).toThrow();
});

it("fails closed on unsupported positional metadata and preserves the source rather than stripping fields", () => {
  for (const key of ["columnGroups", "blockRanges", "docxRawBlocks", "docxExportExcludedRanges", "futureRanges"]) {
    const original = source(), target = selected(original, "Hello😀"); original.snapshot.body[key] = [{ startIndex: 50, endIndex: 70 }];
    const before = structuredClone(original);
    expect(() => applyNativeDocumentOperations(original, [operation(target, "Changed")], target)).toThrow("NATIVE_DOCUMENT_AI_STRUCTURE_UNSUPPORTED");
    expect(original).toEqual(before);
  }
});

it("moves inclusive comment ranges and soft page breaks, preserving annotation identity and rejecting anchor deletion", () => {
  const original = source(), start = original.snapshot.body.dataStream.indexOf("List item");
  original.snapshot.body.customDecorations = [{ startIndex: start, endIndex: start + 8, id: "comment", type: 0 }];
  original.snapshot.body.renderedPageBreaks = [original.snapshot.body.dataStream.indexOf("\f")];
  const target = selected(original, "List item"), next = applyNativeDocumentOperations(original, [operation(target, "Revised item😀")], target);
  const range = next.snapshot.body.customDecorations[0];
  expect(next.snapshot.body.dataStream.slice(range.startIndex, range.endIndex + 1)).toBe("Revised item😀"); expect(range.id).toBe("comment");
  expect(next.snapshot.body.dataStream[next.snapshot.body.renderedPageBreaks[0]]).toBe("\f");
  expect(() => applyNativeDocumentOperations(original, [operation(target, "")], target)).toThrow("NATIVE_DOCUMENT_AI_PROTECTED");
  const mixed = source();
  mixed.snapshot.body.customDecorations = [{ startIndex: 0, endIndex: 12, id: "mixed", type: 0 }];
  const mixedTarget = selected(mixed, "Hello😀 world");
  expect(mixedTarget.spans).toHaveLength(2);
  expect(() => applyNativeDocumentOperations(mixed, [operation(mixedTarget, ""), operation(mixedTarget, "", 1)], mixedTarget)).toThrow("NATIVE_DOCUMENT_AI_PROTECTED");
  expect(mixed.snapshot.body.customDecorations).toHaveLength(1);
});

it("agrees with installed TextX on plain replacement offsets and per-character styles for shorter/longer/deleted text", () => {
  for (const replacement of ["", "x", "longer😀replacement", "中文"]) {
    const original = source(), target = selected(original, "Hello😀");
    const ours = applyNativeDocumentOperations(original, [operation(target, replacement)], target).snapshot.body;
    const actual = structuredClone(original.snapshot.body), span = target.spans[0], run = actual.textRuns.find(run => run.st <= span.start && run.ed >= span.end);
    const inserted = { dataStream: replacement, textRuns: replacement && run ? [{ ...run, st: 0, ed: replacement.length }] : [] };
    const textX = new TextX().retain(span.start).delete(span.end - span.start).insert(replacement.length, inserted);
    TextX.apply(actual, textX.serialize());
    expect(ours.dataStream).toBe(actual.dataStream);
    for (const key of ["paragraphs", "sectionBreaks", "customBlocks", "tables"]) expect(ours[key]).toEqual(actual[key]);
    for (let offset = 0; offset < ours.dataStream.length; offset++) {
      expect(ours.textRuns.find(run => run.st <= offset && run.ed > offset)?.ts).toEqual(actual.textRuns.find(run => run.st <= offset && run.ed > offset)?.ts);
    }
  }
});

it("bounds selection size and fragmentation and rejects repeated or overlapping operations", () => {
  const original = source(), target = selected(original, "Hello😀");
  expect(() => applyNativeDocumentOperations(original, [operation(target, "a"), operation(target, "b")], target)).toThrow("LANGUAGE_EDIT_OUTSIDE_SCOPE");
  expect(() => nativeDocumentSelection(original, { unitId: "unit", segmentId: "", start: 0, end: 1000000 })).toThrow("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
  original.snapshot.body = { dataStream: `${"a\r".repeat(65)}\n`, paragraphs: [], sectionBreaks: [] };
  expect(() => nativeDocumentSelection(original, { unitId: "unit", segmentId: "", start: 0, end: 130 })).toThrow("NATIVE_DOCUMENT_AI_SELECTION_LIMIT");
});
