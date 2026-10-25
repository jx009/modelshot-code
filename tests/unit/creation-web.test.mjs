// @vitest-environment jsdom
import { expect, it } from "vitest";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
import { applyWebOperations } from "../../src/lib/creation/web-operations.js";
import { buildWebPreviewDocument, prepareWebPreviewDocument, webPreviewFrameProps, validateWebPreviewMessage } from "../../src/lib/creation/web-preview.js";
import { webResourcePath } from "../../src/lib/creation/web-resource-path.js";
const site = () => webSchema.parse({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [
  { id: "html", path: "index.html", kind: "html", content: '<main><h1>咖啡</h1><link rel="stylesheet" href="styles.css"><script src="app.js"></script></main>' },
  { id: "css", path: "styles.css", kind: "css", content: "body { color: #111; }" }, { id: "js", path: "app.js", kind: "js", content: "document.body.dataset.ready = 'yes';" },
] });
it("validates a bounded static site and rejects navigation/network escape hatches", () => {
  expect(site().files).toHaveLength(3);
  for (const bad of [{ ...site(), entryPath: "missing.html" }, { ...site(), files: [{ ...site().files[0], content: '<script src="https://evil.test/x.js"></script>' }, ...site().files.slice(1)] }, { ...site(), files: [{ ...site().files[1], content: "@import url(https://evil.test);" }, ...site().files.slice(0, 1), ...site().files.slice(2)] }]) expect(() => webSchema.parse(bad)).toThrow();
  expect(() => webSchema.parse({ ...site(), files: [{ id: "x", path: "../secret", kind: "html", content: "x" }] })).toThrow();
});
it("applies file patches with stable IDs and preserves the source site", () => {
  const source = site(), next = applyWebOperations(source, [{ op: "setFile", fileId: "html", path: "index.html", kind: "html", content: "<h1>New</h1>" }, { op: "renameFile", fileId: "css", path: "styles.css", nextPath: "theme.css" }, { op: "setEntry", path: "index.html" }]);
  expect(next.files.find(file => file.id === "html").content).toBe("<h1>New</h1>"); expect(next.files.find(file => file.id === "css").path).toBe("theme.css"); expect(source.files[0].content).toContain("咖啡");
  expect(() => applyWebOperations(source, [{ op: "removeFile", fileId: "html", path: "index.html" }])).toThrow("WEB_ENTRY_INVALID");
  expect(() => applyWebOperations(source, [{ op: "setFile", fileId: "missing", path: "x.html", kind: "html", content: "x" }])).toThrow("WEB_FILE_NOT_FOUND");
});
it("builds an isolated preview with local resources and rejects forged frame messages", () => {
  const preview = buildWebPreviewDocument(site()); expect(preview).toContain("咖啡"); expect(preview).toContain("body { color"); expect(preview).not.toContain("<script"); expect(webPreviewFrameProps(site()).sandbox).toBe(""); expect(preview).toContain("connect-src 'none'"); expect(preview).not.toContain("https://");
  const source = {}, event = { source, origin: "null", data: { channel: "modelshot-web-preview-v1", type: "ready", payload: { width: 390 } } };
  expect(validateWebPreviewMessage(event, { source, origin: "null" }).type).toBe("ready");
  expect(() => validateWebPreviewMessage({ ...event, source: {} }, { source, origin: "null" })).toThrow(); expect(() => validateWebPreviewMessage({ ...event, origin: "https://evil.test" }, { source, origin: "null" })).toThrow();
  expect(() => validateWebPreviewMessage({ ...event, data: { channel: "other", type: "ready" } }, { source, origin: "null" })).toThrow();
});
it("runs only declared local scripts when explicitly enabled in an opaque-origin preview", () => {
  const value = site();
  const staticPreview = buildWebPreviewDocument(value);
  const interactivePreview = buildWebPreviewDocument(value, new Map(), { interactive: true });
  expect(staticPreview).not.toContain("document.body.dataset.ready");
  expect(interactivePreview).toContain("document.body.dataset.ready");
  const policy = new DOMParser().parseFromString(interactivePreview, "text/html").querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  expect(policy).toContain("script-src 'unsafe-inline'");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("default-src 'none'");
  expect(webPreviewFrameProps(value).sandbox).toBe("");
});
it("does not load remote scripts and bounds executable scripts", () => {
  const value = site();
  value.files[0].content = '<script src="missing.js"></script><h1>Site</h1>';
  const output = buildWebPreviewDocument(value, new Map(), { interactive: true });
  expect(output).not.toContain("missing.js");
  value.files[0].content = Array.from({ length: 21 }, () => "<script>document.title='x'</script>").join("");
  expect(() => buildWebPreviewDocument(value, new Map(), { interactive: true })).toThrow("WEB_PREVIEW_SCRIPT_LIMIT");
});
it("preserves interactive controls and data selectors and does not duplicate scripts on re-render", () => {
  const value = site();
  value.files[0].content = '<label for="name">Name</label><input id="name" placeholder="Name" data-action="name"><select name="choice"><option value="a">A</option></select><script src="app.js"></script>';
  value.files[2].content = 'document.body.dataset.text = "</script><h1>not markup</h1>";';
  const prepared = prepareWebPreviewDocument(value, { interactive: true });
  const first = prepared.render(), second = prepared.render();
  expect(second).toBe(first);
  const doc = new DOMParser().parseFromString(second, "text/html");
  expect(doc.querySelectorAll("script")).toHaveLength(1);
  expect(doc.querySelector("h1")).toBeNull();
  expect(doc.querySelector("input").dataset.action).toBe("name");
  expect(doc.querySelector("label").htmlFor).toBe("name");
  expect(doc.querySelector("option").value).toBe("a");
});

it("reconstructs inert markup, strips navigation and resources, and includes styles once", () => {
  const value = site();
  value.files[0].content = '<!doctype html><html><head><title>Original</title><style>h1{color:red}</style><meta http-equiv="refresh" content="0;url=https://evil.test"></head><body><h1>Coffee</h1><a href="https://evil.test" ping="https://evil.test">Link</a><img src="https://evil.test" srcset="https://evil.test 2x"><script>location.href="https://evil.test"</script><link rel="stylesheet" href="styles.css"></body></html>';
  const preview = buildWebPreviewDocument(value), doc = new DOMParser().parseFromString(preview, "text/html");
  expect(doc.querySelector("h1").textContent).toBe("Coffee");
  expect(doc.querySelector("script,link,meta[http-equiv=refresh],iframe,form")).toBeNull();
  expect(doc.querySelector("a").hasAttribute("href")).toBe(false);
  expect(doc.querySelector("img").hasAttribute("src")).toBe(false);
  expect(preview).not.toContain("evil.test");
  expect(preview.match(/body \{ color/g)).toHaveLength(1);
  expect(preview).toContain("h1{color:red}");
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toContain("script-src 'none'");
});
it("prevents raw style termination and caps deep preview trees", () => {
  const value = site();
  value.files[1].content = 'p::before { content: "</style><script>alert(1)</script>"; }';
  expect(new DOMParser().parseFromString(buildWebPreviewDocument(value), "text/html").querySelector("script")).toBeNull();
  value.files[0].content = "<div>".repeat(102) + "Deep" + "</div>".repeat(102);
  expect(() => buildWebPreviewDocument(value)).toThrow("WEB_PREVIEW_COMPLEXITY_LIMIT");
});
it("rejects unexpected message payloads and missing iframe identity", () => {
  const source = {}, event = { source, origin: "null", data: { channel: "modelshot-web-preview-v1", type: "ready", payload: { width: 390 } } };
  expect(() => validateWebPreviewMessage({ ...event, source: undefined }, {})).toThrow();
  for (const payload of [null, { width: Infinity }, { width: 390, html: "x" }]) expect(() => validateWebPreviewMessage({ ...event, data: { ...event.data, payload } }, { source })).toThrow();
  expect(() => validateWebPreviewMessage({ ...event, data: { ...event.data, type: "navigate" } }, { source })).toThrow();
});
it("resolves declared image resources relative to HTML and CSS without exposing private URLs", () => {
  const value = site(), id = "asset-coffee-123456", image = "data:image/webp;base64,UklGRgAAAAAXRUJQ";
  value.entryPath = "pages/index.html"; value.files[0].path = value.entryPath;
  value.files[0].content = '<link rel="stylesheet" href="../styles/site.css"><main style="background:url(../assets/coffee.webp)"><img src="../assets/coffee.webp"><img src="https://external.test/x"><img src="/assets/missing.webp"></main>';
  value.files[1].path = "styles/site.css"; value.files[1].content = 'main { background-image:url("../assets/coffee.webp") }';
  value.assetIds = [id]; value.files.push({ id: "coffee", kind: "asset", path: "assets/coffee.webp", assetId: id });
  const prepared = prepareWebPreviewDocument(value);
  expect(prepared.assetIds).toEqual([id]);
  const preview = prepared.render(new Map([[id, image]])), doc = new DOMParser().parseFromString(preview, "text/html");
  expect(doc.querySelector("img").getAttribute("src")).toBe(image);
  expect(doc.querySelector("main").getAttribute("style")).toContain(image);
  expect(doc.querySelector("style").textContent).toContain(image);
  expect(doc.querySelectorAll("img[src]")).toHaveLength(1);
  expect(preview).not.toContain("/api/assets/"); expect(preview).not.toContain("external.test");
  expect(prepared.render(new Map([[id, "https://external.test"]]))).not.toContain("https://external.test");
});
it("ignores unused asset entries and refuses to turn URL schemes or root escapes into local resources", () => {
  for (const path of ["https://evil.test/a", "//evil.test/a", "data:image/png,x", "../../a", "%2e%2e/a", "..\\a"]) expect(webResourcePath(path, "index.html")).toBeNull();
  expect(webResourcePath("../assets/a.png?v=1", "pages/index.html")).toBe("assets/a.png");
  const value = site(); value.assetIds = ["unused-asset-123456"]; value.files.push({ id: "unused", kind: "asset", path: "unused.png", assetId: value.assetIds[0] });
  expect(prepareWebPreviewDocument(value).assetIds).toEqual([]);
});
it("bounds data expansion before repeatedly embedding a large image", () => {
  const value = site(), id = "asset-coffee-123456";
  value.files[0].content = '<img src="coffee.webp">'.repeat(30);
  value.assetIds = [id]; value.files.push({ id: "coffee", kind: "asset", path: "coffee.webp", assetId: id });
  const prepared = prepareWebPreviewDocument(value);
  expect(() => prepared.render(new Map([[id, "data:image/webp;base64," + "A".repeat(1000000)]]))).toThrow("WEB_PREVIEW_ASSET_LIMIT");
});

it("loads only the active page stylesheets and assets, preserving inline/link cascade order", () => {
  const value = site();
  value.files[0].content = '<style>h1{color:black}</style><link rel="stylesheet" href="styles.css"><style>h1{color:blue}</style><h1>Coffee</h1>';
  value.files.push({ id: "other-css", kind: "css", path: "other.css", content: 'h1{color:green;background:url(unused.webp)}' }, { id: "unused", kind: "asset", path: "unused.webp", assetId: "unused-asset-123456" });
  value.assetIds = ["unused-asset-123456"];
  const prepared = prepareWebPreviewDocument(value), result = new DOMParser().parseFromString(prepared.render(), "text/html");
  expect(prepared.assetIds).toEqual([]);
  expect([...result.querySelectorAll("style")].map(node => node.textContent)).toEqual(["h1{color:black}", "body { color: #111; }", "h1{color:blue}"]);
});
