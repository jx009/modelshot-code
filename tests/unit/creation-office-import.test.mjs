import { expect, it } from "vitest";
import JSZip from "jszip";
import { sourceXml, patchXml, replaceChildren, officePackage } from "../../src/lib/creation/office/package.js";
import { importWorkbook, patchWorkbook } from "../../src/lib/creation/office/xlsx.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { buildNativeWorkbookXlsx } from "../../src/lib/creation/exports/native-xlsx.js";
import { assertNativeOfficeRuntimeContent } from "../../src/lib/creation/client/native-office-policy.js";
import { Univer, UniverInstanceType } from "@univerjs/core";
import { importDocument, patchDocument } from "../../src/lib/creation/office/docx.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { buildNativeDocumentDocx } from "../../src/lib/creation/exports/native-docx.js";
import { applyNativeDocumentOperations } from "../../src/lib/creation/native-document-edit.js";
import { validateImportedReplacement } from "../../src/lib/creation/office/protection.js";
import { importOfficeInProcess } from "../../src/lib/domain/creation/office-process.js";

async function fixture(transform = () => {}) {
  const source = toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "中文预算",
    sheets: [{ id: "s", name: "收入", cells: [
      { id: "a", address: "A1", value: "中文 & <说明>", style: { bold: true } },
      { id: "b", address: "B2", value: 25.5, style: { numberFormat: "currency" } },
      { id: "c", address: "C3", formula: "=SUM(B2:B2)", style: {} },
    ], freezeRows: 1, freezeColumns: 0 }] }, "workbook");
  const zip = await JSZip.loadAsync(await buildNativeWorkbookXlsx(source));
  zip.file("customXml/item1.xml", '<unknown:root xmlns:unknown="urn:test"><!--must survive-->原件</unknown:root>');
  zip.file("xl/charts/chart1.xml", '<chart xmlns="urn:test">untouched</chart>');
  await transform(zip);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
it("attaches source spans through namespaces, comments, CDATA and quoted >; rejects overlapping edits", () => {
  const xml = sourceXml(Buffer.from('<?xml version="1.0"?><n:r xmlns:n="urn:n"><!--x--><n:a q=">"><![CDATA[<abc>]]></n:a><n:b /></n:r>'));
  const a = xml.root.children[0], b = xml.root.children[1];
  expect(xml.source.slice(a.start, a.end)).toBe('<n:a q=">"><![CDATA[<abc>]]></n:a>');
  const result = patchXml(xml.source, [replaceChildren(xml.source, b, "新"), replaceChildren(xml.source, a, "改")]);
  expect(result).toContain('<n:a q=">">改</n:a><n:b >新</n:b>');
  expect(() => patchXml(xml.source, [{ start: 0, end: 5, text: "" }, { start: 2, end: 6, text: "" }])).toThrow("OFFICE_XML_PATCH_INVALID");
});
it("imports a real XLSX, edits/adds cells and styles, preserves all unrelated package parts byte for byte", async () => {
  const bytes = await fixture(), { content } = importWorkbook(bytes);
  assertNativeOfficeRuntimeContent(content);
  const before = officePackage(bytes), sheet = content.snapshot.sheets.sheet0;
  expect(sheet.cellData[0][0].v).toBe("中文 & <说明>");
  expect(sheet.cellData[1][1].v).toBe(25.5);
  expect(sheet.cellData[2][2].f).toBe("=SUM(B2:B2)");
  sheet.cellData[0][0].v = "更新中文";
  sheet.cellData[0][0].s = { bl: 1, bg: { rgb: "#123456" }, fs: 18 };
  sheet.cellData[0][1] = { v: "右侧新增", t: 1 };
  sheet.cellData[1][0] = { v: 4, t: 2 };
  sheet.cellData[8] = { 3: { v: true, t: 3 } };
  const result = await patchWorkbook(bytes, content), after = officePackage(result), imported = importWorkbook(result).content;
  expect(imported.snapshot.sheets.sheet0.cellData[0][0].v).toBe("更新中文");
  expect(imported.snapshot.sheets.sheet0.cellData[8][3].v).toBe(true);
  expect(imported.snapshot.styles[imported.snapshot.sheets.sheet0.cellData[0][0].s].bg).toEqual({ rgb: "#123456" });
  for (const name of before.names) if (!["xl/worksheets/sheet1.xml", "xl/styles.xml", "xl/workbook.xml"].includes(name)) expect(after.read(name)).toEqual(before.read(name));
});
it("round-trips an actual Univer saved import without replacing untouched worksheet XML", async () => {
  const bytes = await fixture(), { content } = importWorkbook(bytes), univer = new Univer();
  try {
    const model = univer.createUnit(UniverInstanceType.UNIVER_SHEET, content.snapshot);
    const result = await patchWorkbook(bytes, { ...content, snapshot: model.save() });
    expect(officePackage(result).read("xl/worksheets/sheet1.xml")).toEqual(officePackage(bytes).read("xl/worksheets/sheet1.xml"));
  } finally { univer.dispose(); }
});
it("preserves external/shared formulas and rich strings as protected cached projections", async () => {
  const bytes = await fixture(async zip => {
    let xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
    xml = xml.replace(/<c r="A1"[\s\S]*?<\/c>/, '<c r="A1" t="inlineStr"><is><r><rPr><b/></rPr><t>富文本</t></r></is></c>');
    xml = xml.replace(/<c r="C3"[\s\S]*?<\/c>/, '<c r="C3"><f t="array" ref="C3">WEBSERVICE("https://secret.example")</f><v>7</v></c>');
    zip.file("xl/worksheets/sheet1.xml", xml);
  });
  const { content } = importWorkbook(bytes);
  expect(content.snapshot.sheets.sheet0.cellData[2][2].f).toBeUndefined();
  assertNativeOfficeRuntimeContent(content);
  expect(officePackage(await patchWorkbook(bytes, content)).read("xl/worksheets/sheet1.xml")).toEqual(officePackage(bytes).read("xl/worksheets/sheet1.xml"));
  content.snapshot.sheets.sheet0.cellData[0][0].v = "不应覆盖";
  await expect(patchWorkbook(bytes, content)).rejects.toThrow("OFFICE_CELL_PROTECTED");
});
it("rejects unsafe package relationships without fetching them, and prevents structure loss", async () => {
  const bytes = await fixture(), { content } = importWorkbook(bytes);
  content.snapshot.sheets.sheet0.mergeData.push({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
  await expect(patchWorkbook(bytes, content)).rejects.toThrow("OFFICE_IMPORT_STRUCTURE_PROTECTED");
  const unsafe = await fixture(async zip => zip.file("xl/_rels/workbook.xml.rels", (await zip.file("xl/_rels/workbook.xml.rels").async("string")).replace('Target="worksheets/sheet1.xml"', 'Target="../../../private.xml"')));
  expect(() => importWorkbook(unsafe)).toThrow("OFFICE_RELATIONSHIP_INVALID");
});

async function documentFixture(transform = () => {}) {
  const content = toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "中文文档", page: { header: "页眉", footer: "页脚", pageNumbers: false },
    sections: [{ id: "section", title: "", blocks: [
      { id: "title", type: "heading", level: 1, runs: [{ text: "产品计划", marks: { bold: true } }] },
      { id: "intro", type: "paragraph", runs: [{ text: "原始说明", marks: {} }] },
      { id: "table", type: "table", rows: [{ id: "row", cells: [{ id: "cell", runs: [{ text: "表格内容", marks: {} }] }] }] },
    ] }] }, "document");
  const zip = await JSZip.loadAsync(await buildNativeDocumentDocx(content));
  zip.file("customXml/item1.xml", '<opaque xmlns="urn:test">未修改</opaque>');
  await transform(zip);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
it("imports DOCX with styled paragraphs, tables and headers, then AI patches only the targeted XML range", async () => {
  const bytes = await documentFixture(), { content } = importDocument(bytes);
  assertNativeOfficeRuntimeContent(content);
  expect(content.snapshot.body.dataStream).toContain("表格内容");
  expect(Object.values(content.snapshot.headers)[0].body.dataStream).toContain("页眉");
  const start = content.snapshot.body.dataStream.indexOf("原始说明");
  const updated = applyNativeDocumentOperations(content, [{ op: "replaceNativeText", segmentId: "", start, end: start + 4, expectedText: "原始说明", text: "修改后的中文说明" }]);
  const result = await patchDocument(bytes, updated), before = officePackage(bytes), after = officePackage(result);
  expect(importDocument(result).content.snapshot.body.dataStream).toContain("修改后的中文说明");
  for (const name of before.names) if (name !== "word/document.xml") expect(after.read(name)).toEqual(before.read(name));
  const originalXml = before.read("word/document.xml").toString(), finalXml = after.read("word/document.xml").toString();
  expect(finalXml.slice(finalXml.indexOf("<w:tbl>"))).toBe(originalXml.slice(originalXml.indexOf("<w:tbl>")));
});
it("keeps DOCX fields/revisions intact and refuses editing their protected paragraphs", async () => {
  const bytes = await documentFixture(async zip => {
    zip.file("word/document.xml", (await zip.file("word/document.xml").async("string")).replace("原始说明", "原始说明").replace("<w:t xml:space=\"preserve\">原始说明</w:t>", '<w:fldChar w:fldCharType="begin"/><w:instrText>TOC</w:instrText><w:t>原始说明</w:t><w:fldChar w:fldCharType="end"/>'));
  });
  const { content } = importDocument(bytes);
  expect(content.snapshot.custom.modelshot.officeImport.protection.length).toBeGreaterThan(0);
  const result = await patchDocument(bytes, content);
  expect(officePackage(result).read("word/document.xml")).toEqual(officePackage(bytes).read("word/document.xml"));
  const start = content.snapshot.body.dataStream.indexOf("原始说明");
  const updated = applyNativeDocumentOperations(content, [{ op: "replaceNativeText", segmentId: "", start, end: start + 4, expectedText: "原始说明", text: "不能覆盖" }]);
  await expect(patchDocument(bytes, updated)).rejects.toThrow("OFFICE_DOCUMENT_RANGE_PROTECTED");
});
it("round-trips DOCX after an actual Univer core save", async () => {
  const bytes = await documentFixture(), { content } = importDocument(bytes), univer = new Univer();
  try {
    const model = univer.createUnit(UniverInstanceType.UNIVER_DOC, content.snapshot);
    for (const key of ["documentStyle", "lists", "tableSource", "drawings", "drawingsOrder"]) expect(model.getSnapshot()[key], key).toEqual(content.snapshot[key]);
    const result = await patchDocument(bytes, { ...content, snapshot: model.getSnapshot() });
    expect(officePackage(result).read("word/document.xml")).toEqual(officePackage(bytes).read("word/document.xml"));
  } finally { univer.dispose(); }
});

it("retains opaque run properties when changing visible formatting", async () => {
  const bytes = await documentFixture(async zip => {
    let xml = await zip.file("word/document.xml").async("string");
    xml = xml.replace('<w:t xml:space="preserve">原始说明</w:t>', '<w:t xml:space="preserve">原始说明</w:t>');
    const at = xml.indexOf('<w:t xml:space="preserve">原始说明</w:t>'), run = xml.lastIndexOf("<w:r>", at);
    xml = xml.slice(0, run + 5) + '<w:rPr><w:lang w:val="zh-CN"/><w:noProof/></w:rPr>' + xml.slice(run + 5);
    zip.file("word/document.xml", xml);
  });
  const { content } = importDocument(bytes), start = content.snapshot.body.dataStream.indexOf("原始说明");
  content.snapshot.body.textRuns.find(r => r.st === start).ts.bl = 1;
  const xml = officePackage(await patchDocument(bytes, content)).read("word/document.xml").toString();
  expect(xml).toContain('<w:lang w:val="zh-CN"/>');
  expect(xml).toContain("<w:noProof/>");
  expect(importDocument(await patchDocument(bytes, content)).content.snapshot.body.textRuns.find(r => r.st === start).ts.bl).toBe(1);
});

it("guards protected ranges at save time but accepts equivalent inline styles", async () => {
  const bytes = await fixture(async zip => {
    zip.file("xl/worksheets/sheet1.xml", (await zip.file("xl/worksheets/sheet1.xml").async("string")).replace(/<c r="A1"[\s\S]*?<\/c>/, '<c r="A1" t="inlineStr"><is><r><rPr><b/></rPr><t>保留</t></r></is></c>'));
  });
  const { content } = importWorkbook(bytes), next = structuredClone(content), cell = next.snapshot.sheets.sheet0.cellData[0][0];
  cell.s = next.snapshot.styles[cell.s];
  expect(() => validateImportedReplacement(content, next)).not.toThrow();
  cell.v = "不允许";
  expect(() => validateImportedReplacement(content, next)).toThrow("OFFICE_CELL_PROTECTED");
});

it("imports real DOCX/XLSX in the bounded child process and exports edits into the retained package", async () => {
  const previous = process.env.CREATION_EXPORT_ISOLATED; process.env.CREATION_EXPORT_ISOLATED = "true";
  try {
    for (const format of ["docx", "xlsx"]) {
      const bytes = await (format === "docx" ? documentFixture() : fixture());
      const result = await importOfficeInProcess(bytes, { format, sourceId: "test-import", unitId: "test-unit", title: "隔离导入" });
      expect(result.content.snapshot.id).toBe("test-unit");
      expect(result.media).toEqual([]);
      const output = await (format === "docx" ? patchDocument(bytes, result.content) : patchWorkbook(bytes, result.content));
      const before = officePackage(bytes), after = officePackage(output);
      for (const name of before.names) expect(after.read(name)).toEqual(before.read(name));
    }
  } finally {
    if (previous === undefined) delete process.env.CREATION_EXPORT_ISOLATED;
    else process.env.CREATION_EXPORT_ISOLATED = previous;
  }
}, 15000);
