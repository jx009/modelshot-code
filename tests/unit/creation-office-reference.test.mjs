import { expect, it } from "vitest";
import { extractOfficeReference } from "../../src/lib/creation/references/office-text.js";
import { openOfficeZip } from "../../src/lib/creation/references/office-zip.js";
import { officeFile, W, S, P, R, rels } from "../fixtures/creation-office-reference.mjs";
import { buildWorkbookXlsx } from "../../src/lib/creation/exports/xlsx.js";
import { buildLayoutPptx } from "../../src/lib/creation/exports/pptx.js";

it("rejects metadata-only documents, worksheets and slides as unreadable references", async () => {
  for (const kind of ["docx", "xlsx", "pptx"]) {
    const bytes = await officeFile(kind, zip => {
      if (kind === "docx") zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body/></w:document>`);
      if (kind === "xlsx") for (const id of [1, 2]) zip.file(`xl/worksheets/sheet${id}.xml`, `<worksheet xmlns="${S}"><sheetData/></worksheet>`);
      if (kind === "pptx") {
        for (const id of [1, 2]) zip.file(`ppt/slides/slide${id}.xml`, `<p:sld xmlns:p="${P}"><p:cSld/></p:sld>`);
        zip.remove("ppt/slides/_rels/slide2.xml.rels");
      }
    });
    expect(() => extractOfficeReference(bytes, kind)).toThrow("CREATION_REFERENCE_NO_TEXT");
  }
});

it("reads DOCX paragraph/table locators and Unicode without deleted revision text", async () => {
  const result = extractOfficeReference(await officeFile("docx"), "docx"), records = result.text.split("\n").map(JSON.parse);
  expect(records[0]).toEqual({ locator: "document/p1", text: "城市咖啡 & 茶😀\t开业\n11 月 1 日" });
  expect(records[1]).toEqual({ locator: "document/table2/row1/cell1/p1", text: "预算" });
  expect(records[2].text).toBe("6200"); expect(result.text).not.toContain("删除文字");
  expect(result.limitations.join(" ")).toContain("not rendered page numbers");
});
it("reads sparse XLSX in workbook order and labels stale cached formulas without recalculating", async () => {
  const result = extractOfficeReference(await officeFile("xlsx"), "xlsx"), records = result.text.split("\n").map(JSON.parse);
  expect(records[0]).toEqual({ locator: "sheet1", sheetName: "预算", state: "hidden", dateSystem: "1900" });
  expect(records.find(row => row.locator === "sheet1!A1").value).toBe("咖啡预算");
  expect(records.find(row => row.locator === "sheet1!C2")).toMatchObject({ formula: "SUM(B1:B2)", value: "1", hiddenRow: true, cachedResultUnverified: true });
  expect(records.at(-1)).toEqual({ locator: "sheet2!B10", type: "b", value: "1" });
});
it("reads PPTX in presentation order with hidden slide markers and speaker notes", async () => {
  const records = extractOfficeReference(await officeFile("pptx"), "pptx").text.split("\n").map(JSON.parse);
  expect(records).toEqual([{ locator: "slide1", hidden: false }, { locator: "slide1/p1", text: "第一页" }, { locator: "slide1/notes/p1", text: "讲者备注" }, { locator: "slide2", hidden: true }, { locator: "slide2/p1", text: "第二页" }]);
});
it("accepts namespace prefixes independent of spelling but rejects extension/type spoofing", async () => {
  const bytes = await officeFile("docx", zip => zip.file("word/document.xml", `<document xmlns="${W}"><body><p><r><t>Prefix independent</t></r></p></body></document>`));
  expect(extractOfficeReference(bytes, "docx").text).toContain("Prefix independent");
  expect(() => extractOfficeReference(bytes, "xlsx")).toThrow("CREATION_REFERENCE_OFFICE_INVALID");
});
it.each([
  ['<!DOCTYPE w:document [<!ENTITY secret SYSTEM "file:///etc/passwd">]>', "CREATION_REFERENCE_XML_INVALID"],
  ['<!ENTITY secret "expand">', "CREATION_REFERENCE_XML_INVALID"],
])("rejects declarations without resolving any entity: %s", async (declaration, code) => {
  const bytes = await officeFile("docx", zip => zip.file("word/document.xml", `${declaration}<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>&secret;</w:t></w:r></w:p></w:body></w:document>`));
  expect(() => extractOfficeReference(bytes, "docx")).toThrow(code);
});
it("rejects malformed XML, internal escaping relationships, active content and excessive XML depth", async () => {
  for (const [change, code] of [
    [zip => zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body></w:document>`), "CREATION_REFERENCE_XML_INVALID"],
    [zip => zip.file("_rels/.rels", rels([["main", "officeDocument", "../outside.xml"]])), "CREATION_REFERENCE_OFFICE_INVALID"],
    [zip => zip.file("word/vbaProject.bin", "macro"), "CREATION_REFERENCE_ACTIVE_CONTENT"],
    [zip => zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body>${"<w:sdt>".repeat(70)}${"</w:sdt>".repeat(70)}</w:body></w:document>`), "CREATION_REFERENCE_EXTRACT_LIMIT"],
  ]) {
    const bytes = await officeFile("docx", change);
    expect(() => extractOfficeReference(bytes, "docx")).toThrow(code);
  }
});
it("refuses ZIP entry traversal, duplicate normalized names, truncated content and excessive expansion", async () => {
  const cases = [zip => zip.file("../escape.xml", "bad"), zip => zip.file("WORD/document.xml", "collision"), zip => zip.file("word/large.xml", "x".repeat(8 * 1024 * 1024 + 1))];
  for (const change of cases) {
    const bytes = await officeFile("docx", change);
    expect(() => openOfficeZip(bytes)).toThrow("CREATION_REFERENCE_ARCHIVE_INVALID");
  }
  const bytes = await officeFile("docx");
  expect(() => openOfficeZip(bytes.subarray(0, -3))).toThrow("CREATION_REFERENCE_ARCHIVE_INVALID");
});
it("bounds actual inflate output even when central/local uncompressed lengths are forged", async () => {
  const bytes = Buffer.from(await officeFile("docx"));
  for (let offset = 0; offset < bytes.length - 46; offset++) if (bytes.readUInt32LE(offset) === 0x02014b50) {
    const length = bytes.readUInt16LE(offset + 28), name = bytes.subarray(offset + 46, offset + 46 + length).toString();
    if (name !== "word/document.xml") continue;
    const local = bytes.readUInt32LE(offset + 42);
    bytes.writeUInt32LE(1, offset + 24); bytes.writeUInt32LE(1, local + 22);
  }
  expect(() => extractOfficeReference(bytes, "docx")).toThrow("CREATION_REFERENCE_ARCHIVE_INVALID");
});
it("refuses excessive reference output rather than silently truncating useful content", async () => {
  const bytes = await officeFile("docx", zip => zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${"中".repeat(50000)}</w:t></w:r></w:p></w:body></w:document>`));
  expect(() => extractOfficeReference(bytes, "docx")).toThrow("CREATION_REFERENCE_CONTEXT_LIMIT");
});
it("rejects external main documents and never follows arbitrary relationship types", async () => {
  const bytes = await officeFile("docx", zip => zip.file("_rels/.rels", rels([["main", "officeDocument", "https://example.invalid/document.xml", "External"]])));
  expect(() => extractOfficeReference(bytes, "docx")).toThrow("CREATION_REFERENCE_OFFICE_INVALID");
  const wrong = await officeFile("docx", zip => zip.file("_rels/.rels", rels([["main", "officeDocument", "word/document.xml"]]).replace(`${R}/officeDocument`, "https://example.invalid/officeDocument")));
  expect(() => extractOfficeReference(wrong, "docx")).toThrow("CREATION_REFERENCE_OFFICE_INVALID");
});

it("reads actual generated XLSX and PPTX packages, including Chinese text, formula results and slide notes", async () => {
  const xlsx = await buildWorkbookXlsx({ schemaVersion: 1, kind: "sheet", title: "预算", sheets: [{ id: "s", name: "预算", cells: [{ id: "a", address: "A1", value: 2000 }, { id: "b", address: "A2", formula: "=SUM(A1:A1)" }] }] });
  expect(extractOfficeReference(xlsx, "xlsx").text).toContain('"formula":"SUM(A1:A1)"');
  const pptx = await buildLayoutPptx({ schemaVersion: 1, kind: "slides", title: "发布方案", theme: { name: "Brand", primary: "#202124", accent: "#cc6600", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "p", title: "首页", notes: "介绍品牌", width: 1920, height: 1080, nodes: [{ id: "t", type: "text", name: "标题", text: "城市咖啡", x: 50, y: 50, width: 600, height: 150, style: {} }] }] });
  const text = extractOfficeReference(pptx, "pptx").text;
  expect(text).toContain("城市咖啡"); expect(text).toContain("介绍品牌");
});
