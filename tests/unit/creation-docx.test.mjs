// @vitest-environment jsdom
import { expect, it } from "vitest";
import { posix } from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { buildDocumentDocx } from "../../src/lib/creation/exports/docx.js";

const runs = text => [{ text, marks: {} }];
function document() {
  return { schemaVersion: 1, kind: "document", title: '中文 < & "', page: { header: "内部参考 &", footer: "季度报告", pageNumbers: true }, sections: [
    { id: "section", title: "Outline only", blocks: [
      { id: "heading", type: "heading", level: 2, runs: runs("成果与建议") },
      { id: "body", type: "paragraph", style: { align: "justify", spaceBefore: 6, spaceAfter: 8, lineHeight: 1.25 }, runs: [
        { text: "  中文😀 <script>&\t", marks: { bold: true, italic: true, underline: true, strike: true, color: "#123456", highlight: "#FFEEDD" } },
        { text: "换行\n引用", marks: { link: "https://example.com/?a=1&b=2" } }, { text: "再次引用", marks: { link: "https://example.com/?a=1&b=2", bold: false } },
      ] },
      { id: "break", type: "pageBreak" },
    ] },
  ] };
}
const parse = source => new DOMParser().parseFromString(source, "application/xml");
const all = (node, tag) => [...node.getElementsByTagName(tag)];
const part = async (zip, name) => parse(await zip.file(name).async("string"));

it("writes native Word text with styles, Unicode, links, breaks, and complete package relationships", async () => {
  const input = document(), unchanged = structuredClone(input);
  const zip = await JSZip.loadAsync(await buildDocumentDocx(input)), body = await part(zip, "word/document.xml");
  expect(input).toEqual(unchanged);
  expect(all(body, "w:t").map(node => node.textContent)).toEqual(["成果与建议", "  中文😀 <script>&", "换行", "引用", "再次引用"]);
  expect(all(body, "w:pStyle")[0].getAttribute("w:val")).toBe("Heading2");
  expect(all(body, "w:tab")).toHaveLength(1);
  expect(all(body, "w:br").map(node => node.getAttribute("w:type"))).toEqual([null, "page"]);
  expect(all(body, "w:b").map(node => node.getAttribute("w:val"))).toEqual(["1", "0"]);
  expect(all(body, "w:shd")[0].getAttribute("w:fill")).toBe("FFEEDD");
  expect(all(body, "w:spacing")[1].getAttribute("w:line")).toBe("300");
  expect(all(body, "w:jc")[1].getAttribute("w:val")).toBe("both");
  expect(all(body, "w:drawing")).toHaveLength(0);
  expect(all(await part(zip, "docProps/core.xml"), "dc:title")[0].textContent).toBe(input.title);
  let externalCount = 0;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.(xml|rels)$/.test(name)) continue;
    const parsed = parse(await entry.async("string"));
    expect(all(parsed, "parsererror"), name).toHaveLength(0);
    if (!name.endsWith(".rels")) continue;
    const ownerDir = name === "_rels/.rels" ? "" : posix.dirname(posix.dirname(name));
    for (const relation of all(parsed, "Relationship")) {
      if (relation.getAttribute("TargetMode") === "External") {
        externalCount++;
        expect(relation.getAttribute("Target")).toBe("https://example.com/?a=1&b=2");
        expect(relation.getAttribute("Type")).toMatch(/\/hyperlink$/);
      } else expect(zip.file(posix.normalize(posix.join(ownerDir, relation.getAttribute("Target")))), name).not.toBeNull();
    }
  }
  expect(externalCount).toBe(1);
  expect(zip.file("word/vbaProject.bin")).toBeNull();
});

it("preserves list restarts, nesting and rectangular native table cells in source order", async () => {
  const input = document();
  input.sections[0].blocks = [
    { id: "ordered", type: "list", ordered: true, start: 4, items: [{ id: "i1", runs: runs("Fourth"), depth: 0 }, { id: "i2", runs: runs("Nested"), depth: 2 }] },
    { id: "bullet", type: "list", items: [{ id: "i3", runs: runs("Bullet") }] },
    { id: "restart", type: "list", ordered: true, start: 8, items: [{ id: "i4", runs: runs("Eighth") }] },
    { id: "table", type: "table", headerRows: 1, rows: [
      { id: "r1", cells: [{ id: "a", runs: runs("Name") }, { id: "b", runs: runs("Value") }, { id: "c", runs: [] }] },
      { id: "r2", cells: [{ id: "d", runs: runs("Coffee") }, { id: "e", runs: runs("12") }, { id: "f", runs: runs("元") }] },
    ] },
  ];
  const zip = await JSZip.loadAsync(await buildDocumentDocx(input)), body = await part(zip, "word/document.xml"), numbering = await part(zip, "word/numbering.xml");
  expect(all(body, "w:t").map(node => node.textContent)).toEqual(["Fourth", "Nested", "Bullet", "Eighth", "Name", "Value", "Coffee", "12", "元"]);
  expect(all(body, "w:ilvl").map(node => node.getAttribute("w:val"))).toEqual(["0", "2", "0", "0"]);
  expect(all(numbering, "w:abstractNum").map(node => all(node, "w:start")[0].getAttribute("w:val"))).toEqual(["4", "1", "8"]);
  expect(all(numbering, "w:abstractNum").map(node => all(node, "w:numFmt")[0].getAttribute("w:val"))).toEqual(["decimal", "bullet", "decimal"]);
  const table = all(body, "w:tbl")[0];
  expect(all(table, "w:tr")).toHaveLength(2); expect(all(table, "w:tc")).toHaveLength(6);
  expect(all(table, "w:tblHeader")).toHaveLength(1);
  expect(all(table, "w:tc").every(cell => all(cell, "w:p").length === 1)).toBe(true);
  expect(all(table, "w:gridCol").reduce((sum, node) => sum + Number(node.getAttribute("w:w")), 0)).toBe(Number(all(table, "w:tblW")[0].getAttribute("w:w")));
});

it("embeds an owned image once, keeps independent editable placements and captions, and bounds oversized frames", async () => {
  const input = document();
  input.sections[0].blocks = [80, 1600].map((width, index) => ({ id: `image${index}`, type: "image", assetId: "photo", width, height: width / 2, alt: "图片 < &", caption: `Caption ${index}` }));
  const bytes = await sharp({ create: { width: 16, height: 8, channels: 4, background: "#ff000080" } }).png().toBuffer();
  const images = new Map([["photo", { bytes, width: 16, height: 8, format: "png" }]]);
  const zip = await JSZip.loadAsync(await buildDocumentDocx(input, images)), body = await part(zip, "word/document.xml");
  expect(Object.values(zip.files).filter(file => !file.dir && file.name.startsWith("word/media/"))).toHaveLength(1);
  expect(await zip.file("word/media/image1.png").async("nodebuffer")).toEqual(bytes);
  expect(all(body, "a:blip").map(node => node.getAttribute("r:embed"))[0]).toBe(all(body, "a:blip")[1].getAttribute("r:embed"));
  expect(all(body, "wp:docPr").map(node => node.getAttribute("id"))).toEqual(["1", "2"]);
  expect(all(body, "wp:docPr")[0].getAttribute("descr")).toBe("图片 < &");
  const extents = all(body, "wp:extent");
  expect(Number(extents[0].getAttribute("cx"))).toBe(80 * 9525);
  expect(Number(extents[1].getAttribute("cx"))).toBeLessThanOrEqual(Math.ceil((595.2756 - 108) * 12700));
  expect(Number(extents[1].getAttribute("cy")) / Number(extents[1].getAttribute("cx"))).toBeCloseTo(.5);
  expect(all(body, "w:t").map(node => node.textContent)).toEqual(["Caption 0", "Caption 1"]);
  await expect(buildDocumentDocx(input)).rejects.toThrow("EXPORT_IMAGE_UNSUPPORTED");
});

it("exports real page geometry and header/footer fields and omits explicitly disabled page numbers", async () => {
  const input = document(); input.page.size = "Letter"; input.page.orientation = "landscape"; input.page.marginLeft = 36;
  const zip = await JSZip.loadAsync(await buildDocumentDocx(input)), body = await part(zip, "word/document.xml");
  expect(all(body, "w:pgSz")[0].getAttribute("w:w")).toBe("15840");
  expect(all(body, "w:pgSz")[0].getAttribute("w:h")).toBe("12240");
  expect(all(body, "w:pgMar")[0].getAttribute("w:left")).toBe("720");
  expect(all(await part(zip, "word/header1.xml"), "w:t")[0].textContent).toBe("内部参考 &");
  expect(all(await part(zip, "word/footer1.xml"), "w:fldSimple")[0].getAttribute("w:instr").trim()).toBe("PAGE");
  input.page = { header: "", footer: "", pageNumbers: false };
  const plain = await JSZip.loadAsync(await buildDocumentDocx(input));
  expect(plain.file("word/header1.xml")).toBeNull(); expect(plain.file("word/footer1.xml")).toBeNull();
  expect(all(await part(plain, "word/document.xml"), "w:headerReference")).toHaveLength(0);
});

it("refuses unsupported source content and oversized output instead of silently truncating or emitting unsafe relationships", async () => {
  const input = document();
  await expect(buildDocumentDocx(input, new Map(), { maxBytes: 10 })).rejects.toThrow("EXPORT_RESULT_TOO_LARGE");
  input.sections[0].blocks[1].runs = [{ text: "Click", marks: { link: "javascript:alert(1)" } }];
  await expect(buildDocumentDocx(input)).rejects.toThrow("EXPORT_DOCUMENT_INVALID");
  for (const text of ["nul\u0000", "unpaired\ud800", "bad\uffff"]) {
    input.sections[0].blocks[1].runs = runs(text);
    await expect(buildDocumentDocx(input)).rejects.toThrow("EXPORT_DOCUMENT_TEXT_UNSUPPORTED");
  }
  await expect(buildDocumentDocx({ ...document(), kind: "slides" })).rejects.toThrow("EXPORT_DOCUMENT_INVALID");
});
