import { expect, it } from "vitest";
import JSZip from "jszip";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { buildNativeDocumentMarkdown } from "../../src/lib/creation/exports/native-markdown.js";

const text = (value, marks = {}) => [{ text: value, marks }];
const native = () => toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "原生报告", page: { header: "Private header", footer: "Private footer" }, sections: [{ id: "section", title: "Internal", blocks: [
  { id: "h", type: "heading", level: 2, runs: text("咖啡😀") },
  { id: "p", type: "paragraph", runs: [...text('<script>bad</script> & | _ *', { bold: true, italic: true, underline: true, strike: true }), ...text("网站", { link: "https://example.com/?a=1&b=2" })] },
  { id: "list", type: "list", ordered: true, start: 5, items: [{ id: "a", depth: 0, runs: text("第一条") }, { id: "b", depth: 1, runs: text("子项") }, { id: "c", depth: 0, runs: text("第二条") }] },
  { id: "table", type: "table", headerRows: 1, rows: [{ id: "r", cells: [{ id: "c1", runs: text("金额") }, { id: "c2", runs: text("¥99") }] }] },
  { id: "image", type: "image", assetId: "private_photo", width: 120, height: 80, alt: '" onerror="bad' },
] }] }, "unit");
const images = new Map([["private_photo", { bytes: Buffer.from("verified by child"), format: "png", width: 120, height: 80 }]]);
async function unpack(value, assets = images, options) {
  const zip = await JSZip.loadAsync(await buildNativeDocumentMarkdown(value, assets, options));
  const markdown = await zip.file("document.md").async("string");
  return { zip, markdown, dom: new JSDOM(markdown).window.document, info: JSON.parse(await zip.file("export-info.json").async("string")) };
}
it("exports the native snapshot directly, retains rich text/list/table semantics and embeds private images with safe relative names", async () => {
  const value = native(), before = structuredClone(value), { zip, markdown, dom, info } = await unpack(value);
  expect(value).toEqual(before); expect(dom.querySelector("h2").textContent).toBe("咖啡😀");
  expect(dom.querySelector("em strong").textContent).toBe('<script>bad</script> & | _ *');
  expect(dom.querySelectorAll("u,del")).toHaveLength(2); expect(dom.querySelector("script")).toBeNull();
  expect(dom.querySelector("a").getAttribute("href")).toBe("https://example.com/?a=1&b=2");
  expect([...dom.querySelectorAll("ol")].map(node => node.getAttribute("start"))).toEqual(["5", "5", "6"]);
  expect(dom.querySelectorAll("table th")).toHaveLength(2); expect(dom.querySelector("img").getAttribute("alt")).toBe('" onerror="bad');
  expect(dom.querySelector("[onerror]")).toBeNull();
  expect(await zip.file("images/image-1.png").async("nodebuffer")).toEqual(images.get("private_photo").bytes);
  expect(markdown).not.toMatch(/Private|Internal|private_photo|\/api\/|asset:/);
  expect(info).toMatchObject({ format: "univer-document-markdown-1", requires: ["inline_html", "relative_images"] });
  expect(info.omitted).toContain("headers"); expect(info.omitted).toContain("fields_use_cached_text");
});
it("exports a real browser-edited Univer snapshot and never serializes its engine/plugin metadata", async () => {
  const value = JSON.parse(readFileSync(new URL("../fixtures/creation-native-document-browser.json", import.meta.url), "utf8"));
  const { markdown } = await unpack(value, new Map());
  expect(markdown).toContain("后退时保存："); expect(markdown).not.toMatch(/modelshot|DOC_OBJECT_PERMISSION_PLUGIN/);
});
it("rejects damaged UTF-16 positions, populated permissions, unsafe links, merged cells and missing images", async () => {
  for (const alter of [
    value => value.snapshot.body.paragraphs[0].startIndex++,
    value => { value.snapshot.resources = [{ name: "DOC_OBJECT_PERMISSION_PLUGIN", data: '[{"permissionId":"private"}]' }]; },
    value => { value.snapshot.body.customRanges[0].properties.url = "javascript:alert(1)"; },
    value => { Object.values(value.snapshot.tableSource)[0].tableRows[0].tableCells[0].columnSpan = 2; },
  ]) {
    const value = native(); alter(value); await expect(buildNativeDocumentMarkdown(value, images)).rejects.toThrow(/^EXPORT_NATIVE_DOCUMENT_/);
  }
  await expect(buildNativeDocumentMarkdown(native(), new Map())).rejects.toThrow("EXPORT_IMAGE_UNSUPPORTED");
  await expect(buildNativeDocumentMarkdown(native(), images, { maxBytes: 32 })).rejects.toThrow("EXPORT_RESULT_TOO_LARGE");
  const large = new Map([["private_photo", { ...images.get("private_photo"), width: 4001, height: 4000 }]]);
  await expect(buildNativeDocumentMarkdown(native(), large)).rejects.toThrow("EXPORT_IMAGE_PIXELS_EXCEEDED");
});
