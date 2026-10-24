import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import JSZip from "jszip";
import { Univer, UniverInstanceType, resolveDocumentParagraphStyle } from "@univerjs/core";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { parseNativeDocumentForDocx } from "../../src/lib/creation/exports/native-docx-model.js";
import { buildNativeDocumentDocx } from "../../src/lib/creation/exports/native-docx.js";
import { applyNativeDocumentOperations, nativeDocumentSelection } from "../../src/lib/creation/native-document-edit.js";

const runs = text => [{ text, marks: {} }];
const source = () => ({ schemaVersion: 1, kind: "document", title: "品牌报告", page: { header: "机密 & 内部", footer: "页脚", pageNumbers: true }, sections: [{ id: "s", title: "报告", blocks: [
  { id: "h", type: "heading", level: 2, runs: runs("咖啡品牌😀") },
  { id: "p", type: "paragraph", style: { align: "justify", spaceBefore: 4, spaceAfter: 10, lineHeight: 1.8 }, runs: [
    { text: "重点 <文字> ", marks: { bold: true, italic: true, underline: true, strike: true, color: "#123456", highlight: "#ddeeff" } },
    { text: "访问网站", marks: { link: "https://example.test/?a=1&b=2" } }, { text: "\n下一段\t结束", marks: {} },
  ] },
  { id: "list", type: "list", ordered: true, start: 5, items: [{ id: "i1", depth: 0, runs: runs("第一条") }, { id: "i2", depth: 1, runs: runs("子项") }, { id: "i3", depth: 0, runs: runs("第二条") }] },
  { id: "table", type: "table", headerRows: 1, rows: [{ id: "r1", cells: [{ id: "a", runs: runs("商品") }, { id: "b", runs: runs("金额") }] }, { id: "r2", cells: [{ id: "c", runs: runs("咖啡\n豆") }, { id: "d", runs: runs("¥ 99") }] }] },
  { id: "image", type: "image", assetId: "photo", width: 120, height: 80, alt: "产品图", caption: "参考图" },
  { id: "break", type: "pageBreak" },
] }, { id: "s2", title: "结束", blocks: [{ id: "end", type: "paragraph", runs: runs("结论") }] }] });
const native = () => toNativeDocumentArtifact(source(), "unit");
const images = new Map([["photo", { bytes: Buffer.from("verified in child"), width: 120, height: 80, format: "png" }]]);
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const nodes = (doc, name) => [...doc.getElementsByTagNameNS(W, name)];
async function inspect(bytes) {
  const zip = await JSZip.loadAsync(bytes), docs = {};
  for (const [path, file] of Object.entries(zip.files)) if (!file.dir && /\.(xml|rels)$/.test(path)) docs[path] = new JSDOM(await file.async("string"), { contentType: "application/xml" }).window.document;
  return { zip, docs };
}
it("exports the real browser-edited preset snapshot and rejects populated permission rules", async () => {
  const content = JSON.parse(readFileSync(new URL("../fixtures/creation-native-document-browser.json", import.meta.url), "utf8"));
  const before = structuredClone(content), { docs } = await inspect(await buildNativeDocumentDocx(content, new Map()));
  expect(nodes(docs["word/document.xml"], "t").map(node => node.textContent).join("")).toContain("后退时保存：");
  expect(content).toEqual(before);
  const resource = content.snapshot.resources.find(item => item.name === "DOC_OBJECT_PERMISSION_PLUGIN");
  resource.data = '[{"objectId":"p0","permissionId":"private","objectType":3}]';
  expect(() => parseNativeDocumentForDocx(content)).toThrow("EXPORT_NATIVE_DOCUMENT_UNSUPPORTED");
});
it("exports the complete generated block vocabulary directly from native data as real DOCX ZIP/XML", async () => {
  const input = native(), before = structuredClone(input), { zip, docs } = await inspect(await buildNativeDocumentDocx(input, images)), main = docs["word/document.xml"];
  expect(input).toEqual(before);
  const text = nodes(main, "t").map(node => node.textContent).join("");
  for (const word of ["咖啡品牌😀", "重点 <文字>", "访问网站", "下一段", "第一条", "子项", "第二条", "商品", "金额", "咖啡", "¥ 99", "参考图", "结论"]) expect(text).toContain(word);
  expect(nodes(main, "tbl")).toHaveLength(1); expect(nodes(main, "tr")).toHaveLength(2); expect(nodes(main, "tc")).toHaveLength(4);
  expect(nodes(main, "tblHeader")[0].getAttributeNS(W, "val")).toBe("1");
  expect(nodes(main, "b").length).toBeGreaterThan(0); expect(nodes(main, "i").length).toBeGreaterThan(0);
  expect(nodes(main, "color").some(n => n.getAttributeNS(W, "val") === "123456")).toBe(true);
  expect(nodes(main, "outlineLvl")[0].getAttributeNS(W, "val")).toBe("1");
  expect(nodes(main, "pStyle")[0].getAttributeNS(W, "val")).toBe("NativeStyle5");
  expect(nodes(main, "spacing").some(n => n.getAttributeNS(W, "line") === "432")).toBe(true);
  expect(nodes(main, "br").filter(n => n.getAttributeNS(W, "type") === "page")).toHaveLength(1);
  expect(nodes(main, "tab")).toHaveLength(1);
  expect(nodes(main, "sectPr")).toHaveLength(2); expect(nodes(main, "pgNumType")).toHaveLength(1);
  expect(nodes(docs["word/footer1.xml"], "fldSimple")[0].getAttributeNS(W, "instr")).toBe(" PAGE ");
  expect(nodes(docs["word/header1.xml"], "t")[0].textContent).toBe("机密 & 内部");
  expect(nodes(docs["word/numbering.xml"], "startOverride").map(n => n.getAttributeNS(W, "val"))).toEqual(["5", "5"]);
  expect(zip.file("word/media/image1.png")).not.toBeNull();
  expect(docs["word/_rels/document.xml.rels"].documentElement.textContent).not.toContain("/api/assets/");
  const links = [...docs["word/_rels/document.xml.rels"].getElementsByTagName("Relationship")].filter(n => n.getAttribute("Type").endsWith("/hyperlink"));
  expect(links[0].getAttribute("Target")).toBe("https://example.test/?a=1&b=2");
  const hyperlink = nodes(main, "hyperlink")[0];
  expect(nodes(hyperlink, "color")[0].getAttributeNS(W, "val")).toBe("2563EB");
  expect(nodes(hyperlink, "u")[0].getAttributeNS(W, "val")).toBe("single");
});

it("accepts an actual 1.2.0 document model snapshot and preserves inline style boundaries", async () => {
  const input = native(), engine = new Univer();
  try {
    const model = engine.createUnit(UniverInstanceType.UNIVER_DOC, input.snapshot), content = { ...input, snapshot: model.getSnapshot() };
    const { docs } = await inspect(await buildNativeDocumentDocx(content, images));
    const main = docs["word/document.xml"], run = nodes(main, "r").find(n => nodes(n, "t").some(t => t.textContent.startsWith("重点")));
    expect(nodes(run, "b")[0].getAttributeNS(W, "val")).toBe("1");
    expect(nodes(run, "shd")[0].getAttributeNS(W, "fill")).toBe("DDEEFF");
  } finally { engine.dispose(); }
});

it("keeps rendered soft page breaks soft and supports fields/links in their owning header part", async () => {
  const input = native(), index = input.snapshot.body.dataStream.indexOf("\f"); input.snapshot.body.renderedPageBreaks = [index];
  const mainRange = input.snapshot.body.customRanges[0], headerId = input.snapshot.documentStyle.defaultHeaderId;
  input.snapshot.headers[headerId].body = { dataStream: "\x1f网站\x1e\r\n", paragraphs: [{ paragraphId: "headerp", startIndex: 4 }], sectionBreaks: [{ sectionId: "headers", startIndex: 5, sectionType: 1 }], customRanges: [{ ...mainRange, rangeId: "header-link", startIndex: 0, endIndex: 3 }] };
  const { docs } = await inspect(await buildNativeDocumentDocx(input, images));
  expect(nodes(docs["word/document.xml"], "lastRenderedPageBreak")).toHaveLength(1);
  expect(nodes(docs["word/document.xml"], "br")).toHaveLength(0);
  expect(docs["word/_rels/header1.xml.rels"].getElementsByTagName("Relationship")[0].getAttribute("Target")).toBe(mainRange.properties.url);
});

it("refuses corrupt positional data and unmapped source features rather than discarding them", async () => {
  for (const alter of [
    d => { d.snapshot.body.textRuns[0].st = 1; d.snapshot.body.textRuns[0].ed = 2; },
    d => { d.snapshot.body.paragraphs[0].startIndex--; },
    d => { d.snapshot.body.tables[0].endIndex--; },
    d => { d.snapshot.body.customBlocks[0].startIndex--; },
    d => { d.snapshot.body.customRanges[0].endIndex--; },
    d => { d.snapshot.body.renderedPageBreaks = [0]; },
  ]) {
    const input = native(); alter(input);
    // The first fixture places a format boundary in the heading's surrogate pair.
    if (input.snapshot.body.textRuns[0].ed === 2) { const emoji = input.snapshot.body.dataStream.indexOf("😀"); input.snapshot.body.textRuns[0].st = emoji + 1; input.snapshot.body.textRuns[0].ed = emoji + 2; }
    expect(() => parseNativeDocumentForDocx(input)).toThrow("EXPORT_NATIVE_DOCUMENT_INVALID");
  }
  for (const alter of [
    d => { d.snapshot.body.customDecorations = [{ id: "comment", type: 0, startIndex: 0, endIndex: 2 }]; },
    d => { d.snapshot.body.docxRawBlocks = [{ startIndex: 0, xml: "<w:object/>" }]; },
    d => { d.snapshot.styles = { imported: { name: "Custom", type: 1 } }; },
    d => { d.snapshot.resources = [{ name: "DOC_NOTE_PLUGIN", data: '{"note":1}' }]; },
    d => { Object.values(d.snapshot.drawings)[0].layoutType = 3; },
    d => { Object.values(d.snapshot.tableSource)[0].tableRows[0].tableCells[0].rowSpan = 2; },
    d => { d.snapshot.body.customRanges[0].properties.url = "javascript:alert(1)"; },
  ]) { const input = native(); alter(input); const before = structuredClone(input); await expect(buildNativeDocumentDocx(input, images)).rejects.toThrow("EXPORT_NATIVE_DOCUMENT_UNSUPPORTED"); expect(input).toEqual(before); }
});

it("refuses missing private image bytes and bounds output", async () => {
  await expect(buildNativeDocumentDocx(native())).rejects.toThrow("EXPORT_IMAGE_UNSUPPORTED");
  await expect(buildNativeDocumentDocx(native(), images, { maxBytes: 10 })).rejects.toThrow("EXPORT_RESULT_TOO_LARGE");
});

it("preserves revised text, link/style boundaries and table positions after the real controlled AI operation", async () => {
  const original = native(), start = original.snapshot.body.dataStream.indexOf("重点"), selected = nativeDocumentSelection(original, { unitId: "unit", segmentId: "", start, end: start + 2 });
  const revised = applyNativeDocumentOperations(original, [{ op: "replaceNativeText", segmentId: "", ...selected.spans[0], text: "更加突出的重点😀" }], selected);
  const { docs } = await inspect(await buildNativeDocumentDocx(revised, images)), main = docs["word/document.xml"];
  const run = nodes(main, "r").find(n => nodes(n, "t").some(t => t.textContent.startsWith("更加")));
  expect(nodes(run, "t")[0].textContent).toBe("更加突出的重点😀 <文字> ");
  expect(nodes(run, "b")[0].getAttributeNS(W, "val")).toBe("1");
  expect(nodes(main, "tbl")).toHaveLength(1); expect(nodes(main, "hyperlink")).toHaveLength(1);
  expect(nodes(main, "drawing")).toHaveLength(1);
});

it("matches installed paragraph default precedence and retains explicit off/hidden text formatting", async () => {
  const input = native(), d = input.snapshot.documentStyle, p = input.snapshot.body.paragraphs[0];
  d.defaultParagraphStyle = { spaceAbove: { v: 90 }, spaceBelow: { v: 91 }, lineSpacing: 2, widowControl: 0 };
  p.paragraphStyle = { namedStyleType: 4, spaceBelow: { v: 8 }, textStyle: { bl: 0, it: 1, hidden: true, fs: 22 }, paragraphMarkTextStyle: { bl: 1 } };
  const expected = resolveDocumentParagraphStyle(d, p.paragraphStyle), { docs } = await inspect(await buildNativeDocumentDocx(input, images)), paragraph = nodes(docs["word/document.xml"], "p")[0];
  const spacing = nodes(paragraph, "spacing")[0];
  expect(spacing.getAttributeNS(W, "before")).toBe(String(expected.spaceAbove.v * 20));
  expect(spacing.getAttributeNS(W, "after")).toBe(String(expected.spaceBelow.v * 20));
  expect(spacing.getAttributeNS(W, "line")).toBe(String(expected.lineSpacing * 240));
  const run = nodes(paragraph, "r")[0];
  expect(nodes(run, "b")[0].getAttributeNS(W, "val")).toBe("0"); expect(nodes(run, "vanish")[0].getAttributeNS(W, "val")).toBe("1");
  expect(nodes(run, "sz")[0].getAttributeNS(W, "val")).toBe("44");
});

it("inherits section geometry, continues page numbering by default and retains explicit restarts", async () => {
  const input = native(), sections = input.snapshot.body.sectionBreaks.filter(s => s.startIndex > input.snapshot.body.tables[0].endIndex);
  sections[0].marginLeft = 96; sections[1].pageNumberStart = 12; sections[1].sectionType = 3;
  const { docs } = await inspect(await buildNativeDocumentDocx(input, images)), main = docs["word/document.xml"];
  expect(nodes(main, "pgMar").map(n => n.getAttributeNS(W, "left"))).toEqual(["1440", "1440"]);
  expect(nodes(main, "pgNumType").map(n => n.getAttributeNS(W, "start"))).toEqual(["1", "12"]);
  expect(nodes(main, "type").map(n => n.getAttributeNS(W, "val"))).toEqual(["continuous", "nextPage"]);
});

it("bounds inline fragmentation before serialization and fails unsafe fields deterministically", async () => {
  const input = native(), stream = "a\t".repeat(50001);
  input.snapshot.body = { dataStream: stream + "\r\n", paragraphs: [{ paragraphId: "p", startIndex: stream.length }], sectionBreaks: [{ sectionId: "s", startIndex: stream.length + 1, sectionType: 1 }] };
  expect(() => parseNativeDocumentForDocx(input)).toThrow("EXPORT_NATIVE_DOCUMENT_LIMIT");
  const unsafe = native(), footer = Object.values(unsafe.snapshot.footers)[0];
  const field = footer.body.customRanges[0]; field.properties.instruction = "INCLUDETEXT https://example.test/remote";
  await expect(buildNativeDocumentDocx(unsafe, images)).rejects.toThrow("EXPORT_NATIVE_DOCUMENT_UNSUPPORTED");
  field.properties.instruction = 42;
  await expect(buildNativeDocumentDocx(unsafe, images)).rejects.toThrow("EXPORT_NATIVE_DOCUMENT_UNSUPPORTED");
});

it("respects hyperlinks that explicitly retain authored text style and color", async () => {
  const input = native(), range = input.snapshot.body.customRanges[0];
  input.snapshot.body.textRuns.push({ st: range.startIndex + 1, ed: range.endIndex, ts: { cl: { rgb: "#ff0000" }, ul: { s: 0 } } });
  input.snapshot.body.textRuns.sort((a, b) => a.st - b.st);
  range.properties.textStyleMode = "text";
  const { docs } = await inspect(await buildNativeDocumentDocx(input, images)), link = nodes(docs["word/document.xml"], "hyperlink")[0];
  expect(nodes(link, "color")[0].getAttributeNS(W, "val")).toBe("FF0000"); expect(nodes(link, "u")[0].getAttributeNS(W, "val")).toBe("none");
});
