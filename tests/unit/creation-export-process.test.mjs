import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp from "sharp";
import JSZip from "jszip";
import { renderLayoutInProcess } from "../../src/lib/domain/creation/export-process.js";
import { exportFormat } from "../../src/lib/creation/contracts/exports.js";

const document = { schemaVersion: 1, kind: "slides", title: "Test", theme: { name: "Test", primary: "#112233", accent: "#ffee00", background: "#ffffff", fontFamily: "sans" }, pages: [{ id: "page", title: "Test", width: 1280, height: 720, nodes: [
  { id: "photo", type: "image", name: "Photo", x: 0, y: 0, width: 80, height: 80, assetId: "asset", fit: "contain" },
] }] };

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
