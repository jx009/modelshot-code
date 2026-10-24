import { expect, it } from "vitest";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { buildDocumentMarkdown } from "../../src/lib/creation/exports/markdown.js";

const paragraph = (id, value, marks = {}) => ({ id, type: "paragraph", runs: [{ text: value, marks }] });
const document = blocks => ({ schemaVersion: 1, kind: "document", title: "报告", page: { header: "Private header", footer: "Private footer" }, sections: [{ id: "section", title: "Internal section label", blocks }] });
const unpack = async (doc, images) => {
  const zip = await JSZip.loadAsync(await buildDocumentMarkdown(doc, images));
  return { zip, markdown: await zip.file("document.md").async("string"), info: JSON.parse(await zip.file("export-info.json").async("string")) };
};

it("keeps Chinese, headings and safe rich text while declaring layout loss instead of exporting private metadata", async () => {
  const source = document([
    { ...paragraph("title", "咖啡计划😀"), type: "heading", level: 2 },
    paragraph("body", "价格 39 元\n下一行", { bold: true, italic: true, underline: true, strike: true, color: "#ff0000", link: "https://example.com/?a=1&b=2" }),
    { id: "break", type: "pageBreak" },
  ]), before = structuredClone(source);
  const { markdown, info, zip } = await unpack(source);
  expect(markdown).toContain("## 咖啡计划😀");
  const html = new JSDOM(markdown).window.document;
  expect(html.querySelector("a strong").textContent).toBe("价格 39 元\n下一行");
  expect(html.querySelector("a").getAttribute("href")).toBe("https://example.com/?a=1&b=2");
  expect(html.querySelectorAll("em,u,del,br")).toHaveLength(4);
  expect(markdown).not.toMatch(/Private|Internal section|ff0000/);
  expect(info).toMatchObject({ entry: "document.md", requires: ["inline_html", "relative_images"] });
  expect(info.omitted).toContain("headers"); expect(info.omitted).toContain("pagination");
  expect(Object.keys(zip.files)).toEqual(["document.md", "export-info.json"]);
  expect(source).toEqual(before);
});

it.each([0, 2])("preserves %i table header rows and escapes content without turning user HTML into markup", async headerRows => {
  const values = ["<script>alert('bad')</script>", "| * _ [test] & 中文", "行1\n行2", "安全"];
  const rows = [0, 1].map(row => ({ id: `r${row}`, cells: [0, 1].map(col => ({ id: `c${row}${col}`, runs: [{ text: values[row * 2 + col] }] })) }));
  const { markdown } = await unpack(document([{ id: "table", type: "table", headerRows, rows }]));
  const html = new JSDOM(markdown).window.document;
  expect(html.querySelectorAll("th")).toHaveLength(headerRows * 2);
  expect(html.querySelectorAll("td")).toHaveLength((2 - headerRows) * 2);
  expect(html.querySelector("script")).toBeNull();
  expect([...html.querySelectorAll("th,td")].map(cell => cell.textContent)).toEqual(values);
});

it("preserves nested ordered lists, orphan indentation, start values and literal Markdown input", async () => {
  const { markdown } = await unpack(document([
    { id: "list", type: "list", ordered: true, start: 5, items: [
      { id: "orphan", depth: 2, runs: [{ text: "深层" }] }, { id: "first", depth: 0, runs: [{ text: "首项" }] },
      { id: "child", depth: 1, runs: [{ text: "子项" }] }, { id: "last", depth: 0, runs: [{ text: "末项" }] },
    ] }, paragraph("literal", "# heading\n![remote](https://example.com/img)\n    code\nO'Reilly <img src=x onerror=evil>"),
  ]));
  const html = new JSDOM(markdown).window.document;
  expect(html.querySelector("ol").getAttribute("start")).toBe("5");
  expect([...html.querySelectorAll("ol > li[value]")].map(item => [item.getAttribute("value"), item.firstChild.textContent.trimEnd()])).toEqual([["1", "深层"], ["5", "首项"], ["1", "子项"], ["6", "末项"]]);
  expect(html.querySelector("img")).toBeNull();
  expect(markdown).toContain("\\# heading"); expect(markdown).toContain("\\!\\[remote\\]");
  expect(markdown).toContain("&#32;&#32;&#32;&#32;code"); expect(markdown).toContain("O&#39;Reilly");
});

it("deduplicates private images into fixed relative paths and retains captions/escaped alternative text", async () => {
  const image = { id: "img", type: "image", assetId: "private_asset", width: 100, height: 50, alt: '" onerror="evil', caption: "商品图" };
  const bytes = Buffer.from("decoded image fixture"), images = new Map([["private_asset", { bytes, format: "png", width: 100, height: 50 }]]);
  const { zip, markdown, info } = await unpack(document([image, { ...image, id: "second" }]), images);
  const html = new JSDOM(markdown).window.document;
  expect([...html.querySelectorAll("img")].map(img => img.getAttribute("src"))).toEqual(["images/image-1.png", "images/image-1.png"]);
  expect(html.querySelector("img").getAttribute("alt")).toBe(image.alt);
  expect(html.querySelector("[onerror]")).toBeNull();
  expect(await zip.file("images/image-1.png").async("nodebuffer")).toEqual(bytes);
  expect(info.images).toEqual(["images/image-1.png"]); expect(markdown).not.toContain("private_asset");
  expect(markdown.match(/商品图/g)).toHaveLength(2);
});

it("rejects invalid text, unsafe links, missing images, unsupported source versions and excessive output budgets", async () => {
  for (const value of ["bad\u0000", "bad\ud800"]) await expect(buildDocumentMarkdown(document([paragraph("p", value)]))).rejects.toThrow("EXPORT_DOCUMENT_TEXT_UNSUPPORTED");
  await expect(buildDocumentMarkdown(document([paragraph("p", "link", { link: "javascript:alert(1)" })]))).rejects.toThrow("EXPORT_SOURCE_FORMAT_UNSUPPORTED");
  await expect(buildDocumentMarkdown({ schemaVersion: 2, kind: "document", snapshot: {} })).rejects.toThrow("EXPORT_SOURCE_FORMAT_UNSUPPORTED");
  const source = document([{ id: "i", type: "image", assetId: "a", width: 10, height: 10 }]);
  await expect(buildDocumentMarkdown(source)).rejects.toThrow("EXPORT_IMAGE_UNSUPPORTED");
  await expect(buildDocumentMarkdown(source, new Map([["a", { bytes: Buffer.from("image"), format: "png", width: 4001, height: 4000 }]]))).rejects.toThrow("EXPORT_IMAGE_PIXELS_EXCEEDED");
  await expect(buildDocumentMarkdown(document([paragraph("p", "文字")]), new Map(), { maxBytes: 32 })).rejects.toThrow("EXPORT_RESULT_TOO_LARGE");
});
