import { expect, it } from "vitest";
import { webSchema } from "../../src/lib/creation/contracts/web.js";
import { prepareWebRename, webReferenceRewrite } from "../../src/lib/creation/client/web-rename.js";
import { rewriteCssReferences } from "../../src/lib/creation/web-reference-css.js";
import { applyWebOperations, applyWebOperationsWithInverse } from "../../src/lib/creation/web-operations.js";
import { assertLayoutJournalCapacity, nextLayoutOperationBatch } from "../../src/lib/creation/layout-journal.js";
const site = () => webSchema.parse({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", assetIds: ["photo"], files: [
  { id: "html", path: "index.html", kind: "html", content: '<!doctype html><html><head><link rel=stylesheet href="styles/main.css"></head><body><img src="assets/a.webp"><a href="pages/about.html?lang=en&amp;theme=dark#info">About</a></body></html>' },
  { id: "about", path: "pages/about.html", kind: "html", content: '<img srcset="../assets/a.webp 1x, /assets/a.webp 2x"><a href="../index.html">Home</a>' },
  { id: "css", path: "styles/main.css", kind: "css", content: '/* url(../assets/a.webp) is a comment */\n.hero { background:url(../assets/a.webp) }\np::after { content:"url(../assets/a.webp)" }' },
  { id: "image", path: "assets/a.webp", kind: "asset", assetId: "photo" },
  { id: "script", path: "app.js", kind: "js", content: 'const dynamicImage = "assets/a.webp";' },
] });
const rename = (content, fileId, nextPath, options) => prepareWebRename(content, { fileId, path: content.files.find(file => file.id === fileId).path, nextPath }, { yieldControl: async () => {}, ...options });
const source = (content, id) => content.files.find(file => file.id === id).content;
it("renames an image and updates HTML/CSS resources as one reversible journal operation", async () => {
  const content = site(), original = structuredClone(content), plan = await rename(content, "image", "media/hero.webp");
  expect(plan.operations).toHaveLength(1); expect(plan.operations[0].updates).toHaveLength(3);
  const result = applyWebOperationsWithInverse(content, plan.operations), next = result.document;
  expect(source(next, "html")).toContain('src="media/hero.webp"');
  expect(source(next, "about")).toContain('srcset="../media/hero.webp 1x, /media/hero.webp 2x"');
  expect(source(next, "css")).toContain('background:url("../media/hero.webp")');
  expect(source(next, "css")).toContain('/* url(../assets/a.webp) is a comment */');
  expect(source(next, "css")).toContain('content:"url(../assets/a.webp)"'); expect(source(next, "script")).toBe(source(content, "script"));
  expect(result.inverse).toHaveLength(1); expect(applyWebOperations(next, result.inverse)).toEqual(original); expect(content).toEqual(original);
  expect(nextLayoutOperationBatch(plan.operations)).toEqual(plan.operations);
});
it("rebases a moved entry page's own links while updating references to it and keeping query/fragment navigation", async () => {
  const content = site(); content.files[0].content += '<a href="?q=1">Query</a><a href="#section">Section</a><a href="/?q=1">Root</a>';
  const plan = await rename(content, "html", "pages/home.html"), next = applyWebOperations(content, plan.operations);
  expect(next.entryPath).toBe("pages/home.html");
  expect(source(next, "html")).toContain('href="../styles/main.css"'); expect(source(next, "html")).toContain('src="../assets/a.webp"');
  expect(source(next, "html")).toContain('href="about.html?lang=en&amp;theme=dark#info"');
  expect(source(next, "html")).toContain('href="?q=1"'); expect(source(next, "html")).toContain('href="#section"'); expect(source(next, "html")).toContain('href="/?q=1"');
  expect(source(next, "about")).toContain('href="home.html"');
});
it("rebases CSS resources relative to the moved stylesheet, independently from the linking HTML", async () => {
  const content = site(), plan = await rename(content, "css", "theme.css"), next = applyWebOperations(content, plan.operations);
  expect(source(next, "html")).toContain('href="theme.css"');
  expect(source(next, "css")).toContain('url("assets/a.webp")');
  expect(source(next, "about")).toBe(source(content, "about"));
});
it("handles CSS escapes and image-set while preserving unrelated strings and external resources", () => {
  const rewrite = value => webReferenceRewrite(value, "styles/main.css", "styles/main.css", "assets/a.webp", "assets/new.webp");
  const css = String.raw`.a{background:u\72 l("../assets/\61.webp")} .b{background:image-set('../assets/a.webp' 1x, url('../assets/a.webp') 2x)} .c{background:url(data:image/png;base64,AAA)} .d{content:'../assets/a.webp'}`;
  const next = rewriteCssReferences(css, rewrite);
  expect(next).toContain('background:url("../assets/new.webp")'); expect(next).toContain('image-set("../assets/new.webp" 1x, url("../assets/new.webp") 2x)');
  expect(next).toContain('url(data:image/png;base64,AAA)'); expect(next).toContain("content:'../assets/a.webp'");
  expect(rewriteCssReferences('x { background:url("../other.webp") }', rewrite)).toBe('x { background:url("../other.webp") }');
});
it("rewrites inline styles, style blocks, template markup and srcsets without touching comments or scripts", async () => {
  const content = site(); content.files[0].content = '<!-- assets/a.webp --><style>.hero{background:url(assets/a.webp)}</style><div style="background:url(assets/a.webp)">X</div><template><img src="assets/a.webp"></template><img srcset="data:image/png;base64,AAAA 1x, assets/a.webp 2x"><script>const path = "assets/a.webp";</script>';
  const next = applyWebOperations(content, (await rename(content, "image", "assets/new.webp")).operations), html = source(next, "html");
  expect(html).toContain('<style>.hero{background:url("assets/new.webp")}</style>'); expect(html).toContain('style="background:url(&quot;assets/new.webp&quot;)"');
  expect(html).toContain('<template><img src="assets/new.webp"></template>'); expect(html).toContain('srcset="data:image/png;base64,AAAA 1x, assets/new.webp 2x"');
  expect(html).toContain('<!-- assets/a.webp -->'); expect(html).toContain('<script>const path = "assets/a.webp";</script>');
});
it("preserves URL suffixes and external URLs, supports encoded filenames, and refuses ambiguous local paths", () => {
  const rewrite = value => webReferenceRewrite(value, "index.html", "pages/index.html", "assets/a.webp", "media/new.webp");
  expect(rewrite(" assets/%61.webp?q=1&other=2#thumb ")).toBe(" ../media/new.webp?q=1&other=2#thumb ");
  for (const value of ["https://example.test/assets/a.webp", "//example.test/a.webp", "mailto:a@example.test", "#x", "?q=1", "/?q=1"]) expect(rewrite(value)).toBe(value);
  expect(rewrite("/other.webp")).toBe("/other.webp");
  for (const value of ["assets%2fa.webp", "assets\\a.webp", "%zz.webp", "../../secret.webp"]) expect(() => rewrite(value)).toThrow("WEB_REFERENCE_PATH_UNSUPPORTED");
});
it("refuses malformed sources and conflicting names before applying any changes", async () => {
  const content = site(), original = structuredClone(content);
  await expect(rename(content, "html", "PAGES/ABOUT.HTML")).rejects.toThrow("WEB_DUPLICATE_FILE");
  expect(content).toEqual(original);
  content.files[0].content = '<img src="assets/a.webp" src="other.webp">';
  await expect(rename(content, "image", "new.webp")).rejects.toThrow("WEB_VISUAL_MARKUP_INVALID");
  content.files[0].content = '<p>Valid</p>'; content.files[2].content = 'p { background:url("unfinished) }';
  await expect(rename(content, "image", "new.webp")).rejects.toThrow("WEB_REFERENCE_CSS_UNSUPPORTED");
  expect(content.files[3].path).toBe("assets/a.webp");
});
it("cancels between files, treats unchanged paths as no-ops, and supports case-only renames", async () => {
  const content = site(), controller = new AbortController(); let yields = 0;
  await expect(rename(content, "image", "new.webp", { signal: controller.signal, yieldControl: async () => { yields++; controller.abort(); } })).rejects.toThrow("ARTIFACT_CLOSED");
  expect(yields).toBe(1); expect((await rename(content, "html", "index.html")).operations).toEqual([]);
  const next = applyWebOperations(content, (await rename(content, "image", "assets/A.webp")).operations);
  expect(source(next, "html")).toContain('src="assets/A.webp"');
});
it("rejects oversized atomic renames instead of splitting references from the path change", async () => {
  const content = site(); content.files[0].content += "<!--" + "x".repeat(245 * 1024) + "-->";
  const plan = await rename(content, "image", "new.webp");
  expect(() => assertLayoutJournalCapacity([], plan.operations)).toThrow("LAYOUT_OPERATION_TOO_LARGE");
  expect(() => nextLayoutOperationBatch(plan.operations)).toThrow("LAYOUT_OPERATION_TOO_LARGE");
  expect(content.files[3].path).toBe("assets/a.webp");
});
it("rejects stale or duplicate source updates and restores an atomic rename exactly", async () => {
  const content = site(), plan = await rename(content, "css", "new.css"), operation = plan.operations[0];
  expect(() => applyWebOperations(content, [{ ...operation, updates: [...operation.updates, operation.updates[0]] }])).toThrow("WEB_FILE_NOT_FOUND");
  expect(() => applyWebOperations(content, [{ ...operation, updates: [{ ...operation.updates[0], path: "stale.html" }] }])).toThrow("WEB_FILE_NOT_FOUND");
  const result = applyWebOperationsWithInverse(content, plan.operations), restored = applyWebOperationsWithInverse(result.document, result.inverse);
  expect(restored.document).toEqual(content); expect(applyWebOperations(restored.document, restored.inverse)).toEqual(result.document);
});
