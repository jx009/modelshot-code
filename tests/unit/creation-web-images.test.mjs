// @vitest-environment jsdom
import { expect, it } from "vitest";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
import { prepareWebImageFiles, webImageReference } from "../../src/lib/creation/client/web-image-files.js";
import { prepareWebImageInsertion } from "../../src/lib/creation/client/web-image-insert.js";
import { applyWebOperationsWithInverse, applyWebOperations } from "../../src/lib/creation/web-operations.js";
import { prepareWebPreviewDocument } from "../../src/lib/creation/web-preview.js";
const item = (id = "asset-image-123456", type = "image/webp") => ({ assetId: id, name: '商品图"<&>', asset: { contentType: type, width: 1000, height: 800 } });
const site = () => webSchema.parse({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "pages/index.html", files: [{ id: "html", path: "pages/index.html", kind: "html", content: "<!doctype html><html><head><title>Test</title></head><body><h1>Coffee</h1></body></html>" }] });
it("adds deduplicated library references with portable paths and undoes registration without changing the original", () => {
  const original = site(), result = prepareWebImageFiles(original, [item(), item(), item("asset-jpeg-123456", "image/jpeg")]);
  expect(result.operations).toHaveLength(2); expect(original.files).toHaveLength(1);
  const applied = applyWebOperationsWithInverse(original, result.operations);
  expect(applied.document.assetIds).toEqual(["asset-image-123456", "asset-jpeg-123456"]);
  expect(applied.document.files.map(file => file.path)).toEqual(["pages/index.html", "image-asset-image-123456.webp", "image-asset-jpeg-123456.jpg"]);
  expect(applied.document.files[1]).not.toHaveProperty("content");
  expect(applyWebOperations(applied.document, applied.inverse)).toEqual(original);
  expect(prepareWebImageFiles(applied.document, [item()])).toEqual({ operations: [], selectedId: applied.document.files[1].id });
});
it("avoids file/path collisions and enforces selection, type and capacity limits without partial additions", () => {
  const content = site(); content.files.push({ id: "collision", kind: "html", path: "IMAGE-ASSET-IMAGE-123456.WEBP", content: "<p>Existing</p>" });
  expect(prepareWebImageFiles(content, [item()]).operations[0].file.path).toBe("image-asset-image-123456-1.webp");
  for (const values of [[], Array(9).fill(item()), [item("bad")], [item("asset-svg-123456", "image/svg+xml")], [item("asset-png-123456", "text/html")]]) expect(() => prepareWebImageFiles(content, values)).toThrow("WEB_IMAGE_SELECTION_INVALID");
  content.assetIds = Array.from({ length: 100 }, (_, i) => `registered-${i}`);
  expect(() => prepareWebImageFiles(content, [item()])).toThrow("WEB_ASSET_LIMIT");
  expect(content.files).toHaveLength(2);
});
it("replaces a referenced image without changing the path or HTML, and restores the previous registry on undo", () => {
  let content = applyWebOperations(site(), prepareWebImageFiles(site(), [item()]).operations);
  const target = content.files[1]; content.files[0].content += `<img src="../${target.path}">`;
  const result = applyWebOperationsWithInverse(content, prepareWebImageFiles(content, [item("replacement-123456", "image/png")], { target }).operations);
  expect(result.document.files[1]).toEqual({ ...target, assetId: "replacement-123456" });
  expect(result.document.files[0]).toEqual(content.files[0]); expect(result.document.assetIds).toEqual(["replacement-123456"]);
  expect(applyWebOperations(result.document, result.inverse)).toEqual(content);
  expect(() => prepareWebImageFiles(result.document, [item()], { target })).toThrow("WEB_ASSET_CHANGED");
  expect(() => applyWebOperations(result.document, [{ op: "replaceAsset", fileId: target.id, path: target.path, expectedAssetId: target.assetId, assetId: "x" }])).toThrow("WEB_ASSET_CHANGED");
});
it("preserves shared asset registrations and permits replacing a sole reference at the registry limit", () => {
  const content = applyWebOperations(site(), prepareWebImageFiles(site(), [item()]).operations), target = content.files[1];
  content.files.push({ ...target, id: "copy", path: "copy.webp" });
  const result = applyWebOperations(content, prepareWebImageFiles(content, [item("replacement-123456")], { target }).operations);
  expect(result.assetIds).toEqual([target.assetId, "replacement-123456"]);
  content.assetIds.push(...Array.from({ length: 99 }, (_, i) => `registered-${i}`));
  expect(() => prepareWebImageFiles(content, [item("replacement-123456")], { target })).toThrow("WEB_ASSET_LIMIT");
  content.files.pop();
  expect(applyWebOperations(content, prepareWebImageFiles(content, [item("replacement-123456")], { target }).operations).assetIds).toHaveLength(100);
});
it("inserts a relative image reference at the end of the requested page and renders it through declared private resources", () => {
  const content = applyWebOperations(site(), prepareWebImageFiles(site(), [item()]).operations), target = content.files[1], page = content.files[0];
  const plan = prepareWebImageInsertion(content, target, page), result = applyWebOperationsWithInverse(content, plan.operations);
  expect(result.document.files[0].content).toContain(`<img src="../${target.path}" alt="" loading="lazy" decoding="async" style="max-width:100%;height:auto">\n</body>`);
  expect(result.document.files[0].content).toContain("<h1>Coffee</h1>");
  expect(prepareWebPreviewDocument(result.document).assetIds).toEqual([target.assetId]);
  expect(applyWebOperations(result.document, result.inverse)).toEqual(content);
  expect(webImageReference("assets/a.webp", "pages/nested/index.html")).toBe("../../assets/a.webp");
  expect(webImageReference("pages/a.webp", "pages/index.html")).toBe("a.webp");
});
it("handles fragment pages and rejects ambiguous insertion into unclosed containers or stale targets", () => {
  const content = applyWebOperations(site(), prepareWebImageFiles(site(), [item()]).operations), target = content.files[1], page = content.files[0];
  page.content = "<h1>Fragment</h1>";
  expect(prepareWebImageInsertion(content, target, page).operations[0].content).toContain('</h1>\n<img src="../');
  for (const source of ["<table><tr><td>Open", "<div>Open", "<textarea>Open"]) {
    page.content = source; expect(() => prepareWebImageInsertion(content, target, page)).toThrow();
  }
  expect(() => prepareWebImageInsertion(content, { ...target, assetId: "changed" }, page)).toThrow("WEB_ASSET_CHANGED");
  expect(() => prepareWebImageInsertion(content, target, { ...page, path: "old.html" })).toThrow("WEB_FILE_NOT_FOUND");
});
