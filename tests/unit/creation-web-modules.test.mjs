// @vitest-environment jsdom
import { expect, it } from "vitest";
import { preparePreviewModules, rewriteModuleReferences } from "../../src/lib/creation/web-modules.js";
import { prepareWebPreviewDocument } from "../../src/lib/creation/web-preview.js";
import { webDeploymentSource } from "../../src/lib/creation/web-deployment.js";
import { prepareWebRename } from "../../src/lib/creation/client/web-rename.js";
import { groupHtmlNodes, ungroupHtmlNode } from "../../src/lib/creation/html/dom-edit.js";

const site = () => ({ schemaVersion: 1, kind: "web", title: "Modules", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [
  { id: "home", path: "index.html", kind: "html", content: '<svg viewBox="0 0 20 20"><path d="M0 0L20 20" stroke="red"/><foreignObject><div>unsafe</div></foreignObject></svg><script type="module" src="js/app.js"></script>' },
  { id: "app", path: "js/app.js", kind: "js", content: 'import { value } from "./value.js"; document.body.dataset.result = value;' },
  { id: "value", path: "js/value.js", kind: "js", content: 'export const value = "ready";' },
] });

it("resolves module graphs with cycles without expanding dependency bodies recursively", () => {
  const content = site(); content.files[2].content += 'export * from "./app.js";';
  const result = preparePreviewModules(content, [{ src: "js/app.js" }]);
  expect(Object.keys(result.imports)).toHaveLength(2);
  expect(decodeURIComponent(result.imports["cw-module-1"])).toContain('export * from "cw-module-0"');
  expect(() => preparePreviewModules(content, [{ code: 'import "https://external.test/a.js";' }])).toThrow("WEB_MODULE_REFERENCE_NOT_FOUND");
});

it("creates inert import maps and preserves safe SVG while dropping active SVG content", () => {
  const html = prepareWebPreviewDocument(site(), { interactive: true, prepareModules: preparePreviewModules }).render();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  expect(parsed.querySelector('script[type="importmap"]')).toBeTruthy();
  expect(parsed.querySelector('script[type="module"]').textContent).toContain("cw-module-0");
  expect(parsed.querySelector("svg").namespaceURI).toBe("http://www.w3.org/2000/svg");
  expect(parsed.querySelector("path").getAttribute("d")).toBe("M0 0L20 20");
  expect(parsed.querySelector("foreignObject")).toBeNull();
});

it("rewrites actual imports, reexports and inline modules consistently for rename and deployment", async () => {
  const source = '/* import "./value.js" */ const text = "./value.js"; export { value } from "/js/value.js";';
  expect(rewriteModuleReferences(source, () => "./renamed.js")).toBe('/* import "./value.js" */ const text = "./value.js"; export { value } from "./renamed.js";');
  const content = site(); content.files[1].content = source;
  expect(webDeploymentSource(content.files[1], content)).toContain('from "./value.js"');
  expect(webDeploymentSource({ path: "index.html", kind: "html", content: '<script type="module">import "/js/app.js";</script>' }, content)).toContain('import "./js/app.js"');
  const plan = await prepareWebRename(site(), { fileId: "value", path: "js/value.js", nextPath: "lib/renamed.js" }, { yieldControl: async () => {} });
  expect(plan.operations[0].updates[0].content).toContain('from "../lib/renamed.js"');
});

it("groups adjacent nodes in document order and refuses to reorder unrelated flex/grid siblings", () => {
  if (!globalThis.CSS?.escape) globalThis.CSS = { escape: value => value };
  const doc = new DOMParser().parseFromString('<div><b data-node-id="a">A</b> <b data-node-id="b">B</b> <b data-node-id="c">C</b></div>', "text/html");
  expect(() => groupHtmlNodes(doc, ["a", "c"], "bad")).toThrow("HTML_GROUP_REQUIRES_ADJACENT_SIBLINGS");
  groupHtmlNodes(doc, ["b", "a"], "group"); expect(doc.querySelector('[data-group]').textContent).toBe("A B");
  ungroupHtmlNode(doc, "group"); expect(doc.body.textContent).toBe("A B C");
});
