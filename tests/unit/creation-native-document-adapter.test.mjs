import { expect, it } from "vitest";
import { Univer, UniverInstanceType, validateDocumentStructure, DataStreamTreeTokenType } from "@univerjs/core";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { nativeDocumentAssetSource } from "../../src/lib/creation/native-office-media.js";
import { assertNativeOfficeRuntimeContent } from "../../src/lib/creation/client/native-office-policy.js";

const runs = text => [{ text, marks: {} }];
const source = () => ({ schemaVersion: 1, kind: "document", title: "报告", locale: "zh", page: { header: "品牌报告", footer: "内部参考", pageNumbers: true },
  sections: [{ id: "section", title: "原章节", blocks: [
    { id: "heading", type: "heading", level: 6, runs: runs("六级标题😀") },
    { id: "paragraph", type: "paragraph", style: { align: "justify", lineHeight: 1.8, spaceBefore: 4, spaceAfter: 10 }, runs: [
      { text: "中文😀", marks: { bold: true, italic: true, underline: true, strike: true, color: "#112233", highlight: "#eeeeee" } },
      { text: "网站\n下一行", marks: { link: "https://example.test/path", bold: false } },
    ] },
    { id: "list", type: "list", ordered: true, start: 5, items: [{ id: "item1", depth: 0, runs: runs("第一条") }, { id: "item2", depth: 1, runs: runs("嵌套条目") }, { id: "item3", depth: 0, runs: runs("第二条") }] },
    { id: "table", type: "table", headerRows: 1, rows: [
      { id: "row1", cells: [{ id: "a", runs: runs("产品") }, { id: "b", runs: runs("价格") }] },
      { id: "row2", cells: [{ id: "c", runs: runs("咖啡\n豆") }, { id: "d", runs: runs("¥ 99") }] },
    ] },
    { id: "image", type: "image", assetId: "asset_a", width: 1200, height: 800, alt: "咖啡商品", caption: "参考图片" },
    { id: "break", type: "pageBreak" },
  ] }, { id: "section2", title: "结尾", blocks: [{ id: "end", type: "paragraph", runs: runs("结束") }] }],
});

it("converts every authored block into a structurally valid installed Univer document, including nested table/link sentinels", () => {
  const input = source(), before = structuredClone(input), result = toNativeDocumentArtifact(input, "unit"), snapshot = result.snapshot;
  expect(validateDocumentStructure(snapshot)).toEqual([]);
  expect(assertNativeOfficeRuntimeContent(result)).toEqual(result);
  expect(input).toEqual(before);
  expect(snapshot.body.tables).toHaveLength(1); expect(snapshot.body.customBlocks).toHaveLength(1);
  const table = snapshot.body.tables[0];
  expect(snapshot.body.dataStream[table.startIndex]).toBe("\x1a");
  expect(snapshot.body.dataStream[table.endIndex - 1]).toBe(DataStreamTreeTokenType.TABLE_END);
  expect(snapshot.body.dataStream).toContain("\f\r\n");
  expect(snapshot.custom.modelshot.sections.map(item => item.sourceId)).toEqual(["section", "section2"]);
  for (const leaf of ["heading", "paragraph", "item1", "item2", "item3", "a", "b", "c", "d", "end"]) expect(snapshot.custom.modelshot.mappings.some(item => item.leafId === leaf)).toBe(true);
  const engine = new Univer();
  try {
    const unit = engine.createUnit(UniverInstanceType.UNIVER_DOC, structuredClone(snapshot));
    const saved = unit.getSnapshot();
    expect(validateDocumentStructure(saved)).toEqual([]);
    for (const key of ["body", "tableSource", "lists", "headers", "footers", "drawings", "custom"]) expect(saved[key]).toEqual(snapshot[key]);
  } finally { engine.dispose(); }
});

it("admits only declared asset URLs and safe link/page fields, including hidden image-source fields", () => {
  const result = toNativeDocumentArtifact(source(), "unit");
  const altered = change => { const input = structuredClone(result); change(input); return input; };
  for (const input of [
    altered(value => { value.assetIds = []; }),
    altered(value => { Object.values(value.snapshot.drawings)[0].source = "https://example.test/tracker.png"; }),
    altered(value => { value.snapshot.documentStyle.background = { source: "https://example.test/background.png" }; }),
    altered(value => { value.snapshot.body.customRanges[0].properties.url = "javascript:alert(1)"; }),
    altered(value => { const footer = Object.values(value.snapshot.footers)[0]; footer.body.customRanges[0].properties.instruction = "INCLUDETEXT https://example.test"; }),
  ]) expect(() => assertNativeOfficeRuntimeContent(input)).toThrow("NATIVE_OFFICE_MEDIA_UNSUPPORTED");
});

it("maps UTF-16 style/link spans and line breaks without exposing stream control characters as text", () => {
  const { snapshot } = toNativeDocumentArtifact(source(), "unit"), body = snapshot.body;
  const styled = body.textRuns.find(run => run.ts.it === 1);
  expect(body.dataStream.slice(styled.st, styled.ed)).toBe("中文😀"); expect(styled.ed - styled.st).toBe(4);
  expect(styled.ts).toMatchObject({ bl: 1, it: 1, ul: { s: 1 }, st: { s: 1 }, cl: { rgb: "#112233" }, bg: { rgb: "#eeeeee" } });
  expect(body.customRanges.map(range => body.dataStream.slice(range.startIndex + 1, range.endIndex))).toEqual(["网站", "下一行"]);
  const map = snapshot.custom.modelshot.mappings.find(item => item.leafId === "paragraph");
  expect(map.paragraphIds).toHaveLength(2);
  const paragraphs = body.paragraphs.filter(item => map.paragraphIds.includes(item.paragraphId));
  expect(paragraphs[0].paragraphStyle).toMatchObject({ horizontalAlign: 4, lineSpacing: 1.8, spaceAbove: { v: 4, u: 0 }, spaceBelow: { v: 0, u: 0 } });
  expect(paragraphs[1].paragraphStyle.spaceBelow).toEqual({ v: 10, u: 0 });
  const heading = body.paragraphs[0];
  expect(heading.paragraphStyle).toMatchObject({ outlineLevel: 5, textStyle: { bl: 1, fs: 12 } });
});

it("keeps editable numbering/table headers and uses distinct source mappings with safe generated native keys", () => {
  const input = source(); input.sections[0].id = "__proto__"; input.sections[0].blocks[2].id = "constructor";
  const { snapshot } = toNativeDocumentArtifact(input, "unit");
  const bullets = snapshot.body.paragraphs.filter(item => item.bullet).map(item => item.bullet);
  expect(bullets.map(item => item.nestingLevel)).toEqual([0, 1, 0]);
  // Univer adds its one-based item index to this zero-based starting offset.
  expect(bullets[0].startNumber).toBe(4); expect(bullets[2].startNumber).toBeUndefined();
  const table = Object.values(snapshot.tableSource)[0];
  expect(table.tableRows.map(row => row.repeatHeaderRow)).toEqual([1, 0]);
  expect(table.tableRows[0].tableCells).toHaveLength(2);
  expect(snapshot.custom.modelshot.sections[0].sourceId).toBe("__proto__");
  expect(snapshot.custom.modelshot.mappings.some(item => item.blockId === "constructor")).toBe(true);
});

it("converts page geometry in pixels while keeping text/spacing in points, and preserves page fields and owned image references", () => {
  const input = source(); input.page = { ...input.page, size: "Letter", orientation: "landscape", marginLeft: 36, marginRight: 36 };
  const { snapshot, assetIds } = toNativeDocumentArtifact(input, "unit");
  expect(snapshot.documentStyle).toMatchObject({ documentFlavor: 1, pageOrient: 1, pageSize: { width: 1056, height: 816 }, marginLeft: 48, marginRight: 48, textStyle: { fs: 12 } });
  const footer = snapshot.footers[snapshot.documentStyle.defaultFooterId];
  expect(footer.body.customRanges[0]).toMatchObject({ rangeType: 1, properties: { instruction: "PAGE", fieldType: "PAGE" } });
  const image = Object.values(snapshot.drawings)[0];
  expect(image.source).toBe(nativeDocumentAssetSource("asset_a")); expect(image.imageSourceType).toBe("URL");
  expect(assetIds).toEqual(["asset_a"]); expect(image.description).toBe("咖啡商品");
  expect(image.docTransform.size.width / image.docTransform.size.height).toBeCloseTo(1.5);
  expect(image.docTransform.size.width).toBeLessThanOrEqual(960); expect(image.docTransform.size.height).toBeLessThanOrEqual(672);
});

it("refuses unsupported controls and locked content rather than silently discarding text or unlocking it", () => {
  for (const text of ["bad\x1atext", "bad\u0000text", "bad\ud800text"]) {
    const input = source(); input.sections[0].blocks[0].runs = runs(text);
    expect(() => toNativeDocumentArtifact(input, "unit")).toThrow("NATIVE_DOCUMENT_TEXT_UNSUPPORTED");
  }
  const input = source(); input.sections[0].blocks[0].locked = true;
  expect(() => toNativeDocumentArtifact(input, "unit")).toThrow("NATIVE_DOCUMENT_LOCKED_CONTENT");
});
