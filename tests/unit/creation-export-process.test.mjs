import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp from "sharp";
import JSZip from "jszip";
import { renderLayoutInProcess } from "../../src/lib/domain/creation/export-process.js";
import { toNativeSheetArtifact } from "../../src/lib/creation/native-sheet-adapter.js";
import { toNativeDocumentArtifact } from "../../src/lib/creation/native-document-adapter.js";
import { exportFormat } from "../../src/lib/creation/contracts/exports.js";

const document = { schemaVersion: 1, kind: "slides", title: "Test", theme: { name: "Test", primary: "#112233", accent: "#ffee00", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "page", title: "Test", width: 1280, height: 720, nodes: [
  { id: "photo", type: "image", name: "Photo", x: 0, y: 0, width: 80, height: 80, assetId: "asset", fit: "contain" },
] }] };

it("exports a real Markdown archive with checksum-verified private images in the isolated child", async () => {
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 4, background: "#123456" } }).png().toBuffer();
  const asset = { id: "photo", objectKey: "private/markdown", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const store = { stream: async () => new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) };
  const content = { schemaVersion: 1, kind: "document", title: "Markdown", sections: [{ id: "s", title: "s", blocks: [
    { id: "p", type: "heading", level: 1, runs: [{ text: "正文😀" }] }, { id: "i", type: "image", assetId: "photo", width: 120, height: 80 },
  ] }] };
  const options = { store, signal: AbortSignal.timeout(15000), format: "markdown", exporterVersion: exportFormat("markdown").version };
  const output = await renderLayoutInProcess(content, [asset], options), zip = await JSZip.loadAsync(output);
  expect(await zip.file("document.md").async("string")).toContain("# 正文😀");
  expect((await sharp(await zip.file("images/image-1.png").async("nodebuffer")).metadata()).width).toBe(12);
  await expect(renderLayoutInProcess(content, [], { ...options, exporterVersion: "wrong-version" })).rejects.toThrow("EXPORT_VERSION_UNSUPPORTED");
  await expect(renderLayoutInProcess(toNativeDocumentArtifact(content, "unit"), [], options)).rejects.toThrow("EXPORT_VERSION_UNSUPPORTED");
}, 20000);

it("exports native sheets only with the matching codec and preserves deterministic unsupported-feature failures in the child", async () => {
  const content = toNativeSheetArtifact({ schemaVersion: 1, kind: "sheet", title: "Native", sheets: [{ id: "s", name: "Sheet", cells: [{ id: "c", address: "A1", value: "Native 中文", style: { bold: true } }] }] }, "unit");
  const options = { store: {}, signal: AbortSignal.timeout(15000), format: "xlsx", exporterVersion: exportFormat("xlsx", 2).version };
  const output = await renderLayoutInProcess(content, [], options), zip = await JSZip.loadAsync(output);
  expect(await zip.file("xl/worksheets/sheet1.xml").async("string")).toContain("Native 中文");
  expect(await zip.file("xl/styles.xml").async("string")).toContain("<b/>");
  await expect(renderLayoutInProcess(content, [], { ...options, exporterVersion: exportFormat("xlsx").version })).rejects.toThrow("EXPORT_VERSION_UNSUPPORTED");
  content.snapshot.sheets.sheet0.cellData[0][0].p = { body: { dataStream: "Rich text\r\n" } };
  await expect(renderLayoutInProcess(content, [], options)).rejects.toThrow("EXPORT_NATIVE_FEATURE_UNSUPPORTED");
}, 20000);

it("exports native DOCX and verified private images in the bounded child without legacy projection", async () => {
  const bytes = await sharp({ create: { width: 12, height: 8, channels: 4, background: "#123456" } }).png().toBuffer();
  const asset = { id: "photo", objectKey: "private/native-document", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const store = { stream: async () => new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } }) };
  const content = toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "Native", sections: [{ id: "s", title: "s", blocks: [{ id: "p", type: "paragraph", runs: [{ text: "原生正文😀", marks: { bold: true } }] }, { id: "image", type: "image", assetId: "photo", width: 120, height: 80 }] }] }, "unit");
  const options = { store, signal: AbortSignal.timeout(15000), format: "docx", exporterVersion: exportFormat("docx", 2).version };
  const output = await renderLayoutInProcess(content, [asset], options), zip = await JSZip.loadAsync(output);
  expect(await zip.file("word/document.xml").async("string")).toContain("原生正文😀");
  expect((await sharp(await zip.file("word/media/image1.png").async("nodebuffer")).metadata()).width).toBe(12);
  await expect(renderLayoutInProcess(content, [], { ...options, exporterVersion: exportFormat("docx").version })).rejects.toThrow("EXPORT_VERSION_UNSUPPORTED");
  content.snapshot.body.customDecorations = [{ id: "note", type: 0, startIndex: 0, endIndex: 1 }];
  await expect(renderLayoutInProcess(content, [], options)).rejects.toThrow("EXPORT_NATIVE_DOCUMENT_UNSUPPORTED");
}, 20000);

it("serializes a poster SVG with verified embedded PNG through the bounded child", async () => {
  const bytes = await sharp({ create: { width: 16, height: 8, channels: 4, background: "#ff000080" } }).png().toBuffer();
  const asset = { id: "asset", objectKey: "private/poster-image", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const store = { stream: async () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
  const output = await renderLayoutInProcess({ ...document, kind: "poster" }, [asset], { store, signal: AbortSignal.timeout(10000), format: "svg" });
  expect(output.toString()).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" /);
  expect(output.toString()).toContain('href="data:image/png;base64,');
  expect(output.toString()).not.toContain("private/poster-image");
  expect((await sharp(output).metadata()).width).toBe(1280);
  await expect(renderLayoutInProcess(document, [], { store, signal: AbortSignal.timeout(10000), format: "svg" })).rejects.toThrow("EXPORT_KIND_UNSUPPORTED");
}, 15000);

it("runs the credential-free conversion child using checksum-verified image bytes and returns a native PPTX", async () => {
  const bytes = await sharp({ create: { width: 16, height: 8, channels: 4, background: "#ff000080" } }).png().toBuffer();
  const asset = { id: "asset", objectKey: "private/example", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const store = { stream: async () => new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 10)); controller.enqueue(bytes.subarray(10)); controller.close(); } }) };
  const output = await renderLayoutInProcess(document, [asset], { store, signal: AbortSignal.timeout(10000), format: "pptx" });
  const zip = await JSZip.loadAsync(output);
  expect(zip.file("ppt/media/image1.png")).not.toBeNull();
  expect(await zip.file("ppt/slides/slide1.xml").async("string")).toContain("<p:pic>");
  await expect(renderLayoutInProcess(document, [{ ...asset, checksum: "0".repeat(64) }], { store, signal: AbortSignal.timeout(10000), format: "pptx" })).rejects.toThrow("EXPORT_ASSET_INTEGRITY_FAILED");
}, 15000);

it("exports semantic documents through the same isolated child without a raster runtime", async () => {
  const bytes = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#112233" } }).png().toBuffer();
  const asset = { id: "photo", objectKey: "private/document-image", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const store = { stream: async () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
  const content = { schemaVersion: 1, kind: "document", title: "报告", sections: [{ id: "section", title: "Summary", blocks: [
    { id: "body", type: "paragraph", runs: [{ text: "可编辑正文😀" }] },
    { id: "image", type: "image", assetId: "photo", width: 80, height: 40 },
  ] }] };
  const output = await renderLayoutInProcess(content, [asset], { store, signal: AbortSignal.timeout(10000), format: "docx" });
  const zip = await JSZip.loadAsync(output);
  expect(await zip.file("word/document.xml").async("string")).toContain("可编辑正文😀");
  expect(zip.file("word/media/image1.png")).not.toBeNull();
  content.sections[0].blocks[0].runs[0].text = "bad\u0000";
  await expect(renderLayoutInProcess(content, [], { store, signal: AbortSignal.timeout(10000), format: "docx" })).rejects.toThrow("EXPORT_IMAGE_UNSUPPORTED");
  content.sections[0].blocks.pop();
  await expect(renderLayoutInProcess(content, [], { store, signal: AbortSignal.timeout(10000), format: "docx" })).rejects.toThrow("EXPORT_DOCUMENT_TEXT_UNSUPPORTED");
}, 15000);
it("exports browser-native document Markdown and image resources through the credential-free child", async () => {
  const bytes = await sharp({ create: { width: 8, height: 4, channels: 3, background: "#112233" } }).png().toBuffer();
  const asset = { id: "photo", objectKey: "private/native-markdown", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const store = { stream: async () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
  const content = toNativeDocumentArtifact({ schemaVersion: 1, kind: "document", title: "报告", sections: [{ id: "section", title: "Summary", blocks: [
    { id: "body", type: "paragraph", runs: [{ text: "原生编辑正文😀", marks: { bold: true } }] },
    { id: "image", type: "image", assetId: "photo", width: 80, height: 40 },
  ] }] }, "unit");
  const options = { store, signal: AbortSignal.timeout(10000), format: "markdown", exporterVersion: exportFormat("markdown", 2).version };
  const output = await renderLayoutInProcess(content, [asset], options), zip = await JSZip.loadAsync(output);
  expect(await zip.file("document.md").async("string")).toContain("<strong>原生编辑正文😀</strong>");
  expect((await sharp(await zip.file("images/image-1.png").async("nodebuffer")).metadata()).width).toBe(8);
  await expect(renderLayoutInProcess(content, [], { ...options, exporterVersion: exportFormat("markdown").version })).rejects.toThrow("EXPORT_VERSION_UNSUPPORTED");
}, 15000);
it("exports website source and images through the isolated child with valid WebP bytes", async () => {
  const bytes = await sharp({ create: { width: 8, height: 4, channels: 4, background: "#11223380" } }).png().toBuffer();
  const asset = { id: "photo", objectKey: "private/web-image", bytes: bytes.length, checksum: createHash("sha256").update(bytes).digest("hex") };
  const store = { stream: async () => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
  const content = { schemaVersion: 1, kind: "web", title: "咖啡", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", assetIds: ["photo"], files: [
    { id: "home", path: "index.html", kind: "html", content: '<h1>咖啡</h1><img src="images/coffee.webp">' }, { id: "photo", path: "images/coffee.webp", kind: "asset", assetId: "photo" },
  ] };
  const output = await renderLayoutInProcess(content, [asset], { store, signal: AbortSignal.timeout(10000), format: "zip" });
  const zip = await JSZip.loadAsync(output);
  expect(await zip.file("index.html").async("string")).toBe(content.files[0].content);
  expect((await sharp(await zip.file("images/coffee.webp").async("nodebuffer")).metadata()).format).toBe("webp");
}, 15000);
