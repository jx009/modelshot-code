// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createWebVisualSource } from "../../src/lib/creation/web-visual-source.js";
import { patchWebVisualSource } from "../../src/lib/creation/client/web-visual-patch.js";
import { prepareWebPreviewDocument } from "../../src/lib/creation/web-preview.js";
import { bindWebVisualSelection } from "../../src/lib/creation/client/web-visual-selection.js";
const site = content => ({ schemaVersion: 1, kind: "web", title: "Coffee", theme: { primary: "#111111", accent: "#ee5500", background: "#ffffff", fontFamily: "sans" }, entryPath: "index.html", files: [{ id: "html", path: "index.html", kind: "html", content }] });
const target = (session, tag) => [...session.targets.values()].find(value => value.tag === tag);

it("patches just the chosen source span, preserving comments, casing, entities, scripts and sibling whitespace", () => {
  const source = '<!DOCTYPE html>\n<!--keep-->\n<H1 class=hero>A &amp; B</H1>\n<p>😀 unchanged</p><script>const x = "<p>data</p>";</script>';
  const session = createWebVisualSource(source), id = target(session, "h1").id;
  expect(patchWebVisualSource(session, source, id, { text: "A & B" })).toBe(source);
  expect(patchWebVisualSource(session, source, id, { text: '你好 <b> & "' })).toBe(source.replace("A &amp; B", '你好 &lt;b&gt; &amp; "'));
  expect(session.targets.size).toBe(2);
  expect(source).not.toContain("data-modelshot-edit-id");
});
it("edits leaf text without flattening nested formatting or traversing templates, SVG and scripts", () => {
  const session = createWebVisualSource('<h1>Title <em>italic</em></h1><template><p>Hidden</p></template><svg><text>Vector</text></svg><p>Plain</p><script>ignored</script>');
  expect([...session.targets.values()].map(value => value.text)).toEqual(["italic", "Plain"]);
});
it("refuses stale selections, parser errors, duplicate attributes and reserved marker spoofing", () => {
  const source = "<h1>Title</h1>", session = createWebVisualSource(source), id = target(session, "h1").id;
  expect(() => patchWebVisualSource(session, source + " ", id, { text: "New" })).toThrow("WEB_SOURCE_CHANGED");
  expect(() => patchWebVisualSource(session, source, "missing", { text: "New" })).toThrow("WEB_VISUAL_SELECTION_CHANGED");
  expect(() => createWebVisualSource('<p style="color:red" STYLE="color:blue">x</p>')).toThrow("WEB_VISUAL_MARKUP_INVALID");
  expect(() => createWebVisualSource('<p data-modelshot-edit-id="text-100">x</p>')).toThrow("WEB_VISUAL_MARKER_RESERVED");
  expect(createWebVisualSource("<p>implicit close").targets.size).toBe(0);
});
it("escapes new style attributes and preserves existing unrelated declarations", () => {
  const source = '<p id=x style=\'margin:2px;color:red\'>Old</p><p>Other</p>', session = createWebVisualSource(source);
  const changed = patchWebVisualSource(session, source, target(session, "p").id, { text: "New", styles: { color: "#ffaa00", "font-size": "24px", "font-weight": "bold", "text-align": "center" } });
  const doc = new DOMParser().parseFromString(changed, "text/html"), p = doc.querySelector("p");
  expect(p.style.margin).toBe("2px"); expect(p.style.color).toBe("rgb(255, 170, 0)"); expect(p.style.fontSize).toBe("24px");
  expect(p.style.fontWeight).toBe("bold"); expect(changed.endsWith("</p><p>Other</p>")).toBe(true);
  for (const styles of [{ color: 'red" onload="x' }, { "font-size": "301px" }, { background: "url(https://x)" }]) expect(() => patchWebVisualSource(session, source, target(session, "p").id, { text: "x", styles })).toThrow("WEB_VISUAL_STYLE_INVALID");
  const simple = createWebVisualSource("<h1>Title</h1>");
  expect(patchWebVisualSource(simple, simple.source, target(simple, "h1").id, { text: "Title", styles: { "font-size": "30px" } })).toBe('<h1 style="font-size: 30px;">Title</h1>');
});
it("preserves a leading newline in preformatted replacement text and bounds work", () => {
  const source = "<pre>Old</pre>", session = createWebVisualSource(source);
  const changed = patchWebVisualSource(session, source, target(session, "pre").id, { text: "\n新文本\n" });
  expect(new DOMParser().parseFromString(changed, "text/html").querySelector("pre").textContent).toBe("\n新文本\n");
  expect(() => createWebVisualSource("x".repeat(512 * 1024 + 1))).toThrow("WEB_VISUAL_SOURCE_TOO_LARGE");
  expect(() => createWebVisualSource("<p>x</p>".repeat(1001))).toThrow("WEB_VISUAL_TARGET_LIMIT");
  expect(() => createWebVisualSource("<div>".repeat(101) + "x" + "</div>".repeat(101))).toThrow("WEB_PREVIEW_COMPLEXITY_LIMIT");
});
it("keeps verified markers only in edit previews, with generated scripts and navigation removed", () => {
  const source = '<!doctype html><html><head><title>Test</title></head><body><a href="https://example.test">Link</a><h1>Title</h1><script>parent.alert(1)</script></body></html>';
  const session = createWebVisualSource(source), prepared = prepareWebPreviewDocument(site(source), { editing: session });
  const doc = new DOMParser().parseFromString(prepared.render(), "text/html");
  expect(doc.querySelectorAll("[data-modelshot-edit-id]")).toHaveLength(2); expect(prepared.editableIds).toHaveLength(2);
  expect(doc.querySelector("a").hasAttribute("href")).toBe(false); expect(doc.querySelector("script")).toBeNull();
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]').content).toContain("script-src 'none'");
  expect(prepareWebPreviewDocument(site(source)).render()).not.toContain("data-modelshot-edit-id");
  expect(() => prepareWebPreviewDocument(site(source + " "), { editing: session })).toThrow("WEB_SOURCE_CHANGED");
});
it("supports click and keyboard selection, blocks navigation, restores highlights, and refuses changed nodes", () => {
  const source = '<a style="outline:1px solid red">Link</a><p>Other</p>', session = createWebVisualSource(source);
  const doc = document.implementation.createHTMLDocument(); doc.body.innerHTML = session.marked;
  const onSelect = vi.fn(); let allowed = true;
  const binding = bindWebVisualSelection(doc, session.targets, onSelect, () => allowed);
  const a = doc.querySelector("a"), original = a.style.outline;
  const click = new MouseEvent("click", { bubbles: true, cancelable: true }); a.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true); expect(onSelect.mock.lastCall[0].text).toBe("Link");
  allowed = false; doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); binding.select(target(session, "p").id);
  expect(onSelect).toHaveBeenCalledOnce();
  allowed = true; doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); expect(a.style.outline).toBe(original);
  binding.select(target(session, "p").id); expect(onSelect.mock.lastCall[0].text).toBe("Other");
  a.innerHTML = "<span>Link</span>"; a.click(); expect(onSelect.mock.lastCall[0]).toBeNull();
  binding.dispose(); onSelect.mockClear(); a.click(); expect(onSelect).not.toHaveBeenCalled();
  expect(doc.querySelector("p").style.outline).toBe("");
});
